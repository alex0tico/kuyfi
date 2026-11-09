import {createHash} from 'node:crypto';
import {readFile, writeFile as fsWriteFile} from 'node:fs/promises';
import path from 'node:path';
import {AuthzConfigError, loadAuthzMatrix} from './config.js';
import {AuthzRunError, runAuthzMatrix} from './run.js';
import type {AuthzReport} from './run.js';
import {getToolVersion} from '../security_report.js';
import {resolveCommit} from './build_info.js';
import {
	EXIT,
	evaluateGate,
	formatGateSummary,
	gateRequested,
	mergeGateSettings,
} from '../gate.js';
import type {ExitCode} from '../gate.js';
import {authzGateInput} from './gate_input.js';

export interface AuthzCliResult {
	/** 0 ok · 1 tool error · 2 --fail-on · 3 incomplete (precedence 1 > 2 > 3 > 0). */
	exitCode: ExitCode;
	output: string | null;
	errorOutput: string | null;
	reportFilePath: string | null;
}

export function formatAuthzSummary(report: AuthzReport): string {
	const lines = [
		`KUYFI AUTHZ MATRIX "${report.matrixId}" (${report.mode})`,
		`Source/relay: ${report.accounts.relay}`,
		'',
	];
	for (const c of report.cases) {
		const o = c.observed;
		lines.push(
			`  ${c.id.padEnd(10)} ${c.evaluation.state.padEnd(22)} accepted=${String(c.evaluation.accepted).padEnd(5)} observed=${o.outcome}/${o.stage}` +
				(o.onChain
					? ` on-chain=${o.onChain.status}@${String(o.onChain.ledger)}`
					: ''),
		);
		if (o.message) lines.push(`             ! ${o.message}`);
		for (const r of c.evaluation.reasons) lines.push(`             - ${r}`);
	}

	lines.push(
		'',
		`Executed ${report.summary.executed}/${report.summary.total}; accepted ${report.summary.accepted}/${report.summary.total}.`,
		'Evidence is simulation (explicit enforcing mode) unless an on-chain entry is shown. Executed is not accepted; a simulation never proves a state change.',
	);
	return lines.join('\n');
}

/** Strips anything shaped like a Stellar secret seed before an error text is persisted. */
export function redactSecrets(text: string): string {
	return text.replace(/\bS[A-Z2-7]{55}\b/g, '[redacted-secret]');
}

function stampOf(iso: string): string {
	return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function runAuthzCli(
	file: string,
	options: {
		outDir?: string;
		/** `--fail-on` / `--fail-on-incomplete` as passed. */
		failOn?: string;
		failOnIncomplete?: boolean;
		writeFile?: typeof fsWriteFile;
		load?: typeof loadAuthzMatrix;
		run?: typeof runAuthzMatrix;
		onProgress?: (m: string) => void;
		now?: () => Date;
		read?: (p: string, enc: 'utf8') => Promise<string>;
	} = {},
): Promise<AuthzCliResult> {
	// Invalid gate settings are a tool error before anything runs.
	let gateSettings;
	try {
		gateSettings = mergeGateSettings({
			failOn: options.failOn,
			failOnIncomplete: options.failOnIncomplete,
		});
	} catch (error) {
		return {
			exitCode: EXIT.TOOL_ERROR,
			output: null,
			errorOutput: error instanceof Error ? error.message : String(error),
			reportFilePath: null,
		};
	}

	let report: AuthzReport;
	let matrixId: string | undefined;
	let matrixSha256: string | undefined;
	let phase: 'load' | 'run' = 'load';
	try {
		const matrix = await (options.load ?? loadAuthzMatrix)(
			file,
			async (p, enc) => {
				const text = await (options.read ?? readFile)(p, enc);
				matrixSha256 = createHash('sha256').update(text).digest('hex');
				return text;
			},
		);
		matrixId = matrix.id;
		phase = 'run';
		report = await (options.run ?? runAuthzMatrix)(matrix, {
			onProgress: options.onProgress,
		});
	} catch (error) {
		const message = redactSecrets(
			error instanceof AuthzConfigError || error instanceof AuthzRunError
				? error.message
				: `Authz run failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		// A failed attempt leaves a record too (no secrets: only the redacted
		// message, the matrix identity and the phase). Best effort: the failure
		// itself is still reported if the record cannot be written.
		const failureCommit = resolveCommit();
		const failedAt = (options.now ?? (() => new Date()))().toISOString();
		const failurePath = path.join(
			options.outDir ?? '.',
			`kuyfi-authz-failure-${matrixId ?? 'unloaded'}-${stampOf(failedAt)}.json`,
		);
		try {
			await (options.writeFile ?? fsWriteFile)(
				failurePath,
				JSON.stringify(
					{
						schemaVersion: '1.0.0',
						kind: 'authz-run-failure',
						failedAt,
						phase,
						tool: {
							name: 'kuyfi',
							version: getToolVersion(),
							...(failureCommit ? {commit: failureCommit} : {}),
						},
						matrix: {
							file: path.basename(file),
							...(matrixId ? {id: matrixId} : {}),
							...(matrixSha256 ? {sha256: matrixSha256} : {}),
						},
						error: {
							name: error instanceof Error ? error.name : 'unknown',
							message,
						},
						note: 'No case results are available for this attempt. This file records that the attempt happened and why it stopped; it is not test evidence.',
					},
					null,
					2,
				) + '\n',
				{flag: 'wx'},
			);
			return {
				exitCode: 1,
				output: null,
				errorOutput: `${message}\nFailure record written to: ${failurePath}`,
				reportFilePath: failurePath,
			};
		} catch {
			return {
				exitCode: 1,
				output: null,
				errorOutput: message,
				reportFilePath: null,
			};
		}
	}

	const gate = evaluateGate(gateSettings, authzGateInput(report));
	if (matrixSha256)
		report = {
			...report,
			matrix: {file: path.basename(file), sha256: matrixSha256},
		};
	if (gateRequested(gateSettings)) report = {...report, gate};
	const stamp = stampOf(report.generatedAt);
	const target = path.join(
		options.outDir ?? '.',
		`kuyfi-authz-${report.matrixId}-${stamp}.json`,
	);
	try {
		// 'wx': never silently overwrite earlier evidence.
		await (options.writeFile ?? fsWriteFile)(
			target,
			JSON.stringify(report, null, 2) + '\n',
			{flag: 'wx'},
		);
	} catch (error) {
		return {
			exitCode: 1,
			output: null,
			errorOutput: `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
			reportFilePath: null,
		};
	}

	return {
		exitCode: gate.exitCode,
		output: `${formatAuthzSummary(report)}${gateRequested(gateSettings) ? '\n' + formatGateSummary(gate).join('\n') : ''}\n\nJSON evidence written to: ${target}`,
		errorOutput: null,
		reportFilePath: target,
	};
}
