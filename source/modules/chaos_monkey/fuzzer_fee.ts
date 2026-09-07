import {Networks, xdr} from '@stellar/stellar-sdk';
import type {Keypair} from '@stellar/stellar-sdk';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {invokeContract} from './router.js';
import {parseInvokeResult} from './result_parser.js';
import {baseline} from './type_gen.js';
import type {UdtRegistry} from './type_gen.js';
import type {AttackVector} from './type_gen.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';
import {hasAddressTypeParam} from './fuzzer_access.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

const FEE_PARAM_NAME_PATTERN = /fee|fees|bps|basis_point/i;

const NUMERIC_TYPES = new Set([
	'scSpecTypeU32',
	'scSpecTypeI32',
	'scSpecTypeU64',
	'scSpecTypeI64',
	'scSpecTypeU128',
	'scSpecTypeI128',
]);

export function isFeeShapedParam(name: string, type: AnyTypeDef): boolean {
	return (
		FEE_PARAM_NAME_PATTERN.test(name) &&
		NUMERIC_TYPES.has((type as xdr.ScSpecTypeDef).switch().name)
	);
}

/**
 * A small, defendable set of basis-point/fee boundary values — not the
 * generic numeric attackVals() set. 0/1 (lower edge), 9999/10000/10001
 * (the 100%-in-basis-points boundary most fee-splitting math is built
 * around), and the type's own max (near-max arithmetic). Rejecting 10001 is
 * expected/correct behavior for a well-guarded fee setter — this vector only
 * checks that boundaries are HANDLED, it does not assert rejection is a bug.
 */
export function feeAttackVals(t: AnyTypeDef): AttackVector[] {
	const n: string = t.switch().name;
	const raw = [0, 1, 9999, 10000, 10001];

	switch (n) {
		case 'scSpecTypeU32':
			return [
				...raw.map(v => ({name: `BPS_${v}`, val: xdr.ScVal.scvU32(v)})),
				{name: 'MAX_U32', val: xdr.ScVal.scvU32(4_294_967_295)},
			];
		case 'scSpecTypeI32':
			return [
				...raw.map(v => ({name: `BPS_${v}`, val: xdr.ScVal.scvI32(v)})),
				{name: 'MAX_I32', val: xdr.ScVal.scvI32(2_147_483_647)},
			];
		case 'scSpecTypeU64':
			return [
				...raw.map(v => ({
					name: `BPS_${v}`,
					val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(v))),
				})),
				{
					name: 'MAX_U64',
					val: xdr.ScVal.scvU64(xdr.Uint64.fromString('18446744073709551615')),
				},
			];
		case 'scSpecTypeI64':
			return [
				...raw.map(v => ({
					name: `BPS_${v}`,
					val: xdr.ScVal.scvI64(xdr.Int64.fromString(String(v))),
				})),
				{
					name: 'MAX_I64',
					val: xdr.ScVal.scvI64(xdr.Int64.fromString('9223372036854775807')),
				},
			];
		case 'scSpecTypeU128':
			return [
				...raw.map(v => ({
					name: `BPS_${v}`,
					val: xdr.ScVal.scvU128(
						new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('0'),
							lo: xdr.Uint64.fromString(String(v)),
						}),
					),
				})),
				{
					name: 'MAX_U128',
					val: xdr.ScVal.scvU128(
						new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('18446744073709551615'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						}),
					),
				},
			];
		case 'scSpecTypeI128':
			return [
				...raw.map(v => ({
					name: `BPS_${v}`,
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('0'),
							lo: xdr.Uint64.fromString(String(v)),
						}),
					),
				})),
				{
					name: 'MAX_I128',
					val: xdr.ScVal.scvI128(
						new xdr.Int128Parts({
							hi: xdr.Int64.fromString('9223372036854775807'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						}),
					),
				},
			];
		default:
			return [];
	}
}

/**
 * Fee/basis-point boundary fuzzer. One-variable-at-a-time, same strategy as
 * fuzzer_math.ts: every fee-shaped, numeric-typed parameter is attacked in
 * turn with the fee-specific boundary set while all other parameters
 * (including other fee-shaped ones) stay at baseline. expectedToFail=false
 * — this is a boundary-handling probe, not an access-control hypothesis;
 * the trace classifier alone decides what a rejection means.
 */
export async function fuzzFeeVectors(
	target: FuzzTarget,
	keypair: Keypair,
	server: SorobanRpc.Server,
	registry: UdtRegistry,
): Promise<FuzzResult[]> {
	const feeParamIndices = target.params
		.map((p, i) => (isFeeShapedParam(p.name, p.type) ? i : -1))
		.filter(i => i !== -1);

	if (feeParamIndices.length === 0) return [];

	const rawBaselines = target.params.map(p => baseline(p.type, registry));
	if (rawBaselines.some(b => b === null)) return []; // unresolved param — can't build any valid call

	const baselines = rawBaselines as xdr.ScVal[];
	const hasUnverifiedAddressArg = hasAddressTypeParam(target.params);
	const results: FuzzResult[] = [];

	for (const i of feeParamIndices) {
		const param = target.params[i]!;
		const vectors = feeAttackVals(param.type);

		for (const vec of vectors) {
			const args = baselines.map((b, j) => (j === i ? vec.val : b));
			const vectorName = `FEE::${param.name}::${vec.name}`;

			const raw = await invokeContract({
				contractId: target.contractId,
				functionName: target.functionName,
				args,
				keypair,
				server,
				networkPassphrase: Networks.TESTNET,
			});

			const parsed = parseInvokeResult(
				raw,
				false,
				target.functionName,
				vectorName,
				target.isAdminFunction,
				hasUnverifiedAddressArg,
			);
			results.push({target, vectorName, result: parsed});
		}
	}

	return results;
}
