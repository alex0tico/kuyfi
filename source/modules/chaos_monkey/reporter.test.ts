import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {parseInvokeResult} from './result_parser.js';
import {buildReport, formatReportForTerminal} from './reporter.js';
import type {InvokeResult} from './router.js';
import type {FuzzResult, FuzzTarget} from './fuzzer_math.js';

const CONTRACT_UNDER_TEST = Buffer.alloc(32, 0xaa);

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
	return buildEvent({
		contractId: null,
		topics: [
			xdr.ScVal.scvSymbol('fn_call'),
			xdr.ScVal.scvBytes(contractId),
			xdr.ScVal.scvSymbol(functionName),
		],
	});
}

function errorEvent(
	contractId: Buffer,
	scError: xdr.ScError,
): xdr.DiagnosticEvent {
	return buildEvent({
		contractId,
		topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(scError)],
	});
}

/**
 * D2.1 — proves evidence survives the LAST hop: FuzzResult → Finding, via
 * the real buildReport() aggregator (not a reimplementation of it).
 */

function buildTarget(overrides: Partial<FuzzTarget> = {}): FuzzTarget {
	return {
		contractId: 'CCSJ3REOFONMUJUINMZWBL45UXJYFXVFSXAWINLTDKFNEYBCRR4VF2Q2',
		functionName: 'swap_exact_in',
		params: [],
		isAdminFunction: false,
		...overrides,
	};
}

test('Finding carries the same ExecutionEvidence produced by parseInvokeResult — no re-derivation, no raw XDR', t => {
	// Broadcast + on-chain FAILED, WITH a structured trace present — the
	// trace-primary classifier takes over from the TX_FAILED string fallback
	// and this ambiguous root-level trap classifies as UNEXPECTED_ERROR,
	// which (unlike PRECONDITION_FAIL) DOES produce a Finding.
	const events = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'swap_exact_in'),
		errorEvent(
			CONTRACT_UNDER_TEST,
			xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction()),
		),
	];

	const invokeResult: InvokeResult = {
		success: false,
		broadcasted: true,
		transactionHash: 'd'.repeat(64),
		ledger: 999111,
		resultValue: null,
		errorCode: 'TX_FAILED',
		errorMessage: 'Transaction failed during on-chain execution',
		simulationFailed: false,
		diagnosticEvents: events,
	};

	const parsed = parseInvokeResult(
		invokeResult,
		false,
		'swap_exact_in',
		'amount_in::MAX',
		false,
		false,
	);
	t.is(parsed.signal, 'UNEXPECTED_ERROR');

	const target = buildTarget();
	const fuzzResults: FuzzResult[] = [
		{target, vectorName: 'amount_in::MAX', result: parsed},
	];

	const report = buildReport(target.contractId, fuzzResults);

	t.is(report.findings.length, 1);
	const [finding] = report.findings;
	t.truthy(finding);
	t.deepEqual(finding!.evidence, parsed.evidence);
	t.true(finding!.evidence.broadcasted);
	t.is(finding!.evidence.transactionHash, 'd'.repeat(64));
	t.is(finding!.evidence.ledger, 999111);

	// No raw SDK/XDR object leaked onto the public Finding shape.
	t.notThrows(() => JSON.stringify(finding));
	for (const value of Object.values(
		finding as unknown as Record<string, unknown>,
	)) {
		t.false(value instanceof xdr.ScVal);
	}
});

test('SECURE/PRECONDITION_FAIL results are excluded from findings[] but their evidence is not required to survive (existing filter, unchanged by D2.1)', t => {
	const invokeResult: InvokeResult = {
		success: true,
		broadcasted: true,
		transactionHash: 'e'.repeat(64),
		ledger: 42,
		resultValue: xdr.ScVal.scvVoid(),
		errorCode: null,
		errorMessage: null,
		simulationFailed: false,
		diagnosticEvents: [],
	};

	const parsed = parseInvokeResult(
		invokeResult,
		false,
		'get_balance',
		'user::ZERO',
		false,
		false,
	);
	t.is(parsed.signal, 'SECURE');

	const target = buildTarget({functionName: 'get_balance'});
	const report = buildReport(target.contractId, [
		{target, vectorName: 'user::ZERO', result: parsed},
	]);

	t.is(report.findings.length, 0);
	t.is(report.summary.info, 1);
});

test('formatReportForTerminal: zero findings does not claim the contract is robust or secure', t => {
	const output = formatReportForTerminal(buildReport('C'.repeat(56), []));

	t.true(output.includes('0 findings in this run.'));
	t.true(
		output.includes('This does not prove the absence of vulnerabilities.'),
	);
	t.notRegex(output, /robust|secure/i);
});
