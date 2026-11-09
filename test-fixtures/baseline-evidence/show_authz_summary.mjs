// Read-only: one-screen view of STORED `kuyfi authz` results (no network, no writes). usage: node show_authz_summary.mjs
import {existsSync, readFileSync, readdirSync} from 'node:fs';
const dir = 'test-fixtures/authz-fixtures/evidence/product-run-1';
if (!existsSync(dir)) {
	console.log('local experiment data (test-fixtures/authz-fixtures) is not part of the public repository');
	process.exit(3);
}
const reports = readdirSync(dir).sort().map(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const exp = c => (c.expectation.outcome === 'success' ? 'exito' : `rechazo/${c.expectation.stage}`);
const obs = c => (c.observed.outcome === 'success' ? 'exito' : `rechazo/${c.observed.stage}`);
const label = c => c.description.split(/ \(| ->|;| - /)[0].slice(0, 36);
const row = c => `  ${c.id.padEnd(6)} ${label(c).padEnd(36)} ${exp(c).padEnd(30)} ${obs(c).padEnd(30)} ${c.evaluation.accepted ? 'OK' : 'NO'}`;
const order = cs => [...cs].sort((x, y) => ['ED', 'CA', 'NA'].findIndex(k => x.id.includes(k)) - ['ED', 'CA', 'NA'].findIndex(k => y.id.includes(k)));
const isCommitted = c => /^(ED|CA|NA)-\d$/.test(c.id);
const sim = reports.filter(r => r.mode === 'simulate-only');
const chain = reports.filter(r => r.mode === 'broadcast');
console.log('EVIDENCIA GUARDADA de kuyfi authz (22-oct-2026, Testnet, fixtures propias). Nada se ejecuta ahora.\n');
const names = [...new Set(sim.map(r => r.matrixId))];
console.log(`Simulacion en modo enforcing; cada matriz se corrio ${sim.filter(r => r.matrixId === names[0]).length} veces con resultados identicos.`);
const first = n => sim.find(r => r.matrixId === n);
const head = `  ${'caso'.padEnd(6)} ${'que se prueba'.padEnd(36)} ${'ESPERADO'.padEnd(30)} ${'OBSERVADO'.padEnd(30)}`;
console.log('\nCASOS COMPROMETIDOS (12)');
console.log(head);
for (const c of order(names.flatMap(n => first(n).cases.filter(isCommitted)))) console.log(row(c));
console.log('\nCONTROLES ADICIONALES (no cuentan entre los 12)');
console.log(head);
for (const c of order(names.flatMap(n => first(n).cases.filter(c => !isCommitted(c))))) console.log(row(c));
console.log('\nEVIDENCIA ON-CHAIN (transaccion incluida en Testnet y estado leido)');
for (const r of chain) for (const c of r.cases) console.log(`  ${c.id.padEnd(13)} ${c.observed.onChain.status} en el ledger ${c.observed.onChain.ledger}; estado ${c.observed.onChain.stateBefore ?? 'vacio'} -> ${c.observed.onChain.stateAfter}`);
console.log('\n"OK" = coincide con la matriz esperada. NO es la aceptacion del entregable D2.');
