import {findingStatus} from './result_parser.js';
import type {
	ExecutionEvidence,
	FindingStatus,
	Severity,
	VulnerabilitySignal,
} from './result_parser.js';
import type {FuzzResult} from './fuzzer_math.js';
import type {InputProvenance} from './provenance.js';

export type {ExecutionEvidence} from './result_parser.js';

/**
 * A small, deterministic sample of real transaction evidence from the whole
 * run — NOT the full result set. Exists because findings[] filters out
 * SECURE/PRECONDITION_FAIL results, so an audit with zero findings would
 * otherwise expose no verifiable Testnet transaction at all even when the
 * run broadcast dozens of them. Added in D2.3.
 */
export interface VerificationTransaction {
	functionName: string;
	vectorName: string;
	broadcasted: boolean;
	success: boolean;
	transactionHash: string | null;
	ledger: number | null;
}

export interface Finding {
	id: string;
	severity: Severity;
	functionName: string;
	vectorName: string;
	signal: VulnerabilitySignal;
	/** How far the finding is established (see FindingStatus); independent of severity. */
	status: FindingStatus;
	details: string;
	/**
	 * Structured, JSON-safe execution evidence for the invocation that
	 * produced this finding — broadcast status, tx hash, ledger, and the
	 * structured trace summary. Future JSON/PDF layers should read this,
	 * never parse `details`.
	 */
	evidence: ExecutionEvidence;
}

/** One executed invocation, with the provenance of each of its arguments. */
export interface InvocationRecord {
	functionName: string;
	vectorName: string;
	signal: VulnerabilitySignal;
	mode: 'simulation' | 'broadcast';
	/** Number of parameters of the invoked function (denominator for provenance). */
	paramCount: number;
	/** txBadSeq re-submissions this invocation needed. Absent = 0. */
	sendRetries?: number;
	inputs?: InputProvenance[];
	/**
	 * What the call did, structured: accepted, rejected (with the last error
	 * the trace shows: category and code, no values) or not run (operational).
	 * Lets a report state which vectors were blocked before reaching a
	 * semantic condition and by what, without parsing free text.
	 */
	outcome?: VectorOutcome;
}

export interface VectorOutcome {
	result: 'accepted' | 'rejected' | 'not_run';
	/** Category of the last trace error for a rejection ('none' if the trace shows no error). */
	blockedBy?: string;
	code?: string | null;
}

export function vectorOutcome(
	signal: VulnerabilitySignal,
	evidence: ExecutionEvidence,
): VectorOutcome {
	if (signal === 'OPERATIONAL_ERROR') return {result: 'not_run'};
	if (evidence.success) return {result: 'accepted'};
	const last = evidence.trace.errors.at(-1);
	return {
		result: 'rejected',
		blockedBy: last ? last.category : 'none',
		code: last ? last.code : null,
	};
}

/** A vector that ran but produced no contract evidence (kept out of findings, never dropped). */
export interface CoverageNote {
	functionName: string;
	vectorName: string;
	signal: 'OPERATIONAL_ERROR' | 'NOT_EVALUATED';
	errorCode: string | null;
	detail: string;
}

/** How a campaign was configured and what its limits did. Never holds values from the context. */
export interface CampaignInfo {
	mode: 'simulate-only' | 'broadcast';
	allowedFunctions?: string[];
	allowedFamilies?: string[];
	maxVectors?: number;
	/** Invocations refused because the vector budget was exhausted. */
	refusedByBudget: number;
	/** `sendTransaction` attempts blocked by simulate-only (must be 0 in a correct run). */
	blockedSends: number;
	functionsSkippedByLimit: string[];
	/** Context config keys that matched a parameter / that never did. */
	contextKeysUsed: string[];
	contextKeysUnused: string[];
	authorizationRecord?: string;
}

export interface ChaosReport {
	contractId: string;
	scannedAt: string;
	network: 'testnet' | 'mainnet';
	totalFunctions: number;
	totalVectorsRun: number;
	findings: Finding[];
	summary: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
		preconditionFail: number;
		/**
		 * Tallied over EVERY result (not just findings[], which filters out
		 * SECURE/PRECONDITION_FAIL) — this is the only place the full evidence
		 * count survives once buildReport() finishes, so it must be computed
		 * here rather than re-derived later from the filtered findings list.
		 */
		broadcastTransactions: number;
		transactionsWithHash: number;
		/** Vectors that failed operationally / could not be evaluated; not findings. */
		operationalErrors?: number;
		notEvaluated?: number;
		/** Findings by what they establish; sums to findings.length. */
		byStatus?: Record<FindingStatus, number>;
	};
	/**
	 * Up to two entries: the first broadcasted+hashed result whose tx
	 * confirmed SUCCESS, and the first whose tx did not — whichever exist.
	 * Empty only when nothing in the run ever broadcast. See
	 * VerificationTransaction's doc comment for why this exists separately
	 * from findings[].
	 */
	verificationTransactions: VerificationTransaction[];
	/** One record per executed invocation (provenance lives here). */
	invocations?: InvocationRecord[];
	/** OPERATIONAL_ERROR / NOT_EVALUATED vectors: coverage gaps, not findings. */
	coverageNotes?: CoverageNote[];
	/** Present only when a campaign configuration was used. */
	campaign?: CampaignInfo;
	/** Vectors whose inputs were generated but never started (vector budget). */
	refusedInvocations?: Array<
		Pick<
			InvocationRecord,
			'functionName' | 'vectorName' | 'paramCount' | 'inputs'
		>
	>;
}

const SEVERITY_ORDER: Severity[] = [
	'CRITICAL',
	'HIGH',
	'MEDIUM',
	'LOW',
	'INFO',
];

/**
 * Takes all FuzzResults and builds a ChaosReport.
 * Filters out INFO/SECURE results from findings list (they go to summary only).
 * Assigns sequential IDs starting from KYF-001.
 */
export function buildReport(
	contractId: string,
	results: FuzzResult[],
	campaign?: CampaignInfo,
	refused: FuzzResult[] = [],
): ChaosReport {
	const summary = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		info: 0,
		preconditionFail: 0,
		broadcastTransactions: 0,
		transactionsWithHash: 0,
		operationalErrors: 0,
		notEvaluated: 0,
	};
	const byStatus: Record<FindingStatus, number> = {
		supported: 0,
		hypothesis: 0,
		inconclusive: 0,
	};
	const invocations: InvocationRecord[] = [];
	const coverageNotes: CoverageNote[] = [];
	const uniqueFunctions = new Set(results.map(r => r.target.functionName));
	const findings: Finding[] = [];
	let findingIndex = 1;
	let firstSuccessBroadcast: FuzzResult | null = null;
	let firstFailedBroadcast: FuzzResult | null = null;

	for (const r of results) {
		const {severity, signal, evidence} = r.result;

		invocations.push({
			functionName: r.result.functionName,
			vectorName: r.result.vectorName,
			signal,
			mode: evidence.mode ?? 'broadcast',
			paramCount: r.target.params.length,
			...(evidence.sendRetries ? {sendRetries: evidence.sendRetries} : {}),
			...(r.inputs ? {inputs: r.inputs} : {}),
			outcome: vectorOutcome(signal, evidence),
		});

		if (evidence.broadcasted) summary.broadcastTransactions++;
		if (evidence.transactionHash !== null) summary.transactionsWithHash++;

		if (evidence.broadcasted && evidence.transactionHash !== null) {
			if (evidence.success && firstSuccessBroadcast === null)
				firstSuccessBroadcast = r;
			if (!evidence.success && firstFailedBroadcast === null)
				firstFailedBroadcast = r;
		}

		if (signal === 'OPERATIONAL_ERROR' || signal === 'NOT_EVALUATED') {
			if (signal === 'OPERATIONAL_ERROR') summary.operationalErrors++;
			else summary.notEvaluated++;
			coverageNotes.push({
				functionName: r.result.functionName,
				vectorName: r.result.vectorName,
				signal,
				errorCode: r.result.rawErrorCode,
				detail: r.result.details,
			});
			continue;
		}

		switch (severity) {
			case 'CRITICAL':
				summary.critical++;
				break;
			case 'HIGH':
				summary.high++;
				break;
			case 'MEDIUM':
				summary.medium++;
				break;
			case 'LOW':
				if (signal === 'PRECONDITION_FAIL') summary.preconditionFail++;
				else summary.low++;
				break;
			case 'INFO':
				summary.info++;
				break;
		}

		if (signal !== 'SECURE' && signal !== 'PRECONDITION_FAIL') {
			const id = `KYF-${String(findingIndex).padStart(3, '0')}`;
			findingIndex++;
			const status = findingStatus(signal);
			byStatus[status]++;
			findings.push({
				id,
				severity,
				functionName: r.result.functionName,
				vectorName: r.result.vectorName,
				signal,
				status,
				details: r.result.details,
				evidence: r.result.evidence,
			});
		}
	}

	// Sort findings: CRITICAL first, then by SEVERITY_ORDER
	findings.sort(
		(a, b) =>
			SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
	);

	const verificationTransactions: VerificationTransaction[] = [
		firstSuccessBroadcast,
		firstFailedBroadcast,
	]
		.filter((r): r is FuzzResult => r !== null)
		.map(r => ({
			functionName: r.result.functionName,
			vectorName: r.result.vectorName,
			broadcasted: r.result.evidence.broadcasted,
			success: r.result.evidence.success,
			transactionHash: r.result.evidence.transactionHash,
			ledger: r.result.evidence.ledger,
		}));

	return {
		contractId,
		scannedAt: new Date().toISOString(),
		network: 'testnet',
		totalFunctions: uniqueFunctions.size,
		totalVectorsRun: results.length,
		findings,
		summary: {...summary, byStatus},
		verificationTransactions,
		invocations,
		coverageNotes,
		...(campaign ? {campaign} : {}),
		...(refused.length > 0
			? {
					refusedInvocations: refused.map(r => ({
						functionName: r.result.functionName,
						vectorName: r.result.vectorName,
						paramCount: r.target.params.length,
						...(r.inputs ? {inputs: r.inputs} : {}),
					})),
				}
			: {}),
	};
}

/**
 * Formats a ChaosReport as a human-readable string for terminal display.
 * Plain text only — no Ink components.
 */
export function formatReportForTerminal(report: ChaosReport): string {
	const lines: string[] = [];
	const SEP = '─'.repeat(56);

	lines.push(SEP);
	lines.push('  CHAOS MONKEY — SECURITY REPORT');
	lines.push(SEP);
	lines.push(`  Contract : ${report.contractId}`);
	lines.push(`  Scanned  : ${report.scannedAt}`);
	lines.push(`  Network  : ${report.network.toUpperCase()}`);
	lines.push(
		`  Functions: ${report.totalFunctions}  |  Vectors run: ${report.totalVectorsRun}`,
	);
	lines.push(SEP);
	lines.push('  SUMMARY');
	lines.push(`    CRITICAL         : ${report.summary.critical}`);
	lines.push(`    HIGH             : ${report.summary.high}`);
	lines.push(`    MEDIUM           : ${report.summary.medium}`);
	lines.push(`    LOW              : ${report.summary.low}`);
	lines.push(`    PRECONDITION_FAIL: ${report.summary.preconditionFail}`);
	lines.push(`    INFO             : ${report.summary.info}`);
	if (report.summary.byStatus) {
		const b = report.summary.byStatus;
		lines.push(
			`    Established: ${b.supported} supported | ${b.hypothesis} hypotheses (need confirmation) | ${b.inconclusive} inconclusive`,
		);
	}

	lines.push(SEP);
	lines.push('  EVIDENCE');
	lines.push(
		`    Broadcast transactions: ${report.summary.broadcastTransactions}`,
	);
	lines.push(
		`    Transactions with hash: ${report.summary.transactionsWithHash}`,
	);
	lines.push(SEP);

	if (report.findings.length === 0) {
		lines.push('  0 findings in this run.');
		lines.push('  No security findings were emitted.');
		lines.push('  This does not prove the absence of vulnerabilities.');
	} else {
		lines.push(`  FINDINGS (${report.findings.length})`);
		lines.push(
			'  Severity is triage priority if the finding holds; status says how far it is established.',
		);
		lines.push('');
		for (const f of report.findings) {
			lines.push(`  [${f.id}] ${f.severity} — ${f.signal} (${f.status})`);
			lines.push(`  Function : ${f.functionName}`);
			lines.push(`  Vector   : ${f.vectorName}`);
			lines.push(`  Details  : ${f.details}`);
			if (f.evidence.broadcasted && f.evidence.transactionHash) {
				lines.push(`  Tx       : ${f.evidence.transactionHash}`);
			}

			lines.push('');
		}
	}

	lines.push(SEP);
	return lines.join('\n');
}
