import {Address, StrKey, nativeToScVal} from '@stellar/stellar-sdk';
import type {xdr} from '@stellar/stellar-sdk';

/**
 * Contextual configuration for a campaign: roles and known values that let the
 * generator fill a parameter with a value the contract can recognise instead
 * of a random one. Strict on purpose: unknown keys are errors, so a typo never
 * silently disables a context.
 */
export type KnownValueType =
	| 'address'
	| 'u32'
	| 'i32'
	| 'u64'
	| 'i64'
	| 'u128'
	| 'i128'
	| 'bool'
	| 'symbol'
	| 'string';

export interface KnownValue {
	type: KnownValueType;
	value: string | number | boolean;
}

export interface ContextConfig {
	version: 1;
	/** Role name → address (G… or C…). Matches parameters of type Address. */
	roles: Record<string, string>;
	/** Parameter name → typed value. */
	knownValues: Record<string, KnownValue>;
}

export class ContextConfigError extends Error {
	constructor(public readonly problems: string[]) {
		super(`Invalid context configuration: ${problems.join('; ')}`);
		this.name = 'ContextConfigError';
	}
}

const NAME = /^[A-Za-z_]\w{0,63}$/;
const TYPES = new Set<string>([
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

const SPEC_TYPE_TO_KNOWN: Record<string, KnownValueType> = {
	scSpecTypeAddress: 'address',
	scSpecTypeU32: 'u32',
	scSpecTypeI32: 'i32',
	scSpecTypeU64: 'u64',
	scSpecTypeI64: 'i64',
	scSpecTypeU128: 'u128',
	scSpecTypeI128: 'i128',
	scSpecTypeBool: 'bool',
	scSpecTypeSymbol: 'symbol',
	scSpecTypeString: 'string',
};

function isValidAddress(value: string): boolean {
	return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
}

function isIntegerString(value: string | number | boolean): boolean {
	return (
		(typeof value === 'string' || typeof value === 'number') &&
		/^-?\d+$/.test(String(value))
	);
}

function checkKnownValue(key: string, kv: KnownValue, problems: string[]) {
	if (!TYPES.has(kv.type)) {
		problems.push(`${key}.type "${String(kv.type)}" is not supported`);
		return;
	}

	switch (kv.type) {
		case 'address':
			if (typeof kv.value !== 'string' || !isValidAddress(kv.value))
				problems.push(`${key}.value is not a valid Stellar address`);
			break;
		case 'bool':
			if (typeof kv.value !== 'boolean')
				problems.push(`${key}.value must be a boolean`);
			break;
		case 'symbol':
		case 'string':
			if (typeof kv.value !== 'string')
				problems.push(`${key}.value must be a string`);
			break;
		default:
			if (!isIntegerString(kv.value))
				problems.push(`${key}.value must be an integer (number or string)`);
	}
}

/** Validates untrusted JSON into a ContextConfig; throws ContextConfigError. */
export function parseContextConfig(raw: unknown): ContextConfig {
	const problems: string[] = [];
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new ContextConfigError(['configuration must be a JSON object']);
	}

	const obj = raw as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (!['version', 'roles', 'knownValues'].includes(key))
			problems.push(`unknown top-level key "${key}"`);
	}

	if (obj['version'] !== 1) problems.push('version must be 1');

	const roles: Record<string, string> = {};
	const rawRoles = obj['roles'] ?? {};
	if (typeof rawRoles !== 'object' || rawRoles === null) {
		problems.push('roles must be an object');
	} else {
		for (const [name, value] of Object.entries(rawRoles)) {
			if (!NAME.test(name)) problems.push(`roles.${name}: invalid name`);
			else if (typeof value !== 'string' || !isValidAddress(value))
				problems.push(`roles.${name} is not a valid Stellar address`);
			else roles[name] = value;
		}
	}

	const knownValues: Record<string, KnownValue> = {};
	const rawKnown = obj['knownValues'] ?? {};
	if (typeof rawKnown !== 'object' || rawKnown === null) {
		problems.push('knownValues must be an object');
	} else {
		for (const [name, value] of Object.entries(rawKnown)) {
			const key = `knownValues.${name}`;
			if (!NAME.test(name)) problems.push(`${key}: invalid name`);
			else if (typeof value !== 'object' || value === null)
				problems.push(`${key} must be an object {type, value}`);
			else {
				const before = problems.length;
				checkKnownValue(key, value as KnownValue, problems);
				if (problems.length === before) knownValues[name] = value as KnownValue;
			}
		}
	}

	if (problems.length > 0) throw new ContextConfigError(problems);
	return {version: 1, roles, knownValues};
}

export interface ContextHit {
	val: xdr.ScVal;
	/** e.g. `roles.admin` or `knownValues.amount`. */
	configKey: string;
}

/** Converts a validated typed literal to its ScVal (shared with the authz matrix). */
export function knownValueToScVal(kv: KnownValue): xdr.ScVal {
	switch (kv.type) {
		case 'address':
			return new Address(kv.value as string).toScVal();
		case 'bool':
			return nativeToScVal(kv.value, {type: 'bool'});
		case 'symbol':
			return nativeToScVal(kv.value, {type: 'symbol'});
		case 'string':
			return nativeToScVal(kv.value, {type: 'string'});
		case 'u32':
		case 'i32':
			return nativeToScVal(Number(kv.value), {type: kv.type});
		default:
			return nativeToScVal(BigInt(kv.value as string | number), {
				type: kv.type,
			});
	}
}

/**
 * Looks up a contextual value for a parameter. Matches by parameter name
 * (case-insensitive) and requires the configured type to equal the spec type;
 * a mismatch yields no hit (the generator falls back to its normal value).
 */
export function resolveContextValue(
	config: ContextConfig | undefined,
	paramName: string,
	specTypeName: string,
): ContextHit | undefined {
	if (!config) return undefined;
	const wanted = SPEC_TYPE_TO_KNOWN[specTypeName];
	if (!wanted) return undefined;
	const lower = paramName.toLowerCase();
	const find = <T>(record: Record<string, T>) =>
		Object.keys(record).find(k => k.toLowerCase() === lower);

	if (wanted === 'address') {
		const role = find(config.roles);
		if (role !== undefined) {
			return {
				val: new Address(config.roles[role]!).toScVal(),
				configKey: `roles.${role}`,
			};
		}
	}

	const known = find(config.knownValues);
	if (known !== undefined && config.knownValues[known]!.type === wanted) {
		return {
			val: knownValueToScVal(config.knownValues[known]!),
			configKey: `knownValues.${known}`,
		};
	}

	return undefined;
}

/** Config keys never matched by any parameter — surfaces typos in a campaign. */
export function unusedContextKeys(
	config: ContextConfig,
	used: Iterable<string>,
): string[] {
	const usedSet = new Set(used);
	return [
		...Object.keys(config.roles).map(k => `roles.${k}`),
		...Object.keys(config.knownValues).map(k => `knownValues.${k}`),
	].filter(k => !usedSet.has(k));
}
