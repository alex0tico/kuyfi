// Read-only: prints the error enum declared in a contract's own spec (code -> name). No network writes.
import {rpc, contract} from '@stellar/stellar-sdk';
const id = process.argv[2];
const wasm = await new rpc.Server('https://soroban-testnet.stellar.org').getContractWasmByContractId(id);
const spec = contract.Spec.fromWasm ? contract.Spec.fromWasm(wasm) : null;
const out = {contractId: id, errors: {}};
for (const e of spec.entries) if (e.switch().name === 'scSpecEntryUdtErrorEnumV0') { const en = e.udtErrorEnumV0(); out.errors[en.name().toString()] = en.cases().map(c => ({code: c.value(), name: c.name().toString()})); }
console.log(JSON.stringify(out, null, 1));
