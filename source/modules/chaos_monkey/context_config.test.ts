import test from 'ava';
import {Address, Keypair, xdr} from '@stellar/stellar-sdk';
import {
	ContextConfigError,
	parseContextConfig,
	resolveContextValue,
	unusedContextKeys,
} from './context_config.js';
import {buildAttackInputs, buildBaselineInput} from './input_builder.js';
import type {UdtDef, UdtRegistry} from './udt_registry.js';
import {isValidProvenance, provenanceCoverage} from './provenance.js';

const ADMIN = Keypair.random().publicKey();
const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();
const ADDRESS = xdr.ScSpecTypeDef.scSpecTypeAddress();

const valid = () =>
	parseContextConfig({
		version: 1,
		roles: {admin: ADMIN},
		knownValues: {amount: {type: 'i128', value: '1000'}},
	});

test('parseContextConfig accepts a valid configuration', t => {
	const c = valid();
	t.is(c.roles['admin'], ADMIN);
	t.is(c.knownValues['amount']!.type, 'i128');
});

test('parseContextConfig rejects unknown keys, bad addresses and wrong types, listing every problem', t => {
	const error = t.throws(
		() =>
			parseContextConfig({
				version: 1,
				extra: true,
				roles: {admin: 'not-an-address'},
				knownValues: {
					n: {type: 'u32', value: 'abc'},
					f: {type: 'float', value: 1},
				},
			}),
		{instanceOf: ContextConfigError},
	);
	t.is(error!.problems.length, 4);
});

test('parseContextConfig rejects non-objects and a wrong version', t => {
	t.throws(() => parseContextConfig(null), {instanceOf: ContextConfigError});
	t.throws(() => parseContextConfig([]), {instanceOf: ContextConfigError});
	t.throws(() => parseContextConfig({version: 2}), {
		instanceOf: ContextConfigError,
	});
});

test('resolveContextValue matches roles for Address and typed known values, case-insensitively', t => {
	const c = valid();
	const role = resolveContextValue(c, 'Admin', 'scSpecTypeAddress')!;
	t.is(role.configKey, 'roles.admin');
	t.is(Address.fromScVal(role.val).toString(), ADMIN);
	const amount = resolveContextValue(c, 'amount', 'scSpecTypeI128')!;
	t.is(amount.configKey, 'knownValues.amount');
});

test('resolveContextValue does not apply a known value of a different type', t => {
	t.is(resolveContextValue(valid(), 'amount', 'scSpecTypeU32'), undefined);
	t.is(resolveContextValue(undefined, 'admin', 'scSpecTypeAddress'), undefined);
});

test('unusedContextKeys surfaces keys that never matched', t => {
	t.deepEqual(unusedContextKeys(valid(), ['roles.admin']), [
		'knownValues.amount',
	]);
});

test('buildBaselineInput with context records configured_context and the config key', t => {
	const r = buildBaselineInput(
		{name: 'admin', type: ADDRESS},
		new Map(),
		valid(),
	)!;
	t.is(r.provenance.source, 'configured_context');
	t.is(r.provenance.configKey, 'roles.admin');
	t.is(Address.fromScVal(r.val).toString(), ADMIN);
});

test('buildBaselineInput without context keeps v0.1.0 behaviour and records spec/test_data', t => {
	const n = buildBaselineInput({name: 'n', type: U32}, new Map())!;
	t.is(n.val.u32(), 0);
	t.deepEqual(n.provenance, {
		param: 'n',
		rule: 'baseline',
		source: 'spec',
		seeded: false,
	});
	const a = buildBaselineInput({name: 'who', type: ADDRESS}, new Map())!;
	t.is(a.provenance.source, 'test_data');
	t.is(a.provenance.configKey, undefined);
});

test('buildBaselineInput returns null for an unresolvable UDT (never fabricates)', t => {
	const udt = xdr.ScSpecTypeDef.scSpecTypeUdt(
		new xdr.ScSpecTypeUdt({name: 'Missing'}),
	);
	t.is(buildBaselineInput({name: 'x', type: udt}, new Map()), null);
});

test('buildAttackInputs gives every attack vector a provenance entry', t => {
	const vectors = buildAttackInputs({name: 'amount', type: I128}, new Map());
	t.true(vectors.length > 0);
	for (const v of vectors) {
		t.is(v.provenance.param, 'amount');
		t.is(v.provenance.rule, `attack:${v.name}`);
		t.is(v.provenance.source, 'type_boundary');
	}

	const addr = buildAttackInputs({name: 'who', type: ADDRESS}, new Map());
	t.true(addr.every(v => v.provenance.source === 'test_data'));
});

test('provenanceCoverage flags invocations without one entry per parameter', t => {
	const target = {functionName: 'f', params: [1, 2]};
	const entry = {
		param: 'a',
		rule: 'baseline',
		source: 'spec' as const,
		seeded: false,
	};
	const c = provenanceCoverage([
		{target, vectorName: 'ok', inputs: [entry, entry]},
		{target, vectorName: 'short', inputs: [entry]},
		{target, vectorName: 'none'},
	]);
	t.is(c.invocations, 3);
	t.is(c.invocationsWithProvenance, 1);
	t.deepEqual(
		c.missing.map(m => m.vectorName),
		['short', 'none'],
	);
});

// --- nested / composite parameters ---
const udt = (name: string) =>
	xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({name}));
const vecOf = (elementType: xdr.ScSpecTypeDef) =>
	xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({elementType}));
const registryOf = (...defs: UdtDef[]): UdtRegistry =>
	new Map(defs.map(d => [d.name, d]));
const registryWithPos = (): UdtRegistry =>
	registryOf({
		kind: 'struct',
		name: 'Pos',
		fields: [
			{name: 'owner', type: ADDRESS},
			{name: 'n', type: U32},
		],
	});

test('a struct containing an Address is test_data (not spec) and lists its leaf sources', t => {
	const r = buildBaselineInput(
		{name: 'pos', type: udt('Pos')},
		registryWithPos(),
	)!;
	t.is(r.provenance.source, 'test_data');
	t.deepEqual(r.provenance.nested, ['spec', 'test_data']);
	t.true(isValidProvenance(r.provenance));
});

test('Vec<Address> and Option<Address> are test_data; Vec<u32> stays spec with nested leaves', t => {
	const vecAddr = buildBaselineInput(
		{name: 'a', type: vecOf(ADDRESS)},
		new Map(),
	)!;
	t.is(vecAddr.provenance.source, 'test_data');
	t.deepEqual(vecAddr.provenance.nested, ['test_data']);
	const vecU32 = buildBaselineInput({name: 'b', type: vecOf(U32)}, new Map())!;
	t.is(vecU32.provenance.source, 'spec');
	t.deepEqual(vecU32.provenance.nested, ['spec']);
	t.is(
		buildBaselineInput({name: 'c', type: U32}, new Map())!.provenance.nested,
		undefined,
	);
});

test('attack vectors for Vec<UDT-with-Address> carry nested test_data', t => {
	const vectors = buildAttackInputs(
		{name: 'ps', type: vecOf(udt('Pos'))},
		registryWithPos(),
	);
	t.true(vectors.length > 0);
	for (const v of vectors) {
		t.is(v.provenance.source, 'test_data');
		t.true(v.provenance.nested!.includes('test_data'));
	}
});

test('a self-referencing UDT does not hang the leaf walk', t => {
	const reg = registryOf({
		kind: 'struct',
		name: 'Loop',
		fields: [{name: 'next', type: udt('Loop')}],
	});
	const r = buildBaselineInput({name: 'l', type: udt('Loop')}, reg);
	t.is(r, null); // unresolvable by baseline(): no inputs are generated for it
});

test('context never replaces nested fields: a struct param ignores a same-named known value', t => {
	const cfg = parseContextConfig({
		version: 1,
		knownValues: {pos: {type: 'u32', value: 1}},
	});
	const r = buildBaselineInput(
		{name: 'pos', type: udt('Pos')},
		registryWithPos(),
		cfg,
	)!;
	t.not(r.provenance.source, 'configured_context');
});
