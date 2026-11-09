// Read-only: summarises STORED evidence (no network, no writes). usage: node summarize_stored.mjs authz|real
import {existsSync, readFileSync, readdirSync} from 'node:fs';
const kind = process.argv[2];
if (kind === 'd1') {
	const base = 'test-fixtures/baseline-evidence/context-fixtures';
	console.log('Config (contexto) usado por el brazo C de S1:');
	console.log(readFileSync(`${base}/configs/S1-C.json`, 'utf8'));
	console.log('Observable por brazo (run 1 de 3; las 3 corridas dan lo mismo). A = v0.1.0, B = sprint sin contexto, C = sprint con contexto:');
	for (const sc of ['S1', 'S2']) for (const arm of ['armA-v0.1.0', 'armB-sprint', 'armC-sprint']) {
		const res = JSON.parse(readFileSync(`${base}/${sc}/${arm}/run1.result.json`, 'utf8'));
		const rep = JSON.parse(readFileSync(`${base}/${sc}/${arm}/run1.json`, 'utf8'));
		console.log(`  ${sc} ${arm.padEnd(12)} observable ${res.observable}: ${res.observableEvents} evento(s) | difundidas ${res.report.broadcast}  procedencia=${rep.provenance ? rep.provenance.audit.percent + '%' : 'n/a (v0.1.0)'}  limites=${rep.campaign ? rep.campaign.mode + ', blockedSends ' + rep.campaign.blockedSends : 'n/a'}`);
	}
	console.log('\nLos HIGH que aparecen en el brazo C son HIPOTESIS de fixtures sin require_auth, no vulnerabilidades confirmadas.');
} else if (kind === 'authz') {
	const dir = 'test-fixtures/authz-fixtures/evidence/product-run-1';
	if (!existsSync(dir)) {
		console.log('local experiment data (test-fixtures/authz-fixtures) is not part of the public repository');
		process.exit(3);
	}
	for (const f of readdirSync(dir).sort()) {
		const r = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
		console.log(`${r.matrixId.padEnd(26)} ${r.mode.padEnd(13)} executed ${r.summary.executed}/${r.summary.total}, matrix-accepted ${r.summary.accepted}/${r.summary.total}  ${f.slice(-21, -5)}`);
		for (const c of r.cases) if (c.observed.onChain) console.log(`   on-chain ${c.id}: ${c.observed.onChain.status} ledger ${c.observed.onChain.ledger} tx ${c.observed.onChain.hash.slice(0, 12)}…`);
	}
	console.log('\n"matrix-accepted" = evaluation against the matrix; it is NOT the acceptance of D2.');
} else if (kind === 'real') {
	// Aggregates only: no Contract IDs, WASM hashes, function names or report contents (the public repository keeps just this file).
	const agg = JSON.parse(readFileSync('test-fixtures/baseline-evidence/real-contracts-aggregate/aggregate.json', 'utf8'));
	for (const c of agg.campaigns) {
		const out = {};
		for (const [k, n] of Object.entries(c.outcomePerVector)) out[k.startsWith('rejected:') ? `bloqueado por ${k.slice(9)}` : k === 'accepted' ? 'aceptado' : 'no ejecutado'] = n;
		console.log(`${c.id}: solo simulacion (${c.mode}), vectores ${c.vectorsExecuted}, transacciones difundidas ${c.broadcastTransactions}, procedencia ${c.provenancePercent}%, ejecutada ${c.executedAt.rerun.slice(0, 10)}`);
		console.log(`   resultado por vector ${JSON.stringify(out)}; no evaluados ${c.notEvaluated}; errores operativos ${c.operationalErrors}`);
		console.log(`   hallazgos por estado ${JSON.stringify(c.findingsByStatus)} (respaldados / hipotesis / inconclusos)`);
	}
	console.log('\nSin hallazgos, o solo inconclusos, NO es garantia de seguridad. La autorizacion es una confirmacion del solicitante.');
}
