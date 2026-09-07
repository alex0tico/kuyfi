import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {isFeeShapedParam, feeAttackVals} from './fuzzer_fee.js';
import {
	isLiquidityShapedFunction,
	selectNumericPair,
	pairedBoundaryVectors,
} from './fuzzer_liquidity.js';
import {hasAddressTypeParam} from './fuzzer_access.js';
import {selectCallOrderTargets} from './fuzzer_call_order.js';

const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();
const ADDRESS = xdr.ScSpecTypeDef.scSpecTypeAddress();
const BOOL = xdr.ScSpecTypeDef.scSpecTypeBool();
const SYMBOL = xdr.ScSpecTypeDef.scSpecTypeSymbol();

// ============================================================
// C1 — authorization/access-control (UNAUTHORIZED_ADDR_CALL selection)
// ============================================================

test('hasAddressTypeParam: applies when a param is Address-typed', t => {
	t.true(hasAddressTypeParam([{type: U32}, {type: ADDRESS}]));
});

test('hasAddressTypeParam: does NOT apply when no param is Address-typed', t => {
	t.false(hasAddressTypeParam([{type: U32}, {type: BOOL}]));
	t.false(hasAddressTypeParam([]));
});

// ============================================================
// C2 — fee / basis-point boundaries
// ============================================================

test('isFeeShapedParam: applies to numeric params with fee/bps-shaped names', t => {
	t.true(isFeeShapedParam('total_fee_bps', I128));
	t.true(isFeeShapedParam('protocol_fee_bps', I128));
	t.true(isFeeShapedParam('fee', U32));
	t.true(isFeeShapedParam('basis_points', U32));
});

test('isFeeShapedParam: does NOT apply to non-fee names, or fee-named non-numeric params', t => {
	t.false(isFeeShapedParam('amount', I128)); // unrelated name
	t.false(isFeeShapedParam('fee_recipient', ADDRESS)); // fee-shaped name but not numeric — nothing to boundary-fuzz
	t.false(isFeeShapedParam('fee_symbol', SYMBOL));
});

test('feeAttackVals: generates exactly the documented boundary set, type-correct for I128', t => {
	const vectors = feeAttackVals(I128);
	t.deepEqual(
		vectors.map(v => v.name),
		['BPS_0', 'BPS_1', 'BPS_9999', 'BPS_10000', 'BPS_10001', 'MAX_I128'],
	);
	for (const v of vectors) t.is(v.val.switch().name, 'scvI128');
	t.is(vectors[0]!.val.i128().lo().toString(), '0');
	t.is(vectors[3]!.val.i128().lo().toString(), '10000');
});

test('feeAttackVals: generates a type-correct set for U32 (no negative/overflow values)', t => {
	const vectors = feeAttackVals(U32);
	for (const v of vectors) t.is(v.val.switch().name, 'scvU32');
	t.is(vectors.find(v => v.name === 'MAX_U32')!.val.u32(), 4_294_967_295);
});

test('feeAttackVals: unsupported (non-numeric) type yields no fabricated values', t => {
	t.deepEqual(feeAttackVals(ADDRESS), []);
});

test('feeAttackVals: deterministic — same type always yields the same vector set', t => {
	t.deepEqual(
		feeAttackVals(U32).map(v => v.name),
		feeAttackVals(U32).map(v => v.name),
	);
});

// ============================================================
// C3 — liquidity-ratio overflow
// ============================================================

test('isLiquidityShapedFunction: applies to liquidity/swap/reserve-named functions', t => {
	t.true(isLiquidityShapedFunction('add_liquidity'));
	t.true(isLiquidityShapedFunction('remove_liquidity'));
	t.true(isLiquidityShapedFunction('swap_exact_in'));
	t.true(isLiquidityShapedFunction('get_reserves'));
});

test('isLiquidityShapedFunction: does NOT apply to unrelated function names', t => {
	t.false(isLiquidityShapedFunction('lp_transfer'));
	t.false(isLiquidityShapedFunction('claim_protocol_fees'));
});

test('selectNumericPair: picks the first two numeric params by position, ignores non-numeric ones', t => {
	const params = [
		{name: 'to', type: ADDRESS},
		{name: 'a0_desired', type: I128},
		{name: 'a1_desired', type: I128},
		{name: 'a0_min', type: I128},
	];
	t.deepEqual(selectNumericPair(params), [1, 2]);
});

test('selectNumericPair: returns null when fewer than two numeric params exist (does NOT apply)', t => {
	t.is(selectNumericPair([{name: 'trader', type: ADDRESS}]), null);
	t.is(
		selectNumericPair([
			{name: 'trader', type: ADDRESS},
			{name: 'amount', type: I128},
		]),
		null,
	);
});

test('pairedBoundaryVectors: small fixed set, type-correct, includes MIN only for signed types', t => {
	const signedPair = pairedBoundaryVectors(I128, I128);
	t.deepEqual(
		signedPair.map(v => v.name),
		[
			'ZERO_A_MAX_B',
			'MAX_A_ZERO_B',
			'MAX_A_MAX_B',
			'ONE_A_MAX_B',
			'MAX_A_ONE_B',
			'MIN_A_MAX_B',
		],
	);
	for (const v of signedPair) {
		t.is(v.valA.switch().name, 'scvI128');
		t.is(v.valB.switch().name, 'scvI128');
	}

	const unsignedPair = pairedBoundaryVectors(U32, U32);
	t.deepEqual(
		unsignedPair.map(v => v.name),
		[
			'ZERO_A_MAX_B',
			'MAX_A_ZERO_B',
			'MAX_A_MAX_B',
			'ONE_A_MAX_B',
			'MAX_A_ONE_B',
		], // no MIN_A_MAX_B — would duplicate ZERO_A_MAX_B
	);
});

test('pairedBoundaryVectors: unsupported numeric type combination yields no fabricated pairs', t => {
	t.deepEqual(pairedBoundaryVectors(ADDRESS, I128), []);
});

test('pairedBoundaryVectors: deterministic and bounded — no combinatorial explosion regardless of type', t => {
	t.true(pairedBoundaryVectors(I128, I128).length <= 6);
	t.deepEqual(
		pairedBoundaryVectors(I128, U32).map(v => v.name),
		pairedBoundaryVectors(I128, U32).map(v => v.name),
	);
});

// ============================================================
// C4 — call ordering
// ============================================================

test('selectCallOrderTargets: matches initialize/claim/withdraw-shaped functions to their sequence group', t => {
	const functions = [
		{name: 'initialize', params: []},
		{name: 'claim_protocol_fees', params: []},
		{name: 'lp_transfer', params: []},
	];
	const selected = selectCallOrderTargets(functions);
	t.deepEqual(
		selected.map(s => ({label: s.label, fn: s.fn.name})),
		[
			{label: 'REINIT_SEQUENCE', fn: 'initialize'},
			{label: 'REPEATED_CLAIM_SEQUENCE', fn: 'claim_protocol_fees'},
		],
	);
});

test('selectCallOrderTargets: does NOT apply when no function matches any sequence group', t => {
	const functions = [
		{name: 'lp_transfer', params: []},
		{name: 'get_reserves', params: []},
	];
	t.deepEqual(selectCallOrderTargets(functions), []);
});

test('selectCallOrderTargets: a function is used by at most one group (no duplication across groups)', t => {
	// "remove_liquidity" matches REPEATED_WITHDRAW_SEQUENCE ("remove") — must
	// not also be reused if it coincidentally matched another group's pattern.
	const functions = [{name: 'remove_liquidity', params: []}];
	const selected = selectCallOrderTargets(functions);
	t.is(selected.length, 1);
	t.is(selected[0]!.label, 'REPEATED_WITHDRAW_SEQUENCE');
});

test('selectCallOrderTargets: deterministic — same input always yields the same selection', t => {
	const functions = [
		{name: 'initialize', params: []},
		{name: 'withdraw', params: []},
	];
	t.deepEqual(
		selectCallOrderTargets(functions),
		selectCallOrderTargets(functions),
	);
});
