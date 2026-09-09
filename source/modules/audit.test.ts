import test from 'ava';
import {runAudit} from './audit.js';
import type {ScanResult} from './scanner.js';
import type {ChaosMonkeyOptions} from './chaos_monkey/index.js';
import type {ChaosReport} from './chaos_monkey/index.js';

/**
 * D2.2 — CASE C: the orchestrator passes scan.functions and scan.udtRegistry
 * straight through to Chaos Monkey, with no network calls. Both scanContract
 * and runChaosMonkey are stubbed via runAudit's injection seam.
 */

function fakeChaosReport(contractId: string): ChaosReport {
	return {
		contractId,
		scannedAt: new Date().toISOString(),
		network: 'testnet',
		totalFunctions: 0,
		totalVectorsRun: 0,
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
		},
	};
}

test('CASE C — runAudit passes scan.functions and scan.udtRegistry unchanged into Chaos Monkey', async t => {
	const contractId = 'CSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUB1';
	const fakeScanResult: ScanResult = {
		contractId,
		bytecodeSize: 1234,
		functions: [{name: 'deposit', params: [{name: 'amount', type: {}}], hasReturn: false}],
		udtRegistry: new Map([['Pair', {kind: 'struct', name: 'Pair', fields: []}]]),
	};

	let capturedOptions: ChaosMonkeyOptions | undefined;

	const result = await runAudit(contractId, {
		scan: async () => fakeScanResult,
		chaos: async options => {
			capturedOptions = options;
			return fakeChaosReport(contractId);
		},
	});

	t.truthy(capturedOptions);
	t.is(capturedOptions!.contractId, contractId);
	t.is(capturedOptions!.functions, fakeScanResult.functions);
	t.is(capturedOptions!.udtRegistry, fakeScanResult.udtRegistry);
	t.is(result.scan, fakeScanResult);
	t.is(result.chaos.contractId, contractId);
});

test('runAudit forwards onProgress to both scan and chaos phases', async t => {
	const messages: string[] = [];
	const contractId = 'CSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTUB2';
	const fakeScanResult: ScanResult = {
		contractId,
		bytecodeSize: 0,
		functions: [],
		udtRegistry: new Map(),
	};

	await runAudit(contractId, {
		onProgress: msg => messages.push(msg),
		scan: async () => fakeScanResult,
		chaos: async options => {
			options.onProgress('chaos-phase-message');
			return fakeChaosReport(contractId);
		},
	});

	t.true(messages.some(m => m.includes('Scanning')));
	t.true(messages.includes('chaos-phase-message'));
});
