import {
	Account,
	Contract,
	TransactionBuilder,
	rpc as SorobanRpc,
	xdr,
} from '@stellar/stellar-sdk';
import type {Keypair} from '@stellar/stellar-sdk';

/**
 * Worker version of the CLI router: SIMULATION ONLY. It never signs, never
 * calls sendTransaction/getTransaction and needs no funded account. The
 * keypair argument is kept so the copied fuzzers compile unchanged; only its
 * public key is used, as the (unsigned) source address of the simulation.
 */
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
	/** Always false in the Worker: nothing is ever sent. Kept for the shared result shape. */
	broadcasted: boolean;
	transactionHash: string | null;
	ledger: number | null;
	resultValue: xdr.ScVal | null;
	errorCode: string | null;
	errorMessage: string | null;
	simulationFailed: boolean;
	diagnosticEvents: xdr.DiagnosticEvent[];
}

const BASE_FEE = '100';

/** Counts simulations so a request never exceeds its subrequest budget. */
export class BudgetedServer extends SorobanRpc.Server {
	simulationsRun = 0;
	simulationsSkipped = 0;

	constructor(
		url: string,
		readonly simulationLimit: number,
	) {
		super(url, {allowHttp: false});
	}
}

export const NOT_RUN = 'NOT_RUN';

export async function invokeContract(
	params: InvokeParams,
): Promise<InvokeResult> {
	const {server} = params;
	if (server instanceof BudgetedServer) {
		if (server.simulationsRun >= server.simulationLimit) {
			server.simulationsSkipped++;
			return notRun();
		}

		server.simulationsRun++;
	}

	try {
		// Sequence 0 is enough: the transaction is only simulated.
		const account = new Account(params.keypair.publicKey(), '0');
		const tx = new TransactionBuilder(account, {
			fee: BASE_FEE,
			networkPassphrase: params.networkPassphrase,
		})
			.addOperation(
				new Contract(params.contractId).call(
					params.functionName,
					...params.args,
				),
			)
			.setTimeout(30)
			.build();

		const sim = await server.simulateTransaction(tx);

		if (SorobanRpc.Api.isSimulationError(sim)) {
			return {
				success: false,
				broadcasted: false,
				transactionHash: null,
				ledger: null,
				resultValue: null,
				errorCode: 'SIMULATION_ERROR',
				errorMessage: sim.error,
				simulationFailed: true,
				diagnosticEvents: sim.events,
			};
		}

		return {
			success: true,
			broadcasted: false,
			transactionHash: null,
			ledger: null,
			resultValue: sim.result?.retval ?? null,
			errorCode: null,
			errorMessage: null,
			simulationFailed: false,
			diagnosticEvents: [],
		};
	} catch (error) {
		return {
			success: false,
			broadcasted: false,
			transactionHash: null,
			ledger: null,
			resultValue: null,
			errorCode: 'EXCEPTION',
			errorMessage: error instanceof Error ? error.message : String(error),
			simulationFailed: false,
			diagnosticEvents: [],
		};
	}
}

function notRun(): InvokeResult {
	return {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: NOT_RUN,
		errorMessage: 'vector not run: simulation budget exhausted',
		simulationFailed: false,
		diagnosticEvents: [],
	};
}
