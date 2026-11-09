// D2 week-1 spike harness. Uses the SDK installed in the product (14.6.1).
// Never logs or writes secret keys; evidence files contain only public data.
import {createHash, randomBytes} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
	Address,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
	rpc,
	xdr,
	nativeToScVal,
	hash,
} from '@stellar/stellar-sdk';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);

export function evidenceDir(runId) {
	const dir = path.resolve(
		new URL('.', import.meta.url).pathname,
		'..',
		'evidence',
		runId,
	);
	mkdirSync(dir, {recursive: true});
	return dir;
}

export function save(dir, name, data) {
	writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n');
}

export const transport = {retries: 0};

/** JSON-RPC with bounded retries on transport failure only (never on RPC errors). */
export async function rawRpc(method, params) {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetch(RPC_URL, {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
				signal: AbortSignal.timeout(30_000),
			});
			return await response.json();
		} catch (error) {
			if (attempt >= 4) throw error;
			transport.retries++;
			await new Promise(res => setTimeout(res, 1500 * attempt));
		}
	}
}

export async function fund(publicKey) {
	for (let i = 0; i < 4; i++) {
		const r = await fetch(
			`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`,
		);
		if (r.ok) return;
		await new Promise(res => setTimeout(res, 2000));
	}
	throw new Error('friendbot failed');
}

export async function latestLedger() {
	return (await server.getLatestLedger()).sequence;
}

export function buildInvoke(account, contractId, fn, args, auth = []) {
	return new TransactionBuilder(account, {
		fee: '1000000',
		networkPassphrase: PASSPHRASE,
	})
		.addOperation(
			Operation.invokeContractFunction({
				contract: contractId,
				function: fn,
				args,
				auth,
			}),
		)
		.setTimeout(120)
		.build();
}

/** record-mode simulate -> assemble -> sign by source -> send -> poll. */
export async function submitWithSource(tx, sourceKp, mode = undefined) {
	const sim = await server.simulateTransaction(tx, undefined, mode);
	if (rpc.Api.isSimulationError(sim)) {
		return {phase: 'simulate', sim};
	}
	const prepared = rpc.assembleTransaction(tx, sim).build();
	prepared.sign(sourceKp);
	const sent = await server.sendTransaction(prepared);
	if (sent.status !== 'PENDING') return {phase: 'send', sent};
	const final = await server.pollTransaction(sent.hash, {attempts: 30});
	return {phase: 'final', sent, final};
}

export async function uploadAndDeploy(relayKp, wasm, initFn, initArgs) {
	let account = await server.getAccount(relayKp.publicKey());
	let tx = new TransactionBuilder(account, {
		fee: '1000000',
		networkPassphrase: PASSPHRASE,
	})
		.addOperation(Operation.uploadContractWasm({wasm}))
		.setTimeout(120)
		.build();
	let r = await submitWithSource(tx, relayKp);
	if (r.final?.status !== 'SUCCESS') throw new Error('upload failed ' + JSON.stringify(r.phase));
	const wasmHash = hash(wasm);
	account = await server.getAccount(relayKp.publicKey());
	tx = new TransactionBuilder(account, {
		fee: '1000000',
		networkPassphrase: PASSPHRASE,
	})
		.addOperation(
			Operation.createCustomContract({
				address: Address.fromString(relayKp.publicKey()),
				wasmHash: wasmHash,
				salt: randomBytes(32),
			}),
		)
		.setTimeout(120)
		.build();
	r = await submitWithSource(tx, relayKp);
	if (r.final?.status !== 'SUCCESS') throw new Error('create failed ' + JSON.stringify(r.sim?.error ?? r.phase));
	const contractId = Address.fromScVal(r.final.returnValue).toString();
	if (!initFn) return {contractId, wasmHash: wasmHash.toString('hex')};
	account = await server.getAccount(relayKp.publicKey());
	tx = buildInvoke(account, contractId, initFn, initArgs);
	r = await submitWithSource(tx, relayKp);
	if (r.final?.status !== 'SUCCESS') throw new Error('init failed ' + JSON.stringify(r.sim?.error ?? r.phase));
	return {contractId, wasmHash: wasmHash.toString('hex'), initTx: r.sent.hash};
}

export function invocationFor(contractId, fn, args, subInvocations = []) {
	return new xdr.SorobanAuthorizedInvocation({
		function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
			new xdr.InvokeContractArgs({
				contractAddress: Address.fromString(contractId).toScAddress(),
				functionName: fn,
				args,
			}),
		),
		subInvocations,
	});
}

export function newNonce() {
	return xdr.Int64.fromString(
		BigInt.asUintN(62, randomBytes(8).readBigUInt64BE()).toString(),
	);
}

export function preimageHash(nonce, expiration, invocation) {
	const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
		new xdr.HashIdPreimageSorobanAuthorization({
			networkId: hash(Buffer.from(PASSPHRASE)),
			nonce,
			signatureExpirationLedger: expiration,
			invocation,
		}),
	);
	return createHash('sha256').update(preimage.toXDR()).digest();
}

function unsignedEntry(address, nonce, expiration, invocation, signature) {
	return new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
			new xdr.SorobanAddressCredentials({
				address: Address.fromString(address).toScAddress(),
				nonce,
				signatureExpirationLedger: expiration,
				signature,
			}),
		),
		rootInvocation: invocation,
	});
}

/** Ed25519 account entry. mutate: 'none' | 'badsig' | 'otherkey' | 'nosig' */
export function ed25519Entry({signer, address, invocation, expiration, mutate = 'none', nonce = newNonce()}) {
	const payload = preimageHash(nonce, expiration, invocation);
	let sigBytes = signer.sign(payload);
	let pub = Address.fromString(signer.publicKey()).toScAddress().accountId().ed25519();
	if (mutate === 'badsig') {
		sigBytes = Buffer.from(sigBytes);
		sigBytes[0] ^= 0xff;
	}
	if (mutate === 'otherkey') {
		sigBytes = Keypair.random().sign(payload);
	}
	const sig = xdr.ScVal.scvVec([
		xdr.ScVal.scvMap([
			new xdr.ScMapEntry({
				key: xdr.ScVal.scvSymbol('public_key'),
				val: xdr.ScVal.scvBytes(pub),
			}),
			new xdr.ScMapEntry({
				key: xdr.ScVal.scvSymbol('signature'),
				val: xdr.ScVal.scvBytes(sigBytes),
			}),
		]),
	]);
	return unsignedEntry(address, nonce, expiration, invocation, sig);
}

/** PolicyAccount entry: signature = struct {public_key, signature}. */
export function policyEntry({signer, accountId, invocation, expiration, mutate = 'none', nonce = newNonce()}) {
	const payload = preimageHash(nonce, expiration, invocation);
	let sigBytes = signer.sign(payload);
	const pub = signer.rawPublicKey();
	if (mutate === 'badsig') {
		sigBytes = Buffer.from(sigBytes);
		sigBytes[0] ^= 0xff;
	}
	const sig = xdr.ScVal.scvMap([
		new xdr.ScMapEntry({
			key: xdr.ScVal.scvSymbol('public_key'),
			val: xdr.ScVal.scvBytes(pub),
		}),
		new xdr.ScMapEntry({
			key: xdr.ScVal.scvSymbol('signature'),
			val: xdr.ScVal.scvBytes(sigBytes),
		}),
	]);
	return unsignedEntry(accountId, nonce, expiration, invocation, sig);
}

export const addr = a => new Address(a).toScVal();
export const u32 = v => nativeToScVal(v, {type: 'u32'});

/** Public-only summary of a raw simulate response. */
export function summarizeRaw(raw) {
	const r = raw.result ?? raw;
	return {
		error: r.error,
		latestLedger: r.latestLedger,
		hasResults: Boolean(r.results?.length),
		authReturned: r.results?.[0]?.auth?.length ?? 0,
		events: r.events?.length ?? 0,
		minResourceFee: r.minResourceFee,
		transactionData: r.transactionData ? 'present' : undefined,
	};
}

/**
 * Nested authorization tree for NA-1..3: Router.forward(actor, amount) with an
 * optional Executor.execute(actor, innerAmount) child. NA-1: (5,5); NA-2: no
 * child (includeInner=false); NA-3: child signed for a different amount.
 */
export function nestedTree(routerId, executorId, actor, amount, innerAmount, includeInner = true) {
	return invocationFor(routerId, 'forward', [addr(actor), u32(amount)],
		includeInner ? [invocationFor(executorId, 'execute', [addr(actor), u32(innerAmount)])] : []);
}
