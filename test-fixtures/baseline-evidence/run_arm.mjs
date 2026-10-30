// Runs one KUYFI campaign for the D1 comparison and records a self-describing result.
// usage: node run_arm.mjs --arm A|B|C --scenario S1|S2 --kind formal|smoke --run N \
//          --bin <kuyfi bin> [--config <ctx.json>] [--src-repo <git repo>] --out <dir>
// Preconditions are VERIFIED (read-only simulation) before the run; the observable
// (role_ok / hook_ok events emitted by the fixture) is counted from RPC getEvents
// over the ledger window of the run. Nothing here signs or writes secrets.
import {execFileSync, spawnSync} from 'node:child_process';
import {closeSync, rmSync, mkdirSync, openSync, unlinkSync, readFileSync, readdirSync, writeFileSync, copyFileSync} from 'node:fs';
import path from 'node:path';
import {Address, Keypair, TransactionBuilder, Account, Operation, Networks, rpc, scValToNative, xdr} from '@stellar/stellar-sdk';

// One campaign at a time: concurrent runs would pollute the event window and the fixtures' state.
const LOCK = '/tmp/kuyfi-run-arm.lock';
try {
	closeSync(openSync(LOCK, 'wx'));
} catch {
	console.error('Another run_arm.mjs holds the lock', LOCK);
	process.exit(4);
}
process.on('exit', () => { try { unlinkSync(LOCK); } catch {} });
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const dep = JSON.parse(readFileSync(new URL('./context-fixtures/deployment.json', import.meta.url)));
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const scenario = args.scenario;
const ctrl = scenario === 'CTRL' ? JSON.parse(readFileSync(new URL('./control/deployment.json', import.meta.url))) : undefined;
const target = ctrl ?? (scenario === 'S1' ? dep.roleGate : dep.hookCaller);
const observable = scenario === 'S1' ? 'role_ok' : scenario === 'S2' ? 'hook_ok' : 'none';

async function readonly(contractId, fn) {
	const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), '0'), {fee: '100', networkPassphrase: Networks.TESTNET})
		.addOperation(Operation.invokeContractFunction({contract: contractId, function: fn, args: []})).setTimeout(30).build();
	const sim = await server.simulateTransaction(tx);
	if (!rpc.Api.isSimulationSuccess(sim)) return {error: String(sim.error ?? 'sim failed').split('\n')[0]};
	return {value: scValToNative(sim.result.retval)};
}

const pre = {};
if (scenario === 'CTRL') {
	pre.ok = true;
} else if (scenario === 'S1') {
	const op = await readonly(dep.roleGate.contractId, 'get_operator');
	pre.operatorStored = op.value;
	pre.operatorExpected = dep.operator;
	pre.ok = op.value === dep.operator;
	pre.valueBefore = String((await readonly(dep.roleGate.contractId, 'get_value')).value);
} else {
	const ping = await readonly(dep.pingTarget.contractId, 'ping');
	pre.pingTargetAnswer = ping.value;
	pre.ok = ping.value === 42;
}
if (!pre.ok) {
	console.error('PRECONDITION FAILED', JSON.stringify(pre));
	process.exit(3);
}

const srcRepo = args['src-repo'];
const code = {};
if (srcRepo) {
	const git = a => execFileSync('git', ['-C', srcRepo, ...a], {encoding: 'utf8'}).trim();
	code.commit = git(['rev-parse', 'HEAD']);
	code.branch = git(['branch', '--show-current']);
	code.dirty = git(['status', '--porcelain', '--', 'source', 'package.json', 'package-lock.json']) !== '';
	if (code.dirty) {
		const patch = git(['diff', 'HEAD', '--', 'source', 'package.json', 'package-lock.json']);
		code.dirtyPatchSha256 = (await import('node:crypto')).createHash('sha256').update(patch).digest('hex');
		mkdirSync(args.out, {recursive: true});
		writeFileSync(path.join(args.out, `run${args.run}.dirty.patch`), patch + '\n');
	}
} else {
	code.package = JSON.parse(readFileSync(path.join(path.dirname(args.bin), '..', '@kuyfi', 'kuyfi', 'package.json'), 'utf8').toString());
	code.package = {name: code.package.name, version: code.package.version, gitHead: code.package.gitHead};
}

// A transaction submitted after this point can only land in a LATER ledger, so events are counted from startLedger + 1
// (consecutive runs share the boundary ledger otherwise).
const startLedger = (await server.getLatestLedger()).sequence;
const runDir = path.resolve(args.out, `run${args.run}.work`);
mkdirSync(runDir, {recursive: true});
const startedAt = new Date().toISOString();
const cliArgs = [target.contractId, '--json', ...(args.config ? ['--config', args.config] : [])];
const [cmd, cmdArgs] = args.bin.endsWith('.js') && !args.bin.includes('node_modules/.bin') ? [process.execPath, [args.bin, ...cliArgs]] : [args.bin, cliArgs];
const proc = spawnSync(cmd, cmdArgs, {cwd: runDir, encoding: 'utf8', timeout: 900_000});
const endLedger = (await server.getLatestLedger()).sequence; // getEvents.endLedger is EXCLUSIVE: query endLedger + 1
const reportFile = readdirSync(runDir).find(f => f.endsWith('.json'));
let report;
if (reportFile) {
	copyFileSync(path.join(runDir, reportFile), path.join(args.out, `run${args.run}.json`));
	report = JSON.parse(readFileSync(path.join(runDir, reportFile), 'utf8'));
}

let observed = 0;
if (scenario === 'CTRL') pre.note = 'control: success is judged on findings per function, no event observable';
let events = [];
try {
	const res = scenario === 'CTRL' ? {events: []} : await server.getEvents({startLedger: startLedger + 1, endLedger: endLedger + 1, filters: [{type: 'contract', contractIds: [target.contractId]}], limit: 200});
	events = res.events.filter(e => e.topic.some(t => { try { return scValToNative(t) === observable; } catch { return false; } }));
	observed = events.length;
} catch (error) {
	pre.eventQueryError = String(error.message ?? error);
}

const result = {
	arm: args.arm, scenario, kind: args.kind, run: Number(args.run), startedAt, exitCode: proc.status,
	stderr: proc.stderr?.slice(0, 400) || undefined, code, target: target.contractId, wasmHash: target.wasmHash,
	preconditions: pre, ledgerWindow: {startLedger, endLedger}, observable, observableEvents: observed,
	observableTxHashes: events.map(e => e.txHash),
	report: report && {reportId: report.reportId, tool: report.tool, vectors: report.execution.vectorsExecuted, broadcast: report.execution.broadcastTransactions, summary: report.summary, findings: report.findings.map(f => `${f.functionName}::${f.vectorName}:${f.signal}:${f.severity}`)},
};
rmSync(runDir, {recursive: true, force: true});
writeFileSync(path.join(args.out, `run${args.run}.result.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({arm: args.arm, scenario, run: args.run, exit: proc.status, observed, findings: result.report?.findings, reportId: report?.reportId}));
