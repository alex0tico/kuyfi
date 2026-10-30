import test from 'ava';
import {selectCliMode} from '../cli_runtime.js';
import {runAuthzCli} from './cli.js';
import {AuthzConfigError} from './config.js';
import type {AuthzReport} from './run.js';
import type {AuthzMatrix} from './types.js';

const report = (): AuthzReport => ({
	schemaVersion: '1.0.0',
	kind: 'authz-matrix',
	matrixId: 'm1',
	generatedAt: '2026-10-22T12:00:00.000Z',
	tool: {name: 'kuyfi', version: '0.1.0'},
	environment: {network: 'testnet', rpcUrl: 'u', sdkVersion: 'x'},
	mode: 'simulate-only',
	accounts: {relay: 'GR', actors: {}},
	cases: [],
	summary: {total: 0, executed: 0, accepted: 0, byState: {}, note: 'n'},
});

test('selectCliMode: authz is a subcommand and cannot collide with a Contract ID', t => {
	t.deepEqual(selectCliMode(['authz', 'm.json']), {
		kind: 'authz',
		file: 'm.json',
	});
	t.deepEqual(selectCliMode(['authz']), {kind: 'authz', file: undefined});
	t.is(selectCliMode([]).kind, 'tui');
});

test('runAuthzCli: invalid matrix is a tool failure (exit 1) and nothing runs', async t => {
	let ran = false;
	const r = await runAuthzCli('m.json', {
		load: async () => {
			throw new AuthzConfigError(['bad']);
		},
		run: async () => {
			ran = true;
			return report();
		},
		writeFile: (async () => {}) as never,
	});
	t.is(r.exitCode, 1);
	t.regex(r.errorOutput!, /Invalid authz matrix/);
	t.false(ran);
});

test('runAuthzCli: writes the JSON evidence with the no-overwrite flag and exits 0', async t => {
	const writes: Array<{path: string; flag: unknown}> = [];
	const r = await runAuthzCli('m.json', {
		outDir: 'out',
		load: async () => ({
			version: 1,
			id: 'm1',
			mode: 'simulate-only',
			actors: {},
			cases: [],
		}),
		run: async () => report(),
		writeFile: (async (p: string, _d: unknown, o: {flag?: string}) => {
			writes.push({path: p, flag: o.flag});
		}) as never,
	});
	t.is(r.exitCode, 0);
	t.is(writes[0]!.flag, 'wx');
	t.regex(writes[0]!.path, /out\/kuyfi-authz-m1-20261022T120000Z\.json$/);
	t.regex(r.output!, /Executed 0\/0; accepted 0\/0/);
});

test('runAuthzCli: an existing evidence file is a tool failure, not an overwrite', async t => {
	const r = await runAuthzCli('m.json', {
		load: async () => ({
			version: 1,
			id: 'm1',
			mode: 'simulate-only',
			actors: {},
			cases: [],
		}),
		run: async () => report(),
		writeFile: (async () => {
			throw new Error('EEXIST');
		}) as never,
	});
	t.is(r.exitCode, 1);
	t.regex(r.errorOutput!, /EEXIST/);
});

const emptyMatrix: AuthzMatrix = {
	version: 1,
	id: 'm1',
	mode: 'simulate-only',
	actors: {},
	cases: [],
};

test('runAuthzCli: a failed attempt leaves a record with phase, matrix hash and no secrets', async t => {
	const secret = 'S' + 'A'.repeat(55);
	const writes: Array<{path: string; data: string; flag: unknown}> = [];
	const r = await runAuthzCli('dir/m.json', {
		outDir: 'out',
		now: () => new Date('2026-10-22T12:00:00.000Z'),
		read: async () => '{"matrix":"text"}',
		load: async (_f, read) => {
			await read!('dir/m.json', 'utf8');
			return emptyMatrix;
		},
		run: async () => {
			throw new Error(`friendbot unreachable for ${secret}`);
		},
		writeFile: (async (p: string, d: string, o: {flag?: string}) => {
			writes.push({path: p, data: d, flag: o.flag});
		}) as never,
	});
	t.is(r.exitCode, 1);
	t.is(writes.length, 1);
	t.is(writes[0]!.flag, 'wx');
	t.regex(
		writes[0]!.path,
		/out\/kuyfi-authz-failure-m1-20261022T120000Z\.json$/,
	);
	const rec = JSON.parse(writes[0]!.data) as {
		kind: string;
		phase: string;
		matrix: {file: string; sha256: string};
		error: {message: string};
	};
	t.is(rec.kind, 'authz-run-failure');
	t.is(rec.phase, 'run');
	t.is(rec.matrix.file, 'm.json');
	t.regex(rec.matrix.sha256, /^[0-9a-f]{64}$/);
	t.regex(rec.error.message, /friendbot unreachable/);
	t.false(writes[0]!.data.includes(secret));
	t.false(r.errorOutput!.includes(secret));
	t.is(r.reportFilePath, writes[0]!.path);
});

test('runAuthzCli: a failure before the matrix loads is recorded as phase "load"', async t => {
	const writes: string[] = [];
	await runAuthzCli('m.json', {
		load: async () => {
			throw new AuthzConfigError(['bad']);
		},
		writeFile: (async (_p: string, d: string) => {
			writes.push(d);
		}) as never,
	});
	t.is(JSON.parse(writes[0]!).phase, 'load');
});

test('runAuthzCli: if the failure record cannot be written the failure is still reported', async t => {
	const r = await runAuthzCli('m.json', {
		load: async () => {
			throw new AuthzConfigError(['bad']);
		},
		writeFile: (async () => {
			throw new Error('EEXIST');
		}) as never,
	});
	t.is(r.exitCode, 1);
	t.is(r.reportFilePath, null);
	t.regex(r.errorOutput!, /Invalid authz matrix/);
});

test('runAuthzCli: successful evidence carries the matrix file name and SHA-256', async t => {
	const writes: string[] = [];
	await runAuthzCli('dir/m.json', {
		read: async () => 'abc',
		load: async (_f, read) => {
			await read!('x', 'utf8');
			return emptyMatrix;
		},
		run: async () => report(),
		writeFile: (async (_p: string, d: string) => {
			writes.push(d);
		}) as never,
	});
	t.deepEqual(JSON.parse(writes[0]!).matrix, {
		file: 'm.json',
		// sha256("abc"), a published test vector
		sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	});
});
