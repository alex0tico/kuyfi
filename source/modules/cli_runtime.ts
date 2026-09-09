import {writeFile as fsWriteFile} from 'node:fs/promises';
import {isValidContractId, ScanError} from './scanner.js';
import {runAudit, formatAuditSummary} from './audit.js';
import type {RunAuditOptions} from './audit.js';
import {buildSecurityReport, serializeSecurityReport} from './security_report.js';

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
}

/** `kuyfi-report-<reportId>.json` — reportId is already filename-safe by construction, but this stays defensive if that ever changes. */
export function defaultReportFileName(reportId: string): string {
	const safe = reportId.replace(/[^A-Za-z0-9._-]/g, '_');
	return `kuyfi-report-${safe}.json`;
}

/**
 * Runs one full headless audit and maps the outcome to a process exit code.
 * A THROWN error (invalid scan, RPC failure, Chaos Monkey internal failure)
 * is a tool failure → exitCode 1. A completed run is exitCode 0 regardless
 * of what severities the findings inside it carry — a security finding is
 * never confused with a tool error. When `writeJson` is set, building and
 * writing the SecurityReport happens AFTER the audit succeeds, from the
 * SAME AuditRun — never a second scan/Chaos Monkey run.
 *
 * A file-write failure (including refusing to silently overwrite an
 * existing file) IS a tool failure → exitCode 1, same as any other I/O
 * failure — it happens after a successful audit, so it does not retroactively
 * change the audit's own outcome, only the process's final exit code.
 */
export async function runHeadlessAudit(
	contractId: string,
	options: RunAuditOptions & {
		runAudit?: typeof runAudit;
		writeJson?: boolean;
		writeFile?: typeof fsWriteFile;
	} = {},
): Promise<HeadlessRunResult> {
	const audit = options.runAudit ?? runAudit;
	const write = options.writeFile ?? fsWriteFile;

	let auditRun;
	try {
		auditRun = await audit(contractId, options);
	} catch (error) {
		return {exitCode: 1, output: null, errorOutput: describeAuditError(error), reportFilePath: null};
	}

	const {scan, chaos} = auditRun;
	const summaryText = formatAuditSummary(scan, chaos);

	if (!options.writeJson) {
		return {exitCode: 0, output: summaryText, errorOutput: null, reportFilePath: null};
	}

	const securityReport = buildSecurityReport(auditRun);
	const fileName = defaultReportFileName(securityReport.reportId);

	try {
		// 'wx' = create-exclusive: throws EEXIST rather than silently overwriting.
		await write(fileName, serializeSecurityReport(securityReport), {encoding: 'utf8', flag: 'wx'});
	} catch (writeError) {
		const code = writeError instanceof Error ? (writeError as NodeJS.ErrnoException).code : undefined;
		const message =
			code === 'EEXIST'
				? `Refusing to overwrite existing file: ${fileName}`
				: `Failed to write JSON report: ${writeError instanceof Error ? writeError.message : String(writeError)}`;
		return {exitCode: 1, output: null, errorOutput: message, reportFilePath: null};
	}

	return {
		exitCode: 0,
		output: `${summaryText}\n\nJSON report written to: ${fileName}`,
		errorOutput: null,
		reportFilePath: fileName,
	};
}
