import {Networks, xdr} from '@stellar/stellar-sdk';
import type {Keypair} from '@stellar/stellar-sdk';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {invokeContract} from './router.js';
import {parseInvokeResult} from './result_parser.js';
import {baseline} from './type_gen.js';
import type {UdtRegistry} from './type_gen.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';
import {hasAddressTypeParam} from './fuzzer_access.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

const LIQUIDITY_FUNCTION_PATTERN = /liquidity|swap|reserve/i;

const NUMERIC_TYPES = new Set([
	'scSpecTypeU32',
	'scSpecTypeI32',
	'scSpecTypeU64',
	'scSpecTypeI64',
	'scSpecTypeU128',
	'scSpecTypeI128',
]);

const SIGNED_TYPES = new Set([
	'scSpecTypeI32',
	'scSpecTypeI64',
	'scSpecTypeI128',
]);

function isNumeric(t: AnyTypeDef): boolean {
	return NUMERIC_TYPES.has((t as xdr.ScSpecTypeDef).switch().name);
}

export function isLiquidityShapedFunction(name: string): boolean {
	return LIQUIDITY_FUNCTION_PATTERN.test(name);
}

/**
 * Picks the first two numeric parameters, by position, as the pair to
 * attack jointly. Returns null when the function has fewer than two numeric
 * parameters. Deterministic — always the same pair for the same signature.
 */
export function selectNumericPair(
	params: Array<{name: string; type: AnyTypeDef}>,
): [number, number] | null {
	const numericIndices = params
		.map((p, i) => (isNumeric(p.type) ? i : -1))
		.filter(i => i !== -1);
	return numericIndices.length < 2
		? null
		: [numericIndices[0]!, numericIndices[1]!];
}

type BoundaryKind = 'ZERO' | 'ONE' | 'MAX' | 'MIN';

function numericBoundary(t: AnyTypeDef, kind: BoundaryKind): xdr.ScVal | null {
	const n: string = (t as xdr.ScSpecTypeDef).switch().name;
	switch (n) {
		case 'scSpecTypeU32':
			return xdr.ScVal.scvU32(
				kind === 'MAX' ? 4_294_967_295 : kind === 'ONE' ? 1 : 0,
			);
		case 'scSpecTypeI32':
			return xdr.ScVal.scvI32(
				kind === 'MAX'
					? 2_147_483_647
					: kind === 'MIN'
						? -2_147_483_648
						: kind === 'ONE'
							? 1
							: 0,
			);
		case 'scSpecTypeU64':
			return xdr.ScVal.scvU64(
				xdr.Uint64.fromString(
					kind === 'MAX' ? '18446744073709551615' : kind === 'ONE' ? '1' : '0',
				),
			);
		case 'scSpecTypeI64':
			return xdr.ScVal.scvI64(
				xdr.Int64.fromString(
					kind === 'MAX'
						? '9223372036854775807'
						: kind === 'MIN'
							? '-9223372036854775808'
							: kind === 'ONE'
								? '1'
								: '0',
				),
			);
		case 'scSpecTypeU128':
			return xdr.ScVal.scvU128(
				kind === 'MAX'
					? new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('18446744073709551615'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						})
					: new xdr.UInt128Parts({
							hi: xdr.Uint64.fromString('0'),
							lo: xdr.Uint64.fromString(kind === 'ONE' ? '1' : '0'),
						}),
			);
		case 'scSpecTypeI128':
			return xdr.ScVal.scvI128(
				kind === 'MAX'
					? new xdr.Int128Parts({
							hi: xdr.Int64.fromString('9223372036854775807'),
							lo: xdr.Uint64.fromString('18446744073709551615'),
						})
					: kind === 'MIN'
						? new xdr.Int128Parts({
								hi: xdr.Int64.fromString('-9223372036854775808'),
								lo: xdr.Uint64.fromString('0'),
							})
						: new xdr.Int128Parts({
								hi: xdr.Int64.fromString('0'),
								lo: xdr.Uint64.fromString(kind === 'ONE' ? '1' : '0'),
							}),
			);
		default:
			return null;
	}
}

interface PairedVector {
	name: string;
	valA: xdr.ScVal;
	valB: xdr.ScVal;
}

/**
 * A small, fixed set of paired boundary combinations — not a combinatorial
 * sweep. Covers, per the SOW: zero-denominator-shaped cases, asymmetric
 * extremes, near-max arithmetic, and ratio boundaries. MIN_A is only
 * included for signed A (for unsigned types MIN === ZERO, which would just
 * duplicate ZERO_A_MAX_B).
 */
export function pairedBoundaryVectors(
	typeA: AnyTypeDef,
	typeB: AnyTypeDef,
): PairedVector[] {
	const build = (
		name: string,
		kindA: BoundaryKind,
		kindB: BoundaryKind,
	): PairedVector | null => {
		const valA = numericBoundary(typeA, kindA);
		const valB = numericBoundary(typeB, kindB);
		return valA === null || valB === null ? null : {name, valA, valB};
	};

	const candidates = [
		build('ZERO_A_MAX_B', 'ZERO', 'MAX'), // zero-denominator-shaped
		build('MAX_A_ZERO_B', 'MAX', 'ZERO'), // zero-denominator-shaped, reversed
		build('MAX_A_MAX_B', 'MAX', 'MAX'), // near-max arithmetic (overflow-shaped)
		build('ONE_A_MAX_B', 'ONE', 'MAX'), // ratio boundary
		build('MAX_A_ONE_B', 'MAX', 'ONE'), // ratio boundary, reversed
		SIGNED_TYPES.has((typeA as xdr.ScSpecTypeDef).switch().name)
			? build('MIN_A_MAX_B', 'MIN', 'MAX')
			: null, // asymmetric extremes
	];

	return candidates.filter((v): v is PairedVector => v !== null);
}

/**
 * Liquidity-ratio overflow fuzzer. Applies only to functions whose name
 * suggests pool/AMM semantics (liquidity/swap/reserve) and that declare at
 * least two numeric parameters — the first two such parameters (by
 * position) are attacked as a PAIR, simultaneously, while every other
 * parameter stays at baseline. This is deliberately not a combinatorial
 * sweep over all numeric-param pairs: one pair, one small fixed vector set.
 *
 * expectedToFail=false — a rejected extreme input is not automatically a
 * bug; the trace classifier alone decides what the rejection evidence shows.
 */
export async function fuzzLiquidityVectors(
	target: FuzzTarget,
	keypair: Keypair,
	server: SorobanRpc.Server,
	registry: UdtRegistry,
): Promise<FuzzResult[]> {
	if (!isLiquidityShapedFunction(target.functionName)) return [];

	const pair = selectNumericPair(target.params);
	if (!pair) return [];

	const [ia, ib] = pair;
	const paramA = target.params[ia!]!;
	const paramB = target.params[ib!]!;

	const rawBaselines = target.params.map(p => baseline(p.type, registry));
	if (rawBaselines.some(b => b === null)) return []; // unresolved param — can't build any valid call
	const baselines = rawBaselines as xdr.ScVal[];
	const hasUnverifiedAddressArg = hasAddressTypeParam(target.params);

	const results: FuzzResult[] = [];

	for (const pv of pairedBoundaryVectors(paramA.type, paramB.type)) {
		const args = baselines.map((b, j) =>
			j === ia ? pv.valA : j === ib ? pv.valB : b,
		);
		const vectorName = `LIQUIDITY::${paramA.name}x${paramB.name}::${pv.name}`;

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

	return results;
}
