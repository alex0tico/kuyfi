// Step 2: does Testnet RPC honour authMode? Raw JSON-RPC, public data only.
import {readFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {addr, buildInvoke, ed25519Entry, evidenceDir, invocationFor, latestLedger, rawRpc, save, server, u32} from './harness.mjs';

const runId = process.argv[2];
const dir = evidenceDir(runId);
const pub = JSON.parse(readFileSync(`${dir}/setup.json`));
const keys = JSON.parse(readFileSync(process.argv[3]));
const relay = Keypair.fromSecret(keys.relay);
const actor = Keypair.random();
const account = await server.getAccount(relay.publicKey());
const vault = pub.vault.contractId;
const args = [addr(actor.publicKey()), u32(7)];
const noAuth = buildInvoke(account, vault, 'protected_set', args);
const ledger = await latestLedger();
const inv = invocationFor(vault, 'protected_set', args);
const entry = ed25519Entry({signer: actor, address: actor.publicKey(), invocation: inv, expiration: ledger + 50});
account.incrementSequenceNumber?.();
const withAuth = buildInvoke(await server.getAccount(relay.publicKey()), vault, 'protected_set', args, [entry]);

const out = {ledger, probes: {}};
for (const [name, tx, mode] of [
	['noauth_default', noAuth, undefined],
	['noauth_record', noAuth, 'record'],
	['noauth_enforce', noAuth, 'enforce'],
	['noauth_bogus', noAuth, 'definitely_not_a_mode'],
	['signed_default', withAuth, undefined],
	['signed_enforce', withAuth, 'enforce'],
	['signed_record', withAuth, 'record'],
]) {
	const params = {transaction: tx.toXDR(), ...(mode ? {authMode: mode} : {})};
	const res = await rawRpc('simulateTransaction', params);
	out.probes[name] = {
		mode: mode ?? '(omitted)',
		rpcError: res.error,
		error: res.result?.error,
		authReturned: res.result?.results?.[0]?.auth?.length,
		returnValue: res.result?.results?.[0]?.xdr ? 'present' : undefined,
		events: res.result?.events?.length,
		latestLedger: res.result?.latestLedger,
	};
}
save(dir, 'probe-authmode.json', out);
console.log(JSON.stringify(out, null, 2));
