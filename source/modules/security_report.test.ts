import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {buildReport} from './chaos_monkey/reporter.js';
import {parseInvokeResult} from './chaos_monkey/result_parser.js';
import {buildSecurityReport, serializeSecurityReport, generateReportId, SCHEMA_VERSION} from './security_report.js';
import type {ScanResult} from './scanner.js';
import type {UdtRegistry} from './chaos_monkey/udt_registry.js';
import type {InvokeResult} from './chaos_monkey/router.js';
import type {FuzzResult, FuzzTarget} from './chaos_monkey/fuzzer_math.js';
import type {AuditRun} from './audit.js';

/**
 * D2.3 — SecurityReport. All fixtures use REAL xdr.ScSpecTypeDef values and
 * go through the REAL parseInvokeResult()/buildReport() pipeline (not hand-
 * typed fakes of their output), so these tests exercise the actual D1/D2.1
 * classification + D2.2 evidence-tally code paths, not a reimplementation
 * of them. No network calls.
 */

const CONTRACT_UNDER_TEST = Buffer.alloc(32, 0xaa);
const NESTED_CONTRACT = Buffer.alloc(32, 0xbb);

function buildEvent(opts: {contractId: Buffer | null; topics: xdr.ScVal[]}): xdr.DiagnosticEvent {
	const body = new xdr.ContractEventBody(
		0,
		new xdr.ContractEventV0({topics: opts.topics, data: xdr.ScVal.scvVoid()}),
	);
	const event = new xdr.ContractEvent({
		ext: new xdr.ExtensionPoint(0),
		contractId: opts.contractId as unknown as xdr.Hash | null,
		type: xdr.ContractEventType.diagnostic(),
		body,
	});
	return new xdr.DiagnosticEvent({inSuccessfulContractCall: false, event});
}

function fnCallEvent(contractId: Buffer, functionName: string): xdr.DiagnosticEvent {
	return buildEvent({
		contractId: null,
		topics: [xdr.ScVal.scvSymbol('fn_call'), xdr.ScVal.scvBytes(contractId), xdr.ScVal.scvSymbol(functionName)],
	});
}

function errorEvent(contractId: Buffer, scError: xdr.ScError): xdr.DiagnosticEvent {
	return buildEvent({contractId, topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(scError)]});
}

function fakeInvokeResult(overrides: Partial<InvokeResult>): InvokeResult {
	return {
		success: false,
		broadcasted: false,
		transactionHash: null,
		ledger: null,
		resultValue: null,
		errorCode: 'SIMULATION_ERROR',
		errorMessage: null,
		simulationFailed: true,
		diagnosticEvents: [],
		...overrides,
	};
}

function target(functionName: string): FuzzTarget {
	return {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		functionName,
		params: [],
		isAdminFunction: false,
	};
}

function buildFixtureAuditRun(): AuditRun {
	const udtRegistry: UdtRegistry = new Map([
		[
			'Point',
			{
				kind: 'struct',
				name: 'Point',
				fields: [
					{name: 'x', type: xdr.ScSpecTypeDef.scSpecTypeI128()},
					{name: 'y', type: xdr.ScSpecTypeDef.scSpecTypeI128()},
				],
			},
		],
		[
			'Status',
			{
				kind: 'enum',
				name: 'Status',
				cases: [
					{name: 'Active', value: 1},
					{name: 'Inactive', value: 2},
				],
			},
		],
		[
			'Action',
			{
				kind: 'union',
				name: 'Action',
				cases: [
					{name: 'Noop', valueTypes: []},
					{
						name: 'Move',
						valueTypes: [xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({name: 'Point'}))],
					},
				],
			},
		],
	]);

	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 4242,
		functions: [
			{name: 'deposit', params: [{name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeI128()}], hasReturn: false},
			{name: 'get_balance', params: [], hasReturn: true},
		],
		udtRegistry,
	};

	// rA: root-level generic trap, no broadcast (simulation failure) — CASE H.
	const rA: FuzzResult = {
		target: target('initialize'),
		vectorName: 'amount::ZERO',
		result: parseInvokeResult(
			fakeInvokeResult({
				diagnosticEvents: [
					fnCallEvent(CONTRACT_UNDER_TEST, 'initialize'),
					errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
				],
			}),
			false,
			'initialize',
			'amount::ZERO',
			false,
			false,
		),
	};

	// rB: broadcast + on-chain failure, nested trace — CASE I/J.
	const rB: FuzzResult = {
		target: target('claim'),
		vectorName: 'amount::MAX',
		result: parseInvokeResult(
			fakeInvokeResult({
				broadcasted: true,
				success: false,
				transactionHash: 'b'.repeat(64),
				ledger: 2222,
				errorCode: 'TX_FAILED',
				simulationFailed: false,
				diagnosticEvents: [
					fnCallEvent(CONTRACT_UNDER_TEST, 'claim'),
					fnCallEvent(NESTED_CONTRACT, 'transfer'),
					errorEvent(NESTED_CONTRACT, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
				],
			}),
			false,
			'claim',
			'amount::MAX',
			false,
			true,
		),
	};

	// rC: broadcast + genuine on-chain SUCCESS (no error event at all) → SECURE
	// ("accepted gracefully"), filtered from findings[]. This is the fixture's
	// only real successful-broadcast candidate for the verification-transaction
	// selection in reporter.ts (a contract-level rejection, like rB's nested
	// trap, always carries success:false in this system — see rA/rB above and
	// the D1 comments in result_parser.ts).
	const rC: FuzzResult = {
		target: target('get_balance'),
		vectorName: 'baseline::NO_ARGS',
		result: parseInvokeResult(
			fakeInvokeResult({
				broadcasted: true,
				success: true,
				transactionHash: 'c'.repeat(64),
				ledger: 3333,
				simulationFailed: false,
				diagnosticEvents: [],
			}),
			false,
			'get_balance',
			'baseline::NO_ARGS',
			false,
			false,
		),
	};

	const chaos = buildReport(scan.contractId, [rA, rB, rC]);
	return {scan, chaos};
}

// --- CASE A/B/C ---------------------------------------------------------

test('CASE A — buildSecurityReport produces a JSON-safe object', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	t.notThrows(() => JSON.stringify(report));
});

test('CASE B — schemaVersion is exact', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	t.is(report.schemaVersion, SCHEMA_VERSION);
	t.is(report.schemaVersion, '1.0.0');
});

test('CASE C — reportId is unique per run (two builds of the same AuditRun differ)', t => {
	const auditRun = buildFixtureAuditRun();
	const r1 = buildSecurityReport(auditRun);
	const r2 = buildSecurityReport(auditRun);
	t.not(r1.reportId, r2.reportId);
	t.not(generateReportId(), generateReportId());
});

// --- CASE D: functions -----------------------------------------------------

test('CASE D — functions transform correctly (name, parameters with typeName()-rendered types, hasReturn)', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	t.is(report.scan.totalFunctions, 2);
	t.deepEqual(report.scan.functions, [
		{name: 'deposit', parameters: [{name: 'amount', type: 'I128'}], hasReturn: false},
		{name: 'get_balance', parameters: [], hasReturn: true},
	]);
});

// --- CASE E/F/G: UDT kinds --------------------------------------------------

test('CASE E — struct UDT transforms correctly', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const point = report.scan.udts.find(u => u.name === 'Point');
	t.deepEqual(point, {
		kind: 'struct',
		name: 'Point',
		fields: [
			{name: 'x', type: 'I128'},
			{name: 'y', type: 'I128'},
		],
	});
});

test('CASE F — enum UDT transforms correctly', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const status = report.scan.udts.find(u => u.name === 'Status');
	t.deepEqual(status, {
		kind: 'enum',
		name: 'Status',
		cases: [
			{name: 'Active', value: 1},
			{name: 'Inactive', value: 2},
		],
	});
});

test('CASE G — union UDT transforms correctly, including a nested-UDT payload type name', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const action = report.scan.udts.find(u => u.name === 'Action');
	t.deepEqual(action, {
		kind: 'union',
		name: 'Action',
		cases: [
			{name: 'Noop', valueTypes: []},
			{name: 'Move', valueTypes: ['Point']},
		],
	});
});

// --- CASE H/I: transaction evidence -----------------------------------------

test('CASE H — broadcast=false: hash=null, ledger=null, explorerUrl=null', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const finding = report.findings.find(f => f.functionName === 'initialize');
	t.truthy(finding);
	t.deepEqual(finding!.evidence.transaction, {
		broadcasted: false,
		hash: null,
		ledger: null,
		explorerUrl: null,
	});
});

test('CASE I — broadcast=true: hash preserved, ledger preserved, correct Stellar Expert URL', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const finding = report.findings.find(f => f.functionName === 'claim');
	t.truthy(finding);
	t.deepEqual(finding!.evidence.transaction, {
		broadcasted: true,
		hash: 'b'.repeat(64),
		ledger: 2222,
		explorerUrl: `https://stellar.expert/explorer/testnet/tx/${'b'.repeat(64)}`,
	});
});

// --- CASE J: nested trace summary --------------------------------------------

test('CASE J — nested trace summary survives intact into the public finding', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const finding = report.findings.find(f => f.functionName === 'claim');
	t.truthy(finding);
	t.is(finding!.evidence.trace.nestedCallCount, 1);
	t.is(finding!.evidence.trace.failureLocation, 'NESTED');
	t.deepEqual(
		[...finding!.evidence.trace.involvedContractIds].sort(),
		[CONTRACT_UNDER_TEST.toString('hex'), NESTED_CONTRACT.toString('hex')].sort(),
	);
});

// --- CASE K/L: taxonomy is reflected, never reinterpreted -------------------

test('CASE K — UNEXPECTED_ERROR findings stay UNEXPECTED_ERROR in the public report', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const signals = report.findings.map(f => f.signal);
	t.true(signals.includes('UNEXPECTED_ERROR'));
	t.deepEqual(report.summary.findingsBySignal, {UNEXPECTED_ERROR: 2});
});

test('CASE L — SECURE is never a finding and never appears in findingsBySignal', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	t.false(report.findings.some(f => (f.signal as string) === 'SECURE'));
	t.is(report.summary.findingsBySignal.SECURE, undefined);
});

// --- CASE M/N: serialization safety ------------------------------------------

test('CASE M — JSON.stringify/parse round trip is lossless', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const roundTripped = JSON.parse(serializeSecurityReport(report)) as unknown;
	t.deepEqual(roundTripped, report);
});

function walkForRuntimeObjects(value: unknown, path: string, offenses: string[]): void {
	if (value === null || value === undefined) return;
	if (value instanceof Map) offenses.push(`Map at ${path}`);
	if (Buffer.isBuffer(value)) offenses.push(`Buffer at ${path}`);
	if (typeof value === 'bigint') offenses.push(`BigInt at ${path}`);
	if (Array.isArray(value)) {
		value.forEach((v, i) => {
			walkForRuntimeObjects(v, `${path}[${i}]`, offenses);
		});
		return;
	}

	if (typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			walkForRuntimeObjects(v, `${path}.${k}`, offenses);
		}
	}
}

test('CASE N — no Map/Buffer/BigInt (and, by the CASE M round-trip, no XDR/SDK object) anywhere in SecurityReport', t => {
	const report = buildSecurityReport(buildFixtureAuditRun());
	const offenses: string[] = [];
	walkForRuntimeObjects(report, 'report', offenses);
	t.deepEqual(offenses, []);
});

// --- Section 18: zero-findings still preserves a real verification tx ------

test('an audit with ZERO findings still preserves at least one real verification transaction', t => {
	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 100,
		functions: [],
		udtRegistry: new Map(),
	};

	// A genuinely successful, gracefully-accepted call (no error event at
	// all) — SECURE, filtered from findings[], but still a real broadcast
	// with a real tx hash.
	const onlySecureResult: FuzzResult = {
		target: target('get_tokens'),
		vectorName: 'baseline::NO_ARGS',
		result: parseInvokeResult(
			fakeInvokeResult({
				broadcasted: true,
				success: true,
				transactionHash: 'd'.repeat(64),
				ledger: 9999,
				simulationFailed: false,
				diagnosticEvents: [],
			}),
			false,
			'get_tokens',
			'baseline::NO_ARGS',
			false,
			false,
		),
	};

	const chaos = buildReport(scan.contractId, [onlySecureResult]);
	t.is(chaos.findings.length, 0);

	const report = buildSecurityReport({scan, chaos});
	t.is(report.summary.totalFindings, 0);
	t.deepEqual(report.findings, []);
	t.is(report.execution.verificationTransactions.length, 1);
	t.deepEqual(report.execution.verificationTransactions[0], {
		functionName: 'get_tokens',
		vectorName: 'baseline::NO_ARGS',
		broadcasted: true,
		hash: 'd'.repeat(64),
		ledger: 9999,
		explorerUrl: `https://stellar.expert/explorer/testnet/tx/${'d'.repeat(64)}`,
	});
});

// --- Post-review fix: summary.bySeverity/totalFindings must describe the ---
// --- exact same universe as findings[], never chaos.summary's all-results --
// --- counts. CASE S/T/U/V. ---------------------------------------------------

function sumBySeverity(bySeverity: Record<string, number>): number {
	return Object.values(bySeverity).reduce((a, b) => a + b, 0);
}

function secureResult(n: number): FuzzResult {
	return {
		target: target('get_tokens'),
		vectorName: `baseline::NO_ARGS_${n}`,
		result: parseInvokeResult(
			fakeInvokeResult({
				broadcasted: true,
				success: true,
				transactionHash: n.toString().padStart(64, '0'),
				ledger: 1000 + n,
				simulationFailed: false,
				diagnosticEvents: [],
			}),
			false,
			'get_tokens',
			`baseline::NO_ARGS_${n}`,
			false,
			false,
		),
	};
}

test('CASE S — zero findings: totalFindings=0 and sum(bySeverity)=0', t => {
	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 1,
		functions: [],
		udtRegistry: new Map(),
	};
	const chaos = buildReport(scan.contractId, [secureResult(1)]);
	t.is(chaos.findings.length, 0);

	const report = buildSecurityReport({scan, chaos});
	t.is(report.findings.length, 0);
	t.is(report.summary.totalFindings, 0);
	t.is(sumBySeverity(report.summary.bySeverity), 0);
});

test('CASE T — findings severity consistency: totalFindings === findings.length === sum(bySeverity), across distinct severities', t => {
	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 1,
		functions: [],
		udtRegistry: new Map(),
	};

	// LOW: TIMEOUT never reaches diagnostic-trace classification at all.
	const lowResult: FuzzResult = {
		target: target('fnLow'),
		vectorName: 'v::LOW',
		result: parseInvokeResult(
			fakeInvokeResult({errorCode: 'TIMEOUT', broadcasted: true, transactionHash: 'a'.repeat(64), ledger: 1}),
			false,
			'fnLow',
			'v::LOW',
			false,
			false,
		),
	};

	// MEDIUM: root-level generic trap, no nested activity → UNEXPECTED_ERROR.
	const mediumResult: FuzzResult = {
		target: target('fnMedium'),
		vectorName: 'v::MEDIUM',
		result: parseInvokeResult(
			fakeInvokeResult({
				diagnosticEvents: [
					fnCallEvent(CONTRACT_UNDER_TEST, 'fnMedium'),
					errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
				],
			}),
			false,
			'fnMedium',
			'v::MEDIUM',
			false,
			false,
		),
	};

	// Strong runtime fault (ArithDomain), root-attributed, nestedCallCount=1 → POTENTIAL_VULN.
	const strongFaultEvents = [
		fnCallEvent(CONTRACT_UNDER_TEST, 'fnCrit'),
		fnCallEvent(CONTRACT_UNDER_TEST, 'fnCrit'),
		errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain())),
	];

	// CRITICAL: POTENTIAL_VULN on an admin function.
	const criticalResult: FuzzResult = {
		target: {...target('fnCrit'), isAdminFunction: true},
		vectorName: 'v::CRITICAL',
		result: parseInvokeResult(
			fakeInvokeResult({diagnosticEvents: strongFaultEvents}),
			false,
			'fnCrit',
			'v::CRITICAL',
			true,
			false,
		),
	};

	// HIGH: the same POTENTIAL_VULN shape on a non-admin function.
	const highResult: FuzzResult = {
		target: target('fnHigh'),
		vectorName: 'v::HIGH',
		result: parseInvokeResult(
			fakeInvokeResult({
				diagnosticEvents: [
					fnCallEvent(CONTRACT_UNDER_TEST, 'fnHigh'),
					fnCallEvent(CONTRACT_UNDER_TEST, 'fnHigh'),
					errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain())),
				],
			}),
			false,
			'fnHigh',
			'v::HIGH',
			false,
			false,
		),
	};

	const chaos = buildReport(scan.contractId, [lowResult, mediumResult, criticalResult, highResult, secureResult(1)]);
	t.deepEqual(
		chaos.findings.map(f => f.severity).sort(),
		['CRITICAL', 'HIGH', 'LOW', 'MEDIUM'],
	);

	const report = buildSecurityReport({scan, chaos});
	t.is(report.summary.totalFindings, report.findings.length);
	t.is(report.summary.totalFindings, 4);
	t.is(sumBySeverity(report.summary.bySeverity), report.summary.totalFindings);
	t.deepEqual(report.summary.bySeverity, {
		critical: 1,
		high: 1,
		medium: 1,
		low: 1,
		info: 0,
		preconditionFail: 0,
	});
});

test('CASE U — 57 executed vectors, all SECURE, 0 findings: reproduces the exact real-run regression this fix protects against', t => {
	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 1,
		functions: [],
		udtRegistry: new Map(),
	};
	const results = Array.from({length: 57}, (_, i) => secureResult(i + 1));
	const chaos = buildReport(scan.contractId, results);

	t.is(chaos.totalVectorsRun, 57);
	t.is(chaos.findings.length, 0);
	t.is(chaos.summary.info, 57); // the all-results tally legitimately has 57 INFO results

	const report = buildSecurityReport({scan, chaos});
	t.is(report.execution.vectorsExecuted, 57);
	t.is(report.summary.totalFindings, 0);
	t.is(report.summary.bySeverity.info, 0); // but the FINDINGS-only tally must be 0, not 57
	t.is(sumBySeverity(report.summary.bySeverity), 0);
	t.deepEqual(report.findings, []);
});

test('CASE V — findingsBySignal is derived from findings[] only: a SECURE-heavy run contributes nothing to it', t => {
	const scan: ScanResult = {
		contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
		bytecodeSize: 1,
		functions: [],
		udtRegistry: new Map(),
	};

	const unexpectedError1: FuzzResult = {
		target: target('fnA'),
		vectorName: 'v::A',
		result: parseInvokeResult(
			fakeInvokeResult({
				diagnosticEvents: [
					fnCallEvent(CONTRACT_UNDER_TEST, 'fnA'),
					errorEvent(CONTRACT_UNDER_TEST, xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecInvalidAction())),
				],
			}),
			false,
			'fnA',
			'v::A',
			false,
			false,
		),
	};

	const results = [unexpectedError1, secureResult(1), secureResult(2), secureResult(3)];
	const chaos = buildReport(scan.contractId, results);
	t.is(chaos.findings.length, 1);

	const report = buildSecurityReport({scan, chaos});
	t.deepEqual(report.summary.findingsBySignal, {UNEXPECTED_ERROR: 1});
	t.is(report.summary.findingsBySignal.SECURE, undefined);
	t.is(
		Object.values(report.summary.findingsBySignal).reduce((a, b) => a + (b ?? 0), 0),
		report.findings.length,
	);
});
