// One command, from scratch, on Testnet:  npm run authz:testnet
//
//   1. loads .env (optional; see .env.example, AUTHZ_* variables)
//   2. builds the fixture wasm if missing
//   3. deploys Vault, PolicyAccount, Executor and Router with fresh funded
//      Testnet accounts (or reuses a deployment given entirely by AUTHZ_*_ID)
//   4. renders matrix/templates/*.template.json -> a temp dir ({{VAULT_ID}} ...)
//   5. runs `kuyfi authz` on every rendered matrix; evidence goes to AUTHZ_OUT_DIR
//
// Secrets live only in this process and in the child env; nothing secret is
// printed or written. Rendered matrices hold real ids: they stay in a temp dir
// that is removed at the end, and the default evidence dir is git-ignored.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Keypair, nativeToScVal} from '@stellar/stellar-sdk';
import {addr, fund, uploadAndDeploy} from './spike/harness.mjs';
import {render} from './render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
try {
	process.loadEnvFile(path.join(repoRoot, '.env'));
} catch {
	// No .env: everything has a default or is generated.
}

const env = process.env;
const log = m => console.log(`[authz:testnet] ${m}`);
const runId = env.AUTHZ_RUN_ID || `run-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const outDir = path.resolve(repoRoot, env.AUTHZ_OUT_DIR || path.join('test-fixtures', 'authz-fixtures', 'evidence', runId));
const skipOnchain = ['1', 'true'].includes(env.AUTHZ_SKIP_ONCHAIN ?? '');

const idVars = ['AUTHZ_VAULT_ID', 'AUTHZ_POLICY_ID', 'AUTHZ_ROUTER_ID', 'AUTHZ_EXECUTOR_ID'];
const given = idVars.filter(v => env[v]);
if (given.length > 0 && given.length < idVars.length) {
	throw new Error(`Set all of ${idVars.join(', ')} to reuse a deployment, or none to deploy from scratch.`);
}

const reuse = given.length === idVars.length;
const secretVars = ['AUTHZ_ADMIN_SECRET', 'AUTHZ_OWNER_SECRET'];
if (reuse && !secretVars.every(v => env[v])) {
	throw new Error(`Reusing a deployment also needs ${secretVars.join(' and ')}.`);
}

const wasmDir = path.join(here, 'target', 'wasm32v1-none', 'release');
const wasmNames = ['vault', 'policy_account', 'executor', 'router'];
if (!reuse && !wasmNames.every(n => existsSync(path.join(wasmDir, `${n}.wasm`)))) {
	log('building fixture wasm (cargo build --release --target wasm32v1-none)');
	const b = spawnSync('cargo', ['build', '--release', '--target', 'wasm32v1-none'], {cwd: here, stdio: 'inherit'});
	if (b.status !== 0) throw new Error('cargo build failed (needs: rustup target add wasm32v1-none)');
}

const values = {RUN_ID: runId};
const admin = env.AUTHZ_ADMIN_SECRET ? Keypair.fromSecret(env.AUTHZ_ADMIN_SECRET) : Keypair.random();
const owner = env.AUTHZ_OWNER_SECRET ? Keypair.fromSecret(env.AUTHZ_OWNER_SECRET) : Keypair.random();
values.ADMIN = admin.publicKey();
values.OWNER = owner.publicKey();

if (reuse) {
	log('reusing the deployment given by AUTHZ_*_ID');
	values.VAULT_ID = env.AUTHZ_VAULT_ID;
	values.POLICY_ID = env.AUTHZ_POLICY_ID;
	values.ROUTER_ID = env.AUTHZ_ROUTER_ID;
	values.EXECUTOR_ID = env.AUTHZ_EXECUTOR_ID;
} else {
	const relay = Keypair.random();
	values.RELAY = relay.publicKey();
	log('funding relay and admin with Friendbot (Testnet)');
	await fund(relay.publicKey());
	await fund(admin.publicKey());
	const wasm = n => readFileSync(path.join(wasmDir, `${n}.wasm`));
	log('deploying vault, policy_account, executor, router');
	values.VAULT_ID = (await uploadAndDeploy(relay, wasm('vault'), 'init', [addr(admin.publicKey())])).contractId;
	values.POLICY_ID = (await uploadAndDeploy(relay, wasm('policy_account'), 'init', [nativeToScVal(owner.rawPublicKey(), {type: 'bytes'})])).contractId;
	values.EXECUTOR_ID = (await uploadAndDeploy(relay, wasm('executor'))).contractId;
	values.ROUTER_ID = (await uploadAndDeploy(relay, wasm('router'), 'init', [addr(values.EXECUTOR_ID)])).contractId;
	values.ACTOR = Keypair.random().publicKey();
}

const cli = path.join(repoRoot, 'dist', 'cli.js');
if (!existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` (npm run authz:testnet does it for you)');

const tplDir = path.join(here, 'matrix', 'templates');
const work = mkdtempSync(path.join(tmpdir(), 'kuyfi-authz-'));
mkdirSync(outDir, {recursive: true});
let failed = 0;
try {
	const templates = readdirSync(tplDir).filter(f => f.endsWith('.template.json')).sort();
	for (const t of templates) {
		if (skipOnchain && t.includes('onchain')) continue;
		const file = path.join(work, t.replace('.template', ''));
		writeFileSync(file, render(readFileSync(path.join(tplDir, t), 'utf8'), values));
		log(`kuyfi authz ${t.replace('.template.json', '')}`);
		const r = spawnSync(process.execPath, [cli, 'authz', file, '--out', outDir], {
			stdio: 'inherit',
			env: {...env, KUYFI_AUTHZ_ADMIN_SECRET: admin.secret(), KUYFI_AUTHZ_OWNER_SECRET: owner.secret()},
		});
		if (r.status !== 0) failed++;
	}
} finally {
	rmSync(work, {recursive: true, force: true});
}

log(`evidence in ${outDir}`);
process.exitCode = failed > 0 ? 1 : 0;
