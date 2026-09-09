import {writeFile as fsWriteFile} from 'node:fs/promises';
import {serializeSecurityReport} from './security_report.js';
import type {SecurityReport} from './security_report.js';
import {renderSecurityReportPdf} from './pdf_report.js';

/**
 * Small, reusable export helpers — the single place both the CLI (--json/
 * --pdf) and the TUI export shortcuts write a SecurityReport to disk.
 * Neither caller reimplements serializeSecurityReport()/fs.writeFile()/
 * renderSecurityReportPdf() itself.
 */

export interface WriteReportResult {
	path: string;
}

export interface WriteReportOptions {
	/** Injection seam for tests — production callers never need this. */
	writeFile?: typeof fsWriteFile;
}

export interface WritePdfOptions extends WriteReportOptions {
	renderPdf?: typeof renderSecurityReportPdf;
}

/** `kuyfi-report-<reportId>.json` — reportId is already filename-safe by construction, but this stays defensive if that ever changes. */
export function defaultReportFileName(reportId: string): string {
	const safe = reportId.replace(/[^A-Za-z0-9._-]/g, '_');
	return `kuyfi-report-${safe}.json`;
}

/** `kuyfi-report-<reportId>.pdf` — same naming/sanitization convention as the JSON output. */
export function defaultPdfReportFileName(reportId: string): string {
	const safe = reportId.replace(/[^A-Za-z0-9._-]/g, '_');
	return `kuyfi-report-${safe}.pdf`;
}

/** Shared collision-safe write policy: 'wx' throws EEXIST rather than silently overwriting. Same wording for CLI and TUI. */
export function describeWriteError(error: unknown, fileName: string, kind: 'JSON' | 'PDF'): string {
	const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
	if (code === 'EEXIST') {
		return `Refusing to overwrite existing file: ${fileName}`;
	}

	return `Failed to write ${kind} report: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Writes `report` as JSON. Collision-safe (never silently overwrites).
 * Takes an already-built SecurityReport — never builds one itself, never
 * touches AuditRun/ChaosReport/ScanResult.
 */
export async function writeSecurityReportJson(
	report: SecurityReport,
	options: WriteReportOptions = {},
): Promise<WriteReportResult> {
	const write = options.writeFile ?? fsWriteFile;
	const path = defaultReportFileName(report.reportId);
	await write(path, serializeSecurityReport(report), {encoding: 'utf8', flag: 'wx'});
	return {path};
}

/**
 * Renders and writes `report` as PDF. Collision-safe (never silently
 * overwrites). Takes an already-built SecurityReport — never builds one
 * itself.
 */
export async function writeSecurityReportPdf(
	report: SecurityReport,
	options: WritePdfOptions = {},
): Promise<WriteReportResult> {
	const write = options.writeFile ?? fsWriteFile;
	const render = options.renderPdf ?? renderSecurityReportPdf;
	const path = defaultPdfReportFileName(report.reportId);
	const pdfBuffer = await render(report);
	await write(path, pdfBuffer, {flag: 'wx'});
	return {path};
}

export type ExportFormat = 'json' | 'pdf' | 'both';

export interface ExportOutcome {
	label: 'JSON' | 'PDF';
	success: boolean;
	/** The written path on success, or a describeWriteError() message on failure. */
	message: string;
}

/**
 * Dispatches one export request against an ALREADY-BUILT SecurityReport —
 * this is the one piece of "what does J/P/B do" logic, pulled out of the
 * TUI component so it's testable without React/Ink. Never calls
 * buildSecurityReport(), runAudit(), scanContract(), or runChaosMonkey() —
 * it only knows how to write a report it was handed. Each requested format
 * is attempted independently: if JSON succeeds and PDF then fails (or vice
 * versa), both outcomes are returned — a later failure never erases an
 * earlier success. Never throws; every failure becomes an ExportOutcome
 * with success:false so a caller (TUI or otherwise) can always safely
 * continue afterward.
 */
export async function exportSecurityReport(
	report: SecurityReport,
	format: ExportFormat,
	options: {
		writeJson?: typeof writeSecurityReportJson;
		writePdf?: typeof writeSecurityReportPdf;
	} = {},
): Promise<ExportOutcome[]> {
	const writeJson = options.writeJson ?? writeSecurityReportJson;
	const writePdf = options.writePdf ?? writeSecurityReportPdf;
	const results: ExportOutcome[] = [];

	if (format === 'json' || format === 'both') {
		try {
			const {path} = await writeJson(report);
			results.push({label: 'JSON', success: true, message: path});
		} catch (error) {
			results.push({
				label: 'JSON',
				success: false,
				message: describeWriteError(error, defaultReportFileName(report.reportId), 'JSON'),
			});
		}
	}

	if (format === 'pdf' || format === 'both') {
		try {
			const {path} = await writePdf(report);
			results.push({label: 'PDF', success: true, message: path});
		} catch (error) {
			results.push({
				label: 'PDF',
				success: false,
				message: describeWriteError(error, defaultPdfReportFileName(report.reportId), 'PDF'),
			});
		}
	}

	return results;
}
