import type {xdr} from '@stellar/stellar-sdk';
import {resolveContextValue} from './context_config.js';
import type {ContextConfig} from './context_config.js';
import {attackVals, baseline} from './type_gen.js';
import type {UdtRegistry} from './type_gen.js';
import type {InputSource, TracedInput} from './provenance.js';

type AnyTypeDef = any;

const COMPOSITE = new Set([
	'scSpecTypeVec',
	'scSpecTypeMap',
	'scSpecTypeOption',
	'scSpecTypeResult',
	'scSpecTypeTuple',
	'scSpecTypeUdt',
]);
const MAX_WALK_DEPTH = 8;

/** Collects the leaf type names of a (possibly composite) spec type. */
function leafTypeNames(
	t: AnyTypeDef,
	registry: UdtRegistry,
	stack: string[] = [],
	out = new Set<string>(),
): Set<string> {
	const n = specName(t);
	if (stack.length > MAX_WALK_DEPTH) return out;
	switch (n) {
		case 'scSpecTypeVec':
			return leafTypeNames(t.vec().elementType(), registry, stack, out);
		case 'scSpecTypeOption':
			return leafTypeNames(t.option().valueType(), registry, stack, out);
		case 'scSpecTypeMap':
			leafTypeNames(t.map().keyType(), registry, stack, out);
			return leafTypeNames(t.map().valueType(), registry, stack, out);
		case 'scSpecTypeResult':
			leafTypeNames(t.result().okType(), registry, stack, out);
			return leafTypeNames(t.result().errorType(), registry, stack, out);
		case 'scSpecTypeTuple':
			for (const v of t.tuple().valueTypes() as AnyTypeDef[])
				leafTypeNames(v, registry, stack, out);
			return out;
		case 'scSpecTypeUdt': {
			const name = (t.udt().name() as Buffer).toString('utf-8');
			if (stack.includes(name)) return out; // cycle guard (generation also stops)
			const def = registry.get(name);
			if (!def) return out;
			const next = [...stack, name];
			if (def.kind === 'struct')
				for (const f of def.fields) leafTypeNames(f.type, registry, next, out);
			else if (def.kind === 'union')
				for (const c of def.cases)
					for (const v of c.valueTypes) leafTypeNames(v, registry, next, out);
			return out;
		}

		default:
			out.add(n);
			return out;
	}
}

/**
 * Source classification of one parameter. Scalars keep the old rule. A
 * composite is `test_data` if any leaf is an Address (the generators fill
 * nested Addresses with random ones) and lists its distinct leaf sources.
 */
function classify(
	t: AnyTypeDef,
	registry: UdtRegistry,
	nonAddressSource: InputSource,
): {source: InputSource; nested?: InputSource[]} {
	if (!COMPOSITE.has(specName(t)))
		return {
			source:
				specName(t) === 'scSpecTypeAddress' ? 'test_data' : nonAddressSource,
		};
	const leaves = leafTypeNames(t, registry);
	const sources = new Set<InputSource>();
	for (const l of leaves)
		sources.add(l === 'scSpecTypeAddress' ? 'test_data' : nonAddressSource);
	if (sources.size === 0) sources.add(nonAddressSource);
	const nested = [...sources].sort();
	return {
		source: sources.has('test_data') ? 'test_data' : nonAddressSource,
		nested,
	};
}

function specName(t: AnyTypeDef): string {
	return t.switch().name as string;
}

/**
 * Baseline (neutral) value for one parameter with its provenance. With a
 * context configuration a matching role/known value replaces it; without one
 * the value is exactly what `baseline()` produced in v0.1.0.
 * Returns null when the type cannot be resolved (caller skips the function).
 */
export function buildBaselineInput(
	param: {name: string; type: AnyTypeDef},
	registry: UdtRegistry,
	context?: ContextConfig,
): TracedInput | null {
	const hit = resolveContextValue(context, param.name, specName(param.type));
	if (hit) {
		return {
			val: hit.val,
			provenance: {
				param: param.name,
				rule: 'baseline:context',
				source: 'configured_context',
				configKey: hit.configKey,
				seeded: false,
			},
		};
	}

	const val = baseline(param.type, registry);
	if (val === null) return null;
	return {
		val,
		provenance: {
			param: param.name,
			rule: 'baseline',
			...classify(param.type, registry, 'spec'),
			seeded: false,
		},
	};
}

export interface TracedAttackVector extends TracedInput {
	name: string;
}

/** Attack values for one parameter, each with provenance. Same set as `attackVals`. */
export function buildAttackInputs(
	param: {name: string; type: AnyTypeDef},
	registry: UdtRegistry,
): TracedAttackVector[] {
	const cls = classify(param.type, registry, 'type_boundary');
	return attackVals(param.type, registry).map(v => ({
		name: v.name,
		val: v.val,
		provenance: {
			param: param.name,
			rule: `attack:${v.name}`,
			...cls,
			seeded: false,
		},
	}));
}

/** Provenance for a value injected by a fuzzer's own hypothesis (not spec-derived). */
export function injectedInput(
	paramName: string,
	val: xdr.ScVal,
	rule: string,
): TracedInput {
	return {
		val,
		provenance: {param: paramName, rule, source: 'test_data', seeded: false},
	};
}
