// Demo helper: Friendbot-funds the admin key of a deployment so it can act as an Ed25519 actor.
// usage: node fund_admin.mjs <run> <keys.json>
import {readFileSync} from 'node:fs';
import {Keypair} from '@stellar/stellar-sdk';
import {fund} from './harness.mjs';

const keys = JSON.parse(readFileSync(process.argv[3]));
await fund(Keypair.fromSecret(keys.admin).publicKey());
console.log('admin funded');
