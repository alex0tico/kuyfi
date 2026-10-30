import test from 'ava';
import {
	findingStatus,
	parseInvokeResult,
	signalToSeverity,
} from './result_parser.js';
import {
	buildReport,
	formatReportForTerminal,
	vectorOutcome,
} from './reporter.js';
import type {ExecutionEvidence, FindingStatus} from './result_parser.js';
import type {TraceErrorObservation} from './trace_analyzer.js';
import type {InvokeResult} from './router.js';

const base: InvokeResult = {
	success: false,
	broadcasted: false,
	transactionHash: null,
	ledger: null,
	resultValue: null,
	errorCode: 'SIMULATION_ERROR',
	errorMessage: 'HostError: something the classifier cannot explain',
	simulationFailed: true,
	diagnosticEvents: [],
};

const target = {
	contractId: 'C',
	functionName: 'transfer',
	params: [],
	isAdminFunction: false,
};

test('status separates what a signal establishes from its severity', t => {
	// Written by hand, not derived from the implementation.
	const expected: Array<[Parameters<typeof findingStatus>[0], FindingStatus]> =
		[
			['UNCONTROLLED_PANIC', 'supported'],
			['POTENTIAL_VULN', 'hypothesis'],
			['UNEXPECTED_ERROR', 'inconclusive'],
			['TIMEOUT', 'inconclusive'],
			['SIMULATION_FAIL', 'inconclusive'],
		];
	for (const [signal, status] of expected)
		t.is(findingStatus(signal), status, `${signal}`);
});

test('severities are unchanged by the status model', t => {
	t.is(signalToSeverity('POTENTIAL_VULN', false), 'HIGH');
	t.is(signalToSeverity('POTENTIAL_VULN', true), 'CRITICAL');
	t.is(signalToSeverity('UNEXPECTED_ERROR', false), 'MEDIUM');
	t.is(signalToSeverity('UNCONTROLLED_PANIC', false), 'MEDIUM');
});

test('a permitted call on an access vector is a hypothesis, never worded as a confirmed vulnerability', t => {
	const ok: InvokeResult = {
		...base,
		success: true,
		broadcasted: true,
		transactionHash: 'h',
		errorCode: null,
		errorMessage: null,
		simulationFailed: false,
	};
	const parsed = parseInvokeResult(
		ok,
		true,
		'transfer',
		'UNAUTHORIZED_ADDR_CALL',
		false,
		true,
	);
	t.is(parsed.signal, 'POTENTIAL_VULN');
	t.regex(parsed.details, /HYPOTHESIS, not a confirmed vulnerability/);

	const report = buildReport('C', [
		{target, vectorName: 'UNAUTHORIZED_ADDR_CALL', result: parsed},
	]);
	t.is(report.findings[0]!.status, 'hypothesis');
	t.deepEqual(report.summary.byStatus, {
		supported: 0,
		hypothesis: 1,
		inconclusive: 0,
	});
	const text = formatReportForTerminal(report);
	t.regex(text, /HIGH — POTENTIAL_VULN \(hypothesis\)/);
	t.regex(text, /1 hypotheses \(need confirmation\)/);
});

test('an unexplained failure is inconclusive and the summary says so', t => {
	const parsed = parseInvokeResult(
		base,
		false,
		'transfer',
		'amount::ZERO',
		false,
		false,
	);
	t.is(parsed.signal, 'UNEXPECTED_ERROR');
	const report = buildReport('C', [
		{target, vectorName: 'amount::ZERO', result: parsed},
	]);
	t.is(report.findings[0]!.status, 'inconclusive');
	t.is(report.summary.byStatus!.inconclusive, 1);
	t.is(
		Object.values(report.summary.byStatus!).reduce((a, b) => a + b, 0),
		report.findings.length,
	);
});

test('vectorOutcome states whether a vector was accepted, blocked (and by what) or not run', t => {
	const ev = (
		success: boolean,
		errors: TraceErrorObservation[],
	): ExecutionEvidence => ({
		broadcasted: false,
		success,
		transactionHash: null,
		ledger: null,
		simulationFailed: !success,
		trace: {
			callFrames: [],
			rootCall: null,
			nestedCallCount: 0,
			involvedContractIds: [],
			errors,
			hasAuthError: false,
			failureLocation: 'UNKNOWN',
			malformed: false,
		},
	});
	t.deepEqual(vectorOutcome('SECURE', ev(true, [])), {result: 'accepted'});
	t.deepEqual(
		vectorOutcome(
			'SECURE',
			ev(false, [{category: 'CONTRACT', code: 'Contract#4', contractId: null}]),
		),
		{result: 'rejected', blockedBy: 'CONTRACT', code: 'Contract#4'},
	);
	t.deepEqual(vectorOutcome('UNEXPECTED_ERROR', ev(false, [])), {
		result: 'rejected',
		blockedBy: 'none',
		code: null,
	});
	t.deepEqual(vectorOutcome('OPERATIONAL_ERROR', ev(false, [])), {
		result: 'not_run',
	});
});
