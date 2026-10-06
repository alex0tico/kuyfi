import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import test from 'ava';
import express from 'express';
import {Keypair} from '@stellar/stellar-sdk';
import {createScanServer} from './scan_server.js';

/**
 * The paid /scan endpoint, exercised without any network: a stub
 * facilitator answers /supported and a stub oracle prices CLP, so these
 * tests check the 400 and 402 paths only — never a real payment or scan.
 */

const CONTRACT_ID = 'CAV2DLUWVABTEFGWBGJXROWMKNEFT5JJMRISRBRF7K666BQ4J3LFMLHO';
const PAY_TO = Keypair.random().publicKey();

const stubOracle = {
	async getRate(currency: string) {
		if (currency !== 'CLP') throw new Error(`unexpected ${currency}`);
		// 1 CLP = 0.001 USD, scaled by 10^14.
		return {
			usdPerUnit: 100_000_000_000n,
			decimals: 14,
			timestamp: Math.floor(Date.now() / 1000),
			source: 'stub',
		};
	},
};

async function listen(
	app: express.Express,
): Promise<{server: Server; url: string}> {
	return new Promise(resolve => {
		const server = app.listen(0, () => {
			const {port} = server.address() as AddressInfo;
			resolve({server, url: `http://127.0.0.1:${port}`});
		});
	});
}

async function startScanServer() {
	const facilitator = express();
	facilitator.get('/supported', (_req, res) => {
		res.json({
			kinds: [
				{x402Version: 2, scheme: 'exact', network: 'stellar:testnet'},
				{
					x402Version: 2,
					scheme: 'exact-fx',
					network: 'stellar:testnet',
					extra: {
						fxContract:
							'CD6PUDBJNDYWLTQPHYU26OCEH4GWR7WN3UIXAEKUP3DQIS3DKJQIF7DL',
					},
				},
			],
			extensions: [],
			signers: {},
		});
	});
	const stubFacilitator = await listen(facilitator);

	const scanServer = await listen(
		createScanServer({
			payTo: PAY_TO,
			price: '500 CLP',
			network: 'stellar:testnet',
			facilitatorUrl: stubFacilitator.url,
			oracle: stubOracle,
		}),
	);

	return {
		url: scanServer.url,
		close() {
			scanServer.server.close();
			scanServer.server.closeAllConnections();
			stubFacilitator.server.close();
			stubFacilitator.server.closeAllConnections();
		},
	};
}

test('rejects a malformed contract ID with 400 before any price is quoted', async t => {
	const server = await startScanServer();
	t.teardown(server.close);

	const response = await fetch(`${server.url}/scan/not-a-contract`);

	t.is(response.status, 400);
	t.is(response.headers.get('payment-required'), null);
	t.is(
		((await response.json()) as {error: string}).error,
		'INVALID_CONTRACT_ID',
	);
});

test('answers an unpaid scan with 402 priced in CLP and paid in USDC to PAY_TO', async t => {
	const server = await startScanServer();
	t.teardown(server.close);

	const response = await fetch(`${server.url}/scan/${CONTRACT_ID}`);

	t.is(response.status, 402);
	const header = response.headers.get('payment-required');
	t.truthy(header);
	const required = JSON.parse(
		Buffer.from(header!, 'base64').toString('utf8'),
	) as {
		accepts: Array<{
			scheme: string;
			network: string;
			payTo: string;
			amount: string;
		}>;
	};

	t.deepEqual(
		required.accepts.map(a => a.scheme),
		['exact', 'exact-fx'],
	);
	for (const accept of required.accepts) {
		t.is(accept.network, 'stellar:testnet');
		t.is(accept.payTo, PAY_TO);
		// 500 CLP at 0.001 USD = 0.5 USDC = 5,000,000 stroops.
		t.is(accept.amount, '5000000');
	}
});
