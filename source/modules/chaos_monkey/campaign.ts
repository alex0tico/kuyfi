import {readFile} from 'node:fs/promises';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {ContextConfigError, parseContextConfig} from './context_config.js';
import type {ContextConfig} from './context_config.js';
import {MAX_SEED} from '../seed.js';
import {FAIL_ON_LEVELS} from '../gate.js';
import type {FailOnLevel} from '../gate.js';

export const VECTOR_FAMILIES = [
	'math',
	'access',
	'fee',
	'liquidity',
	'call_order',
] as const;
export type VectorFamily = (typeof VECTOR_FAMILIES)[number];
export type CampaignMode = 'simulate-only' | 'broadcast';

export interface CampaignLimits {
	/** Allow-list of function names; undefined = all. */
	functions?: string[];
	/** Allow-list of vector families; undefined = all. */
	families?: VectorFamily[];
	/** Maximum invocations (simulations) for the whole campaign; undefined = unlimited. */
	maxVectors?: number;
	mode: CampaignMode;
}

/** Contents of a campaign configuration file (`--config`). */
export interface CampaignConfig {
	version: 1;
	/** Optional; if present it must equal the Contract ID passed on the command line. */
	target?: string;
	context?: ContextConfig;
	limits: CampaignLimits;
	/** Free-text reference to the authorization record. Required for `broadcast`. */
	authorizationRecord?: string;
	/** Seed for the generated test data (`--seed` wins over this). */
	seed?: number;
	/** Exit 2 on a supported finding at or above this severity (`--fail-on` wins). */
	failOn?: FailOnLevel;
	/** Count hypotheses too for `failOn` (`--fail-on-include-hypotheses` wins). */
	failOnIncludeHypotheses?: boolean;
	/** Exit 3 when the run is incomplete (`--fail-on-incomplete` wins). */
	failOnIncomplete?: boolean;
	/** Execution time limit in seconds (`--timeout` wins); reaching it is incomplete. */
	timeout?: number;
}

export class CampaignConfigError extends Error {
	constructor(public readonly problems: string[]) {
		super(`Invalid campaign configuration: ${problems.join('; ')}`);
		this.name = 'CampaignConfigError';
	}
}

const TOP_KEYS = new Set([
	'version',
	'target',
	'context',
	'limits',
	'authorizationRecord',
	'seed',
	'failOn',
	'failOnIncludeHypotheses',
	'failOnIncomplete',
	'timeout',
]);
const LIMIT_KEYS = new Set(['functions', 'families', 'maxVectors', 'mode']);

/**
 * Strict validation of a campaign configuration. Without a `limits.mode` the
 * campaign is simulate-only; `broadcast` additionally requires an
 * `authorizationRecord` (v8: without a record a campaign is simulate-only).
 */
export function parseCampaignConfig(raw: unknown): CampaignConfig {
	const problems: string[] = [];
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new CampaignConfigError(['configuration must be a JSON object']);
	}

	const obj = raw as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (!TOP_KEYS.has(key)) problems.push(`unknown top-level key "${key}"`);
	}

	if (obj['version'] !== 1) problems.push('version must be 1');
	if (obj['target'] !== undefined && typeof obj['target'] !== 'string')
		problems.push('target must be a string');
	if (
		obj['authorizationRecord'] !== undefined &&
		(typeof obj['authorizationRecord'] !== 'string' ||
			obj['authorizationRecord'].trim() === '')
	)
		problems.push('authorizationRecord must be a non-empty string');

	if (
		obj['seed'] !== undefined &&
		(!Number.isInteger(obj['seed']) ||
			(obj['seed'] as number) < 0 ||
			(obj['seed'] as number) > MAX_SEED)
	)
		problems.push(`seed must be an integer from 0 to ${MAX_SEED}`);
	if (
		obj['failOn'] !== undefined &&
		!(FAIL_ON_LEVELS as readonly unknown[]).includes(obj['failOn'])
	)
		problems.push(`failOn must be one of ${FAIL_ON_LEVELS.join(', ')}`);
	for (const key of ['failOnIncludeHypotheses', 'failOnIncomplete'])
		if (obj[key] !== undefined && typeof obj[key] !== 'boolean')
			problems.push(`${key} must be true or false`);
	if (
		obj['timeout'] !== undefined &&
		(typeof obj['timeout'] !== 'number' ||
			!Number.isFinite(obj['timeout']) ||
			obj['timeout'] <= 0)
	)
		problems.push('timeout must be a positive number of seconds');

	let context: ContextConfig | undefined;
	if (obj['context'] !== undefined) {
		try {
			const c = obj['context'];
			context = parseContextConfig(
				typeof c === 'object' && c !== null && !Array.isArray(c)
					? {version: 1, ...(c as Record<string, unknown>)}
					: c,
			);
		} catch (error) {
			if (error instanceof ContextConfigError)
				problems.push(...error.problems.map(p => `context: ${p}`));
			else throw error;
		}
	}

	const rawLimits = obj['limits'] ?? {};
	const limits: CampaignLimits = {mode: 'simulate-only'};
	if (
		typeof rawLimits !== 'object' ||
		rawLimits === null ||
		Array.isArray(rawLimits)
	) {
		problems.push('limits must be an object');
	} else {
		const l = rawLimits as Record<string, unknown>;
		for (const key of Object.keys(l)) {
			if (!LIMIT_KEYS.has(key)) problems.push(`unknown limits key "${key}"`);
		}

		if (l['mode'] !== undefined) {
			if (l['mode'] === 'simulate-only' || l['mode'] === 'broadcast')
				limits.mode = l['mode'];
			else problems.push('limits.mode must be "simulate-only" or "broadcast"');
		}

		if (l['functions'] !== undefined) {
			if (
				Array.isArray(l['functions']) &&
				l['functions'].length > 0 &&
				l['functions'].every(f => typeof f === 'string' && f !== '')
			)
				limits.functions = [...(l['functions'] as string[])];
			else problems.push('limits.functions must be a non-empty string array');
		}

		if (l['families'] !== undefined) {
			const fams = l['families'];
			if (
				Array.isArray(fams) &&
				fams.length > 0 &&
				fams.every(f => VECTOR_FAMILIES.includes(f as VectorFamily))
			)
				limits.families = [...(fams as VectorFamily[])];
			else
				problems.push(
					`limits.families must be a non-empty subset of ${VECTOR_FAMILIES.join(
						', ',
					)}`,
				);
		}

		if (l['maxVectors'] !== undefined) {
			if (Number.isInteger(l['maxVectors']) && (l['maxVectors'] as number) > 0)
				limits.maxVectors = l['maxVectors'] as number;
			else problems.push('limits.maxVectors must be a positive integer');
		}
	}

	if (limits.mode === 'broadcast' && obj['authorizationRecord'] === undefined)
		problems.push(
			'limits.mode "broadcast" requires authorizationRecord (without a record the campaign is simulate-only)',
		);

	if (problems.length > 0) throw new CampaignConfigError(problems);
	return {
		version: 1,
		...(typeof obj['target'] === 'string' ? {target: obj['target']} : {}),
		...(context ? {context} : {}),
		limits,
		...(typeof obj['authorizationRecord'] === 'string'
			? {authorizationRecord: obj['authorizationRecord']}
			: {}),
		...(obj['seed'] === undefined ? {} : {seed: obj['seed'] as number}),
		...(obj['failOn'] === undefined
			? {}
			: {failOn: obj['failOn'] as FailOnLevel}),
		...(obj['failOnIncludeHypotheses'] === undefined
			? {}
			: {failOnIncludeHypotheses: obj['failOnIncludeHypotheses'] as boolean}),
		...(obj['failOnIncomplete'] === undefined
			? {}
			: {failOnIncomplete: obj['failOnIncomplete'] as boolean}),
		...(obj['timeout'] === undefined
			? {}
			: {timeout: obj['timeout'] as number}),
	};
}

/** Reads and validates a configuration file. File and JSON errors become CampaignConfigError. */
export async function loadCampaignConfig(
	filePath: string,
	read: (p: string, enc: 'utf8') => Promise<string> = readFile,
): Promise<CampaignConfig> {
	let text: string;
	try {
		text = await read(filePath, 'utf8');
	} catch (error) {
		throw new CampaignConfigError([
			`cannot read ${filePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		]);
	}

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		throw new CampaignConfigError([
			`${filePath} is not valid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		]);
	}

	return parseCampaignConfig(json);
}

export class SimulateOnlyViolation extends Error {
	constructor() {
		super('sendTransaction is not allowed in a simulate-only campaign');
		this.name = 'SimulateOnlyViolation';
	}
}

/**
 * The RPC server every fuzzer receives, enforcing campaign limits at the one
 * choke point all network traffic goes through — so no fuzzer or future code
 * path can bypass them:
 *  - `maxVectors`: `reserveInvocation()` is checked by `invokeContract` before
 *    any network call; once exhausted, no further invocation starts.
 *  - `simulate-only`: `sendTransaction` throws, regardless of caller.
 */
export class CampaignServer extends SorobanRpc.Server {
	started = 0;
	refused = 0;
	blockedSends = 0;

	constructor(
		url: string,
		public readonly limits: CampaignLimits,
		opts?: SorobanRpc.Server.Options,
	) {
		super(url, opts);
	}

	get simulateOnly(): boolean {
		return this.limits.mode === 'simulate-only';
	}

	get budgetExhausted(): boolean {
		return (
			this.limits.maxVectors !== undefined &&
			this.started >= this.limits.maxVectors
		);
	}

	/** True if one more invocation may start (and counts it). */
	reserveInvocation(): boolean {
		if (this.budgetExhausted) {
			this.refused++;
			return false;
		}

		this.started++;
		return true;
	}

	override async sendTransaction(
		...args: Parameters<SorobanRpc.Server['sendTransaction']>
	): ReturnType<SorobanRpc.Server['sendTransaction']> {
		if (this.simulateOnly) {
			this.blockedSends++;
			throw new SimulateOnlyViolation();
		}

		return super.sendTransaction(...args);
	}
}

/** Whether a fuzzer family / function is allowed by the limits. */
export function isFamilyAllowed(
	limits: CampaignLimits | undefined,
	family: VectorFamily,
): boolean {
	return !limits?.families || limits.families.includes(family);
}

export function isFunctionAllowed(
	limits: CampaignLimits | undefined,
	functionName: string,
): boolean {
	return !limits?.functions || limits.functions.includes(functionName);
}
