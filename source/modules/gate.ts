import type {FindingStatus, Severity} from './chaos_monkey/result_parser.js';

/** Process exit codes. Precedence when several apply: 1 > 2 > 3 > 0. */
export const EXIT = {
	OK: 0,
	TOOL_ERROR: 1,
	FAIL_ON: 2,
	INCOMPLETE: 3,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const FAIL_ON_LEVELS = [
	'info',
	'low',
	'medium',
	'high',
	'critical',
] as const;
export type FailOnLevel = (typeof FAIL_ON_LEVELS)[number];

export class GateConfigError extends Error {}

export function parseFailOn(value: unknown): FailOnLevel {
	if (
		typeof value === 'string' &&
		(FAIL_ON_LEVELS as readonly string[]).includes(value)
	)
		return value as FailOnLevel;
	throw new GateConfigError(
		`Invalid --fail-on "${String(value)}": expected one of ${FAIL_ON_LEVELS.join(', ')}.`,
	);
}

export function parseTimeout(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0)
		return value;
	throw new GateConfigError(
		`Invalid --timeout "${String(value)}": expected a positive number of seconds.`,
	);
}

/** What the user asked the gate to enforce (after flags and config are merged). */
export interface GateSettings {
	failOn?: FailOnLevel;
	includeHypotheses: boolean;
	failOnIncomplete: boolean;
	timeoutSeconds?: number;
}

/** Raw, optional inputs from one source (CLI flags or the --config file). */
export interface RawGateInputs {
	failOn?: unknown;
	failOnIncludeHypotheses?: boolean;
	failOnIncomplete?: boolean;
	timeout?: unknown;
}

/**
 * Flags win over the config file, field by field: a flag that was passed
 * replaces the file's value; a field the flags leave out falls back to the
 * file. Invalid values are a tool error (GateConfigError), never ignored.
 */
export function mergeGateSettings(
	flags: RawGateInputs,
	file: RawGateInputs = {},
): GateSettings {
	const pick = <K extends keyof RawGateInputs>(key: K) =>
		flags[key] ?? file[key];
	const failOn = pick('failOn');
	const timeout = pick('timeout');
	return {
		...(failOn === undefined ? {} : {failOn: parseFailOn(failOn)}),
		includeHypotheses: pick('failOnIncludeHypotheses') === true,
		failOnIncomplete: pick('failOnIncomplete') === true,
		...(timeout === undefined ? {} : {timeoutSeconds: parseTimeout(timeout)}),
	};
}

/** True when the user asked for any gate (the output and the JSON then carry it). */
export function gateRequested(settings: GateSettings): boolean {
	return (
		settings.failOn !== undefined ||
		settings.failOnIncomplete ||
		settings.timeoutSeconds !== undefined
	);
}

export interface GateFinding {
	severity: Severity;
	status: FindingStatus;
}

export interface GateInput {
	findings: GateFinding[];
	/** One human-readable reason per kind of incompleteness found (empty = complete). */
	incomplete: string[];
}

export type GateName = 'fail_on' | 'fail_on_incomplete';

/** JSON-safe record of what the gate saw and decided. */
export interface GateResult {
	settings: GateSettings;
	/** The exit code the gate alone calls for: 0, 2 or 3 (1 is the tool's own). */
	exitCode: 0 | 2 | 3;
	/** Every gate that fired; the exit code follows precedence (fail_on > incomplete). */
	triggered: GateName[];
	/** The gate that decided the exit code, or null when none fired. */
	decidedBy: GateName | null;
	reasons: string[];
	/** Findings by status, then severity. */
	counts: Record<FindingStatus, Record<Severity, number>>;
	/** Incompleteness found, whether or not --fail-on-incomplete was asked. */
	incomplete: string[];
}

const SEVERITY_RANK: Record<Severity, number> = {
	INFO: 0,
	LOW: 1,
	MEDIUM: 2,
	HIGH: 3,
	CRITICAL: 4,
};
const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const STATUSES: FindingStatus[] = ['supported', 'hypothesis', 'inconclusive'];

export function emptyCounts(): GateResult['counts'] {
	const row = (): Record<Severity, number> => ({
		CRITICAL: 0,
		HIGH: 0,
		MEDIUM: 0,
		LOW: 0,
		INFO: 0,
	});
	return {supported: row(), hypothesis: row(), inconclusive: row()};
}

/**
 * Pure decision. --fail-on counts only `supported` findings at or above the
 * threshold (hypotheses only with includeHypotheses; inconclusive never).
 * --fail-on-incomplete fires on any incompleteness. The exit code takes the
 * highest-precedence gate that fired: 2 over 3 over 0.
 */
export function evaluateGate(
	settings: GateSettings,
	input: GateInput,
): GateResult {
	const counts = emptyCounts();
	for (const f of input.findings) counts[f.status][f.severity]++;

	const triggered: GateName[] = [];
	const reasons: string[] = [];

	if (settings.failOn !== undefined) {
		const threshold = SEVERITY_RANK[settings.failOn.toUpperCase() as Severity];
		const counted: FindingStatus[] = settings.includeHypotheses
			? ['supported', 'hypothesis']
			: ['supported'];
		let matching = 0;
		for (const status of counted) {
			for (const severity of SEVERITIES) {
				if (SEVERITY_RANK[severity] >= threshold)
					matching += counts[status][severity];
			}
		}

		if (matching > 0) {
			triggered.push('fail_on');
			reasons.push(
				`--fail-on ${settings.failOn}: ${matching} ${counted.join('/')} finding(s) at ${settings.failOn} or above`,
			);
		}
	}

	if (settings.failOnIncomplete && input.incomplete.length > 0) {
		triggered.push('fail_on_incomplete');
		reasons.push(`--fail-on-incomplete: ${input.incomplete.join('; ')}`);
	}

	const decidedBy = triggered.includes('fail_on')
		? 'fail_on'
		: triggered.includes('fail_on_incomplete')
			? 'fail_on_incomplete'
			: null;
	return {
		settings,
		exitCode:
			decidedBy === 'fail_on'
				? EXIT.FAIL_ON
				: decidedBy === 'fail_on_incomplete'
					? EXIT.INCOMPLETE
					: EXIT.OK,
		triggered,
		decidedBy,
		reasons,
		counts,
		incomplete: input.incomplete,
	};
}

/**
 * The final exit code: a tool error always wins, then the gate's 2, then 3.
 * (`toolError` covers failed writes and any other failure after the run.)
 */
export function finalExitCode(gate: GateResult, toolError = false): ExitCode {
	return toolError ? EXIT.TOOL_ERROR : gate.exitCode;
}

/** Human-readable gate block: counts by status and severity, then what fired. */
export function formatGateSummary(gate: GateResult): string[] {
	const lines = ['', 'Gate:'];
	lines.push('  Findings by status / severity:');
	for (const status of STATUSES) {
		const row = SEVERITIES.map(
			s => `${s.toLowerCase()}=${gate.counts[status][s]}`,
		);
		lines.push(`    ${status.padEnd(12)} ${row.join(' ')}`);
	}

	if (gate.settings.failOn !== undefined)
		lines.push(
			`  --fail-on ${gate.settings.failOn}${gate.settings.includeHypotheses ? ' (including hypotheses)' : ''}`,
		);
	if (gate.settings.failOnIncomplete) lines.push('  --fail-on-incomplete');
	if (gate.settings.timeoutSeconds !== undefined)
		lines.push(`  --timeout ${gate.settings.timeoutSeconds}s`);
	if (gate.incomplete.length > 0)
		lines.push(`  Incomplete: ${gate.incomplete.join('; ')}`);
	lines.push(
		gate.decidedBy === null
			? '  Result: gate passed (exit 0)'
			: `  Result: ${gate.reasons.join(' | ')} (exit ${gate.exitCode})`,
	);
	return lines;
}
