import {readFile} from 'node:fs/promises';
import {StrKey} from '@stellar/stellar-sdk';
import type {KnownValueType} from '../chaos_monkey/context_config.js';
import type {
	ArgSpec,
	AuthEntrySpec,
	AuthVariant,
	AuthzMatrix,
	CaseSpec,
	ExpectSpec,
	InvocationSpec,
} from './types.js';

export class AuthzConfigError extends Error {
	constructor(public readonly problems: string[]) {
		super(`Invalid authz matrix: ${problems.join('; ')}`);
		this.name = 'AuthzConfigError';
	}
}

const NAME = /^[A-Za-z_]\w{0,63}$/;
const VALUE_TYPES = new Set<string>([
	'address',
	'u32',
	'i32',
	'u64',
	'i64',
	'u128',
	'i128',
	'bool',
	'symbol',
	'string',
]);
const VARIANTS = new Set<string>([
	'valid',
	'missing',
	'invalid_signature',
	'foreign_signature',
	'expired',
]);
const STAGES = new Set<string>([
	'none',
	'authorization_missing',
	'signature_invalid',
	'signature_expired',
	'nonce_reused',
	'account_not_found',
	'contract_error',
	'check_auth_signature',
	'check_auth_policy',
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function onlyKeys(
	obj: Record<string, unknown>,
	allowed: string[],
	where: string,
	problems: string[],
) {
	for (const k of Object.keys(obj)) {
		if (!allowed.includes(k)) problems.push(`${where}: unknown key "${k}"`);
	}
}

function parseArg(
	raw: unknown,
	where: string,
	actors: Set<string>,
	problems: string[],
): ArgSpec | undefined {
	if (!isObject(raw)) {
		problems.push(`${where}: argument must be an object`);
		return undefined;
	}

	if ('actor' in raw) {
		onlyKeys(raw, ['actor'], where, problems);
		if (typeof raw['actor'] !== 'string' || !actors.has(raw['actor'])) {
			problems.push(`${where}: unknown actor "${String(raw['actor'])}"`);
			return undefined;
		}

		return {actor: raw['actor']};
	}

	onlyKeys(raw, ['type', 'value'], where, problems);
	if (typeof raw['type'] !== 'string' || !VALUE_TYPES.has(raw['type'])) {
		problems.push(`${where}: unsupported type "${String(raw['type'])}"`);
		return undefined;
	}

	const v = raw['value'];
	const type = raw['type'] as KnownValueType;
	const okScalar =
		typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
	if (!okScalar) {
		problems.push(`${where}: value must be a string, number or boolean`);
		return undefined;
	}

	if (type === 'address' && (typeof v !== 'string' || !isAddr(v))) {
		problems.push(`${where}: value is not a valid Stellar address`);
		return undefined;
	}

	if (
		['u32', 'i32', 'u64', 'i64', 'u128', 'i128'].includes(type) &&
		!/^-?\d+$/.test(String(v))
	) {
		problems.push(`${where}: value must be an integer`);
		return undefined;
	}

	return {type, value: v};
}

function isAddr(v: string): boolean {
	return StrKey.isValidEd25519PublicKey(v) || StrKey.isValidContract(v);
}

function parseArgs(
	raw: unknown,
	where: string,
	actors: Set<string>,
	problems: string[],
): ArgSpec[] {
	if (!Array.isArray(raw)) {
		problems.push(`${where}: args must be an array`);
		return [];
	}

	return raw
		.map((a, i) => parseArg(a, `${where}[${i}]`, actors, problems))
		.filter((a): a is ArgSpec => a !== undefined);
}

function parseTree(
	raw: unknown,
	where: string,
	actors: Set<string>,
	problems: string[],
	depth = 0,
): InvocationSpec | undefined {
	if (!isObject(raw) || depth > 6) {
		problems.push(`${where}: tree node must be an object (max depth 6)`);
		return undefined;
	}

	onlyKeys(
		raw,
		['contractId', 'function', 'args', 'children'],
		where,
		problems,
	);
	if (
		typeof raw['contractId'] !== 'string' ||
		!StrKey.isValidContract(raw['contractId'])
	)
		problems.push(`${where}.contractId is not a valid contract id`);
	if (typeof raw['function'] !== 'string' || !NAME.test(raw['function']))
		problems.push(`${where}.function is not a valid name`);
	const node: InvocationSpec = {
		contractId: String(raw['contractId']),
		function: String(raw['function']),
		args: parseArgs(raw['args'] ?? [], `${where}.args`, actors, problems),
	};
	if (raw['children'] !== undefined) {
		if (Array.isArray(raw['children']))
			node.children = raw['children']
				.map((c, i) =>
					parseTree(c, `${where}.children[${i}]`, actors, problems, depth + 1),
				)
				.filter((c): c is InvocationSpec => c !== undefined);
		else problems.push(`${where}.children must be an array`);
	}

	return node;
}

function parseAccount(
	acc: unknown,
	where: string,
	problems: string[],
): AuthEntrySpec['account'] {
	if (acc === undefined) return undefined;
	if (
		!isObject(acc) ||
		typeof acc['contractId'] !== 'string' ||
		!StrKey.isValidContract(acc['contractId'])
	) {
		problems.push(`${where}.account.contractId is not a valid contract id`);
		return undefined;
	}

	onlyKeys(
		acc,
		['contractId', 'publicKeyField', 'signatureField'],
		`${where}.account`,
		problems,
	);
	for (const f of ['publicKeyField', 'signatureField'] as const) {
		const v = acc[f];
		if (v !== undefined && (typeof v !== 'string' || !NAME.test(v)))
			problems.push(`${where}.account.${f} must be a field name`);
	}

	return acc as unknown as AuthEntrySpec['account'];
}

function parseExpect(
	raw: unknown,
	where: string,
	problems: string[],
): ExpectSpec | undefined {
	if (!isObject(raw)) {
		problems.push(`${where}: expect must be an object`);
		return undefined;
	}

	onlyKeys(
		raw,
		['outcome', 'stage', 'contractErrorCode', 'evidence', 'eventTopic'],
		where,
		problems,
	);
	if (raw['outcome'] !== 'success' && raw['outcome'] !== 'rejection')
		problems.push(`${where}.outcome must be "success" or "rejection"`);
	if (raw['stage'] !== undefined && !STAGES.has(String(raw['stage'])))
		problems.push(
			`${where}.stage "${String(raw['stage'])}" is not a known stage`,
		);
	if (
		raw['evidence'] !== undefined &&
		raw['evidence'] !== 'simulation' &&
		raw['evidence'] !== 'on-chain'
	)
		problems.push(`${where}.evidence must be "simulation" or "on-chain"`);
	if (
		raw['contractErrorCode'] !== undefined &&
		!Number.isInteger(raw['contractErrorCode'])
	)
		problems.push(`${where}.contractErrorCode must be an integer`);
	return raw as unknown as ExpectSpec;
}

/** Strict validation of an authz matrix; collects every problem. */
export function parseAuthzMatrix(raw: unknown): AuthzMatrix {
	const problems: string[] = [];
	if (!isObject(raw))
		throw new AuthzConfigError(['matrix must be a JSON object']);
	onlyKeys(
		raw,
		['version', 'id', 'mode', 'authorizationRecord', 'actors', 'cases'],
		'matrix',
		problems,
	);
	if (raw['version'] !== 1) problems.push('version must be 1');
	if (typeof raw['id'] !== 'string' || !/^[\w.-]{1,80}$/.test(raw['id']))
		problems.push('id must be 1-80 characters of [A-Za-z0-9_.-]');
	const mode = raw['mode'] ?? 'simulate-only';
	if (mode !== 'simulate-only' && mode !== 'broadcast')
		problems.push('mode must be "simulate-only" or "broadcast"');
	if (
		mode === 'broadcast' &&
		(typeof raw['authorizationRecord'] !== 'string' ||
			raw['authorizationRecord'].trim() === '')
	)
		problems.push('mode "broadcast" requires authorizationRecord');

	const actors: AuthzMatrix['actors'] = {};
	if (!isObject(raw['actors']) || Object.keys(raw['actors']).length === 0) {
		problems.push('actors must be a non-empty object');
	} else {
		for (const [name, spec] of Object.entries(raw['actors'])) {
			if (!NAME.test(name) || !isObject(spec)) {
				problems.push(`actors.${name}: invalid`);
				continue;
			}

			if (spec['source'] === 'ephemeral') {
				onlyKeys(spec, ['source'], `actors.${name}`, problems);
				actors[name] = {source: 'ephemeral'};
			} else if (
				spec['source'] === 'env' &&
				typeof spec['secretEnv'] === 'string' &&
				/^[A-Z_][A-Z0-9_]*$/.test(spec['secretEnv'])
			) {
				onlyKeys(spec, ['source', 'secretEnv'], `actors.${name}`, problems);
				actors[name] = {source: 'env', secretEnv: spec['secretEnv']};
			} else {
				problems.push(
					`actors.${name}: source must be "ephemeral" or {source:"env", secretEnv:"VAR_NAME"} (secrets never go in the file)`,
				);
			}
		}
	}

	const actorNames = new Set(Object.keys(actors));
	const cases: CaseSpec[] = [];
	const ids = new Set<string>();
	if (!Array.isArray(raw['cases']) || raw['cases'].length === 0) {
		problems.push('cases must be a non-empty array');
	} else {
		for (const [i, c] of raw['cases'].entries()) {
			const where = `cases[${i}]`;
			if (!isObject(c)) {
				problems.push(`${where} must be an object`);
				continue;
			}

			onlyKeys(
				c,
				[
					'id',
					'description',
					'call',
					'authorization',
					'submit',
					'stateRead',
					'expect',
					'control',
				],
				where,
				problems,
			);
			if (typeof c['id'] !== 'string' || !NAME.test(c['id'].replace(/-/g, '_')))
				problems.push(`${where}.id invalid`);
			else if (ids.has(c['id']))
				problems.push(`${where}.id "${c['id']}" duplicated`);
			else ids.add(c['id']);
			const call = isObject(c['call']) ? c['call'] : undefined;
			if (!call) problems.push(`${where}.call must be an object`);
			const callTree = call
				? parseTree(
						{...call, children: undefined},
						`${where}.call`,
						actorNames,
						problems,
					)
				: undefined;
			const auth: AuthEntrySpec[] = [];
			const authList = Array.isArray(c['authorization'])
				? (c['authorization'] as unknown[])
				: undefined;
			if (!authList)
				problems.push(
					`${where}.authorization must be an array (empty = no entries)`,
				);
			for (const [j, a] of (authList ?? []).entries()) {
				const aw = `${where}.authorization[${j}]`;
				if (!isObject(a)) {
					problems.push(`${aw} must be an object`);
					continue;
				}

				onlyKeys(
					a,
					['actor', 'account', 'variant', 'tree', 'expirationOffset'],
					aw,
					problems,
				);
				if (typeof a['actor'] !== 'string' || !actorNames.has(a['actor']))
					problems.push(`${aw}.actor unknown`);
				if (typeof a['variant'] !== 'string' || !VARIANTS.has(a['variant']))
					problems.push(`${aw}.variant invalid`);
				if (
					a['expirationOffset'] !== undefined &&
					(!Number.isInteger(a['expirationOffset']) ||
						(a['expirationOffset'] as number) < 0)
				)
					problems.push(
						`${aw}.expirationOffset must be a non-negative integer`,
					);
				const account = parseAccount(a['account'], aw, problems);
				const entry: AuthEntrySpec = {
					actor: String(a['actor']),
					variant: a['variant'] as AuthVariant,
					...(account ? {account} : {}),
				};
				if (a['expirationOffset'] !== undefined)
					entry.expirationOffset = a['expirationOffset'] as number;
				if (a['tree'] !== undefined) {
					const t = parseTree(a['tree'], `${aw}.tree`, actorNames, problems);
					if (t) entry.tree = t;
				}

				auth.push(entry);
			}

			if (c['submit'] !== undefined && typeof c['submit'] !== 'boolean')
				problems.push(`${where}.submit must be a boolean`);
			let stateRead: CaseSpec['stateRead'];
			if (c['stateRead'] !== undefined) {
				const t = parseTree(
					{...(c['stateRead'] as object), children: undefined},
					`${where}.stateRead`,
					actorNames,
					problems,
				);
				if (t)
					stateRead = {
						contractId: t.contractId,
						function: t.function,
						args: t.args,
					};
			}

			const expect =
				c['expect'] === undefined
					? undefined
					: parseExpect(c['expect'], `${where}.expect`, problems);
			if (c['control'] !== undefined && typeof c['control'] !== 'string')
				problems.push(`${where}.control must be a case id`);
			if (callTree) {
				cases.push({
					id: String(c['id']),
					...(typeof c['description'] === 'string'
						? {description: c['description']}
						: {}),
					call: {
						contractId: callTree.contractId,
						function: callTree.function,
						args: callTree.args,
					},
					authorization: auth,
					...(c['submit'] === true ? {submit: true} : {}),
					...(stateRead ? {stateRead} : {}),
					...(expect ? {expect} : {}),
					...(typeof c['control'] === 'string' ? {control: c['control']} : {}),
				});
			}
		}

		for (const c of cases)
			if (c.control && !ids.has(c.control))
				problems.push(`case ${c.id}: control "${c.control}" is not a case id`);
	}

	if (problems.length > 0) throw new AuthzConfigError(problems);
	return {
		version: 1,
		id: raw['id'] as string,
		mode: mode as AuthzMatrix['mode'],
		...(typeof raw['authorizationRecord'] === 'string'
			? {authorizationRecord: raw['authorizationRecord']}
			: {}),
		actors,
		cases,
	};
}

export async function loadAuthzMatrix(
	filePath: string,
	read: (p: string, enc: 'utf8') => Promise<string> = readFile,
): Promise<AuthzMatrix> {
	let text: string;
	try {
		text = await read(filePath, 'utf8');
	} catch (error) {
		throw new AuthzConfigError([
			`cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		]);
	}

	try {
		return parseAuthzMatrix(JSON.parse(text));
	} catch (error) {
		if (error instanceof AuthzConfigError) throw error;
		throw new AuthzConfigError([
			`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		]);
	}
}
