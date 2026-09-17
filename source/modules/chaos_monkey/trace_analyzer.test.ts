import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {analyzeDiagnosticTrace} from './trace_analyzer.js';
import {classifyErrorFromTrace, parseInvokeResult} from './result_parser.js';
import type {InvokeResult} from './router.js';

const CONTRACT_UNDER_TEST = Buffer.alloc(32, 0xaa);
const NESTED_CONTRACT = Buffer.alloc(32, 0xbb);

/**
 * Builds a real xdr.DiagnosticEvent using the actual SDK classes (not a
 * plain mock), matching the constructor shapes verified against the
 * installed @stellar/stellar-sdk (14.6.1) types.
 */
function buildEvent(opts: {
	contractId: Buffer | null;
	topics: xdr.ScVal[];
	data?: xdr.ScVal;
}): xdr.DiagnosticEvent {
	const body = new xdr.ContractEventBody(
		0,
		new xdr.ContractEventV0({
			topics: opts.topics,
			data: opts.data ?? xdr.ScVal.scvVoid(),
		}),
	);
	const event = new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		// xdr.Hash's .d.ts type (Opaque[]) doesn't match its runtime Buffer shape.
		contractId: opts.contractId as unknown as xdr.Hash | null,
		type: xdr.ContractEventType.diagnostic(),
		body,
	});
	return new xdr.DiagnosticEvent({
		inSuccessfulContractCall: false,
		event,
	});
}

function fnCallEvent(
	contractId: Buffer,
	functionName: string,
): xdr.DiagnosticEvent {
	// Matches the real Testnet trace shape: fn_call events carry no direct
	// ContractEvent.contractId() (null) — the target contract id/function
	// name live among the topics instead.
	return buildEvent({
		contractId: null,
		topics: [
			xdr.ScVal.scvSymbol('fn_call'),
			xdr.ScVal.scvBytes(contractId),
			xdr.ScVal.scvSymbol(functionName),
		],
	});
}

function fnReturnEvent(
	contractId: Buffer,
	functionName: string,
): xdr.DiagnosticEvent {
	return buildEvent({
		contractId: null,
		topics: [
			xdr.ScVal.scvSymbol('fn_return'),
			xdr.ScVal.scvBytes(contractId),
			xdr.ScVal.scvSymbol(functionName),
		],
	});
}

function errorEvent(
	contractId: Buffer,
	scError: xdr.ScError,
): xdr.DiagnosticEvent {
	// Matches the real Testnet trace shape: error events DO carry a direct
	// ContractEvent.contractId() for the contract whose execution failed.
	return buildEvent({
		contractId,
		topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(scError)],
	});
}

// --- 1. root fn_call + precondition/auth-like failure -----------------------

test('root fn_call + auth error → PRECONDITION_FAIL', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'set_admin'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 0);
	t.true(analysis.hasAuthError);

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'PRECONDITION_FAIL');
});

// --- 2. root fn_call + ambiguous runtime/WASM error --------------------------

test('root fn_call + WasmVm/InvalidAction (the real observed Testnet shape) → UNEXPECTED_ERROR (inconclusive), NOT PRECONDITION_FAIL/UNCONTROLLED_PANIC/POTENTIAL_VULN', t => {
	// Reproduces the exact trace captured against
	// CCSJ3REOFONMUJUINMZWBL45UXJYFXVFSXAWINLTDKFNEYBCRR4VF2Q2 for both
	// `initialize` and `swap_exact_in`: a single root fn_call frame followed
	// by an Error(WasmVm, InvalidAction), no nested calls, no auth signal.
	// The trace alone cannot prove this is a benign precondition guard
	// (PRECONDITION_FAIL) any more than it can prove a genuine unguarded
	// panic (UNCONTROLLED_PANIC) — UNEXPECTED_ERROR is the honest, still-
	// visible-as-a-finding "inconclusive" verdict.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'initialize'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 0);
	t.false(analysis.hasAuthError);
	t.is(analysis.errors[0]?.category, 'WASM_VM');
	t.is(analysis.errors[0]?.code, 'scecInvalidAction');

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('root fn_call + WasmVm/ExceededLimit → UNEXPECTED_ERROR, not UNCONTROLLED_PANIC (host size/resource limits can be the correct rejection of an oversized fuzzer input)', t => {
	// ExceededLimit commonly fires on host-level size limits — including
	// exactly the oversized-input attack vectors this fuzzer sends
	// (OVERSIZE_SYMBOL, LARGE_BYTES). Tripping it can be the CORRECT expected
	// behavior, not a bug, so it must not be treated as a "strong" fault.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecExceededLimit()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 0);

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('root fn_call + WasmVm/ArithDomain (clearly supported runtime fault: documented arithmetic-overflow code, root-attributed) → UNCONTROLLED_PANIC', t => {
	// ArithDomain/IndexBounds are kept as "strong" because their documented
	// XDR meaning (arithmetic overflow/div-by-zero, out-of-bounds indexing)
	// is not something a contract author would use as a deliberate guard —
	// unlike InvalidAction/ExceededLimit, which plausibly are.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 0);
	t.is(analysis.failureLocation, 'ROOT');

	// hasUnverifiedAddressArg=true here on purpose: a strong runtime-safety
	// fault is evidence about the crafted numeric attack value, not about an
	// unrelated Address parameter's semantics — it must escalate either way.
	const {signal} = classifyErrorFromTrace(analysis, true);
	t.is(signal, 'UNCONTROLLED_PANIC');
});

// --- 3. root fn_call → nested fn_call → nested failure -----------------------

test('root fn_call → nested fn_call → failure attributed to the NESTED contract → UNEXPECTED_ERROR, NOT auto-attributed to the root as POTENTIAL_VULN', t => {
	// The error event's contractId is the NESTED contract, not the root under
	// test. We must not credit/blame the root contract for a callee's fault —
	// this is exactly SOW category (c) ("nested failed cross-contract call"):
	// nameable, but not automatically the root's bug.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(
			NESTED_CONTRACT,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 1);
	t.is(analysis.involvedContractIds.length, 2);
	t.is(analysis.failureLocation, 'NESTED');

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('root fn_call → nested fn_call → strong fault attributed to the NESTED contract → still UNEXPECTED_ERROR (attribution gate applies before the code check)', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(
			NESTED_CONTRACT,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 1);
	t.is(analysis.failureLocation, 'NESTED');

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('root fn_call → nested fn_call returns → root itself then fails, NO Address param involved → POTENTIAL_VULN', t => {
	// The nested call completed (fn_return) and the ROOT contract's own
	// subsequent code is what trapped — attribution is confirmed, and the
	// "trivial precondition check at entry" explanation doesn't fit since
	// real nested-call activity happened first. hasUnverifiedAddressArg=false
	// means there is no fabricated-address explanation available either, so
	// this is the one case where nesting legitimately strengthens the verdict.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		fnReturnEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 1);
	t.is(analysis.failureLocation, 'ROOT');

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'POTENTIAL_VULN');
});

test('GATE 1 — identical trace as above, but the call DOES include an unverified Address param → UNEXPECTED_ERROR, NOT POTENTIAL_VULN', t => {
	// This reproduces the exact shape of the 18 inflated add_liquidity
	// findings from the first acceptance run: root-attributed generic trap
	// after real nested-call activity. type-correct input != semantically
	// valid input — the fuzzer's Address arguments (e.g. `to`) are fabricated,
	// unfunded, unauthorized keypairs, never real externally-known addresses.
	// A generic trap reached only after crossing into another contract is
	// exactly the shape produced by that fake address tripping a downstream
	// precondition (missing balance/trustline on a token call, for example).
	// We cannot rule that story out, so we must not escalate to a HIGH finding.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'add_liquidity'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		fnReturnEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 1);
	t.is(analysis.failureLocation, 'ROOT');

	const {signal, details} = classifyErrorFromTrace(analysis, true);
	t.is(signal, 'UNEXPECTED_ERROR');
	t.not(signal, 'POTENTIAL_VULN');
	t.true(details.includes('Address'));
});

test('GATE 1 — same nested+root-attributed shape, but a STRONG runtime fault (ArithDomain) still escalates even with an unverified Address param', t => {
	// Strong fault codes are unaffected by hasUnverifiedAddressArg: an
	// arithmetic-overflow fault is evidence about the crafted numeric attack
	// value, not about the Address parameter's real-world semantics — there
	// is no plausible "the fake address explains this" story for this code.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'add_liquidity'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		fnReturnEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain()),
		),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.nestedCallCount, 1);
	t.is(analysis.failureLocation, 'ROOT');

	const {signal} = classifyErrorFromTrace(analysis, true);
	t.is(signal, 'POTENTIAL_VULN');
});

// --- 4. trace with a return/success shape ------------------------------------

test('root fn_call + fn_return, no error event → parses cleanly, no crash', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'get_reserves'),
		fnReturnEvent(CONTRACT_UNDER_TEST, 'get_reserves'),
	];

	const analysis = analyzeDiagnosticTrace(events);
	t.is(analysis.callFrames.length, 2);
	t.is(analysis.errors.length, 0);
	t.false(analysis.malformed);

	// If this trace were (hypothetically) handed to the classifier on a
	// failure path, it must not fabricate a vulnerability from an absent error.
	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

// --- 5. diagnosticEvents = [] → fallback to the string classifier -----------

test('diagnosticEvents.length === 0 → falls back to the legacy string classifier', t => {
	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(Contract, #1)',
		simulationFailed: true,
		diagnosticEvents: [],
	};

	const parsed = parseInvokeResult(
		result,
		false,
		'initialize',
		'total_fee_bps::ZERO',
		true,
		true,
	);
	// Matches the pre-existing string-based mapping for "Error(Contract,...)".
	t.is(parsed.signal, 'SECURE');
});

test('diagnosticEvents present takes priority over errorMessage even when the string would classify differently', t => {
	// errorMessage alone (old path) would match "error(contract," → SECURE,
	// but a structured auth error is present — the trace must win and the
	// string must not be consulted at all.
	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(Contract, #1)',
		simulationFailed: true,
		diagnosticEvents: [
			fnCallEvent(CONTRACT_UNDER_TEST, 'set_admin'),
			errorEvent(
				CONTRACT_UNDER_TEST,
				xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction()),
			),
		],
	};

	const parsed = parseInvokeResult(
		result,
		true,
		'set_admin',
		'UNAUTHORIZED_CALL',
		true,
		true,
	);
	t.is(parsed.signal, 'SECURE'); // PRECONDITION_FAIL from the trace, wrapped to SECURE for an expectedToFail vector
});

// --- execution classification vs. vector outcome (access-control rejection) -

test('UNAUTHORIZED_CALL rejected via an ambiguous root panic → execution layer is inconclusive, vector layer must NOT declare SECURE on its own', t => {
	// The call WAS rejected (didn't succeed), which is the outcome the
	// UNAUTHORIZED_CALL vector wants — but the trace classifier alone cannot
	// confirm the rejection came from an actual auth check rather than an
	// unrelated ambiguous trap. The vector layer must preserve that
	// uncertainty (UNEXPECTED_ERROR) instead of asserting a confident
	// "access control worked" (SECURE) that the execution evidence doesn't support.
	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(WasmVm, InvalidAction)',
		simulationFailed: true,
		diagnosticEvents: [
			fnCallEvent(CONTRACT_UNDER_TEST, 'set_admin'),
			errorEvent(
				CONTRACT_UNDER_TEST,
				xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
			),
		],
	};

	const parsed = parseInvokeResult(
		result,
		true,
		'set_admin',
		'UNAUTHORIZED_CALL',
		true,
		true,
	);
	t.is(parsed.signal, 'UNEXPECTED_ERROR');
	t.not(parsed.signal, 'SECURE');
});

test('UNAUTHORIZED_CALL rejected via a genuine structural auth error → vector layer DOES declare SECURE (confident execution evidence)', t => {
	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(Auth, InvalidAction)',
		simulationFailed: true,
		diagnosticEvents: [
			fnCallEvent(CONTRACT_UNDER_TEST, 'set_admin'),
			errorEvent(
				CONTRACT_UNDER_TEST,
				xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction()),
			),
		],
	};

	const parsed = parseInvokeResult(
		result,
		true,
		'set_admin',
		'UNAUTHORIZED_CALL',
		true,
		true,
	);
	t.is(parsed.signal, 'SECURE');
});

// --- 6. malformed/unexpected trace → no crash, conservative classification --

test('error topic without a decodable ScError payload → marked malformed, UNEXPECTED_ERROR, no crash', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'initialize'),
		buildEvent({
			contractId: CONTRACT_UNDER_TEST,
			topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvU32(5)], // no scvError topic present
		}),
	];

	t.notThrows(() => analyzeDiagnosticTrace(events));
	const analysis = analyzeDiagnosticTrace(events);
	t.true(analysis.malformed);
	t.is(analysis.errors.length, 0);

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('completely invalid event object → does not throw, returns an empty-but-usable analysis', t => {
	const garbage = {} as unknown as xdr.DiagnosticEvent;

	t.notThrows(() => analyzeDiagnosticTrace([garbage]));
	const analysis = analyzeDiagnosticTrace([garbage]);
	t.true(analysis.malformed);
	t.deepEqual(analysis.callFrames, []);
	t.deepEqual(analysis.errors, []);
	t.is(analysis.rootCall, null);

	const {signal} = classifyErrorFromTrace(analysis, false);
	t.is(signal, 'UNEXPECTED_ERROR');
});

test('empty diagnosticEvents array → empty analysis, no crash', t => {
	const analysis = analyzeDiagnosticTrace([]);
	t.deepEqual(analysis, {
		callFrames: [],
		rootCall: null,
		nestedCallCount: 0,
		involvedContractIds: [],
		errors: [],
		hasAuthError: false,
		failureLocation: 'UNKNOWN',
		malformed: false,
	});
});
