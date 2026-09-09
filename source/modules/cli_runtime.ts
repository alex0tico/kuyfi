import {writeFile as fsWriteFile} from 'node:fs/promises';
import {isValidContractId, ScanError} from './scanner.js';
import {runAudit, formatAuditSummary} from './audit.js';
import type {RunAuditOptions} from './audit.js';
import {buildSecurityReport} from './security_report.js';
import type {SecurityReport} from './security_report.js';
import {renderSecurityReportPdf} from './pdf_report.js';
import {
	writeSecurityReportJson,
	writeSecurityReportPdf,
	describeWriteError,
	defaultReportFileName,
	defaultPdfReportFileName,
} from './report_export.js';

export {defaultReportFileName, defaultPdfReportFileName} from './report_export.js';

export type CliMode =
	| {kind: 'tui'}
	| {kind: 'headless'; contractId: string}
	| {kind: 'invalid'; contractId: string};

/**
 * Pure mode selector — no Ink, no meow, no process access. Backwards
 * compatible with the pre-D2.2 behavior: no positional argument always
 * means the interactive TUI.
 */
export function selectCliMode(positionalArgs: readonly string[]): CliMode {
	const contractId = positionalArgs[0];
	if (!contractId) return {kind: 'tui'};
	if (!isValidContractId(contractId)) return {kind: 'invalid', contractId};
	return {kind: 'headless', contractId};
}

/** Domain error → clear headless-CLI text. Never parses/re-derives from a presentation string. */
export function describeAuditError(error: unknown): string {
	if (error instanceof ScanError) {
		switch (error.code) {
			case 'CONTRACT_NOT_FOUND':
				return 'Contract not found on Testnet. Check the Contract ID.';
			case 'XDR_ALIGN_FAILURE':
				return 'Could not parse the contract spec (contractspecv0 section missing or invalid).';
			case 'RPC_UNAVAILABLE':
				return 'Soroban Testnet RPC is unreachable.';
			case 'UNKNOWN':
				return `Scan failed: ${error.message}`;
		}
	}

	return `Audit failed: ${error instanceof Error ? error.message : String(error)}`;
}

export interface HeadlessRunResult {
	exitCode: 0 | 1;
	output: string | null;
	errorOutput: string | null;
	/** Set only when --json was requested AND the file write succeeded. */
	reportFilePath: string | null;
	/** Set only when --pdf was requested AND the file write succeeded. */
	pdfFilePath: string | null;
}

/**
 * Runs one full headless audit and maps the outcome to a process exit code.
 * A THROWN error (invalid scan, RPC failure, Chaos Monkey internal failure)
 * is a tool failure → exitCode 1. A completed run is exitCode 0 regardless
 * of what severities the findings inside it carry — a security finding is
 * never confused with a tool error.
 *
 * When either `writeJson` or `writePdf` is set, buildSecurityReport() is
 * called EXACTLY ONCE, after the audit succeeds, from the SAME AuditRun —
 * never a second scan/Chaos Monkey run, and JSON/PDF (when both are
 * requested) are always written from that one SecurityReport, so they
 * always share the same reportId/generatedAt/target/summary/findings.
 *
 * A file-write failure (including refusing to silently overwrite an
 * existing file) IS a tool failure → exitCode 1, same as any other I/O
 * failure — it happens after a successful audit, so it does not retroactively
 * change the audit's own outcome, only the process's final exit code. If
 * JSON succeeds and PDF then fails (or vice versa), the run is still
 * reported as a tool failure — the successfully-written path is still
 * surfaced via its own result field for diagnostics.
 */
export async function runHeadlessAudit(
	contractId: string,
	options: RunAuditOptions & {
		runAudit?: typeof runAudit;
		writeJson?: boolean;
		writePdf?: boolean;
		writeFile?: typeof fsWriteFile;
		renderPdf?: typeof renderSecurityReportPdf;
	} = {},
): Promise<HeadlessRunResult> {
	const audit = options.runAudit ?? runAudit;

	let auditRun;
	try {
		auditRun = await audit(contractId, options);
	} catch (error) {
		return {exitCode: 1, output: null, errorOutput: describeAuditError(error), reportFilePath: null, pdfFilePath: null};
	}

	const {scan, chaos} = auditRun;
	const summaryText = formatAuditSummary(scan, chaos);

	if (!options.writeJson && !options.writePdf) {
		return {exitCode: 0, output: summaryText, errorOutput: null, reportFilePath: null, pdfFilePath: null};
	}

	// ONE SecurityReport, shared by both formats — never rebuilt per format.
	const securityReport: SecurityReport = buildSecurityReport(auditRun);
	const outputLines = [summaryText];
	let reportFilePath: string | null = null;
	let pdfFilePath: string | null = null;

	if (options.writeJson) {
		try {
			const {path} = await writeSecurityReportJson(securityReport, {writeFile: options.writeFile});
			reportFilePath = path;
			outputLines.push(`JSON report written to: ${path}`);
		} catch (writeError) {
			return {
				exitCode: 1,
				output: null,
				errorOutput: describeWriteError(writeError, defaultReportFileName(securityReport.reportId), 'JSON'),
				reportFilePath: null,
				pdfFilePath: null,
			};
		}
	}

	if (options.writePdf) {
		try {
			const {path} = await writeSecurityReportPdf(securityReport, {
				writeFile: options.writeFile,
				renderPdf: options.renderPdf,
			});
			pdfFilePath = path;
			outputLines.push(`PDF report written to: ${path}`);
		} catch (writeError) {
			return {
				exitCode: 1,
				output: null,
				errorOutput: describeWriteError(writeError, defaultPdfReportFileName(securityReport.reportId), 'PDF'),
				reportFilePath,
				pdfFilePath: null,
			};
		}
	}

	return {
		exitCode: 0,
		output: outputLines.join('\n\n'),
		errorOutput: null,
		reportFilePath,
		pdfFilePath,
	};
}
