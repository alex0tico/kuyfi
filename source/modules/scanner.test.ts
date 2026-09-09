import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {parseContractSpecSection, isValidContractId, ScanError} from './scanner.js';

/**
 * D2.2 — CASE A/B: the reusable scanner's pure parse core, exercised with
 * real xdr.ScSpecEntry bytes (concatenated exactly as
 * WebAssembly.Module.customSections() would hand them to scanContract()) —
 * no network, no WebAssembly module, no React.
 */

function functionEntry(name: string, inputs: Array<{name: string; type: xdr.ScSpecTypeDef}>): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryFunctionV0(
		new xdr.ScSpecFunctionV0({
			doc: '',
			name,
			inputs: inputs.map(
				i =>
					new xdr.ScSpecFunctionInputV0({
						doc: '',
						name: i.name,
						type: i.type,
					}),
			),
			outputs: [],
		}),
	);
}

function functionEntryWithReturn(name: string): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryFunctionV0(
		new xdr.ScSpecFunctionV0({
			doc: '',
			name,
			inputs: [],
			outputs: [xdr.ScSpecTypeDef.scSpecTypeU32()],
		}),
	);
}

function structEntry(name: string, fields: Array<{name: string; type: xdr.ScSpecTypeDef}>): xdr.ScSpecEntry {
	return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
		new xdr.ScSpecUdtStructV0({
			doc: '',
			lib: '',
			name,
			fields: fields.map(f => new xdr.ScSpecUdtStructFieldV0({doc: '', name: f.name, type: f.type})),
		}),
	);
}

function specSectionBytes(entries: xdr.ScSpecEntry[]): Buffer {
	return Buffer.concat(entries.map(e => e.toXDR()));
}

// --- CASE A: same functions the previous inline app.tsx logic would have found ---

test('CASE A — parseContractSpecSection extracts the same functions/params the previous inline scanner logic produced', t => {
	const entries = [
		functionEntry('deposit', [
			{name: 'from', type: xdr.ScSpecTypeDef.scSpecTypeAddress()},
			{name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128()},
		]),
		functionEntryWithReturn('get_balance'),
	];

	const {functions} = parseContractSpecSection(specSectionBytes(entries));

	t.is(functions.length, 2);
	t.deepEqual(
		functions.map(f => f.name),
		['deposit', 'get_balance'],
	);

	const deposit = functions.find(f => f.name === 'deposit');
	t.truthy(deposit);
	t.is(deposit!.params.length, 2);
	t.is(deposit!.params[0]!.name, 'from');
	t.is(deposit!.params[0]!.type.switch().name, 'scSpecTypeAddress');
	t.is(deposit!.params[1]!.name, 'amount');
	t.is(deposit!.params[1]!.type.switch().name, 'scSpecTypeI128');
	t.false(deposit!.hasReturn);

	const getBalance = functions.find(f => f.name === 'get_balance');
	t.truthy(getBalance);
	t.is(getBalance!.params.length, 0);
	t.true(getBalance!.hasReturn);
});

// --- CASE B: UDT registry generated correctly by the reusable scanner ------

test('CASE B — parseContractSpecSection builds the same UdtRegistry buildUdtRegistry would produce directly', t => {
	const entries = [
		structEntry('Pair', [
			{name: 'a', type: xdr.ScSpecTypeDef.scSpecTypeU32()},
			{name: 'b', type: xdr.ScSpecTypeDef.scSpecTypeAddress()},
		]),
		functionEntry('echo_pair', [{name: 'p', type: xdr.ScSpecTypeDef.scSpecTypeU32()}]),
	];

	const {udtRegistry, functions} = parseContractSpecSection(specSectionBytes(entries));

	t.is(udtRegistry.size, 1);
	const pairDef = udtRegistry.get('Pair');
	t.is(pairDef?.kind, 'struct');
	if (pairDef?.kind === 'struct') {
		t.deepEqual(
			pairDef.fields.map(f => f.name),
			['a', 'b'],
		);
	}

	// The struct entry itself is not a function — must not leak into functions[].
	t.is(functions.length, 1);
	t.is(functions[0]!.name, 'echo_pair');
});

test('parseContractSpecSection throws ScanError(XDR_ALIGN_FAILURE) on garbage bytes, never a raw/unclassified error', t => {
	const error = t.throws(() => parseContractSpecSection(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])));
	t.true(error instanceof ScanError);
	t.is((error as ScanError).code, 'XDR_ALIGN_FAILURE');
});

// --- isValidContractId -------------------------------------------------------

test('isValidContractId — accepts a well-formed 56-char Contract ID starting with C', t => {
	t.true(isValidContractId(`C${'A'.repeat(55)}`));
});

test('isValidContractId — rejects wrong length, wrong prefix, and lowercase', t => {
	t.false(isValidContractId('NOTVALID'));
	t.false(isValidContractId(`G${'A'.repeat(55)}`));
	t.false(isValidContractId(`C${'a'.repeat(55)}`));
	t.false(isValidContractId(`C${'A'.repeat(54)}`));
});
