import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {scanContract} from './scanner.js';
import type {ScanResult} from './scanner.js';
import {TESTNET_RPC_URL} from './network.js';
import {runChaosMonkey} from './chaos_monkey/index.js';
import type {SeedInfo} from './seed.js';
import type {GateInput} from './gate.js';
import {
	hasAddressTypeParam,
	isAdminFunctionByName,
} from './chaos_monkey/fuzzer_access.js';
import {isFeeShapedParam} from './chaos_monkey/fuzzer_fee.js';
import {
	isLiquidityShapedFunction,
	selectNumericPair,
} from './chaos_monkey/fuzzer_liquidity.js';
import {selectCallOrderTargets} from './chaos_monkey/fuzzer_call_order.js';
import {VECTOR_FAMILIES} from './chaos_monkey/campaign.js';
import type {
	CampaignConfig,
	ChaosMonkeyOptions,
	ChaosReport,
} from './chaos_monkey/index.js';

/**
 * Result of one full audit run: the OSINT scan phase plus the Chaos Monkey
 * phase. Internal/runtime shape for D2.2 — NOT the public JSON schema
 * (that's D2.3's SecurityReport). No data is duplicated: ChaosReport already
 * carries its own contractId/network, so AuditRun only adds `scan` alongside
 * it rather than re-flattening fields.
 */
export interface AuditRun {
	scan: ScanResult;
	chaos: ChaosReport;
}

export interface RunAuditOptions {
	/** Defaults to a Testnet SorobanRpc.Server — override only for tests. */
	server?: SorobanRpc.Server;
	onProgress?: (message: string) => void;
	/** Injection seams for tests — production callers never need these. */
	scan?: typeof scanContract;
	chaos?: (options: ChaosMonkeyOptions) => Promise<ChaosReport>;
	/** Validated campaign configuration (context + limits). Absent = v0.1.0 behaviour. */
	campaign?: CampaignConfig;
	/** Seed for the generated test data (absent: Chaos Monkey generates one). */
	seed?: SeedInfo;
	/** Execution time limit in seconds (see ChaosMonkeyOptions.timeoutSeconds). */
	timeoutSeconds?: number;
}

/**
 * Thin, Ink-free orchestrator: scanContract() → runChaosMonkey(), passing
 * scan.functions and scan.udtRegistry straight through as Chaos Monkey's
 * inputs. This is the one place TUI and CLI both call to run a complete
 * audit — neither reimplements the scan→chaos wiring itself.
 */
export async function runAudit(
	contractId: string,
	options: RunAuditOptions = {},
): Promise<AuditRun> {
	const server = options.server ?? new SorobanRpc.Server(TESTNET_RPC_URL);
	const onProgress = options.onProgress ?? (() => {});
	const scan = options.scan ?? scanContract;
	const chaos = options.chaos ?? runChaosMonkey;

	onProgress(`Scanning ${contractId}...`);
	const scanResult = await scan(contractId, server);
	onProgress(
		`Scan complete — ${scanResult.functions.length} function(s), ${scanResult.udtRegistry.size} UDT type(s).`,
	);

	const chaosReport = await chaos({
		contractId,
		functions: scanResult.functions,
		udtRegistry: scanResult.udtRegistry,
		onProgress,
		...(options.seed ? {seed: options.seed} : {}),
		...(options.timeoutSeconds === undefined
			? {}
			: {timeoutSeconds: options.timeoutSeconds}),
		...(options.campaign
			? {
					context: options.campaign.context,
					limits: options.campaign.limits,
					authorizationRecord: options.campaign.authorizationRecord,
				}
			: {}),
	});

	return {scan: scanResult, chaos: chaosReport};
}

/**
 * Human-readable headless summary, rendered from the existing domain
 * objects only (ScanResult + ChaosReport) — no string-parsing of `details`,
 * no re-derivation of anything the audit already computed. Not a source of
 * truth; D2.3's JSON/PDF will read the same domain objects independently.
 */
export function formatAuditSummary(
	scan: ScanResult,
	chaos: ChaosReport,
): string {
	const lines: string[] = [];

	lines.push('KUYFI AUDIT COMPLETE');
	lines.push('');
	lines.push(`Contract: ${scan.contractId}`);
	lines.push(`Network: ${chaos.network.toUpperCase()}`);
	lines.push(`Functions scanned: ${scan.functions.length}`);
	lines.push(`Vectors executed: ${chaos.totalVectorsRun}`);
	lines.push(`Findings: ${chaos.findings.length}`);
	lines.push(`  Critical: ${chaos.summary.critical}`);
	lines.push(`  High: ${chaos.summary.high}`);
	lines.push(`  Medium: ${chaos.summary.medium}`);
	lines.push(`  Low: ${chaos.summary.low}`);
	lines.push(`  Info: ${chaos.summary.info}`);
	lines.push('');
	lines.push('Evidence:');
	lines.push(
		`  Broadcast transactions: ${chaos.summary.broadcastTransactions}`,
	);
	lines.push(`  Transactions with hash: ${chaos.summary.transactionsWithHash}`);
	if (chaos.seed) {
		lines.push('');
		lines.push(
			`Seed: ${chaos.seed.value}${chaos.seed.generated ? ' (generated)' : ''} - repeat this run with --seed ${chaos.seed.value}`,
		);
	}

	return lines.join('\n');
}

/**
 * What the gate reads from a finished audit. Findings are those the audit
 * reported, with their status and severity. A run is incomplete when it hit
 * an operational error, left a hypothesis unevaluated, ran out of vector
 * budget, reached its time limit, left an ATTACKABLE function without a
 * single invocation, or produced inconclusive findings. Not counted:
 * functions the campaign deliberately excluded, and functions no enabled
 * family could attack (see `canBeAttacked`; parameterless ones are listed in
 * the report's `coverage.functionsWithoutParameters` instead).
 */
export function auditGateInput(
	scan: ScanResult,
	chaos: ChaosReport,
): GateInput {
	const incomplete: string[] = [];
	const operational = chaos.summary.operationalErrors ?? 0;
	if (operational > 0) incomplete.push(`${operational} operational error(s)`);
	const notEvaluated = chaos.summary.notEvaluated ?? 0;
	if (notEvaluated > 0)
		incomplete.push(`${notEvaluated} vector(s) not evaluated`);
	if ((chaos.campaign?.refusedByBudget ?? 0) > 0)
		incomplete.push('vector budget exhausted');
	if (chaos.timeout?.reached)
		incomplete.push(`time limit of ${chaos.timeout.seconds}s reached`);
	const exercised = new Set((chaos.invocations ?? []).map(i => i.functionName));
	const excluded = new Set(chaos.campaign?.functionsSkippedByLimit ?? []);
	const families = new Set<string>(
		chaos.campaign?.allowedFamilies ?? VECTOR_FAMILIES,
	);
	const idle = scan.functions
		.filter(
			f =>
				!exercised.has(f.name) &&
				!excluded.has(f.name) &&
				canBeAttacked(f, scan.functions, families),
		)
		.map(f => f.name);
	if (idle.length > 0)
		incomplete.push(`function(s) without invocations: ${idle.join(', ')}`);
	const inconclusive = chaos.summary.byStatus?.inconclusive ?? 0;
	if (inconclusive > 0)
		incomplete.push(`${inconclusive} inconclusive finding(s)`);
	return {
		findings: chaos.findings.map(f => ({
			severity: f.severity,
			status: f.status,
		})),
		incomplete,
	};
}

/**
 * Whether some enabled vector family could attack this function. A function
 * with no parameters has nothing to vary, so none can. With parameters, the
 * math family attacks any of them; if the campaign turned math off, the
 * access, fee, liquidity or call-order family must apply by its own rule.
 */
export function canBeAttacked(
	fn: ScanResult['functions'][number],
	all: ScanResult['functions'],
	families: Set<string>,
): boolean {
	if (fn.params.length === 0) return false;
	if (families.has('math')) return true;
	if (
		families.has('access') &&
		(isAdminFunctionByName(fn.name) || hasAddressTypeParam(fn.params))
	)
		return true;
	if (
		families.has('fee') &&
		fn.params.some(p => isFeeShapedParam(p.name, p.type))
	)
		return true;
	if (
		families.has('liquidity') &&
		isLiquidityShapedFunction(fn.name) &&
		selectNumericPair(fn.params) !== null
	)
		return true;
	return (
		families.has('call_order') &&
		selectCallOrderTargets(all).some(t => t.fn.name === fn.name)
	);
}
