// Read-only: fetches a Testnet contract's WASM, hashes it and runs KUYFI's own scanner (no transactions).
// usage (after npm run build): node test-fixtures/baseline-evidence/verify_contract.mjs <CONTRACT_ID>
import {createHash} from 'node:crypto';
import {rpc} from '@stellar/stellar-sdk';
import {scanContract} from '../../dist/modules/scanner.js';
const id = process.argv[2];
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const wasm = await server.getContractWasmByContractId(id);
const r = await scanContract(id, server);
const out = {contractId: id, network: 'testnet', verifiedAt: new Date().toISOString(), tool: 'dist/modules/scanner.js @ instawards-2/week-1', wasmSha256: createHash('sha256').update(wasm).digest('hex'), bytecodeSize: r.bytecodeSize, functionCount: r.functions.length, functions: r.functions.map(f => ({name: f.name, params: f.params.map(p => p.name)})), udtCount: r.udtRegistry.size};
console.log(JSON.stringify(out, null, 1));
