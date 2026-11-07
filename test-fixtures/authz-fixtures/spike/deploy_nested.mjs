// Deploy-only for the definitive run: Executor + Router of a deployment, no experiments.
// usage: node deploy_nested.mjs <run> <keys.json>   -> evidence/<run>/nested-setup.json (public identifiers only)
import {readFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {addr, evidenceDir, fund, save, uploadAndDeploy} from './harness.mjs';

const [runId, keysPath] = process.argv.slice(2);
const keys = JSON.parse(readFileSync(keysPath));
const relay = Keypair.fromSecret(keys.relay);
const root = new URL('../target/wasm32v1-none/release/', import.meta.url);
const executor = await uploadAndDeploy(relay, readFileSync(new URL('executor.wasm', root)));
const router = await uploadAndDeploy(relay, readFileSync(new URL('router.wasm', root)), 'init', [addr(executor.contractId)]);
const actor = Keypair.random();
await fund(actor.publicKey());
save(evidenceDir(runId), 'nested-setup.json', {relay: relay.publicKey(), actor: actor.publicKey(), executor, router});
console.log('nested deployed');
