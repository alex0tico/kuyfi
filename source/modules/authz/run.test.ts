import test from 'ava';
import {
	Account,
	Address,
	Keypair,
	Networks,
	Operation,
	SorobanDataBuilder,
	StrKey,
	hash,
	rpc,
	xdr,
	nativeToScVal,
} from '@stellar/stellar-sdk';
import {createHash} from 'node:crypto';
import {CampaignServer} from '../chaos_monkey/campaign.js';
import {parseAuthzMatrix} from './config.js';
import {AuthzRunError, runAuthzMatrix} from './run.js';
import type {AuthzMatrix} from './types.js';

const VAULT = StrKey.encodeContract(Buffer.alloc(32, 11));
const cast = <T>(value: unknown): T => value as T;

/** Independent re-implementation of "what the host checks", written for the test. */
function payloadOf(
	cred: xdr.SorobanAddressCredentials,
	inv: xdr.SorobanAuthorizedInvocation,
): Buffer {
	const pre = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
		new xdr.HashIdPreimageSorobanAuthorization({
			networkId: hash(Buffer.from(Networks.TESTNET)),
			nonce: cred.nonce(),
			signatureExpirationLedger: cred.signatureExpirationLedger(),
			invocation: inv,
		}),
	);
	return createHash('sha256').update(pre.toXDR()).digest();
}

type Behaviour =
	'honest' | 'accept_all' | 'reject_all' | 'wrong_text' | 'throw';

class FakeServer extends CampaignServer {
	ledger = 1000;
	authModes: unknown[] = [];
	sources: string[] = [];
	authCounts: number[] = [];
	sends = 0;
	stateValue: number | undefined;
	state = 'before';

	constructor(
		mode: 'simulate-only' | 'broadcast',
		private readonly behaviour: Behaviour = 'honest',
	) {
		super('https://example.invalid', {mode});
	}

	override async getLatestLedger() {
		return cast<rpc.Api.GetLatestLedgerResponse>({sequence: this.ledger});
	}

	override async getAccount(a: string) {
		return new Account(a, '1');
	}

	override async simulateTransaction(
		tx: never,
		_add?: unknown,
		authMode?: unknown,
	): Promise<never> {
		const t = tx as unknown as {
			source: string;
			operations: Operation.InvokeHostFunction[];
		};
		const op = t.operations[0]!;
		if (op.func.invokeContract().functionName().toString() === 'get') {
			return cast<never>({
				id: '1',
				latestLedger: this.ledger,
				events: [],
				_parsed: true,
				result: {
					auth: [],
					retval: nativeToScVal(this.state === 'before' ? 0 : 7, {type: 'u32'}),
				},
				transactionData: new SorobanDataBuilder(),
				minResourceFee: '1',
			});
		}

		this.authModes.push(authMode);
		this.sources.push(t.source);
		this.authCounts.push(op.auth?.length ?? 0);
		if (this.behaviour === 'throw') throw new Error('ETIMEDOUT');
		const error = this.judge(op);
		if (error)
			return cast<never>({
				id: '1',
				latestLedger: this.ledger,
				events: [],
				_parsed: true,
				error,
			});
		return cast<never>({
			id: '1',
			latestLedger: this.ledger,
			events: [],
			_parsed: true,
			transactionData: new SorobanDataBuilder(),
			minResourceFee: '100',
			result: {auth: [], retval: xdr.ScVal.scvVoid()},
		});
	}

	private judge(op: Operation.InvokeHostFunction): string | undefined {
		if (this.behaviour === 'accept_all') return undefined;
		if (this.behaviour === 'reject_all')
			return 'HostError: Error(Auth, InvalidAction)\n\nEvent log (newest first):\n   0: [Diagnostic Event] data:["Unauthorized function call for address", GX]';
		if (this.behaviour === 'wrong_text')
			return 'HostError: Error(Budget, ExceededLimit)';
		const args = op.func.invokeContract().args();
		const need = Address.fromScVal(args[0]!).toString();
		const mine = (op.auth ?? []).find(
			e =>
				Address.fromScAddress(
					e.credentials().address().address(),
				).toString() === need,
		);
		if (!mine)
			return `HostError: Error(Auth, InvalidAction)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CX, topics:[error, Error(Auth, InvalidAction)], data:["Unauthorized function call for address", ${need}]`;
		const cred = mine.credentials().address();
		if (cred.signatureExpirationLedger() < this.ledger)
			return `HostError: Error(Auth, InvalidInput)\n\nEvent log (newest first):\n   0: [Diagnostic Event] data:["signature has expired", ${need}, ${cred.signatureExpirationLedger()}, ${this.ledger}]`;
		const sig = Buffer.from(
			cred
				.signature()
				.vec()![0]!
				.map()!
				.find(e => e.key().sym().toString() === 'signature')!
				.val()
				.bytes(),
		);
		if (
			!Keypair.fromPublicKey(need).verify(
				payloadOf(cred, mine.rootInvocation()),
				sig,
			)
		)
			return `HostError: Error(Auth, InvalidAction)\n\nEvent log (newest first):\n   0: [Diagnostic Event] data:["failed account authentication with error", ${need}, Error(Crypto, InvalidInput)]\n   1: [Diagnostic Event] data:"failed ED25519 verification"`;
		return undefined;
	}

	override async sendTransaction(tx: never) {
		this.sends++;
		if (this.simulateOnly) return super.sendTransaction(tx);
		return cast<rpc.Api.SendTransactionResponse>({
			status: 'PENDING',
			hash: 'abc123',
		});
	}

	override async pollTransaction() {
		this.state = 'after';
		return cast<rpc.Api.GetTransactionResponse>({
			status: 'SUCCESS',
			ledger: this.ledger + 2,
		});
	}
}

const matrix = (
	mode: AuthzMatrix['mode'] = 'simulate-only',
	extra: Record<string, unknown> = {},
): AuthzMatrix =>
	parseAuthzMatrix({
		version: 1,
		id: 'ed25519-test',
		mode,
		...(mode === 'broadcast' ? {authorizationRecord: 'own-fixture'} : {}),
		actors: {A: {source: 'ephemeral'}},
		cases: [
			{
				id: 'valid',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'valid'}],
				expect: {outcome: 'success'},
				...extra,
			},
			{
				id: 'missing',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'missing'}],
				expect: {outcome: 'rejection', stage: 'authorization_missing'},
				control: 'valid',
			},
			{
				id: 'badsig',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'invalid_signature'}],
				expect: {outcome: 'rejection', stage: 'signature_invalid'},
				control: 'valid',
			},
			{
				id: 'foreign',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'foreign_signature'}],
				expect: {outcome: 'rejection', stage: 'signature_invalid'},
				control: 'valid',
			},
			{
				id: 'expired',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'expired'}],
				expect: {outcome: 'rejection', stage: 'signature_expired'},
				control: 'valid',
			},
		],
	});

const ephemeral = () => {
	const made: Keypair[] = [];
	return {
		made,
		create: async () => {
			const k = Keypair.random();
			made.push(k);
			return k;
		},
	};
};

test('honest fake: every case lands in its expected state and is accepted; mode is explicit enforce; source is a separate relay', async t => {
	const server = new FakeServer('simulate-only');
	const keys = ephemeral();
	const report = await runAuthzMatrix(matrix(), {
		server,
		createEphemeral: keys.create,
	});
	t.deepEqual(
		report.cases.map(c => [c.id, c.evaluation.state, c.evaluation.accepted]),
		[
			['valid', 'expected_success', true],
			['missing', 'expected_rejection', true],
			['badsig', 'expected_rejection', true],
			['foreign', 'expected_rejection', true],
			['expired', 'expected_rejection', true],
		],
	);
	t.true(server.authModes.every(m => m === 'enforce'));
	const [relay, actor] = keys.made;
	t.true(server.sources.every(s => s === relay!.publicKey()));
	t.not(relay!.publicKey(), actor!.publicKey());
	t.is(report.accounts.relay, relay!.publicKey());
	t.deepEqual(server.authCounts, [1, 0, 1, 1, 1]); // 'missing' supplies NO entry, others one
	t.is(server.sends, 0);
	t.is(report.summary.accepted, 5);
});

test('DISCREPANCY: a contract that accepts everything is caught as unexpected_acceptance', async t => {
	const report = await runAuthzMatrix(matrix(), {
		server: new FakeServer('simulate-only', 'accept_all'),
		createEphemeral: ephemeral().create,
	});
	const byId = Object.fromEntries(report.cases.map(c => [c.id, c.evaluation]));
	t.is(byId['valid']!.state, 'expected_success');
	for (const id of ['missing', 'badsig', 'foreign', 'expired']) {
		t.is(byId[id]!.state, 'unexpected_acceptance', `${id}`);
		t.false(byId[id]!.accepted, `${id}`);
	}
});

test('DISCREPANCY: a contract that rejects everything is caught as unexpected_rejection, and rejections lose attribution', async t => {
	const report = await runAuthzMatrix(matrix(), {
		server: new FakeServer('simulate-only', 'reject_all'),
		createEphemeral: ephemeral().create,
	});
	const byId = Object.fromEntries(report.cases.map(c => [c.id, c.evaluation]));
	t.is(byId['valid']!.state, 'unexpected_rejection');
	// control failed, so the expected rejections cannot be attributed
	for (const id of ['missing', 'badsig', 'foreign', 'expired'])
		t.is(byId[id]!.state, 'inconclusive', `${id}`);
	t.is(report.summary.accepted, 0);
});

test('DISCREPANCY: a rejection at an unrelated stage is not accepted', async t => {
	const report = await runAuthzMatrix(matrix(), {
		server: new FakeServer('simulate-only', 'wrong_text'),
		createEphemeral: ephemeral().create,
	});
	t.is(report.summary.accepted, 0);
	t.true(report.cases.every(c => !c.evaluation.accepted));
});

test('an RPC/transport failure is an operational error: inconclusive, never a rejection', async t => {
	const report = await runAuthzMatrix(matrix(), {
		server: new FakeServer('simulate-only', 'throw'),
		createEphemeral: ephemeral().create,
	});
	t.true(
		report.cases.every(
			c =>
				c.observed.outcome === 'operational_error' &&
				c.evaluation.state === 'inconclusive',
		),
	);
});

test('simulate-only never sends, even when a case asks to submit', async t => {
	const server = new FakeServer('simulate-only');
	const report = await runAuthzMatrix(matrix('simulate-only', {submit: true}), {
		server,
		createEphemeral: ephemeral().create,
	});
	t.is(server.sends, 0);
	t.regex(report.cases[0]!.observed.submissionSkipped!, /simulate-only/);
	t.is(report.cases[0]!.observed.onChain, undefined);
});

test('broadcast: an included transaction and a state read give on-chain evidence; evidence:"on-chain" is then satisfied', async t => {
	const server = new FakeServer('broadcast');
	const m = parseAuthzMatrix({
		version: 1,
		id: 'onchain',
		mode: 'broadcast',
		authorizationRecord: 'own-fixture',
		actors: {A: {source: 'ephemeral'}},
		cases: [
			{
				id: 'valid',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [{actor: 'A'}, {type: 'u32', value: 7}],
				},
				authorization: [{actor: 'A', variant: 'valid'}],
				submit: true,
				stateRead: {contractId: VAULT, function: 'get', args: [{actor: 'A'}]},
				expect: {outcome: 'success', evidence: 'on-chain'},
			},
		],
	});
	const report = await runAuthzMatrix(m, {
		server,
		createEphemeral: ephemeral().create,
	});
	const c = report.cases[0]!;
	t.is(server.sends, 1);
	t.is(c.observed.onChain!.status, 'SUCCESS');
	t.deepEqual(
		[c.observed.onChain!.stateBefore, c.observed.onChain!.stateAfter],
		[0, 7],
	);
	t.true(c.evaluation.accepted);
});

test('source and actor must be separate; env actors need their variable', async t => {
	const same = Keypair.random();
	await t.throwsAsync(
		runAuthzMatrix(matrix(), {
			server: new FakeServer('simulate-only'),
			relay: same,
			createEphemeral: async () => same,
		}),
		{instanceOf: AuthzRunError, message: /source and actor must be separate/},
	);
	const m = parseAuthzMatrix({
		...matrixJson(),
		actors: {A: {source: 'env', secretEnv: 'KUYFI_TEST_ACTOR_SECRET'}},
	});
	await t.throwsAsync(
		runAuthzMatrix(m, {
			server: new FakeServer('simulate-only'),
			createEphemeral: ephemeral().create,
			env: {},
		}),
		{message: /KUYFI_TEST_ACTOR_SECRET is not set/},
	);
});

function matrixJson() {
	return {
		version: 1,
		id: 'x',
		actors: {A: {source: 'ephemeral'}},
		cases: [
			{
				id: 'c',
				call: {contractId: VAULT, function: 'set', args: [{actor: 'A'}]},
				authorization: [],
			},
		],
	};
}

test('the JSON evidence never contains secret keys, signatures or the env secret', async t => {
	const secret = Keypair.random();
	const m = parseAuthzMatrix({
		...matrixJson(),
		actors: {A: {source: 'env', secretEnv: 'KUYFI_TEST_ACTOR_SECRET'}},
		cases: [
			{
				id: 'c',
				call: {contractId: VAULT, function: 'set', args: [{actor: 'A'}]},
				authorization: [{actor: 'A', variant: 'valid'}],
				expect: {outcome: 'success'},
			},
		],
	});
	const report = await runAuthzMatrix(m, {
		server: new FakeServer('simulate-only'),
		createEphemeral: ephemeral().create,
		env: {KUYFI_TEST_ACTOR_SECRET: secret.secret()},
	});
	const json = JSON.stringify(report);
	t.false(json.includes(secret.secret()));
	t.notRegex(json, /\bS[A-Z2-7]{55}\b/);
	t.true(json.includes(secret.publicKey()));
});

test('nested trees are built from the matrix: the entry tree carries the child node', async t => {
	let seen = 0;
	class Spy extends FakeServer {
		override async simulateTransaction(tx: never, a?: unknown, m?: unknown) {
			const op = (tx as unknown as {operations: Operation.InvokeHostFunction[]})
				.operations[0]!;
			seen = op.auth?.[0]?.rootInvocation().subInvocations().length ?? -1;
			return super.simulateTransaction(tx, a, m);
		}
	}

	const EXEC = StrKey.encodeContract(Buffer.alloc(32, 12));
	const m = parseAuthzMatrix({
		version: 1,
		id: 'nested',
		actors: {A: {source: 'ephemeral'}},
		cases: [
			{
				id: 'na1',
				call: {
					contractId: VAULT,
					function: 'forward',
					args: [{actor: 'A'}, {type: 'u32', value: 5}],
				},
				authorization: [
					{
						actor: 'A',
						variant: 'valid',
						tree: {
							contractId: VAULT,
							function: 'forward',
							args: [{actor: 'A'}, {type: 'u32', value: 5}],
							children: [
								{
									contractId: EXEC,
									function: 'execute',
									args: [{actor: 'A'}, {type: 'u32', value: 5}],
								},
							],
						},
					},
				],
			},
		],
	});
	await runAuthzMatrix(m, {
		server: new Spy('simulate-only'),
		createEphemeral: ephemeral().create,
	});
	t.is(seen, 1);
});

test('custom account entries: the entry address is the account contract and the actor only signs', async t => {
	const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 13));
	let seenAddress = '';
	let keys: string[] = [];
	class Spy extends FakeServer {
		override async simulateTransaction(tx: never) {
			const op = (tx as unknown as {operations: Operation.InvokeHostFunction[]})
				.operations[0]!;
			const cred = op.auth![0]!.credentials().address();
			seenAddress = Address.fromScAddress(cred.address()).toString();
			keys = cred
				.signature()
				.map()!
				.map(e => e.key().sym().toString());
			return cast<never>({
				id: '1',
				latestLedger: 1000,
				events: [],
				_parsed: true,
				transactionData: new SorobanDataBuilder(),
				minResourceFee: '1',
				result: {auth: [], retval: xdr.ScVal.scvVoid()},
			});
		}
	}

	const m = parseAuthzMatrix({
		version: 1,
		id: 'custom',
		actors: {OWNER: {source: 'ephemeral'}},
		cases: [
			{
				id: 'ca1',
				call: {
					contractId: VAULT,
					function: 'set',
					args: [
						{type: 'address', value: ACCOUNT},
						{type: 'u32', value: 7},
					],
				},
				authorization: [
					{actor: 'OWNER', variant: 'valid', account: {contractId: ACCOUNT}},
				],
				expect: {outcome: 'success'},
			},
		],
	});
	const report = await runAuthzMatrix(m, {
		server: new Spy('simulate-only'),
		createEphemeral: ephemeral().create,
	});
	t.is(seenAddress, ACCOUNT);
	t.deepEqual(keys, ['public_key', 'signature']);
	t.is(report.cases[0]!.entries[0]!.accountContract, ACCOUNT);
	t.true(report.cases[0]!.evaluation.accepted);
});
