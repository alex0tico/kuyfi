import {Address, Keypair, Networks, xdr} from '@stellar/stellar-sdk';
import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {invokeContract} from './router.js';
import {parseInvokeResult} from './result_parser.js';
import {baseline} from './type_gen.js';
import type {UdtRegistry} from './type_gen.js';
import type {FuzzTarget, FuzzResult} from './fuzzer_math.js';

const ADMIN_FUNCTION_PATTERNS = [
	'pause',
	'unpause',
	'initialize',
	'init',
	'setup',
	'upgrade',
	'set_admin',
	'set_pending_admin',
	'transfer_admin',
	'emergency',
];

const REINIT_FUNCTION_PATTERNS = ['initialize', 'init', 'setup'];
const SELF_CALL_FUNCTION_PATTERNS = [
	'set_admin',
	'set_pending_admin',
	'transfer_admin',
];

export function isAdminFunctionByName(name: string): boolean {
	return ADMIN_FUNCTION_PATTERNS.some(pattern =>
		name.toLowerCase().includes(pattern),
	);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

/** Pure selection helper for UNAUTHORIZED_ADDR_CALL, exported for isolated testing. */
export function hasAddressTypeParam(
	params: Array<{type: AnyTypeDef}>,
): boolean {
	return params.some(
		p => (p.type as xdr.ScSpecTypeDef).switch().name === 'scSpecTypeAddress',
	);
}

/**
 * Runs access control attack vectors against admin functions.
 *
 * All arguments use type-correct values derived from the param spec,
 * including UDT structs via the registry. This ensures failures happen
 * at the auth level, not at type-parsing level.
 */
export async function fuzzAccessVectors(
	target: FuzzTarget,
	keypair: Keypair,
	server: SorobanRpc.Server,
	registry: UdtRegistry,
): Promise<FuzzResult[]> {
	const results: FuzzResult[] = [];
	const fnName = target.functionName.toLowerCase();
	const isAdmin = isAdminFunctionByName(target.functionName);
	const attackerAddrVal = new Address(keypair.publicKey()).toScVal();

	// Any parameter that can't be safely resolved (unknown/unregistered UDT,
	// or a depth/cycle limit hit) means we can't build a valid call at all for
	// these baseline-args vectors — skip them rather than substitute a
	// fabricated value for the unresolved parameter.
	const baselineArgs = target.params.map(p => baseline(p.type, registry));
	const canBuildBaselineCall = baselineArgs.every(a => a !== null);
	const hasUnverifiedAddressArg = hasAddressTypeParam(target.params);

	// 1. UNAUTHORIZED_CALL — call any admin function from a random (non-admin) keypair
	if (isAdmin && canBuildBaselineCall) {
		const raw = await invokeContract({
			contractId: target.contractId,
			functionName: target.functionName,
			args: baselineArgs as xdr.ScVal[],
			keypair,
			server,
			networkPassphrase: Networks.TESTNET,
		});
		const parsed = parseInvokeResult(
			raw,
			true,
			target.functionName,
			'UNAUTHORIZED_CALL',
			true,
			hasUnverifiedAddressArg,
		);
		results.push({target, vectorName: 'UNAUTHORIZED_CALL', result: parsed});
	}

	// 2. REINIT_ATTACK — call init/setup on an already-initialised contract
	const isReinit = REINIT_FUNCTION_PATTERNS.some(p => fnName.includes(p));
	if (isReinit && canBuildBaselineCall) {
		const raw = await invokeContract({
			contractId: target.contractId,
			functionName: target.functionName,
			args: baselineArgs as xdr.ScVal[],
			keypair,
			server,
			networkPassphrase: Networks.TESTNET,
		});
		const parsed = parseInvokeResult(
			raw,
			true,
			target.functionName,
			'REINIT_ATTACK',
			true,
			hasUnverifiedAddressArg,
		);
		results.push({target, vectorName: 'REINIT_ATTACK', result: parsed});
	}

	// 3. SELF_CALL_ATTACK — try to promote the attacker's address as admin.
	//    Address-typed params receive the attacker's address; all others get baseline.
	const isSelfCall = SELF_CALL_FUNCTION_PATTERNS.some(p => fnName === p);
	if (isSelfCall) {
		const args = target.params.map(p => {
			const isAddr =
				(p.type as xdr.ScSpecTypeDef).switch().name === 'scSpecTypeAddress';
			return isAddr ? attackerAddrVal : baseline(p.type, registry);
		});

		if (args.every(a => a !== null)) {
			const raw = await invokeContract({
				contractId: target.contractId,
				functionName: target.functionName,
				args: args as xdr.ScVal[],
				keypair,
				server,
				networkPassphrase: Networks.TESTNET,
			});
			const parsed = parseInvokeResult(
				raw,
				true,
				target.functionName,
				'SELF_CALL_ATTACK',
				true,
				hasUnverifiedAddressArg,
			);
			results.push({target, vectorName: 'SELF_CALL_ATTACK', result: parsed});
		}
	}

	// 4. UNAUTHORIZED_ADDR_CALL — for any NON-admin-named function that takes
	//    at least one Address parameter, call it with a baseline (random,
	//    unrelated) address in that slot, signed only by our own ephemeral
	//    keypair. This is a genuine attack HYPOTHESIS, not a name-pattern
	//    shortcut: black-box fuzzing cannot see whether the contract calls
	//    address_param.require_auth() internally, so we can't assert this
	//    function "requires authorization" — we can only observe what
	//    happens when it's called without providing that address's auth.
	//    Admin-named functions are excluded here since UNAUTHORIZED_CALL
	//    above already runs the identical baseline-args call for them.
	//
	//    expectedToFail=true means: if the call SUCCEEDS despite the address
	//    parameter never being authorized by its owner, that is a genuine
	//    access-control bypass (POTENTIAL_VULN). If it fails, the existing
	//    trace-primary classifier — not this vector — decides what the
	//    failure evidence actually shows (confident auth rejection → SECURE;
	//    ambiguous → UNEXPECTED_ERROR, never silently upgraded to SECURE).
	if (!isAdmin && hasAddressTypeParam(target.params) && canBuildBaselineCall) {
		const raw = await invokeContract({
			contractId: target.contractId,
			functionName: target.functionName,
			args: baselineArgs as xdr.ScVal[],
			keypair,
			server,
			networkPassphrase: Networks.TESTNET,
		});
		const parsed = parseInvokeResult(
			raw,
			true,
			target.functionName,
			'UNAUTHORIZED_ADDR_CALL',
			false,
			hasUnverifiedAddressArg,
		);
		results.push({
			target,
			vectorName: 'UNAUTHORIZED_ADDR_CALL',
			result: parsed,
		});
	}

	return results;
}
