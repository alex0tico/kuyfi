import {isValidContractId, ScanError} from './scanner.js';
import {runAudit, formatAuditSummary} from './audit.js';
import type {RunAuditOptions} from './audit.js';

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
}

/**
 * Runs one full headless audit and maps the outcome to a process exit code.
 * A THROWN error (invalid scan, RPC failure, Chaos Monkey internal failure)
 * is a tool failure → exitCode 1. A completed run is exitCode 0 regardless
 * of what severities the findings inside it carry — a security finding is
 * never confused with a tool error.
 */
export async function runHeadlessAudit(
	contractId: string,
	options: RunAuditOptions & {runAudit?: typeof runAudit} = {},
): Promise<HeadlessRunResult> {
	const audit = options.runAudit ?? runAudit;

	try {
		const {scan, chaos} = await audit(contractId, options);
		return {exitCode: 0, output: formatAuditSummary(scan, chaos), errorOutput: null};
	} catch (error) {
		return {exitCode: 1, output: null, errorOutput: describeAuditError(error)};
	}
}
