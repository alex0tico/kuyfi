import {writeFile as fsWriteFile} from 'node:fs/promises';
import {isValidContractId, ScanError} from './scanner.js';
import {
	CampaignConfigError,
	loadCampaignConfig,
} from './chaos_monkey/campaign.js';
import type {CampaignConfig} from './chaos_monkey/campaign.js';
import {resolveSeed} from './seed.js';
import type {SeedInfo} from './seed.js';
import {
	evaluateGate,
	formatGateSummary,
	gateRequested,
	mergeGateSettings,
} from './gate.js';
import type {ExitCode, GateResult} from './gate.js';
import {runAudit, formatAuditSummary, auditGateInput} from './audit.js';
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

export {
	defaultReportFileName,
	defaultPdfReportFileName,
} from './report_export.js';

export type CliMode =
	| {kind: 'tui'}
	| {kind: 'authz'; file: string | undefined}
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
	// `authz` is never a valid Contract ID (56 chars starting with C), so the subcommand cannot collide.
	if (contractId === 'authz') return {kind: 'authz', file: positionalArgs[1]};
	if (!isValidContractId(contractId)) return {kind: 'invalid', contractId};
	return {kind: 'headless', contractId};
}

/** Domain error → clear headless-CLI text. Never parses/re-derives from a presentation string. */
export function describeAuditError(error: unknown): string {
	if (error instanceof CampaignConfigError) return error.message;

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

	return `Audit failed: ${
		error instanceof Error ? error.message : String(error)
	}`;
}

export interface HeadlessRunResult {
	/** 0 ok · 1 tool error · 2 --fail-on · 3 incomplete (precedence 1 > 2 > 3 > 0). */
	exitCode: ExitCode;
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
		/** `--seed` value; absent: the config file's seed, else one is generated. */
		seedValue?: number;
		/** `--fail-on`, `--fail-on-include-hypotheses`, `--fail-on-incomplete`, `--timeout` as passed; they win over the config file. */
		failOn?: string;
		failOnIncludeHypotheses?: boolean;
		failOnIncomplete?: boolean;
		timeout?: number;
		/** Path of a campaign configuration file (`--config`). */
		configPath?: string;
		/** Injection seam for tests. */
		loadConfig?: typeof loadCampaignConfig;
	} = {},
): Promise<HeadlessRunResult> {
	const audit = options.runAudit ?? runAudit;

	// A bad or mismatching configuration is a tool failure BEFORE any network
	// activity: nothing is scanned or sent under limits that failed to load.
	let campaign: CampaignConfig | undefined;
	if (options.configPath !== undefined) {
		try {
			campaign = await (options.loadConfig ?? loadCampaignConfig)(
				options.configPath,
			);
			if (campaign.target !== undefined && campaign.target !== contractId) {
				throw new CampaignConfigError([
					`target ${campaign.target} does not match the Contract ID ${contractId}`,
				]);
			}
		} catch (error) {
			return {
				exitCode: 1,
				output: null,
				errorOutput: describeAuditError(error),
				reportFilePath: null,
				pdfFilePath: null,
			};
		}
	}

	let seed: SeedInfo;
	let gateSettings;
	try {
		seed = resolveSeed(options.seedValue ?? campaign?.seed);
		gateSettings = mergeGateSettings(
			{
				failOn: options.failOn,
				failOnIncludeHypotheses: options.failOnIncludeHypotheses,
				failOnIncomplete: options.failOnIncomplete,
				timeout: options.timeout,
			},
			campaign,
		);
	} catch (error) {
		return {
			exitCode: 1,
			output: null,
			errorOutput: error instanceof Error ? error.message : String(error),
			reportFilePath: null,
			pdfFilePath: null,
		};
	}

	let auditRun;
	try {
		auditRun = await audit(contractId, {
			...options,
			campaign,
			seed,
			...(gateSettings.timeoutSeconds === undefined
				? {}
				: {timeoutSeconds: gateSettings.timeoutSeconds}),
		});
	} catch (error) {
		return {
			exitCode: 1,
			output: null,
			errorOutput: describeAuditError(error),
			reportFilePath: null,
			pdfFilePath: null,
		};
	}

	const {scan, chaos} = auditRun;
	// The gate is decided from the finished run alone, before any file is
	// written; a failed write below still outranks it (exit 1).
	const gate: GateResult = evaluateGate(
		gateSettings,
		auditGateInput(scan, chaos),
	);
	const summaryText = [
		formatAuditSummary(scan, chaos),
		...(gateRequested(gateSettings) ? formatGateSummary(gate) : []),
	].join('\n');

	if (!options.writeJson && !options.writePdf) {
		return {
			exitCode: gate.exitCode,
			output: summaryText,
			errorOutput: null,
			reportFilePath: null,
			pdfFilePath: null,
		};
	}

	// ONE SecurityReport, shared by both formats — never rebuilt per format.
	const securityReport: SecurityReport = buildSecurityReport(auditRun, {
		...(gateRequested(gateSettings) ? {gate} : {}),
	});
	const outputLines = [summaryText];
	let reportFilePath: string | null = null;
	let pdfFilePath: string | null = null;

	if (options.writeJson) {
		try {
			const {path} = await writeSecurityReportJson(securityReport, {
				writeFile: options.writeFile,
			});
			reportFilePath = path;
			outputLines.push(`JSON report written to: ${path}`);
		} catch (writeError) {
			return {
				exitCode: 1,
				output: null,
				errorOutput: describeWriteError(
					writeError,
					defaultReportFileName(securityReport.reportId),
					'JSON',
				),
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
				errorOutput: describeWriteError(
					writeError,
					defaultPdfReportFileName(securityReport.reportId),
					'PDF',
				),
				reportFilePath,
				pdfFilePath: null,
			};
		}
	}

	return {
		exitCode: gate.exitCode,
		output: outputLines.join('\n\n'),
		errorOutput: null,
		reportFilePath,
		pdfFilePath,
	};
}
