import test from 'ava';
import {
	Account,
	Keypair,
	StrKey,
	SorobanDataBuilder,
	rpc,
	xdr,
} from '@stellar/stellar-sdk';
import {CampaignServer, SimulateOnlyViolation} from './campaign.js';
import type {CampaignLimits} from './campaign.js';
import {runChaosMonkey} from './index.js';
import {auditProvenance} from './provenance.js';
import {parseContextConfig} from './context_config.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();
const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();
const U128 = xdr.ScSpecTypeDef.scSpecTypeU128();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();

// One function per vector family so every fuzzer runs:
//  access+call_order: initialize(admin) · fee: set_fee(fee_bps) · liquidity: swap(a, b)
//  math: transfer(to, amount)
const FUNCTIONS = [
	{name: 'initialize', params: [{name: 'admin', type: ADDR}]},
	{name: 'set_fee', params: [{name: 'fee_bps', type: U32}]},
	{
		name: 'swap',
		params: [
			{name: 'amount_a', type: U128},
			{name: 'amount_b', type: U128},
		],
	},
	{
		name: 'transfer',
		params: [
			{name: 'to', type: ADDR},
			{name: 'amount', type: I128},
		],
	},
];

const cast = <T>(value: unknown): T => value as T;

type Mode = 'sim-ok' | 'sim-reject';

/** Offline stand-in for the RPC: counts every call that would leave the process. */
class FakeServer extends CampaignServer {
	simulateCalls = 0;
	sendCalls = 0;

	constructor(
		limits: CampaignLimits,
		private readonly mode: Mode = 'sim-ok',
	) {
		super('https://example.invalid', limits);
	}

	override async getAccount(address: string) {
		return new Account(address, '1');
	}

	override async simulateTransaction(): Promise<never> {
		this.simulateCalls++;
		if (this.mode === 'sim-reject') {
			return cast<never>({
				id: '1',
				latestLedger: 1,
				events: [],
				_parsed: true,
				error: 'HostError: Error(Contract, #1)',
			});
		}

		return cast<never>({
			id: '1',
			latestLedger: 1,
			events: [],
			_parsed: true,
			transactionData: new SorobanDataBuilder(),
			minResourceFee: '100',
			result: {auth: [], retval: xdr.ScVal.scvVoid()},
		});
	}

	override async sendTransaction(tx: never) {
		this.sendCalls++;
		if (this.simulateOnly) return super.sendTransaction(tx);
		return cast<never>({status: 'ERROR', hash: 'h'});
	}
}

async function run(
	server: CampaignServer,
	extra: Record<string, unknown> = {},
	functions = FUNCTIONS,
) {
	return runChaosMonkey({
		contractId: CONTRACT_ID,
		functions,
		udtRegistry: new Map(),
		onProgress() {},
		keypair: Keypair.random(),
		server,
		...extra,
	});
}

test('simulate-only: no transaction is ever sent, every invocation is a simulation', async t => {
	const server = new FakeServer({mode: 'simulate-only'});
	const report = await run(server, {limits: {mode: 'simulate-only'}});
	t.true(report.totalVectorsRun > 0);
	t.is(server.sendCalls, 0);
	t.is(report.summary.broadcastTransactions, 0);
	t.is(report.summary.transactionsWithHash, 0);
	t.true(report.invocations!.every(i => i.mode === 'simulation'));
	t.is(report.campaign!.blockedSends, 0);
	t.is(report.campaign!.mode, 'simulate-only');
});

test('simulate-only: a simulated success on an access vector is NOT a finding', async t => {
	const server = new FakeServer({mode: 'simulate-only'});
	const report = await run(server, {}, [FUNCTIONS[0]!]);
	const access = report.invocations!.filter(
		i =>
			i.vectorName === 'UNAUTHORIZED_CALL' || i.vectorName === 'REINIT_ATTACK',
	);
	t.true(access.length > 0);
	t.true(access.every(i => i.signal === 'NOT_EVALUATED'));
	t.false(report.findings.some(f => f.signal === 'POTENTIAL_VULN'));
	t.true(report.summary.notEvaluated! > 0);
	t.true(report.coverageNotes!.every(n => n.signal !== undefined));
});

test('simulate-only: a code path that bypasses the scheduler still cannot send', async t => {
	const server = new FakeServer({mode: 'simulate-only'});
	await t.throwsAsync(server.sendTransaction({} as never), {
		instanceOf: SimulateOnlyViolation,
	});
	t.is(server.blockedSends, 1);
});

test('maxVectors is a hard cap across all families and records what it refused', async t => {
	const server = new FakeServer({mode: 'simulate-only', maxVectors: 5});
	const report = await run(server, {
		limits: {mode: 'simulate-only', maxVectors: 5},
	});
	t.is(server.simulateCalls, 5);
	t.is(report.totalVectorsRun, 5);
	t.true(report.campaign!.refusedByBudget >= 0);
	t.is(report.campaign!.maxVectors, 5);
});

test('vectors refused by the budget still have their generated inputs audited', async t => {
	const server = new FakeServer({mode: 'simulate-only', maxVectors: 5});
	const report = await run(server, {
		limits: {mode: 'simulate-only', maxVectors: 5},
	});
	t.true(report.refusedInvocations!.length > 0);
	const audit = auditProvenance(
		report.invocations!,
		report.refusedInvocations,
		report.summary.operationalErrors,
	);
	t.is(audit.vectorsExecuted, 5);
	t.is(audit.vectorsRefusedByBudget, report.refusedInvocations!.length);
	t.is(audit.vectorsGenerated, 5 + report.refusedInvocations!.length);
	t.is(audit.percent, 100);
	t.is(report.campaign!.refusedByBudget, report.refusedInvocations!.length);
});

test('function and family allow-lists restrict what runs', async t => {
	const limits: CampaignLimits = {
		mode: 'simulate-only',
		functions: ['set_fee'],
		families: ['fee'],
	};
	const server = new FakeServer(limits);
	const report = await run(server, {limits});
	t.true(report.invocations!.length > 0);
	t.true(report.invocations!.every(i => i.functionName === 'set_fee'));
	t.true(report.invocations!.every(i => i.vectorName.startsWith('FEE::')));
	t.deepEqual(report.campaign!.functionsSkippedByLimit.sort(), [
		'initialize',
		'swap',
		'transfer',
	]);
});

test('provenance covers 100% of invocations across all five families, with and without context', async t => {
	for (const context of [
		undefined,
		parseContextConfig({
			version: 1,
			roles: {admin: Keypair.random().publicKey()},
			knownValues: {amount_a: {type: 'u128', value: '500'}},
		}),
	]) {
		const server = new FakeServer({mode: 'simulate-only'});
		const report = await run(server, {
			limits: {mode: 'simulate-only'},
			context,
		});
		const families = new Set(
			report.invocations!.map(i =>
				i.vectorName.startsWith('FEE::')
					? 'fee'
					: i.vectorName.startsWith('LIQUIDITY::')
						? 'liquidity'
						: i.vectorName.includes('::CALL_')
							? 'call_order'
							: [
										'UNAUTHORIZED_CALL',
										'REINIT_ATTACK',
										'SELF_CALL_ATTACK',
										'UNAUTHORIZED_ADDR_CALL',
								  ].includes(i.vectorName)
								? 'access'
								: 'math',
			),
		);
		t.deepEqual([...families].sort(), [
			'access',
			'call_order',
			'fee',
			'liquidity',
			'math',
		]);
		const audit = auditProvenance(report.invocations!);
		t.is(audit.percent, 100);
		t.deepEqual(audit.missing, []);
		if (context) {
			t.true(report.campaign!.contextKeysUsed.includes('roles.admin'));
			t.true(report.campaign!.contextKeysUsed.includes('knownValues.amount_a'));
		}
	}
});

test('auditProvenance counts a fuzzer that forgets provenance instead of skipping it', t => {
	const entry = {
		param: 'a',
		rule: 'baseline',
		source: 'spec' as const,
		seeded: false,
	};
	const audit = auditProvenance([
		{functionName: 'f', vectorName: 'ok', paramCount: 1, inputs: [entry]},
		{functionName: 'f', vectorName: 'none', paramCount: 1},
		{functionName: 'f', vectorName: 'short', paramCount: 2, inputs: [entry]},
		{
			functionName: 'f',
			vectorName: 'bad',
			paramCount: 1,
			inputs: [{...entry, source: 'configured_context' as const}],
		},
	]);
	t.is(audit.percent, 25);
	t.deepEqual(
		audit.missing.map(m => m.vectorName),
		['none', 'short', 'bad'],
	);
});

test('broadcast mode with an authorized campaign still sends (limits are not a blanket block)', async t => {
	const limits: CampaignLimits = {mode: 'broadcast', maxVectors: 1};
	const server = new FakeServer(limits);
	const report = await run(server, {limits}, [{name: 'pause', params: []}]);
	t.is(server.sendCalls, 1);
	t.is(report.campaign!.mode, 'broadcast');
	// SEND_ERROR is operational, not a security finding.
	t.is(report.findings.length, 0);
	t.is(report.summary.operationalErrors, 1);
});

test('without campaign limits the v0.1.0 flow is untouched: a plain Server still sends and no campaign block appears', async t => {
	let sends = 0;
	class PlainFake extends rpc.Server {
		override async getAccount(address: string) {
			return new Account(address, '1');
		}

		override async simulateTransaction(): Promise<never> {
			return cast<never>({
				id: '1',
				latestLedger: 1,
				events: [],
				_parsed: true,
				transactionData: new SorobanDataBuilder(),
				minResourceFee: '100',
				result: {auth: [], retval: xdr.ScVal.scvVoid()},
			});
		}

		override async sendTransaction(): Promise<never> {
			sends++;
			return cast<never>({status: 'ERROR', hash: 'h'});
		}
	}

	const report = await runChaosMonkey({
		contractId: CONTRACT_ID,
		functions: [{name: 'pause', params: []}],
		udtRegistry: new Map(),
		onProgress() {},
		keypair: Keypair.random(),
		server: new PlainFake('https://example.invalid'),
	});
	t.is(sends, 1);
	t.is(report.campaign, undefined);
	t.is(report.invocations![0]!.mode, 'broadcast');
});

test('a rejected simulation is contract evidence, not an operational error', async t => {
	const server = new FakeServer({mode: 'simulate-only'}, 'sim-reject');
	const report = await run(server, {limits: {mode: 'simulate-only'}}, [
		FUNCTIONS[3]!,
	]);
	t.is(report.summary.operationalErrors, 0);
	t.true(report.invocations!.length > 0);
});
