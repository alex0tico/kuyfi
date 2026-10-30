import test from 'ava';
import {
	Account,
	Keypair,
	SorobanDataBuilder,
	StrKey,
	xdr,
} from '@stellar/stellar-sdk';
import {CampaignServer} from './campaign.js';
import {invokeContract} from './router.js';
import {parseInvokeResult} from './result_parser.js';
import {buildReport} from './reporter.js';
import type {InvokeResult} from './router.js';

function failed(errorCode: string, errorMessage: string): InvokeResult {
	return {
		success: false,
		broadcasted: false,
		transactionHash: 'abc',
		ledger: null,
		resultValue: null,
		errorCode,
		errorMessage,
		simulationFailed: false,
		diagnosticEvents: [],
	};
}

const target = {
	contractId: 'C',
	functionName: 'set_admin_value',
	params: [],
	isAdminFunction: true,
};

// Regression for v0.1.0: a SEND_ERROR (network rejected the envelope before it
// entered the network) was reported as a MEDIUM UNEXPECTED_ERROR finding.
test('SEND_ERROR is an operational error, never a security finding', t => {
	const parsed = parseInvokeResult(
		failed(
			'SEND_ERROR',
			'Network rejected transaction before broadcast (txBAD_SEQ)',
		),
		false,
		'set_admin_value',
		'admin::RANDOM_ADDR_B',
		true,
		true,
	);
	t.is(parsed.signal, 'OPERATIONAL_ERROR');
	t.is(parsed.severity, 'INFO');
	t.regex(parsed.details, /txBAD_SEQ/);
	t.is(parsed.evidence.transactionHash, 'abc'); // evidence preserved

	const report = buildReport('C', [
		{target, vectorName: parsed.vectorName, result: parsed},
	]);
	t.is(report.findings.length, 0);
	t.is(report.summary.medium, 0);
	t.is(report.summary.operationalErrors, 1);
	t.is(report.totalVectorsRun, 1); // not dropped: still counted as executed
	t.is(report.coverageNotes![0]!.errorCode, 'SEND_ERROR');
});

test('EXCEPTION and BUDGET_EXHAUSTED are operational too; a contract error is not', t => {
	for (const code of ['EXCEPTION', 'BUDGET_EXHAUSTED']) {
		t.is(
			parseInvokeResult(failed(code, 'x'), false, 'f', 'v', false, false)
				.signal,
			'OPERATIONAL_ERROR',
		);
	}

	const contractError = parseInvokeResult(
		failed('SIMULATION_ERROR', 'HostError: Error(Contract, #3)'),
		false,
		'f',
		'v',
		false,
		false,
	);
	t.not(contractError.signal, 'OPERATIONAL_ERROR');
});

test('a successful broadcast of an access vector is still a finding (no regression)', t => {
	const ok: InvokeResult = {
		...failed('', ''),
		success: true,
		broadcasted: true,
		errorCode: null,
		errorMessage: null,
		ledger: 5,
	};
	const parsed = parseInvokeResult(
		ok,
		true,
		'set_admin_value',
		'UNAUTHORIZED_CALL',
		true,
		true,
	);
	t.is(parsed.signal, 'POTENTIAL_VULN');
	t.is(parsed.severity, 'CRITICAL');
	// Wording regression: state what was observed, not a proven policy violation.
	t.notRegex(parsed.details, /access control bypass/i);
	t.regex(parsed.details, /succeeded without authorization/);
	t.regex(parsed.details, /intended access policy/);
});

// --- txBadSeq retry (root cause of the SEND_ERROR seen in v0.1.0 run 3) ---

const badSeq = {result: () => ({switch: () => ({name: 'txBadSeq'})})};

class BadSeqServer extends CampaignServer {
	sends = 0;
	constructor(private readonly failTimes: number) {
		super('https://example.invalid', {mode: 'broadcast'});
	}

	override async getAccount(a: string) {
		return new Account(a, '1');
	}

	override async simulateTransaction(): Promise<never> {
		return {
			id: '1',
			latestLedger: 1,
			events: [],
			_parsed: true,
			transactionData: new SorobanDataBuilder(),
			minResourceFee: '100',
			result: {auth: [], retval: xdr.ScVal.scvVoid()},
		} as unknown as never;
	}

	override async sendTransaction(): Promise<never> {
		this.sends++;
		if (this.sends <= this.failTimes)
			return {
				status: 'ERROR',
				hash: 'h',
				errorResult: badSeq,
			} as unknown as never;
		return {status: 'PENDING', hash: 'ok'} as unknown as never;
	}

	override async getTransaction(): Promise<never> {
		return {
			status: 'SUCCESS',
			ledger: 9,
			returnValue: xdr.ScVal.scvVoid(),
			diagnosticEventsXdr: [],
		} as unknown as never;
	}
}

const params = (server: CampaignServer) => ({
	contractId: StrKey.encodeContract(Buffer.alloc(32, 3)),
	functionName: 'f',
	args: [],
	keypair: Keypair.random(),
	server,
	networkPassphrase: 'Test SDF Network ; September 2015',
});

test('txBadSeq is retried; the vector keeps one budget slot and the retry is reported', async t => {
	const server = new BadSeqServer(1);
	const r = await invokeContract(params(server));
	t.true(r.success);
	t.is(r.sendRetries, 1);
	t.is(server.started, 1);
});

test('persistent txBadSeq stays an operational error after bounded retries (never a finding)', async t => {
	const server = new BadSeqServer(99);
	const r = await invokeContract(params(server));
	t.false(r.success);
	t.is(r.errorCode, 'SEND_ERROR');
	t.regex(r.errorMessage!, /txBadSeq/);
	t.is(r.sendRetries, 2);
	t.is(server.sends, 3);
});

// --- txBadSeq retry boundaries ---
type Step =
	'badseq' | 'ok' | 'throw' | 'insufficient' | 'try_again' | 'duplicate';

class ScriptedServer extends CampaignServer {
	seq = 100;
	gets = 0;
	simulations = 0;
	sentSequences: string[] = [];
	private i = 0;

	constructor(private readonly script: Step[]) {
		super('https://example.invalid', {mode: 'broadcast'});
	}

	override async getAccount(a: string) {
		this.gets++;
		return new Account(a, String(++this.seq));
	}

	override async simulateTransaction(): Promise<never> {
		this.simulations++;
		return {
			id: '1',
			latestLedger: 1,
			events: [],
			_parsed: true,
			transactionData: new SorobanDataBuilder(),
			minResourceFee: '100',
			result: {auth: [], retval: xdr.ScVal.scvVoid()},
		} as unknown as never;
	}

	override async sendTransaction(tx: never): Promise<never> {
		this.sentSequences.push((tx as unknown as {sequence: string}).sequence);
		const step = this.script[this.i++] ?? 'ok';
		const named = (name: string) => ({
			result: () => ({switch: () => ({name})}),
		});
		switch (step) {
			case 'throw':
				throw new Error('Request failed with status code 502');
			case 'badseq':
				return {
					status: 'ERROR',
					hash: 'h',
					errorResult: named('txBadSeq'),
				} as unknown as never;
			case 'insufficient':
				return {
					status: 'ERROR',
					hash: 'h',
					errorResult: named('txInsufficientFee'),
				} as unknown as never;
			case 'try_again':
				return {status: 'TRY_AGAIN_LATER', hash: 'h'} as unknown as never;
			case 'duplicate':
				return {status: 'DUPLICATE', hash: 'h'} as unknown as never;
			default:
				return {status: 'PENDING', hash: 'ok'} as unknown as never;
		}
	}

	override async getTransaction(): Promise<never> {
		return {
			status: 'SUCCESS',
			ledger: 9,
			returnValue: xdr.ScVal.scvVoid(),
			diagnosticEventsXdr: [],
		} as unknown as never;
	}
}

test('a txBadSeq retry rebuilds the transaction: fresh account read, fresh simulation, new sequence', async t => {
	const server = new ScriptedServer(['badseq', 'ok']);
	const r = await invokeContract(params(server));
	t.true(r.success);
	t.is(r.sendRetries, 1);
	t.is(server.gets, 2);
	t.is(server.simulations, 2);
	t.is(server.sentSequences.length, 2);
	t.not(server.sentSequences[0], server.sentSequences[1]);
});

test('retries are bounded at 2 and the rejection stays a single operational error', async t => {
	const server = new ScriptedServer(['badseq', 'badseq', 'badseq', 'ok']);
	const r = await invokeContract(params(server));
	t.is(server.sentSequences.length, 3);
	t.is(r.errorCode, 'SEND_ERROR');
	t.is(r.sendRetries, 2);
	t.is(server.started, 1); // one budget slot, not three
});

test('other rejections, ambiguous statuses and HTTP errors are NOT retried (no duplicated effects)', async t => {
	for (const [step, expectedCode] of [
		['insufficient', 'SEND_ERROR'],
		['throw', 'EXCEPTION'],
	] as const) {
		const server = new ScriptedServer([step, 'ok']);
		const r = await invokeContract(params(server));
		t.is(r.errorCode, expectedCode, `${step}`);
		t.is(server.sentSequences.length, 1, `${step}`);
		t.is(r.sendRetries, undefined, `${step}`);
	}

	for (const step of ['try_again', 'duplicate'] as const) {
		const server = new ScriptedServer([step, 'ok']);
		await invokeContract(params(server));
		t.is(server.sentSequences.length, 1, `${step}`);
	}
});

test('an exception after the envelope was accepted keeps its hash and is never resubmitted', async t => {
	class ThrowOnPoll extends ScriptedServer {
		override async getTransaction(): Promise<never> {
			throw new Error('socket hang up');
		}
	}

	const server = new ThrowOnPoll(['ok']);
	const r = await invokeContract(params(server));
	t.is(r.errorCode, 'EXCEPTION');
	t.true(r.broadcasted);
	t.is(r.transactionHash, 'ok');
	t.is(server.sentSequences.length, 1);
});
