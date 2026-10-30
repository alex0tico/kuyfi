import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import type {Keypair} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL as RPC_URL} from '../network.js';
import {generateEphemeralKeypair} from './keypair_factory.js';
import {fuzzMathVectors} from './fuzzer_math.js';
import {fuzzAccessVectors, isAdminFunctionByName} from './fuzzer_access.js';
import {fuzzFeeVectors} from './fuzzer_fee.js';
import {fuzzLiquidityVectors} from './fuzzer_liquidity.js';
import {fuzzCallOrderVectors} from './fuzzer_call_order.js';
import {buildReport} from './reporter.js';
import type {CampaignInfo} from './reporter.js';
import {
	CampaignServer,
	isFamilyAllowed,
	isFunctionAllowed,
} from './campaign.js';
import type {CampaignLimits, VectorFamily} from './campaign.js';
import {unusedContextKeys} from './context_config.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';
import type {UdtRegistry} from './type_gen.js';
import type {ChaosReport} from './reporter.js';
import type {ContextConfig} from './context_config.js';

export type {ChaosReport} from './reporter.js';
export type {Finding} from './reporter.js';
export type {VerificationTransaction} from './reporter.js';
export {formatReportForTerminal} from './reporter.js';
export type {FuzzResult} from './fuzzer_math.js';
export type {ParsedResult, ExecutionEvidence} from './result_parser.js';
export {stellarExpertTestnetUrl} from './result_parser.js';
export type {UdtRegistry, UdtField} from './type_gen.js';
export type {ContextConfig} from './context_config.js';
export {parseContextConfig, ContextConfigError} from './context_config.js';
export type {InputProvenance} from './provenance.js';
export {provenanceCoverage} from './provenance.js';
export type {CampaignConfig, CampaignLimits} from './campaign.js';
export {
	CampaignConfigError,
	loadCampaignConfig,
	parseCampaignConfig,
} from './campaign.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

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
	/** Optional campaign context (roles, known values). Absent = v0.1.0 behaviour. */
	context?: ContextConfig;
	/**
	 * Optional campaign limits. Absent = v0.1.0 behaviour (everything, broadcast).
	 * When present, every RPC call goes through a CampaignServer that enforces them.
	 */
	limits?: CampaignLimits;
	/** Free-text reference recorded in the report (never interpreted). */
	authorizationRecord?: string;
	/** Test seams — production callers omit both. */
	keypair?: Keypair;
	server?: SorobanRpc.Server;
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
 *
 * Campaign limits (functions, families, vector budget, simulate-only) are
 * applied here for scheduling and ALSO enforced at the network layer by
 * CampaignServer, so a code path that bypasses the scheduler still cannot
 * exceed them.
 */
export async function runChaosMonkey(
	options: ChaosMonkeyOptions,
): Promise<ChaosReport> {
	const {contractId, functions, udtRegistry, onProgress, context} = options;

	onProgress('Generating ephemeral keypair...');
	const keypair = options.keypair ?? (await generateEphemeralKeypair());
	onProgress(`Keypair funded: ${keypair.publicKey().slice(0, 10)}...`);

	const server =
		options.server ??
		(options.limits
			? new CampaignServer(RPC_URL, options.limits)
			: new SorobanRpc.Server(RPC_URL));
	const campaignServer = server instanceof CampaignServer ? server : undefined;
	const limits = campaignServer?.limits;
	onProgress(`Connected to RPC: ${RPC_URL}`);
	if (limits) {
		onProgress(
			`Campaign limits: mode=${limits.mode}` +
				(limits.maxVectors === undefined
					? ''
					: `, maxVectors=${limits.maxVectors}`),
		);
	}

	const selected = functions.filter(fn => isFunctionAllowed(limits, fn.name));
	const skippedFunctions = functions
		.filter(fn => !isFunctionAllowed(limits, fn.name))
		.map(fn => fn.name);
	onProgress(`Starting fuzzing session on ${selected.length} function(s)...`);

	const allResults: FuzzResult[] = [];
	const refusedResults: FuzzResult[] = [];

	/** Runs one family for one scope, keeping out results the budget refused. */
	const runFamily = async (
		family: VectorFamily,
		label: string,
		run: () => Promise<FuzzResult[]>,
		describe: (results: FuzzResult[]) => string | undefined,
	) => {
		if (!isFamilyAllowed(limits, family)) return;
		if (campaignServer?.budgetExhausted) return;
		try {
			const results = await run();
			const kept = results.filter(
				r => r.result.rawErrorCode !== 'BUDGET_EXHAUSTED',
			);
			// Refused vectors never ran, but their inputs WERE generated: keep
			// them so provenance is audited over everything generated.
			refusedResults.push(
				...results.filter(r => r.result.rawErrorCode === 'BUDGET_EXHAUSTED'),
			);
			allResults.push(...kept);
			const message = describe(kept);
			if (message) onProgress(`${label} ${message}`);
		} catch (error) {
			onProgress(
				`${label} ${family} fuzzer error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	};

	for (const fn of selected) {
		const target: FuzzTarget = {
			contractId,
			functionName: fn.name,
			params: fn.params,
			isAdminFunction: isAdminFunctionByName(fn.name),
		};

		if (isFamilyAllowed(limits, 'math')) {
			onProgress(
				`[${fn.name}] Running math vectors (${fn.params.length} params)...`,
			);
		}

		await runFamily(
			'math',
			`[${fn.name}]`,
			async () =>
				fuzzMathVectors(target, keypair, server, udtRegistry, context),
			r => `Math done (${r.length} invocations)`,
		);

		// Always attempted — fuzzAccessVectors self-gates each of its vectors
		// (admin-name UNAUTHORIZED_CALL/REINIT_ATTACK/SELF_CALL_ATTACK, and
		// UNAUTHORIZED_ADDR_CALL for non-admin functions with an Address
		// parameter), so a function with none of those shapes just yields [].
		if (isFamilyAllowed(limits, 'access')) {
			onProgress(`[${fn.name}] Running access control vectors...`);
		}

		await runFamily(
			'access',
			`[${fn.name}]`,
			async () =>
				fuzzAccessVectors(target, keypair, server, udtRegistry, context),
			r => `Access done (${r.length} invocations)`,
		);

		// Fee/BPS and liquidity-ratio vectors self-gate on param name/type and
		// function name respectively — a function with neither shape yields [].
		await runFamily(
			'fee',
			`[${fn.name}]`,
			async () => fuzzFeeVectors(target, keypair, server, udtRegistry, context),
			r =>
				r.length > 0 ? `Fee/BPS vectors: ${r.length} invocation(s)` : undefined,
		);

		await runFamily(
			'liquidity',
			`[${fn.name}]`,
			async () =>
				fuzzLiquidityVectors(target, keypair, server, udtRegistry, context),
			r =>
				r.length > 0
					? `Liquidity-ratio vectors: ${r.length} invocation(s)`
					: undefined,
		);
	}

	// Call-ordering runs once per session (not per function) — it matches at
	// most one function per sequence group across the whole discovered set.
	if (isFamilyAllowed(limits, 'call_order')) {
		onProgress('Checking for call-ordering sequence candidates...');
	}

	await runFamily(
		'call_order',
		'',
		async () =>
			fuzzCallOrderVectors(
				contractId,
				selected,
				keypair,
				server,
				udtRegistry,
				context,
			),
		r =>
			r.length > 0
				? `Call-ordering vectors: ${r.length} invocation(s)`
				: undefined,
	);

	onProgress('Building report...');
	const campaignInfo: CampaignInfo | undefined = limits
		? {
				mode: limits.mode,
				...(limits.functions ? {allowedFunctions: limits.functions} : {}),
				...(limits.families ? {allowedFamilies: limits.families} : {}),
				...(limits.maxVectors === undefined
					? {}
					: {maxVectors: limits.maxVectors}),
				refusedByBudget: Math.max(
					refusedResults.length,
					campaignServer?.refused ?? 0,
				),
				blockedSends: campaignServer?.blockedSends ?? 0,
				functionsSkippedByLimit: skippedFunctions,
				contextKeysUsed: usedContextKeys(allResults),
				contextKeysUnused: context
					? unusedContextKeys(context, usedContextKeys(allResults))
					: [],
				...(options.authorizationRecord
					? {authorizationRecord: options.authorizationRecord}
					: {}),
			}
		: undefined;
	const report = buildReport(
		contractId,
		allResults,
		campaignInfo,
		refusedResults,
	);

	onProgress(
		`Scan complete — ${report.findings.length} finding(s) | ` +
			`CRITICAL: ${report.summary.critical} HIGH: ${report.summary.high}`,
	);

	return report;
}

function usedContextKeys(results: FuzzResult[]): string[] {
	const keys = new Set<string>();
	for (const r of results) {
		for (const input of r.inputs ?? []) {
			if (input.configKey) keys.add(input.configKey);
		}
	}

	return [...keys].sort();
}
