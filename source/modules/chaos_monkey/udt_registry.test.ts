import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {buildUdtRegistry} from './udt_registry.js';

function structEntry(
	name: string,
	fields: Array<{name: string; type: xdr.ScSpecTypeDef}>,
): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
		new xdr.ScSpecUdtStructV0({
			doc: '',
			lib: '',
			name,
			fields: fields.map(
				f =>
					new xdr.ScSpecUdtStructFieldV0({
						doc: '',
						name: f.name,
						type: f.type,
					}),
			),
		}),
	);
}

function enumEntry(
	name: string,
	cases: Array<{name: string; value: number}>,
): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryUdtEnumV0(
		new xdr.ScSpecUdtEnumV0({
			doc: '',
			lib: '',
			name,
			cases: cases.map(
				c =>
					new xdr.ScSpecUdtEnumCaseV0({doc: '', name: c.name, value: c.value}),
			),
		}),
	);
}

function unionEntry(
	name: string,
	cases: Array<{name: string; valueTypes: xdr.ScSpecTypeDef[]}>,
): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
		new xdr.ScSpecUdtUnionV0({
			doc: '',
			lib: '',
			name,
			cases: cases.map(c =>
				c.valueTypes.length === 0
					? xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
							new xdr.ScSpecUdtUnionCaseVoidV0({doc: '', name: c.name}),
					  )
					: xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
							new xdr.ScSpecUdtUnionCaseTupleV0({
								doc: '',
								name: c.name,
								type: c.valueTypes,
							}),
					  ),
			),
		}),
	);
}

test('buildUdtRegistry resolves a struct entry', t => {
	const entries = [
		structEntry('Pair', [
			{name: 'a', type: xdr.ScSpecTypeDef.scSpecTypeU32()},
			{name: 'b', type: xdr.ScSpecTypeDef.scSpecTypeAddress()},
		]),
	];
	const registry = buildUdtRegistry(entries);
	const def = registry.get('Pair');
	t.is(def?.kind, 'struct');
	if (def?.kind === 'struct') {
		t.deepEqual(
			def.fields.map(f => f.name),
			['a', 'b'],
		);
	}
});

test('buildUdtRegistry resolves an enum entry with real discriminants', t => {
	const entries = [
		enumEntry('Status', [
			{name: 'Active', value: 1},
			{name: 'Paused', value: 2},
		]),
	];
	const registry = buildUdtRegistry(entries);
	const def = registry.get('Status');
	t.is(def?.kind, 'enum');
	if (def?.kind === 'enum') {
		t.deepEqual(def.cases, [
			{name: 'Active', value: 1},
			{name: 'Paused', value: 2},
		]);
	}
});

test('buildUdtRegistry resolves a union entry with void and tuple cases', t => {
	const entries = [
		unionEntry('Action', [
			{name: 'Noop', valueTypes: []},
			{name: 'SetFee', valueTypes: [xdr.ScSpecTypeDef.scSpecTypeU32()]},
		]),
	];
	const registry = buildUdtRegistry(entries);
	const def = registry.get('Action');
	t.is(def?.kind, 'union');
	if (def?.kind === 'union') {
		t.is(def.cases[0]?.name, 'Noop');
		t.is(def.cases[0]?.valueTypes.length, 0);
		t.is(def.cases[1]?.name, 'SetFee');
		t.is(def.cases[1]?.valueTypes.length, 1);
	}
});

test('buildUdtRegistry ignores function entries and unresolved kinds', t => {
	const fnEntry = xdr.ScSpecEntry.scSpecEntryFunctionV0(
		new xdr.ScSpecFunctionV0({doc: '', name: 'foo', inputs: [], outputs: []}),
	);
	const registry = buildUdtRegistry([fnEntry]);
	t.is(registry.size, 0);
});
