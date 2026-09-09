import type {ExecutionEvidence, Severity, VulnerabilitySignal} from './result_parser.js';
import type {FuzzResult} from './fuzzer_math.js';

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
	details: string;
	/**
	 * Structured, JSON-safe execution evidence for the invocation that
	 * produced this finding — broadcast status, tx hash, ledger, and the
	 * structured trace summary. Future JSON/PDF layers should read this,
	 * never parse `details`.
	 */
	evidence: ExecutionEvidence;
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
	};
	/**
	 * Up to two entries: the first broadcasted+hashed result whose tx
	 * confirmed SUCCESS, and the first whose tx did not — whichever exist.
	 * Empty only when nothing in the run ever broadcast. See
	 * VerificationTransaction's doc comment for why this exists separately
	 * from findings[].
	 */
	verificationTransactions: VerificationTransaction[];
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/**
 * Takes all FuzzResults and builds a ChaosReport.
 * Filters out INFO/SECURE results from findings list (they go to summary only).
 * Assigns sequential IDs starting from KYF-001.
 */
export function buildReport(contractId: string, results: FuzzResult[]): ChaosReport {
	const summary = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		info: 0,
		preconditionFail: 0,
		broadcastTransactions: 0,
		transactionsWithHash: 0,
	};
	const uniqueFunctions = new Set(results.map(r => r.target.functionName));
	const findings: Finding[] = [];
	let findingIndex = 1;
	let firstSuccessBroadcast: FuzzResult | null = null;
	let firstFailedBroadcast: FuzzResult | null = null;

	for (const r of results) {
		const {severity, signal, evidence} = r.result;

		if (evidence.broadcasted) summary.broadcastTransactions++;
		if (evidence.transactionHash !== null) summary.transactionsWithHash++;

		if (evidence.broadcasted && evidence.transactionHash !== null) {
			if (evidence.success && firstSuccessBroadcast === null) firstSuccessBroadcast = r;
			if (!evidence.success && firstFailedBroadcast === null) firstFailedBroadcast = r;
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
			findings.push({
				id,
				severity,
				functionName: r.result.functionName,
				vectorName: r.result.vectorName,
				signal,
				details: r.result.details,
				evidence: r.result.evidence,
			});
		}
	}

	// Sort findings: CRITICAL first, then by SEVERITY_ORDER
	findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

	const verificationTransactions: VerificationTransaction[] = [firstSuccessBroadcast, firstFailedBroadcast]
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
		summary,
		verificationTransactions,
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
	lines.push(`  Functions: ${report.totalFunctions}  |  Vectors run: ${report.totalVectorsRun}`);
	lines.push(SEP);
	lines.push('  SUMMARY');
	lines.push(`    CRITICAL         : ${report.summary.critical}`);
	lines.push(`    HIGH             : ${report.summary.high}`);
	lines.push(`    MEDIUM           : ${report.summary.medium}`);
	lines.push(`    LOW              : ${report.summary.low}`);
	lines.push(`    PRECONDITION_FAIL: ${report.summary.preconditionFail}`);
	lines.push(`    INFO             : ${report.summary.info}`);
	lines.push(SEP);
	lines.push('  EVIDENCE');
	lines.push(`    Broadcast transactions: ${report.summary.broadcastTransactions}`);
	lines.push(`    Transactions with hash: ${report.summary.transactionsWithHash}`);
	lines.push(SEP);

	if (report.findings.length === 0) {
		lines.push('  No actionable findings. Contract appears robust.');
	} else {
		lines.push(`  FINDINGS (${report.findings.length})`);
		lines.push('');
		for (const f of report.findings) {
			lines.push(`  [${f.id}] ${f.severity} — ${f.signal}`);
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
