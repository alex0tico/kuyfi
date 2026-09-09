import test, {type ExecutionContext} from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {analyzeDiagnosticTrace} from './trace_analyzer.js';
import {parseInvokeResult, stellarExpertTestnetUrl} from './result_parser.js';
import type {InvokeResult} from './router.js';

/**
 * D2.1 — evidence plumbing tests.
 *
 * These tests deliberately do NOT re-check the D1 classification decision
 * table (that's trace_analyzer.test.ts's job, and it is untouched by D2.1).
 * Every case here asserts the SAME signal/severity D1 already produced,
 * PLUS that ExecutionEvidence (broadcasted/transactionHash/ledger/trace)
 * survives from InvokeResult all the way out of parseInvokeResult().
 *
 * No network calls — InvokeResult is always a hand-built fixture, matching
 * the exact shapes documented in router.ts (verified against the installed
 * @stellar/stellar-sdk 14.6.1 rpc.Api types).
 */

const CONTRACT_UNDER_TEST = Buffer.alloc(32, 0xaa);
const NESTED_CONTRACT = Buffer.alloc(32, 0xbb);

function buildEvent(opts: {contractId: Buffer | null; topics: xdr.ScVal[]; data?: xdr.ScVal}): xdr.DiagnosticEvent {
	const body = new xdr.ContractEventBody(
		0,
		new xdr.ContractEventV0({
			topics: opts.topics,
			data: opts.data ?? xdr.ScVal.scvVoid(),
		}),
	);
	const event = new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: opts.contractId as unknown as xdr.Hash | null,
		type: xdr.ContractEventType.diagnostic(),
		body,
	});
	return new xdr.DiagnosticEvent({
		inSuccessfulContractCall: false,
		event,
	});
}

function fnCallEvent(contractId: Buffer, functionName: string): xdr.DiagnosticEvent {
	return buildEvent({
		contractId: null,
		topics: [xdr.ScVal.scvSymbol('fn_call'), xdr.ScVal.scvBytes(contractId), xdr.ScVal.scvSymbol(functionName)],
	});
}

function errorEvent(contractId: Buffer, scError: xdr.ScError): xdr.DiagnosticEvent {
	return buildEvent({
		contractId,
		topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(scError)],
	});
}

/** Round-trips a value through JSON to prove it carries no raw SDK/XDR object. */
function assertJsonSafe(t: ExecutionContext, value: unknown): void {
	t.notThrows(() => JSON.stringify(value));
	t.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

// --- CASE A: simulation failure — never broadcast ---------------------------

test('CASE A — simulation failure: broadcasted=false, txHash=null, trace + classification preserved', t => {
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

	const parsed = parseInvokeResult(result, false, 'initialize', 'amount::ZERO', true, false);

	// D1 classification unchanged: diagnosticEvents.length === 0 → string
	// fallback → Error(Contract,...) → SECURE.
	t.is(parsed.signal, 'SECURE');

	// D2.1 evidence:
	t.false(parsed.evidence.broadcasted);
	t.is(parsed.evidence.transactionHash, null);
	t.is(parsed.evidence.ledger, null);
	t.true(parsed.evidence.simulationFailed);
	t.deepEqual(parsed.evidence.trace, analyzeDiagnosticTrace([]));
	assertJsonSafe(t, parsed.evidence);
});

// --- CASE B: broadcast + SUCCESS --------------------------------------------

test('CASE B — broadcast + SUCCESS: broadcasted=true, txHash + ledger preserved, trace preserved', t => {
	const result: InvokeResult = {
		success: true,
		broadcasted: true,
		transactionHash: 'a'.repeat(64),
		ledger: 123456,
		resultValue: xdr.ScVal.scvVoid(),
		errorCode: null,
		errorMessage: null,
		simulationFailed: false,
		diagnosticEvents: [],
	};

	const parsed = parseInvokeResult(result, false, 'deposit', 'amount::ZERO', false, false);

	// D1 classification unchanged: success + expectedToFail=false → SECURE.
	t.is(parsed.signal, 'SECURE');
	t.is(parsed.severity, 'INFO');

	t.true(parsed.evidence.broadcasted);
	t.is(parsed.evidence.transactionHash, 'a'.repeat(64));
	t.is(parsed.evidence.ledger, 123456);
	t.false(parsed.evidence.simulationFailed);
	t.deepEqual(parsed.evidence.trace, analyzeDiagnosticTrace([]));
	assertJsonSafe(t, parsed.evidence);
});

// --- CASE C: broadcast + FAILED (on-chain execution failure) ---------------

test('CASE C — broadcast + FAILED: broadcasted=true, txHash + ledger + error preserved, trace preserved', t => {
	const result: InvokeResult = {
		success: false,
		broadcasted: true,
		transactionHash: 'b'.repeat(64),
		ledger: 654321,
		resultValue: null,
		errorCode: 'TX_FAILED',
		errorMessage: 'Transaction failed during on-chain execution',
		simulationFailed: false,
		diagnosticEvents: [],
	};

	const parsed = parseInvokeResult(result, false, 'withdraw', 'amount::MAX', false, false);

	// D1 classification unchanged: TX_FAILED, no trace → string fallback → PRECONDITION_FAIL.
	t.is(parsed.signal, 'PRECONDITION_FAIL');
	t.is(parsed.severity, 'LOW');
	t.is(parsed.rawErrorCode, 'TX_FAILED');

	t.true(parsed.evidence.broadcasted);
	t.is(parsed.evidence.transactionHash, 'b'.repeat(64));
	t.is(parsed.evidence.ledger, 654321);
	assertJsonSafe(t, parsed.evidence);
});

// --- CASE D: ambiguous WasmVm/InvalidAction — evidence must not upgrade it --

test('CASE D — ambiguous InvalidAction: D1 signal stays UNEXPECTED_ERROR, evidence does not change classification', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
	];

	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(WasmVm, InvalidAction)',
		simulationFailed: true,
		diagnosticEvents: events,
	};

	const parsed = parseInvokeResult(result, false, 'swap_exact_in', 'amount_in::ZERO', false, false);

	t.is(parsed.signal, 'UNEXPECTED_ERROR');

	const expectedTrace = analyzeDiagnosticTrace(events);
	t.deepEqual(parsed.evidence.trace, expectedTrace);
	t.is(parsed.evidence.trace.nestedCallCount, 0);
	t.is(parsed.evidence.trace.failureLocation, 'ROOT');
	assertJsonSafe(t, parsed.evidence);
});

// --- CASE E: auth/precondition — approved D1 classification stays intact ---

test('CASE E — structural auth error: D1 classification (PRECONDITION_FAIL) stays intact, evidence preserved', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'set_admin'),
		errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction())),
	];

	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: Error(Auth, InvalidAction)',
		simulationFailed: true,
		diagnosticEvents: events,
	};

	// expectedToFail=true (access-control vector) — PRECONDITION_FAIL wraps to
	// vector-level SECURE, exactly as approved in D1.
	const parsed = parseInvokeResult(result, true, 'set_admin', 'UNAUTHORIZED_CALL', true, false);
	t.is(parsed.signal, 'SECURE');

	t.true(parsed.evidence.trace.hasAuthError);
	t.deepEqual(parsed.evidence.trace, analyzeDiagnosticTrace(events));
	assertJsonSafe(t, parsed.evidence);
});

// --- CASE F: nested trace — nestedCallCount/failureLocation survive --------

test('CASE F — nested trace: nestedCallCount + failureLocation survive into evidence unchanged from D1 analysis', t => {
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'claim'),
		fnCallEvent(NESTED_CONTRACT, 'transfer'),
		errorEvent(NESTED_CONTRACT, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
	];

	const result: InvokeResult = {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: 'HostError: nested trap',
		simulationFailed: true,
		diagnosticEvents: events,
	};

	const parsed = parseInvokeResult(result, false, 'claim', 'amount::ZERO', false, true);

	const expectedTrace = analyzeDiagnosticTrace(events);
	t.is(expectedTrace.nestedCallCount, 1);
	t.is(expectedTrace.failureLocation, 'NESTED');

	// D1 rule: failure attributed to a NESTED contract → UNEXPECTED_ERROR,
	// regardless of code — must stay exactly that.
	t.is(parsed.signal, 'UNEXPECTED_ERROR');

	t.deepEqual(parsed.evidence.trace, expectedTrace);
	t.is(parsed.evidence.trace.nestedCallCount, 1);
	t.is(parsed.evidence.trace.failureLocation, 'NESTED');
	t.deepEqual(parsed.evidence.trace.involvedContractIds.sort(), [
		CONTRACT_UNDER_TEST.toString('hex'),
		NESTED_CONTRACT.toString('hex'),
	].sort());
	assertJsonSafe(t, parsed.evidence);
});

// --- stellarExpertTestnetUrl -------------------------------------------------

test('stellarExpertTestnetUrl — builds the expected Testnet explorer URL', t => {
	const hash = 'c'.repeat(64);
	t.is(stellarExpertTestnetUrl(hash), `https://stellar.expert/explorer/testnet/tx/${hash}`);
});

test('stellarExpertTestnetUrl — returns null when there is no hash (never a broadcast)', t => {
	t.is(stellarExpertTestnetUrl(null), null);
});
