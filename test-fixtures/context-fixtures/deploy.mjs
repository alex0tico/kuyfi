// Deploys S1 RoleGate (init with a fresh operator address) and S2 PingTarget +
// HookCaller on Testnet. The operator never signs anything (no require_auth), so
// its secret is discarded. usage: node deploy.mjs <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {addr, fund, uploadAndDeploy} from '../authz-fixtures/spike/harness.mjs';

const root = new URL('./target/wasm32v1-none/release/', import.meta.url);
const wasm = n => readFileSync(new URL(`${n}.wasm`, root));
const relay = Keypair.random();
const operator = Keypair.random().publicKey();
await fund(relay.publicKey());
const roleGate = await uploadAndDeploy(relay, wasm('role_gate'), 'init', [addr(operator)]);
const pingTarget = await uploadAndDeploy(relay, wasm('ping_target'));
const hookCaller = await uploadAndDeploy(relay, wasm('hook_caller'));
const out = {network: 'testnet', deployedAt: new Date().toISOString(), relay: relay.publicKey(), operator, roleGate, pingTarget, hookCaller};
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
