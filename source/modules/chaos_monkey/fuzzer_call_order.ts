import {Networks, xdr} from '@stellar/stellar-sdk';
import type {Keypair} from '@stellar/stellar-sdk';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {invokeContract} from './router.js';
import {parseInvokeResult} from './result_parser.js';
import {baseline} from './type_gen.js';
import type {UdtRegistry} from './type_gen.js';
import {isAdminFunctionByName, hasAddressTypeParam} from './fuzzer_access.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

export interface CallOrderFunction {
	name: string;
	params: Array<{name: string; type: AnyTypeDef}>;
}

/**
 * Deliberately small and fixed: no symbolic state machine, no dependency
 * tracking, no arbitrary sequence generation. Each group names a single
 * hypothesis ("calling this kind of function twice in the same session is
 * where a real bug would show up") and is matched purely by name pattern
 * against the functions the scanner actually found — never fabricated.
 */
const SEQUENCE_GROUPS: Array<{label: string; patterns: string[]}> = [
	{label: 'REINIT_SEQUENCE', patterns: ['initialize', 'init', 'setup']},
	{label: 'REPEATED_WITHDRAW_SEQUENCE', patterns: ['withdraw', 'remove']},
	{label: 'REPEATED_CLAIM_SEQUENCE', patterns: ['claim']},
];

/**
 * Pure selection logic, exported for isolated testing without network
 * calls: which (at most one) function is matched per sequence group, in
 * group order, each function used by at most one group.
 */
export function selectCallOrderTargets(
	functions: CallOrderFunction[],
): Array<{label: string; fn: CallOrderFunction}> {
	const usedFunctionNames = new Set<string>();
	const selected: Array<{label: string; fn: CallOrderFunction}> = [];

	for (const group of SEQUENCE_GROUPS) {
		const fn = functions.find(
			f =>
				!usedFunctionNames.has(f.name) &&
				group.patterns.some(p => f.name.toLowerCase().includes(p)),
		);
		if (!fn) continue;
		usedFunctionNames.add(fn.name);
		selected.push({label: group.label, fn});
	}

	return selected;
}

/**
 * Call-ordering fuzzer. For each matched sequence group, calls the SAME
 * function twice in a row (same ephemeral keypair/session, baseline args
 * both times) and records both outcomes independently — e.g. `initialize`
 * then `initialize` again, or `claim` then `claim` again. A function is used
 * in at most one sequence group, in scan order, so the same function is
 * never double-counted across groups.
 *
 * expectedToFail=false for both calls — the second call's failure or success
 * is exactly the observation being made; the trace classifier alone decides
 * what it means. No branching on the first call's outcome.
 */
export async function fuzzCallOrderVectors(
	contractId: string,
	functions: CallOrderFunction[],
	keypair: Keypair,
	server: SorobanRpc.Server,
	registry: UdtRegistry,
): Promise<FuzzResult[]> {
	const results: FuzzResult[] = [];

	for (const {label, fn} of selectCallOrderTargets(functions)) {
		const rawBaselines = fn.params.map(p => baseline(p.type, registry));
		if (rawBaselines.some(b => b === null)) continue; // unresolved param — can't build a valid call
		const args = rawBaselines as xdr.ScVal[];

		const target: FuzzTarget = {
			contractId,
			functionName: fn.name,
			params: fn.params,
			isAdminFunction: isAdminFunctionByName(fn.name),
		};
		const hasUnverifiedAddressArg = hasAddressTypeParam(fn.params);

		for (const step of ['CALL_1', 'CALL_2'] as const) {
			const vectorName = `${label}::${step}`;
			// eslint-disable-next-line no-await-in-loop
			const raw = await invokeContract({
				contractId,
				functionName: fn.name,
				args,
				keypair,
				server,
				networkPassphrase: Networks.TESTNET,
			});
			const parsed = parseInvokeResult(
				raw,
				false,
				fn.name,
				vectorName,
				target.isAdminFunction,
				hasUnverifiedAddressArg,
			);
			results.push({target, vectorName, result: parsed});
		}
	}

	return results;
}
