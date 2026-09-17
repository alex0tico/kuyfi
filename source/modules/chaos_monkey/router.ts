import {
	Contract,
	Keypair,
	TransactionBuilder,
	rpc as SorobanRpc,
	xdr,
} from '@stellar/stellar-sdk';

export interface InvokeParams {
	contractId: string;
	functionName: string;
	args: xdr.ScVal[];
	keypair: Keypair;
	server: SorobanRpc.Server;
	networkPassphrase: string;
}

export interface InvokeResult {
	success: boolean;
	/**
	 * True iff sendTransaction() was actually called against the RPC node —
	 * i.e. simulation succeeded and a signed envelope left the process.
	 * false covers both SIMULATION_ERROR (never attempted) and SEND_ERROR
	 * (the node rejected the envelope before it entered the network, per
	 * the SDK's own SendTransactionStatus.ERROR semantics). A transaction
	 * hash may still be present even when broadcasted is false (SEND_ERROR
	 * carries the locally-computed envelope hash) — absence of a hash must
	 * never be inferred from broadcasted alone; always check both fields.
	 */
	broadcasted: boolean;
	transactionHash: string | null;
	/**
	 * Ledger sequence the transaction was included in, from
	 * GetSuccessfulTransactionResponse.ledger / GetFailedTransactionResponse.ledger.
	 * null whenever no polled getTransaction response reached SUCCESS/FAILED
	 * (SIMULATION_ERROR, SEND_ERROR, TIMEOUT, EXCEPTION).
	 */
	ledger: number | null;
	resultValue: xdr.ScVal | null;
	errorCode: string | null;
	errorMessage: string | null;
	simulationFailed: boolean;
	/**
	 * Structured DiagnosticEvent array as returned by Soroban RPC, preserved
	 * as-is (never stringified). Source depends on the outcome:
	 *   - simulation error  → simResult.events (always present, per SDK)
	 *   - SEND_ERROR        → sendResult.diagnosticEvents ?? []
	 *   - success / TX_FAILED → pollResult.diagnosticEventsXdr ?? []
	 *   - TIMEOUT / EXCEPTION → [] (no RPC response to read events from)
	 * Always an array — absence of events is [], never omitted or thrown.
	 */
	diagnosticEvents: xdr.DiagnosticEvent[];
}

const BASE_FEE = '100';
const TX_TIMEOUT_SECONDS = 30;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 20;

/**
 * Builds, simulates, signs, submits, and polls a Soroban contract invocation.
 * Never throws — all errors are caught and returned in InvokeResult.
 *
 * Flow:
 * 1. getAccount → build tx with TransactionBuilder
 * 2. simulateTransaction to get footprint
 * 3. If simulation fails → return simulationFailed: true
 * 4. assembleTransaction with simulation result
 * 5. Sign with keypair
 * 6. sendTransaction
 * 7. Poll getTransaction every 1000ms up to 20 attempts
 */
export async function invokeContract(
	params: InvokeParams,
): Promise<InvokeResult> {
	// Tracks the hash of a transaction that DID reach sendTransaction() with a
	// non-ERROR status, so evidence survives even if an exception is thrown
	// later (e.g. a network hiccup mid-poll) — see the catch block below.
	let sentTxHash: string | null = null;

	try {
		const account = await params.server.getAccount(params.keypair.publicKey());

		const contract = new Contract(params.contractId);
		const tx = new TransactionBuilder(account, {
			fee: BASE_FEE,
			networkPassphrase: params.networkPassphrase,
		})
			.addOperation(contract.call(params.functionName, ...params.args))
			.setTimeout(TX_TIMEOUT_SECONDS)
			.build();

		const simResult = await params.server.simulateTransaction(tx);

		if (SorobanRpc.Api.isSimulationError(simResult)) {
			return {
				success: false,
				broadcasted: false,
				transactionHash: null,
				ledger: null,
				resultValue: null,
				errorCode: 'SIMULATION_ERROR',
				errorMessage: simResult.error,
				simulationFailed: true,
				diagnosticEvents: simResult.events,
			};
		}

		const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
		preparedTx.sign(params.keypair);

		const sendResult = await params.server.sendTransaction(preparedTx);

		if (sendResult.status === 'ERROR') {
			return {
				success: false,
				broadcasted: false,
				transactionHash: sendResult.hash,
				ledger: null,
				resultValue: null,
				errorCode: 'SEND_ERROR',
				errorMessage: 'Network rejected transaction before broadcast',
				simulationFailed: false,
				diagnosticEvents: sendResult.diagnosticEvents ?? [],
			};
		}

		const txHash = sendResult.hash;
		sentTxHash = txHash;

		for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
			await new Promise<void>(resolve => {
				setTimeout(resolve, POLL_INTERVAL_MS);
			});

			const pollResult = await params.server.getTransaction(txHash);

			if (pollResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
				return {
					success: true,
					broadcasted: true,
					transactionHash: txHash,
					ledger: pollResult.ledger,
					resultValue: pollResult.returnValue ?? null,
					errorCode: null,
					errorMessage: null,
					simulationFailed: false,
					diagnosticEvents: pollResult.diagnosticEventsXdr ?? [],
				};
			}

			if (pollResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
				return {
					success: false,
					broadcasted: true,
					transactionHash: txHash,
					ledger: pollResult.ledger,
					resultValue: null,
					errorCode: 'TX_FAILED',
					errorMessage: 'Transaction failed during on-chain execution',
					simulationFailed: false,
					diagnosticEvents: pollResult.diagnosticEventsXdr ?? [],
				};
			}
			// NOT_FOUND — still pending, keep polling
		}

		return {
			success: false,
			broadcasted: true,
			transactionHash: txHash,
			ledger: null,
			resultValue: null,
			errorCode: 'TIMEOUT',
			errorMessage: `Transaction not confirmed after ${MAX_POLL_ATTEMPTS} polling attempts`,
			simulationFailed: false,
			diagnosticEvents: [],
		};
	} catch (error) {
		return {
			success: false,
			broadcasted: sentTxHash !== null,
			transactionHash: sentTxHash,
			ledger: null,
			resultValue: null,
			errorCode: 'EXCEPTION',
			errorMessage: error instanceof Error ? error.message : String(error),
			simulationFailed: false,
			diagnosticEvents: [],
		};
	}
}
