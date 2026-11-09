// Does enforce-mode simulation without entries accept an actor == tx source (implicit auth)?
// And does it reject an actor != source? (mirrors what a broadcast tx would do)
import {readFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {addr, buildInvoke, evidenceDir, rawRpc, save, server, u32} from './harness.mjs';

const [runId, keysPath] = process.argv.slice(2);
const dir = evidenceDir(runId);
const pub = JSON.parse(readFileSync(`${dir}/setup.json`));
const relay = Keypair.fromSecret(JSON.parse(readFileSync(keysPath)).relay);
const other = Keypair.random().publicKey();
const out = {};
for (const [name, actor] of [['actor_is_source', relay.publicKey()], ['actor_is_other', other]]) {
	for (const mode of [undefined, 'enforce']) {
		const tx = buildInvoke(await server.getAccount(relay.publicKey()), pub.vault.contractId, 'protected_set', [addr(actor), u32(1)]);
		const r = await rawRpc('simulateTransaction', {transaction: tx.toXDR(), ...(mode ? {authMode: mode} : {})});
		out[`${name}/${mode ?? 'omitted'}`] = {rpcVersionHint: 'testnet', error: r.result?.error?.split('\n')[0], ok: !r.result?.error && !r.error, authReturned: r.result?.results?.[0]?.auth?.length};
	}
}
save(dir, 'source-actor-enforce.json', out);
console.log(JSON.stringify(out, null, 1));
