import test from 'ava';
import {selectCliMode, runHeadlessAudit, describeAuditError} from './cli_runtime.js';
import {ScanError} from './scanner.js';
import type {ScanResult} from './scanner.js';
import type {ChaosReport} from './chaos_monkey/index.js';

/**
 * D2.2 — CASE D/E/F: pure mode selection, no Ink/meow/process involved.
 */

test('CASE D — no positional args selects the TUI path', t => {
	t.deepEqual(selectCliMode([]), {kind: 'tui'});
});

test('CASE E — a valid Contract ID selects the headless path', t => {
	const contractId = `C${'A'.repeat(55)}`;
	t.deepEqual(selectCliMode([contractId]), {kind: 'headless', contractId});
});

test('CASE F — an invalid Contract ID is rejected (not silently sent to TUI or headless)', t => {
	t.deepEqual(selectCliMode(['NOTVALID']), {kind: 'invalid', contractId: 'NOTVALID'});
});

// --- CASE G/H: runHeadlessAudit exit-code behavior, via the scan/chaos injection seam ---

function fakeScanResult(contractId: string): ScanResult {
	return {contractId, bytecodeSize: 10, functions: [], udtRegistry: new Map()};
}

function fakeChaosReport(contractId: string, overrides: Partial<ChaosReport['summary']> = {}): ChaosReport {
	return {
		contractId,
		scannedAt: new Date().toISOString(),
		network: 'testnet',
		totalFunctions: 0,
		totalVectorsRun: 1,
		findings: [],
		summary: {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			preconditionFail: 0,
			broadcastTransactions: 0,
			transactionsWithHash: 0,
			...overrides,
		},
	};
}

test('CASE G — a run that completes with an UNEXPECTED_ERROR/CRITICAL finding still exits 0 (a security finding is not a tool failure)', async t => {
	const contractId = `C${'B'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId, {critical: 1}),
	});

	t.is(result.exitCode, 0);
	t.is(result.errorOutput, null);
	t.truthy(result.output);
	t.true(result.output!.includes('KUYFI AUDIT COMPLETE'));
});

test('CASE H — a scanner ScanError propagates as a tool failure: exitCode 1, clear message, no report', async t => {
	const contractId = `C${'C'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => {
			throw new ScanError('CONTRACT_NOT_FOUND', 'CONTRACT_NOT_FOUND');
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.output, null);
	t.truthy(result.errorOutput);
	t.true(result.errorOutput!.toLowerCase().includes('not found'));
});

test('CASE H (continued) — a Chaos Monkey internal failure also propagates as exitCode 1', async t => {
	const contractId = `C${'D'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => {
			throw new Error('Ephemeral keypair funding failed after 3 retries');
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.output, null);
	t.regex(result.errorOutput!, /funding failed/);
});

test('describeAuditError maps every ScanError code to a distinct, clear message', t => {
	t.true(describeAuditError(new ScanError('CONTRACT_NOT_FOUND', 'x')).toLowerCase().includes('not found'));
	t.true(describeAuditError(new ScanError('XDR_ALIGN_FAILURE', 'x')).toLowerCase().includes('parse'));
	t.true(describeAuditError(new ScanError('RPC_UNAVAILABLE', 'x')).toLowerCase().includes('unreachable'));
	t.true(describeAuditError(new ScanError('UNKNOWN', 'boom')).includes('boom'));
	t.true(describeAuditError(new Error('generic failure')).includes('generic failure'));
});
