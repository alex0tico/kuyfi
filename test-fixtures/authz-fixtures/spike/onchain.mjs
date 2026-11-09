// Step 4: on-chain success cases (ED-1, CA-1, CA-3), state reads, nonce and
// expiry probes. Source is always the relay; actors authorize via entries only.
import {readFileSync} from 'node:fs';
import {Keypair, rpc, scValToNative} from '@stellar/stellar-sdk';
import {
	addr, buildInvoke, ed25519Entry, evidenceDir, fund, invocationFor, latestLedger,
	newNonce, policyEntry, rawRpc, save, server, transport, u32,
} from './harness.mjs';

const [runId, keysPath, tag = 'onchain'] = process.argv.slice(2);
const dir = evidenceDir(runId);
const pub = JSON.parse(readFileSync(`${dir}/setup.json`));
const keys = JSON.parse(readFileSync(keysPath));
const relay = Keypair.fromSecret(keys.relay);
const owner = Keypair.fromSecret(keys.owner);
const vault = pub.vault.contractId;
const policy = pub.policy.contractId;
const actorA = Keypair.random();
await fund(actorA.publicKey());

const mk = async (fn, args, entries) => buildInvoke(await server.getAccount(relay.publicKey()), vault, fn, args, entries);
const simRaw = async tx => (await rawRpc('simulateTransaction', {transaction: tx.toXDR(), authMode: 'enforce'}));
const short = r => ({ok: !r.error && !r.result?.error, error: r.result?.error?.split('\n')[0], diag: r.result?.error?.split('\n').filter(l => /Diagnostic/.test(l)).slice(0, 3).map(l => l.slice(0, 220)), ledger: r.result?.latestLedger});

async function readValue(who) {
	const tx = await mk('get', [addr(who)], []);
	const res = await server.simulateTransaction(tx);
	return rpc.Api.isSimulationSuccess(res) && res.result ? scValToNative(res.result.retval) : undefined;
}

async function onChain(label, fn, args, entry) {
	const tx = await mk(fn, args, [entry]);
	const simResult = await simRaw(tx);
	if (simResult.result?.error) return {label, phase: 'simulate', ...short(simResult)};
	const sim = await server.simulateTransaction(tx, undefined, 'enforce');
	const prepared = rpc.assembleTransaction(tx, sim).build();
	const keptAuth = prepared.operations[0].auth?.length ?? 0;
	prepared.sign(relay);
	const sent = await server.sendTransaction(prepared);
	const final = sent.status === 'PENDING' ? await server.pollTransaction(sent.hash, {attempts: 40}) : undefined;
	return {label, sourceAccount: relay.publicKey(), simulationMode: 'enforce', authEntriesInSubmittedTx: keptAuth,
		hash: sent.hash, sendStatus: sent.status, status: final?.status, ledger: final?.ledger, feeCharged: final?.resultXdr ? 'see getTransaction' : undefined};
}

const out = {actors: {A: actorA.publicKey(), relay: relay.publicKey()}};
const L = await latestLedger();
const exp = L + 60;
const A = actorA.publicKey();
const args7 = [addr(A), u32(7)];
const inv7 = invocationFor(vault, 'protected_set', args7);
const nonce = newNonce();
const entryA = ed25519Entry({signer: actorA, address: A, invocation: inv7, expiration: exp, nonce});

// nonce: does enforcing simulation consume it? Simulate the same entry twice.
const s1 = short(await simRaw(await mk('protected_set', args7, [entryA])));
const s2 = short(await simRaw(await mk('protected_set', args7, [entryA])));
out.nonce = {sameEntrySimTwiceBeforeSubmit: [s1, s2], before: await readValue(A)};

out['ED-1'] = {before: await readValue(A), tx: await onChain('ED-1', 'protected_set', args7, entryA)};
await new Promise(r => setTimeout(r, 6000));
out['ED-1'].after = await readValue(A);

// replay of the same entry (same nonce, same payload) after inclusion
out.nonce.replaySameEntryAfterInclusion = short(await simRaw(await mk('protected_set', args7, [entryA])));
// same nonce, different payload (value 8), freshly signed
const args8 = [addr(A), u32(8)];
const entrySameNonce = ed25519Entry({signer: actorA, address: A, invocation: invocationFor(vault, 'protected_set', args8), expiration: exp, nonce});
out.nonce.sameNonceDifferentPayload = short(await simRaw(await mk('protected_set', args8, [entrySameNonce])));
// fresh nonce control
const entryFresh = ed25519Entry({signer: actorA, address: A, invocation: invocationFor(vault, 'protected_set', args8), expiration: exp});
out.nonce.freshNonceControl = short(await simRaw(await mk('protected_set', args8, [entryFresh])));

// expiry boundary relative to the simulation ledger reported by the RPC
out.expiry = {};
for (const delta of [-2, -1, 0, 1]) {
	const cur = await latestLedger();
	const e = ed25519Entry({signer: actorA, address: A, invocation: inv7, expiration: cur + delta});
	const r = await simRaw(await mk('protected_set', args7, [e]));
	out.expiry[`latest${delta >= 0 ? '+' : ''}${delta}`] = {requestedExpiration: cur + delta, ledgerBeforeCall: cur, simulationLedger: r.result?.latestLedger, ...short(r)};
}

// custom account on-chain
for (const [id, value] of [['CA-1', 7], ['CA-3', 100]]) {
	const ledger = await latestLedger();
	const args = [addr(policy), u32(value)];
	const e = policyEntry({signer: owner, accountId: policy, invocation: invocationFor(vault, 'protected_set', args), expiration: ledger + 60});
	const before = await readValue(policy);
	const tx = await onChain(id, 'protected_set', args, e);
	await new Promise(r => setTimeout(r, 6000));
	out[id] = {before, tx, after: await readValue(policy), expectedAfter: value};
}
out.transportRetries = transport.retries;
save(dir, `${tag}.json`, out);
console.log(JSON.stringify(out, null, 2));
