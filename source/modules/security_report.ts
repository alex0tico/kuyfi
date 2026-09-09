import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {TESTNET_RPC_URL} from './network.js';
import {typeName} from './chaos_monkey/type_gen.js';
import {stellarExpertTestnetUrl} from './chaos_monkey/result_parser.js';
import type {Severity, VulnerabilitySignal} from './chaos_monkey/result_parser.js';
import type {ScannedFunction} from './scanner.js';
import type {UdtDef} from './chaos_monkey/udt_registry.js';
import type {DiagnosticTraceAnalysis, TraceCallFrame, TraceErrorObservation} from './chaos_monkey/trace_analyzer.js';
import type {ChaosReport, Finding, VerificationTransaction} from './chaos_monkey/index.js';
import type {AuditRun} from './audit.js';

/**
 * Schema version for the public SecurityReport JSON shape — independent
 * from `tool.version` (Kuyfi's own package.json version). Semver-style
 * (major.minor.patch) so a future breaking change to this shape bumps the
 * major, and additive fields bump the minor, following normal semver
 * consumer expectations for a versioned document schema.
 */
export const SCHEMA_VERSION = '1.0.0';

// package.json version, read once via createRequire — works under Node ESM
// without needing tsconfig's resolveJsonModule (which stays off; this is a
// plain runtime require(), not a typed JSON import). Single source: nothing
// hardcodes or duplicates the version number elsewhere.
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as {version: string};

export function getToolVersion(): string {
	return pkg.version;
}

/**
 * Timestamp + random component — deliberately NOT derived from contractId
 * alone, so two audits of the same contract always get distinct ids.
 * `now` is injectable for deterministic tests; production callers omit it.
 */
export function generateReportId(now: Date = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	return `kyf-${stamp}-${randomUUID().slice(0, 8)}`;
}

// ─── Public (JSON-safe) shapes ────────────────────────────────────────────

export interface PublicScannedParam {
	name: string;
	/** Human-readable Soroban type name (e.g. "Address", "Vec<Point>"), via type_gen.ts's typeName() — never raw ScSpecTypeDef. */
	type: string;
}

export interface PublicScannedFunction {
	name: string;
	parameters: PublicScannedParam[];
	hasReturn: boolean;
}

export interface PublicUdtField {
	name: string;
	type: string;
}

export interface PublicUdtStruct {
	kind: 'struct';
	name: string;
	fields: PublicUdtField[];
}

export interface PublicUdtEnumCase {
	name: string;
	value: number;
}

export interface PublicUdtEnum {
	kind: 'enum';
	name: string;
	cases: PublicUdtEnumCase[];
}

export interface PublicUdtUnionCase {
	name: string;
	valueTypes: string[];
}

export interface PublicUdtUnion {
	kind: 'union';
	name: string;
	cases: PublicUdtUnionCase[];
}

export type PublicUdtDef = PublicUdtStruct | PublicUdtEnum | PublicUdtUnion;

/** {broadcasted, hash, ledger, explorerUrl} — the shared shape for any transaction reference in the report. */
export interface PublicTransaction {
	broadcasted: boolean;
	hash: string | null;
	ledger: number | null;
	explorerUrl: string | null;
}

export interface PublicVerificationTransaction extends PublicTransaction {
	functionName: string;
	vectorName: string;
}

/** Subset of DiagnosticTraceAnalysis — drops callFrames[] (verbose/less stable); everything here was already JSON-safe. */
export interface PublicTraceSummary {
	rootCall: TraceCallFrame | null;
	nestedCallCount: number;
	involvedContractIds: string[];
	errors: TraceErrorObservation[];
	hasAuthError: boolean;
	failureLocation: 'ROOT' | 'NESTED' | 'UNKNOWN';
	malformed: boolean;
}

export interface PublicEvidence {
	simulationFailed: boolean;
	transaction: PublicTransaction;
	trace: PublicTraceSummary;
}

/**
 * `vectorName` (e.g. "amount::ZERO", "REINIT_ATTACK") stays the stable v1
 * attack-input identifier, as-is from the fuzzers. A structured
 * {family, targetParameter, mutation} breakdown would need every fuzzer
 * (fuzzer_math/access/fee/liquidity/call_order) to carry that structure
 * internally instead of a formatted label — real work, deliberately
 * deferred rather than reconstructed here with a fragile regex over
 * vectorName. functionName + vectorName + the type-named parameter list in
 * `scan.functions` already let a reader identify what was attacked.
 */
export interface PublicFinding {
	id: string;
	functionName: string;
	vectorName: string;
	signal: VulnerabilitySignal;
	severity: Severity;
	details: string;
	evidence: PublicEvidence;
}

export interface SecurityReport {
	schemaVersion: string;
	reportId: string;
	generatedAt: string;
	tool: {name: string; version: string};
	target: {
		contractId: string;
		network: 'testnet' | 'mainnet';
		rpcUrl: string;
		bytecodeSize: number;
	};
	scan: {
		totalFunctions: number;
		functions: PublicScannedFunction[];
		udts: PublicUdtDef[];
	};
	execution: {
		vectorsExecuted: number;
		broadcastTransactions: number;
		transactionsWithHash: number;
		/** At least one entry survives here even when findings[] is empty — see VerificationTransaction's doc comment in reporter.ts. */
		verificationTransactions: PublicVerificationTransaction[];
	};
	summary: {
		totalFindings: number;
		bySeverity: {
			critical: number;
			high: number;
			medium: number;
			low: number;
			info: number;
			preconditionFail: number;
		};
		/** Tallied over findings[] only — SECURE/PRECONDITION_FAIL never appear here since they're excluded from findings[] by design; see bySeverity.preconditionFail for that count instead. */
		findingsBySignal: Partial<Record<VulnerabilitySignal, number>>;
	};
	findings: PublicFinding[];
}

// ─── Transforms — each one is a pure projection, no re-classification ─────

function toPublicFunction(fn: ScannedFunction): PublicScannedFunction {
	return {
		name: fn.name,
		parameters: fn.params.map(p => ({name: p.name, type: typeName(p.type)})),
		hasReturn: fn.hasReturn,
	};
}

function toPublicUdt(def: UdtDef): PublicUdtDef {
	switch (def.kind) {
		case 'struct':
			return {
				kind: 'struct',
				name: def.name,
				fields: def.fields.map(f => ({name: f.name, type: typeName(f.type)})),
			};
		case 'enum':
			return {
				kind: 'enum',
				name: def.name,
				cases: def.cases.map(c => ({name: c.name, value: c.value})),
			};
		case 'union':
			return {
				kind: 'union',
				name: def.name,
				cases: def.cases.map(c => ({name: c.name, valueTypes: c.valueTypes.map(typeName)})),
			};
	}
}

function toPublicTransaction(evidence: {
	broadcasted: boolean;
	transactionHash: string | null;
	ledger: number | null;
}): PublicTransaction {
	return {
		broadcasted: evidence.broadcasted,
		hash: evidence.transactionHash,
		ledger: evidence.ledger,
		explorerUrl: stellarExpertTestnetUrl(evidence.transactionHash),
	};
}

function toPublicVerificationTransaction(tx: VerificationTransaction): PublicVerificationTransaction {
	return {
		functionName: tx.functionName,
		vectorName: tx.vectorName,
		...toPublicTransaction(tx),
	};
}

function toPublicTraceSummary(trace: DiagnosticTraceAnalysis): PublicTraceSummary {
	return {
		rootCall: trace.rootCall,
		nestedCallCount: trace.nestedCallCount,
		involvedContractIds: trace.involvedContractIds,
		errors: trace.errors,
		hasAuthError: trace.hasAuthError,
		failureLocation: trace.failureLocation,
		malformed: trace.malformed,
	};
}

function toPublicFinding(finding: Finding): PublicFinding {
	return {
		id: finding.id,
		functionName: finding.functionName,
		vectorName: finding.vectorName,
		signal: finding.signal,
		severity: finding.severity,
		details: finding.details,
		evidence: {
			simulationFailed: finding.evidence.simulationFailed,
			transaction: toPublicTransaction(finding.evidence),
			trace: toPublicTraceSummary(finding.evidence.trace),
		},
	};
}

function tallyFindingsBySignal(findings: Finding[]): Partial<Record<VulnerabilitySignal, number>> {
	const tally: Partial<Record<VulnerabilitySignal, number>> = {};
	for (const f of findings) {
		tally[f.signal] = (tally[f.signal] ?? 0) + 1;
	}

	return tally;
}

/**
 * Tallies findings[] ONLY — never chaos.summary, which counts every result
 * (including the SECURE ones filtered out of findings[] by buildReport()).
 * summary.bySeverity and summary.totalFindings must describe the exact same
 * universe (findings[]), so sum(bySeverity) === totalFindings === findings.length
 * always holds. `preconditionFail` mirrors buildReport()'s own bucket split
 * for structural symmetry, but is always 0 here: a PRECONDITION_FAIL signal
 * never survives into findings[] in the first place.
 */
function tallyFindingsBySeverity(findings: Finding[]): SecurityReport['summary']['bySeverity'] {
	const tally = {critical: 0, high: 0, medium: 0, low: 0, info: 0, preconditionFail: 0};
	for (const f of findings) {
		switch (f.severity) {
			case 'CRITICAL':
				tally.critical++;
				break;
			case 'HIGH':
				tally.high++;
				break;
			case 'MEDIUM':
				tally.medium++;
				break;
			case 'LOW':
				if (f.signal === 'PRECONDITION_FAIL') tally.preconditionFail++;
				else tally.low++;
				break;
			case 'INFO':
				tally.info++;
				break;
		}
	}

	return tally;
}

function toReportSummary(chaos: ChaosReport): SecurityReport['summary'] {
	return {
		totalFindings: chaos.findings.length,
		bySeverity: tallyFindingsBySeverity(chaos.findings),
		findingsBySignal: tallyFindingsBySignal(chaos.findings),
	};
}

export interface BuildSecurityReportOptions {
	/** Injectable for deterministic tests; production callers omit both. */
	now?: Date;
	reportId?: string;
}

/**
 * Builds the public, JSON-safe SecurityReport from a completed AuditRun.
 * Pure projection — every finding, every signal, every severity is exactly
 * what D1's classifier and D2.1's evidence plumbing already produced.
 * Nothing here reclassifies, reinterprets, or re-scans anything.
 */
export function buildSecurityReport(auditRun: AuditRun, options: BuildSecurityReportOptions = {}): SecurityReport {
	const {scan, chaos} = auditRun;
	const now = options.now ?? new Date();
	const reportId = options.reportId ?? generateReportId(now);

	return {
		schemaVersion: SCHEMA_VERSION,
		reportId,
		generatedAt: now.toISOString(),
		tool: {name: 'kuyfi', version: getToolVersion()},
		target: {
			contractId: scan.contractId,
			network: chaos.network,
			rpcUrl: TESTNET_RPC_URL,
			bytecodeSize: scan.bytecodeSize,
		},
		scan: {
			totalFunctions: scan.functions.length,
			functions: scan.functions.map(toPublicFunction),
			udts: [...scan.udtRegistry.values()].map(toPublicUdt),
		},
		execution: {
			vectorsExecuted: chaos.totalVectorsRun,
			broadcastTransactions: chaos.summary.broadcastTransactions,
			transactionsWithHash: chaos.summary.transactionsWithHash,
			verificationTransactions: chaos.verificationTransactions.map(toPublicVerificationTransaction),
		},
		summary: toReportSummary(chaos),
		findings: chaos.findings.map(toPublicFinding),
	};
}

/**
 * The only serializer for SecurityReport. Deliberately not
 * JSON.stringify(auditRun) anywhere else in the codebase — AuditRun/
 * ChaosReport/ScanResult are runtime objects (ScanResult.udtRegistry is a
 * Map), not the public schema.
 */
export function serializeSecurityReport(report: SecurityReport): string {
	return JSON.stringify(report, null, 2);
}
