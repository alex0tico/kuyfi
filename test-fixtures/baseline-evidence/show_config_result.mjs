// Read-only: shows a stored fixture config and an excerpt of the stored report it produced (no network, no writes). usage: node show_config_result.mjs
import {readFileSync} from 'node:fs';
const base = 'test-fixtures/baseline-evidence/context-fixtures';
const cfg = `${base}/configs/S1-C-simulate.json`;
const rep = `${base}/S1/armC-simulate-only-smoke/run1.json`;
const r = JSON.parse(readFileSync(rep, 'utf8'));
const {definition, ...audit} = r.provenance.audit;
console.log(`EVIDENCIA GUARDADA - fixture propia S1 (Testnet, ${r.generatedAt.slice(0, 10)}). Corrida de humo, no formal. Nada se ejecuta ahora.\n`);
console.log(`1) CONFIGURACION  (${cfg})`);
console.log(readFileSync(cfg, 'utf8'));
console.log(`2) RESULTADO  (${rep}, extracto)`);
const show = (k, v) => console.log(`"${k}": ${JSON.stringify(v)}`);
show('execution', {vectorsExecuted: r.execution.vectorsExecuted, broadcastTransactions: r.execution.broadcastTransactions});
show('campaign', {mode: r.campaign.mode, blockedSends: r.campaign.blockedSends, contextKeysUsed: r.campaign.contextKeysUsed});
show('provenance.audit', audit);
show('provenance.invocations[0]', r.provenance.invocations[0]);
show('coverage', {functionsWithZeroInvocations: r.coverage.functionsWithZeroInvocations, operationalErrors: r.coverage.operationalErrors, notEvaluated: r.coverage.notEvaluated.map(n => ({functionName: n.functionName, signal: n.signal}))});
