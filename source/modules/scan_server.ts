import express from 'express';
import type {Express} from 'express';
import {paymentMiddleware} from '@x402/express';
import {local402Server, localRoute} from 'local402-server';
import type {LocalRouteOptions} from 'local402-server';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL} from './network.js';
import {isValidContractId, scanContract, ScanError} from './scanner.js';
import type {ScanErrorCode} from './scanner.js';
import {toPublicScan} from './security_report.js';

export type PaymentNetwork = NonNullable<LocalRouteOptions['network']>;

export interface ScanServerOptions {
	/** Public Stellar address (G…) that receives the USDC. Never a secret key. */
	payTo: string;
	/** Price in the seller's currency, e.g. "500 CLP" — converted to USDC per request via Reflector. */
	price: string;
	/** Network the payment settles on. Independent of the scan, which always reads Testnet. */
	network: PaymentNetwork;
	facilitatorUrl: string;
	/** Defaults to Reflector — override only for tests. */
	oracle?: LocalRouteOptions['oracle'];
}

const SCAN_ERROR_STATUS: Record<ScanErrorCode, number> = {
	CONTRACT_NOT_FOUND: 404,
	XDR_ALIGN_FAILURE: 422,
	RPC_UNAVAILABLE: 502,
	UNKNOWN: 500,
};

/**
 * HTTP surface for the OSINT Scanner only: `GET /scan/:contractId` answers
 * 402 with a local-currency price, and returns the read-only attack surface
 * once paid. Chaos Monkey is deliberately not exposed — it broadcasts
 * transactions against the target, which must stay an explicit local action.
 */
export function createScanServer(options: ScanServerOptions): Express {
	const rpcServer = new SorobanRpc.Server(TESTNET_RPC_URL);
	const app = express();

	// Before the paywall, so a malformed ID is rejected instead of priced.
	app.get('/scan/:contractId', (req, res, next) => {
		if (isValidContractId(req.params.contractId)) {
			next();
			return;
		}

		res.status(400).json({
			error: 'INVALID_CONTRACT_ID',
			message: 'Expected 56 characters starting with C (A-Z, 0-9).',
		});
	});

	app.use(
		paymentMiddleware(
			{
				'GET /scan/:contractId': localRoute(options.price, {
					payTo: options.payTo,
					network: options.network,
					oracle: options.oracle,
					description:
						'Kuyfi OSINT scan: functions, parameters and types of a Soroban Testnet contract',
				}),
			},
			local402Server(options.facilitatorUrl, options.network),
		),
	);

	app.get('/scan/:contractId', async (req, res) => {
		try {
			const scan = await scanContract(req.params.contractId, rpcServer);
			res.json({
				contractId: scan.contractId,
				network: 'testnet',
				bytecodeSize: scan.bytecodeSize,
				...toPublicScan(scan),
			});
		} catch (error) {
			// x402 only settles when the handler answers below 400, so a failed scan is never charged.
			const code = error instanceof ScanError ? error.code : 'UNKNOWN';
			res.status(SCAN_ERROR_STATUS[code]).json({error: code});
		}
	});

	return app;
}
