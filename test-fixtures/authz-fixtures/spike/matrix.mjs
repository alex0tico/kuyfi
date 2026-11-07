// Step 3: ED-1..5 and CA-1..4 under enforcing simulation, N runs, plus on-chain
// ED-1/CA-1 and nonce/expiry probes. Evidence is public data only.
import {readFileSync} from 'node:fs';
import {Keypair, rpc, scValToNative, xdr} from '@stellar/stellar-sdk';
import {
	PASSPHRASE, transport, addr, buildInvoke, ed25519Entry, evidenceDir, fund, invocationFor,
	latestLedger, newNonce, policyEntry, rawRpc, save, server, u32,
} from './harness.mjs';

const [runId, keysPath, runsArg = '3', tag = 'matrix'] = process.argv.slice(2);
const dir = evidenceDir(runId);
const pub = JSON.parse(readFileSync(`${dir}/setup.json`));
const keys = JSON.parse(readFileSync(keysPath));
const relay = Keypair.fromSecret(keys.relay);
const admin = Keypair.fromSecret(keys.admin);
const owner = Keypair.fromSecret(keys.owner);
const vault = pub.vault.contractId;
const policy = pub.policy.contractId;
const runs = Number(runsArg);

const actorA = Keypair.random();
const actorB = Keypair.random();
await Promise.all([fund(actorA.publicKey()), fund(actorB.publicKey()), fund(admin.publicKey())].map(p => p.catch(() => {})));
if ([actorA, actorB].some(k => k.publicKey() === relay.publicKey())) throw new Error('actor must differ from relay');

async function sim(fn, args, entries, mode = 'enforce', contract = vault) {
	const account = await server.getAccount(relay.publicKey());
	const tx = buildInvoke(account, contract, fn, args, entries);
	const res = await rawRpc('simulateTransaction', {transaction: tx.toXDR(), ...(mode ? {authMode: mode} : {})});
	return {tx, res, r: res.result, rpcError: res.error};
}

function digest({res, r, rpcError}, ledgerBefore) {
	const events = (r?.events ?? []).map(e => {
		try {
			const d = xdr.DiagnosticEvent.fromXDR(e, 'base64');
			const body = d.event().body().v0();
			return {
				contract: d.event().contractId() ? rpc && Buffer.from(d.event().contractId()).toString('hex') : null,
				topics: body.topics().map(t => safe(t)),
				data: safe(body.data()),
			};
		} catch (error) {
			return {undecoded: String(error)};
		}
	});
	return {
		rpcError, error: r?.error, success: !rpcError && !r?.error && Boolean(r?.results),
		latestLedger: r?.latestLedger, ledgerBefore, events,
		minResourceFee: r?.minResourceFee,
		footprint: footprint(r?.transactionData),
	};
}
function safe(v) {
	try {
		return JSON.stringify(scValToNative(v), (_k, x) => (typeof x === 'bigint' ? x.toString() : x?.type === 'Buffer' ? Buffer.from(x.data).toString('hex') : x));
	} catch {
		return v.toXDR('base64');
	}
}
function footprint(td) {
	if (!td) return undefined;
	const d = xdr.SorobanTransactionData.fromXDR(td, 'base64');
	const fp = d.resources().footprint();
	const kinds = k => k.map(x => x.switch().name + (x.switch().name === 'contractData' ? ':' + x.contractData().key().switch().name : ''));
	return {readOnly: kinds(fp.readOnly()), readWrite: kinds(fp.readWrite()), instructions: d.resources().instructions(), readBytes: d.resources().diskReadBytes?.() ?? d.resources().readBytes?.()};
}

function vaultEntry(signer, address, fn, args, exp, mutate = 'none', nonce) {
	const inv = invocationFor(vault, fn, args);
	return {entry: ed25519Entry({signer, address, invocation: inv, expiration: exp, mutate, nonce}), inv};
}
function accountEntry(fn, args, exp, mutate = 'none', nonce) {
	const inv = invocationFor(vault, fn, args);
	return policyEntry({signer: owner, accountId: policy, invocation: inv, expiration: exp, mutate, nonce});
}

// Calibrated (run-0 calibration) expectations -> TA7 §1.4 result states.
const text = c => `${c.error ?? ''}`;
const ok = c => c.success;
const rejects = {
	'ED-2': c => /Error\(Auth, InvalidAction\)/.test(text(c)) && /Unauthorized function call for address/.test(text(c)) && !/failed account authentication/.test(text(c)),
	'ED-3': c => /failed account authentication/.test(text(c)) && /Error\(Crypto, InvalidInput\)/.test(text(c)) && /failed ED25519 verification/.test(text(c)),
	'ED-4': c => /Error\(Auth, InvalidInput\)/.test(text(c)) && /signature has expired/.test(text(c)),
	'ED-5': c => /Error\(Contract, #3\)/.test(text(c)) && !/Error\(Auth/.test(text(c)) && /admin_set/.test(text(c)),
	'CA-2': c => /failed account authentication/.test(text(c)) && text(c).includes(`contract:${policy}`) && /verify_sig_ed25519/.test(text(c)),
	'CA-4': c => /failed account authentication/.test(text(c)) && /Error\(Contract, #12\)/.test(text(c)) && /__check_auth/.test(text(c)),
};
const control = {'ED-2': 'ED-1', 'ED-3': 'ED-1', 'ED-4': 'ED-1', 'ED-5': 'C-ED5', 'CA-2': 'CA-1', 'CA-4': 'CA-3'};
const policyEvent = c => c.events.some(e => (e.topics ?? []).some(t => t.includes('policy_ok')));
function verdict(cases) {
	const v = {};
	for (const id of ['ED-1', 'C-ED5', 'CA-1', 'CA-3']) {
		v[id] = {expected: 'success', state: ok(cases[id]) ? 'expected_success' : 'unexpected_rejection'};
	}
	v['CA-1'].policyEvent = policyEvent(cases['CA-1']);
	v['CA-3'].policyEvent = policyEvent(cases['CA-3']);
	if (v['CA-3'].state === 'expected_success' && !v['CA-3'].policyEvent) v['CA-3'].state = 'inconclusive';
	for (const [id, match] of Object.entries(rejects)) {
		const c = cases[id];
		const ctl = v[control[id]]?.state === 'expected_success';
		v[id] = {expected: 'rejection', control: control[id], controlOk: ctl,
			state: ok(c) ? 'unexpected_acceptance' : match(c) && ctl ? 'expected_rejection' : 'inconclusive'};
	}
	return v;
}

const all = [];
for (let run = 1; run <= runs; run++) {
	const L = await latestLedger();
	const exp = L + 50;
	const out = {run, ledger: L, expiration: exp, cases: {}};
	const A = actorA.publicKey(), B = actorB.publicKey(), ADM = admin.publicKey();
	const argsA = [addr(A), u32(7)];
	const rec = async (id, fn, args, entries, extra = {}) => {
		const s = await sim(fn, args, entries, 'enforce', extra.contract);
		out.cases[id] = {...digest(s, L), mode: 'enforce', actor: extra.actor, source: relay.publicKey()};
	};
	await rec('ED-1', 'protected_set', argsA, [vaultEntry(actorA, A, 'protected_set', argsA, exp).entry], {actor: A});
	await rec('ED-2', 'protected_set', argsA, [], {actor: A});
	await rec('ED-3', 'protected_set', argsA, [vaultEntry(actorA, A, 'protected_set', argsA, exp, 'badsig').entry], {actor: A});
	await rec('ED-3b-otherkey', 'protected_set', argsA, [vaultEntry(actorA, A, 'protected_set', argsA, exp, 'otherkey').entry], {actor: A});
	await rec('ED-4', 'protected_set', argsA, [vaultEntry(actorA, A, 'protected_set', argsA, L - 10).entry], {actor: A});
	const argsB = [addr(B), u32(1)];
	await rec('ED-5', 'admin_set', argsB, [vaultEntry(actorB, B, 'admin_set', argsB, exp).entry], {actor: B});
	const argsAdm = [addr(ADM), u32(1)];
	await rec('C-ED5', 'admin_set', argsAdm, [vaultEntry(admin, ADM, 'admin_set', argsAdm, exp).entry], {actor: ADM});
	const argsC7 = [addr(policy), u32(7)];
	await rec('CA-1', 'protected_set', argsC7, [accountEntry('protected_set', argsC7, exp)], {actor: policy});
	await rec('CA-2', 'protected_set', argsC7, [accountEntry('protected_set', argsC7, exp, 'badsig')], {actor: policy});
	const argsC100 = [addr(policy), u32(100)];
	await rec('CA-3', 'protected_set', argsC100, [accountEntry('protected_set', argsC100, exp)], {actor: policy});
	const argsC101 = [addr(policy), u32(101)];
	await rec('CA-4', 'protected_set', argsC101, [accountEntry('protected_set', argsC101, exp)], {actor: policy});
	await rec('CA-4b-fn', 'admin_set', [addr(policy), u32(1)], [accountEntry('admin_set', [addr(policy), u32(1)], exp)], {actor: policy});
	out.verdict = verdict(out.cases);
	all.push(out);
	console.log(`run ${run}:`, Object.entries(out.verdict).map(([k, v]) => `${k}=${v.state}`).join(' '));
}
save(dir, `${tag}-enforce-simulation.json`, {transportRetries: transport.retries, rpc: 'https://soroban-testnet.stellar.org', mode: 'enforce', actors: {A: actorA.publicKey(), B: actorB.publicKey(), admin: admin.publicKey(), relay: relay.publicKey()}, runs: all});
