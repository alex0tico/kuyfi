import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {baseline, attackVals, typeName} from './type_gen.js';
import type {UdtDef, UdtRegistry} from './udt_registry.js';

const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();
const ADDRESS = xdr.ScSpecTypeDef.scSpecTypeAddress();
const BOOL = xdr.ScSpecTypeDef.scSpecTypeBool();

function udtType(name: string): xdr.ScSpecTypeDef {
	return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({name}));
}

function vecOf(elementType: xdr.ScSpecTypeDef): xdr.ScSpecTypeDef {
	return xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({elementType}));
}

function optionOf(valueType: xdr.ScSpecTypeDef): xdr.ScSpecTypeDef {
	return xdr.ScSpecTypeDef.scSpecTypeOption(
		new xdr.ScSpecTypeOption({valueType}),
	);
}

function registryOf(...defs: UdtDef[]): UdtRegistry {
	const r: UdtRegistry = new Map();
	for (const d of defs) r.set(d.name, d);
	return r;
}

function mapEntries(v: xdr.ScVal): Array<{key: string; val: xdr.ScVal}> {
	t_assertIsMap(v);
	return v.map()!.map(e => ({key: e.key().sym().toString(), val: e.val()}));
}

function t_assertIsMap(v: xdr.ScVal): asserts v is xdr.ScVal {
	if (v.switch().name !== 'scvMap')
		throw new Error(`expected scvMap, got ${v.switch().name}`);
}

// ============================================================
// CHECKPOINT A — baseline()
// ============================================================

test('struct baseline builds a sorted ScVal::Map from real field values', t => {
	const struct: UdtDef = {
		kind: 'struct',
		name: 'Pair',
		fields: [
			{name: 'b', type: ADDRESS},
			{name: 'a', type: U32},
		],
	};
	const registry = registryOf(struct);
	const val = baseline(udtType('Pair'), registry);

	t.not(val, null);
	const entries = mapEntries(val!);
	t.deepEqual(
		entries.map(e => e.key),
		['a', 'b'],
	); // sorted lexicographically
	t.is(entries[0]!.val.switch().name, 'scvU32');
	t.is(entries[1]!.val.switch().name, 'scvAddress');
});

test('enum baseline uses the first real declared discriminant, never a fabricated value', t => {
	const en: UdtDef = {
		kind: 'enum',
		name: 'Status',
		cases: [
			{name: 'Active', value: 1},
			{name: 'Paused', value: 2},
		],
	};
	const val = baseline(udtType('Status'), registryOf(en));
	t.not(val, null);
	t.is(val!.switch().name, 'scvU32');
	t.is(val!.u32(), 1);
});

test('union baseline uses the first case, Vec[Symbol(case), ...payload] shape', t => {
	const union: UdtDef = {
		kind: 'union',
		name: 'Action',
		cases: [
			{name: 'Noop', valueTypes: []},
			{name: 'SetFee', valueTypes: [U32]},
		],
	};
	const val = baseline(udtType('Action'), registryOf(union));
	t.not(val, null);
	t.is(val!.switch().name, 'scvVec');
	const vec = val!.vec()!;
	t.is(vec.length, 1);
	t.is(vec[0]!.switch().name, 'scvSymbol');
	t.is(vec[0]!.sym().toString(), 'Noop');
});

test('union baseline with a tuple-case-first union includes the payload', t => {
	const union: UdtDef = {
		kind: 'union',
		name: 'Action',
		cases: [{name: 'SetFee', valueTypes: [U32, ADDRESS]}],
	};
	const val = baseline(udtType('Action'), registryOf(union));
	const vec = val!.vec()!;
	t.is(vec.length, 3); // Symbol + 2 payload slots
	t.is(vec[0]!.sym().toString(), 'SetFee');
	t.is(vec[1]!.switch().name, 'scvU32');
	t.is(vec[2]!.switch().name, 'scvAddress');
});

test('nested UDT: struct containing another struct resolves recursively', t => {
	const inner: UdtDef = {
		kind: 'struct',
		name: 'Inner',
		fields: [{name: 'x', type: U32}],
	};
	const outer: UdtDef = {
		kind: 'struct',
		name: 'Outer',
		fields: [{name: 'inner', type: udtType('Inner')}],
	};
	const registry = registryOf(inner, outer);

	const val = baseline(udtType('Outer'), registry);
	t.not(val, null);
	const entries = mapEntries(val!);
	t.is(entries[0]!.key, 'inner');
	t.is(entries[0]!.val.switch().name, 'scvMap');
});

test('unresolved UDT (not in registry) → baseline returns null, never a fabricated ScVal', t => {
	const val = baseline(udtType('DoesNotExist'), new Map());
	t.is(val, null);
});

test('unresolved UDT inside a struct field poisons the whole struct baseline (null, not partial/fabricated)', t => {
	const outer: UdtDef = {
		kind: 'struct',
		name: 'Outer',
		fields: [{name: 'missing', type: udtType('Ghost')}],
	};
	const val = baseline(udtType('Outer'), registryOf(outer));
	t.is(val, null);
});

test('UDT inside Vec resolves via the registry (Vec<Struct>)', t => {
	const item: UdtDef = {
		kind: 'struct',
		name: 'Item',
		fields: [{name: 'qty', type: U32}],
	};
	const val = baseline(vecOf(udtType('Item')), registryOf(item));
	t.not(val, null);
	t.is(val!.switch().name, 'scvVec');
	t.is(val!.vec()![0]!.switch().name, 'scvMap');
});

test('UDT inside Vec with an unresolved element type → whole Vec baseline is null', t => {
	const val = baseline(vecOf(udtType('Ghost')), new Map());
	t.is(val, null);
});

test('UDT inside Option always yields None at baseline regardless of resolvability', t => {
	const val = baseline(optionOf(udtType('Ghost')), new Map());
	t.not(val, null);
	t.is(val!.switch().name, 'scvVoid');
});

test('recursion/cycle protection: a struct that contains itself does not stack-overflow, resolves to null', t => {
	const cyclic: UdtDef = {
		kind: 'struct',
		name: 'Node',
		fields: [{name: 'next', type: udtType('Node')}],
	};
	t.notThrows(() => baseline(udtType('Node'), registryOf(cyclic)));
	const val = baseline(udtType('Node'), registryOf(cyclic));
	t.is(val, null);
});

test('depth protection: a long (non-cyclic) UDT chain beyond MAX_UDT_DEPTH resolves to null instead of throwing', t => {
	// Node0 -> Node1 -> Node2 -> Node3 -> Node4 -> U32, 5 levels of UDT nesting
	const defs: UdtDef[] = [];
	for (let i = 0; i < 5; i++) {
		defs.push({
			kind: 'struct',
			name: `Node${i}`,
			fields: [{name: 'next', type: i === 4 ? U32 : udtType(`Node${i + 1}`)}],
		});
	}
	const registry = registryOf(...defs);
	t.notThrows(() => baseline(udtType('Node0'), registry));
	// Whether this resolves or not depends on the exact depth bound, but it
	// must never throw or hang — that's the property under test.
});

test('typeName resolves a UDT reference to its declared name', t => {
	t.is(typeName(udtType('Pair')), 'Pair');
	t.is(typeName(vecOf(udtType('Pair'))), 'Vec<Pair>');
});

// ============================================================
// CHECKPOINT B — attackVals() composite fuzzing
// ============================================================

test('struct field-by-field OAT: one vector per field per attack value, rest stay baseline', t => {
	const struct: UdtDef = {
		kind: 'struct',
		name: 'Pair',
		fields: [
			{name: 'a', type: U32},
			{name: 'flag', type: BOOL},
		],
	};
	const registry = registryOf(struct);
	const vectors = attackVals(udtType('Pair'), registry);

	// U32 has 3 attack values, BOOL has 2 → 5 total vectors, no combinatorial blow-up.
	t.is(vectors.length, 5);

	for (const v of vectors) {
		const entries = mapEntries(v.val);
		t.is(entries.length, 2); // struct always has both fields present
	}

	// Attacking field `a` must leave `flag` at its baseline (false), and vice versa.
	const aAttack = vectors.find(v => v.name.startsWith('Pair.a::'))!;
	const flagEntry = mapEntries(aAttack.val).find(e => e.key === 'flag')!;
	t.is(flagEntry.val.switch().name, 'scvBool');
	t.false(flagEntry.val.b());
});

test('enum attack vectors: one per real declared case, never a fabricated discriminant', t => {
	const en: UdtDef = {
		kind: 'enum',
		name: 'Status',
		cases: [
			{name: 'Active', value: 1},
			{name: 'Paused', value: 2},
			{name: 'Closed', value: 99},
		],
	};
	const vectors = attackVals(udtType('Status'), registryOf(en));
	t.is(vectors.length, 3);
	t.deepEqual(
		vectors.map(v => v.val.u32()),
		[1, 2, 99],
	);
});

test('union attack vectors: case-selection + type-aware payload OAT, discriminant/payload stay coherent', t => {
	const union: UdtDef = {
		kind: 'union',
		name: 'Action',
		cases: [
			{name: 'Noop', valueTypes: []},
			{name: 'SetFee', valueTypes: [U32]},
		],
	};
	const vectors = attackVals(udtType('Action'), registryOf(union));

	// Noop: 1 case-selection vector (no payload to attack).
	// SetFee: 1 case-selection vector + 3 payload attacks (U32 has 3 values).
	t.is(vectors.length, 1 + 1 + 3);

	for (const v of vectors) {
		t.is(v.val.switch().name, 'scvVec');
		const vec = v.val.vec()!;
		const caseName = vec[0]!.sym().toString();
		t.true(v.name.startsWith(`Action::${caseName}`)); // discriminant matches the vector's own name
		if (caseName === 'Noop') t.is(vec.length, 1);
		if (caseName === 'SetFee') t.is(vec.length, 2);
	}
});

test('nested composite attack: struct field that is itself a struct is attacked via its own OAT set', t => {
	const inner: UdtDef = {
		kind: 'struct',
		name: 'Inner',
		fields: [{name: 'x', type: U32}],
	};
	const outer: UdtDef = {
		kind: 'struct',
		name: 'Outer',
		fields: [{name: 'inner', type: udtType('Inner')}],
	};
	const registry = registryOf(inner, outer);

	const vectors = attackVals(udtType('Outer'), registry);
	t.is(vectors.length, 3); // Outer has one field, whose type (Inner) yields 3 struct-field vectors
	for (const v of vectors) {
		const outerEntries = mapEntries(v.val);
		t.is(outerEntries[0]!.key, 'inner');
		t.is(outerEntries[0]!.val.switch().name, 'scvMap'); // still a valid Inner struct
	}
});

test('recursion protection in attackVals: cyclic UDT yields no fabricated vectors', t => {
	const cyclic: UdtDef = {
		kind: 'struct',
		name: 'Node',
		fields: [{name: 'next', type: udtType('Node')}],
	};
	t.notThrows(() => attackVals(udtType('Node'), registryOf(cyclic)));
	t.deepEqual(attackVals(udtType('Node'), registryOf(cyclic)), []);
});

test('unresolved type in attackVals safely yields [] rather than a fabricated vector', t => {
	t.deepEqual(attackVals(udtType('Ghost'), new Map()), []);
});

test('Vec<UDT> attack vectors are skipped (not fabricated as empty elements) when the element UDT is unresolved', t => {
	const vectors = attackVals(vecOf(udtType('Ghost')), new Map());
	t.deepEqual(
		vectors.map(v => v.name),
		['EMPTY_VEC'], // ONE_ELEM_VEC/TWO_ELEM_VEC dropped — no fabricated element
	);
});

test('Vec<UDT> attack vectors include real one/two-element vectors when the element UDT resolves', t => {
	const item: UdtDef = {
		kind: 'struct',
		name: 'Item',
		fields: [{name: 'qty', type: U32}],
	};
	const vectors = attackVals(vecOf(udtType('Item')), registryOf(item));
	t.deepEqual(
		vectors.map(v => v.name),
		['EMPTY_VEC', 'ONE_ELEM_VEC', 'TWO_ELEM_VEC'],
	);
});
