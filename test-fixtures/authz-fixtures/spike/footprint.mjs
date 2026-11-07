// Step 5: footprint of CA-1 in record (no entries) vs enforce (signed) simulation.
import {readFileSync} from 'node:fs';
import {Keypair, xdr} from '@stellar/stellar-sdk';
import {addr, buildInvoke, evidenceDir, invocationFor, latestLedger, policyEntry, rawRpc, save, server, u32} from './harness.mjs';

const [runId, keysPath] = process.argv.slice(2);
const dir = evidenceDir(runId);
const pub = JSON.parse(readFileSync(`${dir}/setup.json`));
const keys = JSON.parse(readFileSync(keysPath));
const relay = Keypair.fromSecret(keys.relay);
const owner = Keypair.fromSecret(keys.owner);
const vault = pub.vault.contractId;
const policy = pub.policy.contractId;
const args = [addr(policy), u32(7)];
const fp = td => {
	const d = xdr.SorobanTransactionData.fromXDR(td, 'base64');
	const f = d.resources().footprint();
	const name = k => k.switch().name === 'contractData' ? `contractData(${Buffer.from(k.contractData().contract().contractId()).toString('hex').slice(0, 8)}…,${k.contractData().key().switch().name})` : k.switch().name === 'contractCode' ? `contractCode(${Buffer.from(k.contractCode().hash()).toString('hex').slice(0, 8)}…)` : k.switch().name;
	return {readOnly: f.readOnly().map(name), readWrite: f.readWrite().map(name), instructions: d.resources().instructions()};
};
const L = await latestLedger();
const rec = await rawRpc('simulateTransaction', {transaction: buildInvoke(await server.getAccount(relay.publicKey()), vault, 'protected_set', args).toXDR()});
const entry = policyEntry({signer: owner, accountId: policy, invocation: invocationFor(vault, 'protected_set', args), expiration: L + 60});
const enf = await rawRpc('simulateTransaction', {transaction: buildInvoke(await server.getAccount(relay.publicKey()), vault, 'protected_set', args, [entry]).toXDR(), authMode: 'enforce'});
const out = {
	policyCodeHashPrefix: pub.policy.wasmHash.slice(0, 8), vaultCodeHashPrefix: pub.vault.wasmHash.slice(0, 8),
	recordNoEntries: {error: rec.result.error?.split('\n')[0], footprint: rec.result.transactionData && fp(rec.result.transactionData), authReturned: rec.result.results?.[0]?.auth?.length},
	enforceSigned: {error: enf.result.error?.split('\n')[0], footprint: fp(enf.result.transactionData)},
};
save(dir, 'footprint-record-vs-enforce.json', out);
console.log(JSON.stringify(out, null, 2));
