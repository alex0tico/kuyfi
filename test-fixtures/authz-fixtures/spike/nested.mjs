// NA-1..3: nested authorization (Router.forward -> Executor.execute), enforcing simulation x N,
// plus NA-1 on-chain with state read. Actor is an Ed25519 account; source is the relay.
import {readFileSync, writeFileSync} from 'node:fs';
import {Keypair, rpc, scValToNative} from '@stellar/stellar-sdk';
import {nestedTree, addr, buildInvoke, ed25519Entry, evidenceDir, fund, invocationFor, latestLedger, rawRpc, save, server, transport, u32, uploadAndDeploy} from './harness.mjs';

const [runId, keysPath, runsArg = '3', tag = ''] = process.argv.slice(2);
const dir = evidenceDir(runId);
const keys = JSON.parse(readFileSync(keysPath));
const relay = Keypair.fromSecret(keys.relay);
const root = new URL('../target/wasm32v1-none/release/', import.meta.url);
const executor = await uploadAndDeploy(relay, readFileSync(new URL('executor.wasm', root)));
const router = await uploadAndDeploy(relay, readFileSync(new URL('router.wasm', root)), 'init', [addr(executor.contractId)]);
const actor = Keypair.random();
await fund(actor.publicKey());
const A = actor.publicKey();
const deployment = {relay: relay.publicKey(), actor: A, executor, router};
save(dir, `nested-setup${tag}.json`, deployment);

const tree = (amount, innerAmount, includeInner = true) => nestedTree(router.contractId, executor.contractId, A, amount, innerAmount, includeInner);
const sim = async (entries, amount) => {
	const tx = buildInvoke(await server.getAccount(relay.publicKey()), router.contractId, 'forward', [addr(A), u32(amount)], entries);
	const r = await rawRpc('simulateTransaction', {transaction: tx.toXDR(), authMode: 'enforce'});
	return {tx, r};
};
const digest = ({r}) => ({ok: !r.error && !r.result?.error, error: r.result?.error, latestLedger: r.result?.latestLedger});
const entry = (inv, exp) => ed25519Entry({signer: actor, address: A, invocation: inv, expiration: exp});
const text = c => c.error ?? '';
const verdicts = {
	'NA-2': c => /Error\(Auth, InvalidAction\)/.test(text(c)) && /Unauthorized function call for address/.test(text(c)) && text(c).includes(`fn_call, ${executor.contractId}, execute`),
	'NA-3': c => /Error\(Auth, InvalidAction\)/.test(text(c)) && /Unauthorized function call for address/.test(text(c)) && text(c).includes(`fn_call, ${executor.contractId}, execute`),
};
const runs = [];
for (let n = 1; n <= Number(runsArg); n++) {
	const L = await latestLedger(); const exp = L + 50; const out = {run: n, ledger: L, cases: {}};
	out.cases['NA-1'] = digest(await sim([entry(tree(5, 5), exp)], 5));
	out.cases['NA-2'] = digest(await sim([entry(tree(5, 5, false), exp)], 5));
	out.cases['NA-3'] = digest(await sim([entry(tree(5, 6), exp)], 5));
	// Control for NA-3: the same kind of child signed for 6, but the call also uses 6 -> must succeed.
	out.cases['C-NA3'] = digest(await sim([entry(tree(6, 6), exp)], 6));
	const v = {'NA-1': out.cases['NA-1'].ok ? 'expected_success' : 'unexpected_rejection', 'C-NA3': out.cases['C-NA3'].ok ? 'expected_success' : 'unexpected_rejection'};
	for (const id of ['NA-2', 'NA-3']) v[id] = out.cases[id].ok ? 'unexpected_acceptance' : (verdicts[id](out.cases[id]) && v['NA-1'] === 'expected_success' && (id !== 'NA-3' || v['C-NA3'] === 'expected_success') ? 'expected_rejection' : 'inconclusive');
	out.verdict = v; runs.push(out);
	console.log(`run ${n}:`, JSON.stringify(v));
}
// NA-1 on-chain
const L = await latestLedger();
const { tx } = await sim([entry(tree(5, 5), L + 60)], 5);
const s = await server.simulateTransaction(tx, undefined, 'enforce');
const prepared = rpc.assembleTransaction(tx, s).build(); prepared.sign(relay);
const read = async () => { const t = buildInvoke(await server.getAccount(relay.publicKey()), executor.contractId, 'get', [addr(A)]); const r = await server.simulateTransaction(t); return r.result ? scValToNative(r.result.retval) : undefined; };
const before = await read();
const sent = await server.sendTransaction(prepared);
const final = await server.pollTransaction(sent.hash, {attempts: 40});
await new Promise(r => setTimeout(r, 6000));
const onchain = {hash: sent.hash, status: final.status, ledger: final.ledger, before, after: await read(), expectedAfter: 5, authEntriesInSubmittedTx: prepared.operations[0].auth?.length};
save(dir, `nested-enforce-simulation${tag}.json`, {mode: 'enforce', ...deployment, transportRetries: transport.retries, runs, onchain});
console.log(JSON.stringify(onchain));
