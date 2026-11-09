// Recounts observable events over each recorded ledger window with the EXCLUSIVE-endLedger fix.
// The first-pass value is kept in observableEventsFirstPass. usage: node recount_events.mjs
import {readFileSync, readdirSync, writeFileSync, existsSync} from 'node:fs';
import {rpc, scValToNative} from '@stellar/stellar-sdk';
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const base = new URL('./context-fixtures/', import.meta.url).pathname;
for (const s of ['S1', 'S2']) for (const d of readdirSync(`${base}${s}`)) for (const f of readdirSync(`${base}${s}/${d}`).filter(x => x.endsWith('.result.json'))) {
	const p = `${base}${s}/${d}/${f}`;
	const r = JSON.parse(readFileSync(p));
	if (r.recountVersion === 2) continue;
	const res = await server.getEvents({startLedger: r.ledgerWindow.startLedger + 1, endLedger: r.ledgerWindow.endLedger + 1, filters: [{type: 'contract', contractIds: [r.target]}], limit: 200});
	const ev = res.events.filter(e => e.topic.some(t => { try { return scValToNative(t) === r.observable; } catch { return false; } }));
	r.observableEventsFirstPass ??= r.observableEvents;
	r.recountVersion = 2;
	r.observableEvents = ev.length;
	r.observableTxHashes = ev.map(e => e.txHash);
	r.recount = 'getEvents.endLedger is exclusive (first pass missed the last ledger) and consecutive windows shared the boundary ledger (counted from startLedger + 1)';
	writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
	console.log(p.split('context-fixtures/')[1], r.observableEventsFirstPass, '->', r.observableEvents);
}
