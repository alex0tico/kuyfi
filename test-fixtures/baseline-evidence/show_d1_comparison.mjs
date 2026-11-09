// Read-only: one-screen view of STORED D1 evidence (no network, no writes). usage: node show_d1_comparison.mjs
import {readFileSync} from 'node:fs';
const base = 'test-fixtures/baseline-evidence';
const load = f => JSON.parse(readFileSync(`${base}/${f}`, 'utf8'));
const arms = [['armA-v0.1.0', 'A  v0.1.0 (anterior)       '], ['armB-sprint', 'B  nueva, SIN contexto     '], ['armC-sprint', 'C  nueva, CON contexto     ']];
console.log('EVIDENCIA GUARDADA (21-oct-2026, Testnet, fixtures propias). Nada se ejecuta ahora.\n');
console.log('COMPARACION S1 / S2 - eventos del observable por corrida (3 corridas por brazo)');
for (const sc of ['S1', 'S2']) {
	for (const [dir, label] of arms) {
		const runs = [1, 2, 3].map(n => load(`context-fixtures/${sc}/${dir}/run${n}.result.json`));
		const hallazgos = [1, 2, 3].map(n => load(`context-fixtures/${sc}/${dir}/run${n}.json`).summary?.totalFindings ?? '-');
		console.log(`  ${sc}  ${label} ${runs[0].observable}: ${runs.map(r => r.observableEvents).join(' / ')}   hallazgos: ${hallazgos.join(' / ')}`);
	}
}
console.log('\nCONTROL vulnerable / protegido - hallazgos por funcion (3 corridas por brazo)');
for (const [dir, label] of [['armA-v0.1.0', 'A  v0.1.0 (anterior)       '], ['armB-sprint', 'B  nueva (build abcb6a4)  ']]) {
	const reps = [1, 2, 3].map(n => load(`control/${dir}/run${n}.json`));
	const per = fn => reps.map(r => r.findings.filter(f => f.functionName === fn).length).join(' / ');
	console.log(`  ${label} set_admin_value (vulnerable): ${per('set_admin_value')}   secure_set_admin_value (protegida): ${per('secure_set_admin_value')}`);
}
console.log('\nLectura: sin contexto el observable queda en 0; con contexto llega 6 veces (S1) y 1 vez (S2).');
console.log('En el control la funcion vulnerable da hallazgo y la protegida ninguno. Son fixtures propias: una observacion, no una medida de efectividad.');
