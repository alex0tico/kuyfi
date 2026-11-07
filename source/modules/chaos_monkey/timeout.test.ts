import test from 'ava';
import {
	Account,
	Keypair,
	SorobanDataBuilder,
	StrKey,
	xdr,
} from '@stellar/stellar-sdk';
import {CampaignServer} from './campaign.js';
import {runChaosMonkey} from './index.js';
import {resolveSeed} from '../seed.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();

// transfer(to, amount) runs math + access vectors, so there are several families to skip.
const FUNCTIONS = [
	{
		name: 'transfer',
		params: [
			{name: 'to', type: ADDR},
			{name: 'amount', type: I128},
		],
	},
];

const cast = <T>(value: unknown): T => value as T;

class CountingServer extends CampaignServer {
	simulations = 0;

	constructor() {
		super('https://example.invalid', {mode: 'simulate-only'});
	}

	override async getAccount(address: string) {
		return new Account(address, '1');
	}

	override async simulateTransaction(): Promise<never> {
		this.simulations++;
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

async function run(
	extra: {timeoutSeconds?: number; clock?: () => number} = {},
) {
	const server = new CountingServer();
	const report = await runChaosMonkey({
		contractId: CONTRACT_ID,
		functions: FUNCTIONS,
		udtRegistry: new Map(),
		onProgress() {},
		keypair: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)),
		server,
		seed: resolveSeed(1),
		...extra,
	});
	return {report, server};
}

test('no --timeout: the report has no timeout field and everything runs', async t => {
	const {report, server} = await run();
	t.is(report.timeout, undefined);
	t.true(server.simulations > 0);
});

test('a time limit that is not reached changes nothing and says so', async t => {
	const full = await run();
	const limited = await run({timeoutSeconds: 60, clock: () => 0});
	t.deepEqual(limited.report.timeout, {seconds: 60, reached: false});
	t.is(limited.server.simulations, full.server.simulations);
});

test('reaching the time limit stops later vector families and is recorded as reached', async t => {
	const full = await run();
	// The clock jumps past the deadline as soon as the first family has run.
	let server: CountingServer | undefined;
	const holder = new CountingServer();
	server = holder;
	const report = await runChaosMonkey({
		contractId: CONTRACT_ID,
		functions: FUNCTIONS,
		udtRegistry: new Map(),
		onProgress() {},
		keypair: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)),
		server,
		seed: resolveSeed(1),
		timeoutSeconds: 5,
		clock: () => (holder.simulations > 0 ? 1_000_000 : 0),
	});
	t.deepEqual(report.timeout, {seconds: 5, reached: true});
	t.true(holder.simulations > 0); // the family already running finished
	t.true(holder.simulations < full.server.simulations); // later ones did not start
});

test('a limit already passed at the first check runs nothing', async t => {
	let calls = 0;
	const {report, server} = await run({
		timeoutSeconds: 1,
		// First call fixes the deadline at t=0+1s; every later call is far past it.
		clock: () => (calls++ === 0 ? 0 : 1_000_000),
	});
	t.is(server.simulations, 0);
	t.true(report.timeout!.reached);
});
