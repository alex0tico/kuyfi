import type {ExecutionEvidence, Severity, VulnerabilitySignal} from './result_parser.js';
import type {FuzzResult} from './fuzzer_math.js';

export type {ExecutionEvidence} from './result_parser.js';

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
	};
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/**
 * Takes all FuzzResults and builds a ChaosReport.
 * Filters out INFO/SECURE results from findings list (they go to summary only).
 * Assigns sequential IDs starting from KYF-001.
 */
export function buildReport(contractId: string, results: FuzzResult[]): ChaosReport {
	const summary = {critical: 0, high: 0, medium: 0, low: 0, info: 0, preconditionFail: 0};
	const uniqueFunctions = new Set(results.map(r => r.target.functionName));
	const findings: Finding[] = [];
	let findingIndex = 1;

	for (const r of results) {
		const {severity, signal} = r.result;

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

	return {
		contractId,
		scannedAt: new Date().toISOString(),
		network: 'testnet',
		totalFunctions: uniqueFunctions.size,
		totalVectorsRun: results.length,
		findings,
		summary,
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
