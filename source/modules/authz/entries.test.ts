import test from 'ava';
import {
	Address,
	Keypair,
	Networks,
	StrKey,
	authorizeEntry,
	hash,
	xdr,
} from '@stellar/stellar-sdk';
import {createHash} from 'node:crypto';
import {
	authorizationPayload,
	buildCustomAccountEntry,
	buildEd25519Entry,
	buildInvocation,
	newNonce,
	summarizeTree,
} from './entries.js';
import type {InvocationSpec} from './types.js';

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 5));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 6));
const signer = Keypair.random();
const resolve = (name: string) => {
	if (name !== 'A') throw new Error('unknown');
	return signer;
};

const spec: InvocationSpec = {
	contractId: CONTRACT,
	function: 'protected_set',
	args: [{actor: 'A'}, {type: 'u32', value: 7}],
};

function sigBytes(entry: xdr.SorobanAuthorizationEntry, key: string): Buffer {
	const map = entry.credentials().address().signature().vec()![0]!.map()!;
	return Buffer.from(
		map
			.find(e => e.key().sym().toString() === key)!
			.val()
			.bytes(),
	);
}

test('our signature equals the SDK authorizeEntry signature for the same nonce, expiration and tree', async t => {
	const nonce = xdr.Int64.fromString('123456789');
	const inv = buildInvocation(spec, resolve);
	const ours = buildEd25519Entry({
		signer,
		invocation: inv,
		expirationLedger: 5000,
		variant: 'valid',
		networkPassphrase: Networks.TESTNET,
		nonce,
	});
	// Independent implementation: the SDK builds the preimage and signs it.
	const unsigned = new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
			new xdr.SorobanAddressCredentials({
				address: Address.fromString(signer.publicKey()).toScAddress(),
				nonce,
				signatureExpirationLedger: 0,
				signature: xdr.ScVal.scvVoid(),
			}),
		),
		rootInvocation: buildInvocation(spec, resolve),
	});
	const sdk = await authorizeEntry(unsigned, signer, 5000, Networks.TESTNET);
	t.is(
		ours.entry.credentials().address().signature().toXDR('base64'),
		sdk.credentials().address().signature().toXDR('base64'),
	);
	t.is(ours.entry.credentials().address().signatureExpirationLedger(), 5000);
});

test('the payload is the SHA-256 of the authorization preimage and the signature verifies against it', t => {
	const nonce = xdr.Int64.fromString('42');
	const inv = buildInvocation(spec, resolve);
	const payload = authorizationPayload(Networks.TESTNET, nonce, 777, inv);
	const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
		new xdr.HashIdPreimageSorobanAuthorization({
			networkId: hash(Buffer.from(Networks.TESTNET)),
			nonce,
			signatureExpirationLedger: 777,
			invocation: inv,
		}),
	);
	t.deepEqual(payload, createHash('sha256').update(preimage.toXDR()).digest());
	const built = buildEd25519Entry({
		signer,
		invocation: inv,
		expirationLedger: 777,
		variant: 'valid',
		networkPassphrase: Networks.TESTNET,
		nonce,
	});
	t.true(signer.verify(payload, sigBytes(built.entry, 'signature')));
});

test('invalid_signature and foreign_signature never verify; valid does', t => {
	const nonce = xdr.Int64.fromString('9');
	const inv = buildInvocation(spec, resolve);
	const payload = authorizationPayload(Networks.TESTNET, nonce, 10, inv);
	const make = (variant: 'valid' | 'invalid_signature' | 'foreign_signature') =>
		sigBytes(
			buildEd25519Entry({
				signer,
				invocation: inv,
				expirationLedger: 10,
				variant,
				networkPassphrase: Networks.TESTNET,
				nonce,
			}).entry,
			'signature',
		);
	t.true(signer.verify(payload, make('valid')));
	t.false(signer.verify(payload, make('invalid_signature')));
	t.false(signer.verify(payload, make('foreign_signature')));
});

test('a different tree (child omitted or different argument) changes the signed payload', t => {
	const nonce = xdr.Int64.fromString('1');
	const root: InvocationSpec = {
		contractId: CONTRACT,
		function: 'forward',
		args: [{actor: 'A'}, {type: 'u32', value: 5}],
	};
	const child = (v: number): InvocationSpec => ({
		contractId: OTHER,
		function: 'execute',
		args: [{actor: 'A'}, {type: 'u32', value: v}],
	});
	const hashOf = (s: InvocationSpec) =>
		authorizationPayload(
			Networks.TESTNET,
			nonce,
			10,
			buildInvocation(s, resolve),
		).toString('hex');
	const h = [
		hashOf({...root, children: [child(5)]}),
		hashOf(root),
		hashOf({...root, children: [child(6)]}),
	];
	t.is(new Set(h).size, 3);
	const tree = summarizeTree(
		buildInvocation({...root, children: [child(5)]}, resolve),
	) as {children: unknown[]};
	t.is(tree.children.length, 1);
});

test('nonces come from the CSPRNG: distinct and within the positive int64 range', t => {
	const seen = new Set<string>();
	for (let i = 0; i < 500; i++) {
		const n = newNonce().toString();
		t.true(BigInt(n) >= 0n && BigInt(n) < 2n ** 63n);
		seen.add(n);
	}

	t.is(seen.size, 500);
});

// --- custom account entries ---

test('custom account entry: address is the account contract, signature is a sorted ScMap that verifies', t => {
	const nonce = xdr.Int64.fromString('77');
	const inv = buildInvocation(spec, resolve);
	const account = StrKey.encodeContract(Buffer.alloc(32, 8));
	const built = buildCustomAccountEntry({
		signer,
		accountContractId: account,
		invocation: inv,
		expirationLedger: 99,
		variant: 'valid',
		networkPassphrase: Networks.TESTNET,
		nonce,
	});
	const cred = built.entry.credentials().address();
	t.is(Address.fromScAddress(cred.address()).toString(), account);
	const map = cred.signature().map()!;
	t.deepEqual(
		map.map(e => e.key().sym().toString()),
		['public_key', 'signature'],
	);
	const sig = Buffer.from(map[1]!.val().bytes());
	t.true(
		signer.verify(authorizationPayload(Networks.TESTNET, nonce, 99, inv), sig),
	);
	t.deepEqual(Buffer.from(map[0]!.val().bytes()), signer.rawPublicKey());
});

test('custom account entry: field names are configurable and always emitted sorted', t => {
	const inv = buildInvocation(spec, resolve);
	const built = buildCustomAccountEntry({
		signer,
		accountContractId: StrKey.encodeContract(Buffer.alloc(32, 8)),
		publicKeyField: 'zz_key',
		signatureField: 'aa_sig',
		invocation: inv,
		expirationLedger: 5,
		variant: 'invalid_signature',
		networkPassphrase: Networks.TESTNET,
	});
	const keys = built.entry
		.credentials()
		.address()
		.signature()
		.map()!
		.map(e => e.key().sym().toString());
	t.deepEqual(keys, ['aa_sig', 'zz_key']);
});
