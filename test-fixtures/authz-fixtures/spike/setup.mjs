// Step 1: fund relay, deploy fixtures, save public identifiers (no secrets in evidence).
// Ephemeral secrets go only to the scratch file given as argv[3] (mode 0600).
import {readFileSync, writeFileSync} from 'node:fs';
import {Keypair, nativeToScVal} from '@stellar/stellar-sdk';
import {addr, evidenceDir, fund, save, uploadAndDeploy} from './harness.mjs';

const runId = process.argv[2];
const dir = evidenceDir(runId);
const relay = Keypair.random();
const admin = Keypair.random();
const owner = Keypair.random(); // PolicyAccount registered key
await fund(relay.publicKey());
const root = new URL('../target/wasm32v1-none/release/', import.meta.url);
const vault = await uploadAndDeploy(relay, readFileSync(new URL('vault.wasm', root)), 'init', [addr(admin.publicKey())]);
const policy = await uploadAndDeploy(relay, readFileSync(new URL('policy_account.wasm', root)), 'init', [nativeToScVal(owner.rawPublicKey(), {type: 'bytes'})]);
const pub = {runId, relay: relay.publicKey(), admin: admin.publicKey(), owner: owner.publicKey(), vault, policy};
save(dir, 'setup.json', pub);
writeFileSync(process.argv[3], JSON.stringify({relay: relay.secret(), admin: admin.secret(), owner: owner.secret()}), {mode: 0o600});
console.log(JSON.stringify(pub, null, 2));
