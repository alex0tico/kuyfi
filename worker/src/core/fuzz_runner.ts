import {Keypair, Networks} from '@stellar/stellar-sdk';
import {isAdminFunctionByName, fuzzAccessVectors} from './fuzzer_access.js';
import {fuzzFeeVectors} from './fuzzer_fee.js';
import {fuzzLiquidityVectors} from './fuzzer_liquidity.js';
import {fuzzMathVectors} from './fuzzer_math.js';
import type {FuzzResult, FuzzTarget} from './fuzzer_math.js';
import {HARD_MAX_VECTORS} from './guards.js';
import {TESTNET_RPC_URL} from './network.js';
import {SCHEMA_VERSION, TOOL} from './public_scan.js';
import type {Severity, VulnerabilitySignal} from './result_parser.js';
import {BudgetedServer, NOT_RUN} from './router.js';
import type {ScanResult} from './scanner.js';

/** Subrequests used before fuzzing starts: the contract instance + code lookups. */
export const SCAN_SUBREQUESTS = 2;
/** Left unused for the one-off requests around the run. */
const SAFETY_MARGIN = 1;

export type FindingStatus = 'supported' | 'hypothesis' | 'inconclusive';

/** Same mapping the CLI uses (FINDING-STATUS): a status says how much is established. */
export function findingStatus(signal: VulnerabilitySignal): FindingStatus | null {
	switch (signal) {
		case 'UNCONTROLLED_PANIC':
			return 'supported';
		case 'POTENTIAL_VULN':
			return 'hypothesis';
		case 'UNEXPECTED_ERROR':
		case 'TIMEOUT':
		case 'SIMULATION_FAIL':
			return 'inconclusive';
		// SECURE and PRECONDITION_FAIL are not findings; NOT_EVALUATED goes to coverage.
		default:
			return null;
	}
}

const DISCLAIMER =
	'Bounded black-box simulation on Testnet. It sends no transactions and does not enforce authorization, so it cannot show that a contract is correct or protected. Not a security guarantee.';

export interface FuzzOptions {
	maxVectors: number;
	/** Subrequests available to this request (50 on the Workers Free plan). */
	subrequestBudget: number;
}

/** Simulations this request may run, given the requested count and the budget. */
export function simulationAllowance(maxVectors: number, subrequestBudget: number): number {
	const room = Math.max(0, subrequestBudget - SCAN_SUBREQUESTS - SAFETY_MARGIN);
	return Math.min(maxVectors, HARD_MAX_VECTORS, room);
}

interface Row {
	functionName: string;
	vectorName: string;
	signal: VulnerabilitySignal;
	severity: Severity;
	details: string;
}

export async function runFuzz(scan: ScanResult, options: FuzzOptions, reportId: string, now: Date = new Date()) {
	const allowed = simulationAllowance(options.maxVectors, options.subrequestBudget);
	const server = new BudgetedServer(TESTNET_RPC_URL, allowed);
	// Never signs: only its public key is used as the source address of a simulation.
	const keypair = Keypair.random();
	const results: FuzzResult[] = [];
	const operationalErrors: string[] = [];

	for (const fn of scan.functions) {
		const target: FuzzTarget = {
			contractId: scan.contractId,
			functionName: fn.name,
			params: fn.params,
			isAdminFunction: isAdminFunctionByName(fn.name),
		};
		const fuzzers = [
			['math', fuzzMathVectors],
			['access', fuzzAccessVectors],
			['fee', fuzzFeeVectors],
			['liquidity', fuzzLiquidityVectors],
		] as const;
		for (const [family, run] of fuzzers) {
			try {
				results.push(...(await run(target, keypair, server, scan.udtRegistry)));
			} catch (error) {
				operationalErrors.push(`${fn.name}/${family}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	const executed = results.filter(r => r.result.rawErrorCode !== NOT_RUN);
	const rows: Array<Row & {raw: string | null}> = executed.map(r => ({
		functionName: r.result.functionName,
		vectorName: r.result.vectorName,
		signal: r.result.signal,
		severity: r.result.severity,
		details: r.result.details,
		raw: r.result.rawErrorCode,
	}));
	// A tool/network failure is not a finding about the contract.
	const operational = rows.filter(r => r.raw === 'EXCEPTION');
	const classified = rows.filter(r => r.raw !== 'EXCEPTION');

	const findings = classified
		.filter(r => findingStatus(r.signal) !== null)
		.map((r, i) => ({
			id: `KYF-${String(i + 1).padStart(3, '0')}`,
			severity: r.severity,
			status: findingStatus(r.signal)!,
			signal: r.signal,
			functionName: r.functionName,
			vectorName: r.vectorName,
			details: r.details,
		}));
	const byStatus = {supported: 0, hypothesis: 0, inconclusive: 0};
	for (const f of findings) byStatus[f.status]++;
	const notEvaluated = classified.filter(r => r.signal === 'NOT_EVALUATED').map(r => ({functionName: r.functionName, vectorName: r.vectorName, details: r.details}));
	const noFinding = classified.filter(r => r.signal === 'SECURE' || r.signal === 'PRECONDITION_FAIL').length;

	const notGenerated = Math.max(0, allowed - server.simulationsRun - server.simulationsSkipped);
	const vectorNote =
		notGenerated > 0
			? `This contract only has ${server.simulationsRun + server.simulationsSkipped} possible vectors, ${notGenerated} fewer than the ${allowed} allowed for this run. All of them were executed.`
			: server.simulationsSkipped > 0
				? `${server.simulationsSkipped} generated vector(s) were not run because the limit of ${allowed} simulations was reached.`
				: 'Every generated vector was executed.';

	const verdict =
		findings.length === 0
			? 'no findings in this run'
			: `${findings.length} finding(s): ${byStatus.supported} supported, ${byStatus.hypothesis} hypothesis (needs confirmation against the intended policy), ${byStatus.inconclusive} inconclusive`;

	return {
		schemaVersion: SCHEMA_VERSION,
		reportId,
		kind: 'fuzz' as const,
		generatedAt: now.toISOString(),
		tool: TOOL,
		target: {contractId: scan.contractId, network: 'testnet' as const, rpcUrl: TESTNET_RPC_URL},
		mode: 'simulate' as const,
		execution: {
			vectorsRequested: options.maxVectors,
			vectorsExecuted: server.simulationsRun,
			/** Vectors the contract's types produced: executed + not run. */
			vectorsGenerated: server.simulationsRun + server.simulationsSkipped,
			/** Generated but not executed because the simulation limit was reached. */
			vectorsNotRun: server.simulationsSkipped,
			/** Allowed simulations that went unused because the contract has no more vectors to generate. */
			vectorsNotGenerated: notGenerated,
			simulationLimit: allowed,
			hardLimit: HARD_MAX_VECTORS,
			subrequestBudget: options.subrequestBudget,
			note: vectorNote,
			cappedBySubrequestBudget: allowed < Math.min(options.maxVectors, HARD_MAX_VECTORS),
			broadcastTransactions: 0,
			networkPassphrase: Networks.TESTNET,
		},
		verdict,
		summary: {
			totalFindings: findings.length,
			byStatus,
			noFinding,
			notEvaluated: notEvaluated.length,
			operationalErrors: operational.length + operationalErrors.length,
		},
		findings,
		coverage: {
			notEvaluated,
			operationalErrors: [...operational.map(r => `${r.functionName}::${r.vectorName}: ${r.details}`), ...operationalErrors],
			notRun: ['call-order sequences (they need state carried between calls, which a simulation does not keep)'],
		},
		disclaimer: DISCLAIMER,
	};
}

export type FuzzReport = Awaited<ReturnType<typeof runFuzz>>;
