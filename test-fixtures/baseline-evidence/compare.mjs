// Builds the A/B/C table for S1/S2 from run*.result.json (formal runs only; smoke listed apart).
// usage: node compare.mjs > context-fixtures/COMPARISON.md
import {existsSync, readdirSync, readFileSync} from 'node:fs';
const base = new URL('./context-fixtures/', import.meta.url).pathname;
const arms = [['A', 'armA-v0.1.0', 'v0.1.0 (npm @kuyfi/kuyfi@0.1.0)'], ['B', 'armB-sprint', 'sprint, context off'], ['C', 'armC-sprint', 'sprint, context on']];
const out = ['# Comparación D1 — S1/S2 (tres brazos)', '', 'Unidad de comparación: función + vector + clasificación; el observable es el evento emitido por la fixture (`role_ok` / `hook_ok`) contado vía RPC `getEvents` en la ventana de ledgers de cada corrida. Es una observación, no una medida de efectividad.', ''];
for (const s of ['S1', 'S2']) {
	out.push(`## ${s}`, '', '| Brazo | Corrida | Commit / paquete | Observable | Vectores / broadcast | Hallazgos | Notas |', '|---|---|---|---|---|---|---|');
	for (const [arm, dir, label] of arms) {
		const d = `${base}${s}/${dir}`;
		if (!existsSync(d)) continue;
		for (const f of readdirSync(d).filter(x => x.endsWith('.result.json')).sort()) {
			const r = JSON.parse(readFileSync(`${d}/${f}`));
			const code = r.code.commit ? `${r.code.commit.slice(0, 7)}${r.code.dirty ? ' (dirty)' : ''}` : `${r.code.package?.version}@${r.code.package?.gitHead?.slice(0, 7)}`;
			const rep = r.report;
			out.push(`| ${arm} (${label}) | ${r.run} | ${code} | ${r.observableEvents} \`${r.observable}\` | ${rep?.vectors ?? '-'} / ${rep?.broadcast ?? '-'} | ${rep?.findings?.length ?? '-'}${rep?.findings?.length ? ': ' + rep.findings.join('; ') : ''} | exit ${r.exitCode} |`);
		}
	}
	out.push('');
}
const smoke = [];
for (const s of ['S1', 'S2']) for (const d of readdirSync(`${base}${s}`).filter(x => x.includes('smoke'))) smoke.push(`${s}/${d}`);
out.push('## Corridas de humo (no formales)', '', ...smoke.map(x => `- \`${x}\``));
console.log(out.join('\n'));
