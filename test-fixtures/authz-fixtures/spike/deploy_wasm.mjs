// Deploy a no-init WASM (e.g. D1 control fixture) with a fresh Friendbot relay.
// usage: node deploy_wasm.mjs <wasm> <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {fund, uploadAndDeploy} from './harness.mjs';

const relay = Keypair.random();
await fund(relay.publicKey());
const result = await uploadAndDeploy(relay, readFileSync(process.argv[2]));
const pub = {network: 'testnet', deployedAt: new Date().toISOString(), relay: relay.publicKey(), ...result};
writeFileSync(process.argv[3], JSON.stringify(pub, null, 2) + '\n');
console.log(JSON.stringify(pub, null, 2));
