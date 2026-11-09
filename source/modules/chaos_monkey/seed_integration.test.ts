import test from 'ava';
import {
	Account,
	Keypair,
	SorobanDataBuilder,
	StrKey,
	xdr,
} from '@stellar/stellar-sdk';
import type {Operation} from '@stellar/stellar-sdk';
import {CampaignServer} from './campaign.js';
import {runChaosMonkey} from './index.js';
import type {ChaosReport} from './index.js';
import {resolveSeed} from '../seed.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();
const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();

// Address parameters (random test data) in every family that generates them.
const FUNCTIONS = [
	{name: 'initialize', params: [{name: 'admin', type: ADDR}]},
	{name: 'set_fee', params: [{name: 'fee_bps', type: U32}]},
	{
		name: 'transfer',
		params: [
			{name: 'to', type: ADDR},
			{name: 'amount', type: I128},
		],
	},
];

const cast = <T>(value: unknown): T => value as T;

/** Offline RPC that records every generated call (function + XDR arguments). */
class RecordingServer extends CampaignServer {
	readonly calls: string[] = [];

	constructor() {
		super('https://example.invalid', {mode: 'simulate-only'});
	}

	override async getAccount(address: string) {
		return new Account(address, '1');
	}

	override async simulateTransaction(tx: never): Promise<never> {
		const op = (tx as unknown as {operations: Operation.InvokeHostFunction[]})
			.operations[0]!;
		const inv = op.func.invokeContract();
		this.calls.push(
			`${inv.functionName().toString()}(${inv
				.args()
				.map(a => a.toXDR('base64'))
				.join(',')})`,
		);
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
}

// Fixed attacker account: the funded ephemeral key is not what is under test.
const ATTACKER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));

async function run(seedValue?: number) {
	const server = new RecordingServer();
	const seed = seedValue === undefined ? undefined : resolveSeed(seedValue);
	const report = await runChaosMonkey({
		contractId: CONTRACT_ID,
		functions: FUNCTIONS,
		udtRegistry: new Map(),
		onProgress() {},
		keypair: ATTACKER,
		server,
		...(seed ? {seed} : {}),
	});
	return {report, calls: server.calls};
}

/** The report minus the one field that is wall-clock by nature. */
const stable = (r: ChaosReport) => JSON.stringify({...r, scannedAt: undefined});

test('same seed, same input: identical generated cases and identical report', async t => {
	const a = await run(2024);
	const b = await run(2024);
	t.true(a.calls.length > 0);
	t.deepEqual(a.calls, b.calls);
	t.is(stable(a.report), stable(b.report));
});

test('different seeds: the generated cases change', async t => {
	const a = await run(1);
	const b = await run(2);
	t.notDeepEqual(a.calls, b.calls);
	// Same shape though: only the generated values moved.
	t.is(a.calls.length, b.calls.length);
});

test('the seed used is recorded in the report', async t => {
	const {report} = await run(99);
	t.deepEqual(report.seed, {value: 99, generated: false});
});

test('no seed given: one is generated, recorded as generated, and repeating it reproduces the run', async t => {
	const first = await run();
	t.true(first.report.seed!.generated);
	const again = await run(first.report.seed!.value);
	t.false(again.report.seed!.generated);
	t.deepEqual(again.calls, first.calls);
});

test('provenance: generated baseline/attack inputs are marked seeded; fuzzer-injected hypotheses are not', async t => {
	const {report} = await run(5);
	const inputs = (report.invocations ?? []).flatMap(i => i.inputs ?? []);
	const generated = inputs.filter(
		p => p.rule === 'baseline' || p.rule.startsWith('attack:'),
	);
	t.true(generated.length > 0);
	t.true(generated.every(p => p.seeded));
	// Fee/liquidity boundaries and the attacker address are not drawn from the seed.
	const injected = inputs.filter(
		p => p.rule.startsWith('fee:') || p.rule.startsWith('self_call:'),
	);
	t.true(injected.every(p => !p.seeded));
});
