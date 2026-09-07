import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {generateEphemeralKeypair} from './keypair_factory.js';
import {fuzzMathVectors} from './fuzzer_math.js';
import {fuzzAccessVectors, isAdminFunctionByName} from './fuzzer_access.js';
import {fuzzFeeVectors} from './fuzzer_fee.js';
import {fuzzLiquidityVectors} from './fuzzer_liquidity.js';
import {fuzzCallOrderVectors} from './fuzzer_call_order.js';
import {buildReport} from './reporter.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';
import type {UdtRegistry} from './type_gen.js';
import type {ChaosReport} from './reporter.js';

export type {ChaosReport} from './reporter.js';
export type {Finding} from './reporter.js';
export {formatReportForTerminal} from './reporter.js';
export type {FuzzResult} from './fuzzer_math.js';
export type {ParsedResult} from './result_parser.js';
export type {UdtRegistry, UdtField} from './type_gen.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

const RPC_URL = 'https://soroban-testnet.stellar.org';

export interface ChaosMonkeyOptions {
	contractId: string;
	functions: Array<{
		name: string;
		params: Array<{name: string; type: AnyTypeDef}>;
	}>;
	/**
	 * UDT struct registry built from scSpecEntryUdtStructV0 entries.
	 * Used to construct valid struct ScVals for Vec<UDT> parameters.
	 */
	udtRegistry: UdtRegistry;
	onProgress: (message: string) => void;
}

/**
 * Runs the complete Chaos Monkey session against a Soroban contract.
 *
 * 1. Generates an ephemeral keypair and funds it via Friendbot
 * 2. Connects to Testnet RPC
 * 3. For each discovered function: runs type-aware math, access-control,
 *    fee/BPS-boundary, and liquidity-ratio vectors (each fuzzer self-gates
 *    on whether the function's name/params match its own hypothesis)
 * 4. Once per session (not per function): checks for call-ordering sequence
 *    candidates (e.g. initialize→initialize, claim→claim)
 * 5. Builds and returns the final ChaosReport
 *
 * Every vector's outcome is classified by the same trace-primary classifier
 * (result_parser.ts) — a vector can only PROVE an attack hypothesis by
 * producing evidence; it never itself declares a finding.
 */
export async function runChaosMonkey(
	options: ChaosMonkeyOptions,
): Promise<ChaosReport> {
	const {contractId, functions, udtRegistry, onProgress} = options;

	onProgress('Generating ephemeral keypair...');
	const keypair = await generateEphemeralKeypair();
	onProgress(`Keypair funded: ${keypair.publicKey().slice(0, 10)}...`);

	const server = new SorobanRpc.Server(RPC_URL);
	onProgress(`Connected to RPC: ${RPC_URL}`);
	onProgress(`Starting fuzzing session on ${functions.length} function(s)...`);

	const allResults: FuzzResult[] = [];

	for (const fn of functions) {
		const target: FuzzTarget = {
			contractId,
			functionName: fn.name,
			params: fn.params,
			isAdminFunction: isAdminFunctionByName(fn.name),
		};

		onProgress(
			`[${fn.name}] Running math vectors (${fn.params.length} params)...`,
		);
		try {
			const mathResults = await fuzzMathVectors(
				target,
				keypair,
				server,
				udtRegistry,
			);
			allResults.push(...mathResults);
			onProgress(`[${fn.name}] Math done (${mathResults.length} invocations)`);
		} catch (error) {
			onProgress(
				`[${fn.name}] Math fuzzer error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		// Always attempted — fuzzAccessVectors self-gates each of its vectors
		// (admin-name UNAUTHORIZED_CALL/REINIT_ATTACK/SELF_CALL_ATTACK, and
		// UNAUTHORIZED_ADDR_CALL for non-admin functions with an Address
		// parameter), so a function with none of those shapes just yields [].
		onProgress(`[${fn.name}] Running access control vectors...`);
		try {
			const accessResults = await fuzzAccessVectors(
				target,
				keypair,
				server,
				udtRegistry,
			);
			allResults.push(...accessResults);
			onProgress(
				`[${fn.name}] Access done (${accessResults.length} invocations)`,
			);
		} catch (error) {
			onProgress(
				`[${fn.name}] Access fuzzer error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		// Fee/BPS and liquidity-ratio vectors self-gate on param name/type and
		// function name respectively — a function with neither shape yields [].
		try {
			const feeResults = await fuzzFeeVectors(
				target,
				keypair,
				server,
				udtRegistry,
			);
			if (feeResults.length > 0) {
				allResults.push(...feeResults);
				onProgress(
					`[${fn.name}] Fee/BPS vectors: ${feeResults.length} invocation(s)`,
				);
			}
		} catch (error) {
			onProgress(
				`[${fn.name}] Fee fuzzer error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		try {
			const liquidityResults = await fuzzLiquidityVectors(
				target,
				keypair,
				server,
				udtRegistry,
			);
			if (liquidityResults.length > 0) {
				allResults.push(...liquidityResults);
				onProgress(
					`[${fn.name}] Liquidity-ratio vectors: ${liquidityResults.length} invocation(s)`,
				);
			}
		} catch (error) {
			onProgress(
				`[${fn.name}] Liquidity fuzzer error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	// Call-ordering runs once per session (not per function) — it matches at
	// most one function per sequence group across the whole discovered set.
	onProgress('Checking for call-ordering sequence candidates...');
	try {
		const callOrderResults = await fuzzCallOrderVectors(
			contractId,
			functions,
			keypair,
			server,
			udtRegistry,
		);
		if (callOrderResults.length > 0) {
			allResults.push(...callOrderResults);
			onProgress(
				`Call-ordering vectors: ${callOrderResults.length} invocation(s)`,
			);
		}
	} catch (error) {
		onProgress(
			`Call-ordering fuzzer error: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	onProgress('Building report...');
	const report = buildReport(contractId, allResults);

	onProgress(
		`Scan complete — ${report.findings.length} finding(s) | ` +
			`CRITICAL: ${report.summary.critical} HIGH: ${report.summary.high}`,
	);

	return report;
}
