// Read-only: simulates no-argument getter functions and reads the contract's ledger entry. Sends nothing.
// usage: node readonly_probe.mjs <CONTRACT_ID> <fn> [<fn>...]
import {Account, Contract, Keypair, Networks, TransactionBuilder, rpc, scValToNative, xdr} from '@stellar/stellar-sdk';
const [id, ...fns] = process.argv.slice(2);
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const latest = await server.getLatestLedger();
const out = {contractId: id, probedAt: new Date().toISOString(), latestLedger: latest.sequence, results: {}};
const inst = await server.getLedgerEntries(xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract: new (await import('@stellar/stellar-sdk')).Address(id).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent()})));
const e = inst.entries[0];
out.instance = e ? {lastModifiedLedgerSeq: e.lastModifiedLedgerSeq, liveUntilLedgerSeq: e.liveUntilLedgerSeq, executable: e.val.contractData().val().instance().executable().switch().name} : null;
for (const fn of fns) {
	const src = Keypair.random(); // throwaway key, used only as simulation source, never funded or logged
	const tx = new TransactionBuilder(new Account(src.publicKey(), '0'), {fee: '100', networkPassphrase: Networks.TESTNET}).addOperation(new Contract(id).call(fn)).setTimeout(30).build();
	const sim = await server.simulateTransaction(tx);
	out.results[fn] = rpc.Api.isSimulationSuccess(sim) ? {ok: true, value: scValToNative(sim.result.retval)} : {ok: false, error: String(sim.error).slice(0, 300)};
}
console.log(JSON.stringify(out, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1));
