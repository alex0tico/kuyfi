import test from 'ava';
import {StrKey} from '@stellar/stellar-sdk';
import {AuthzConfigError, loadAuthzMatrix, parseAuthzMatrix} from './config.js';

const C = StrKey.encodeContract(Buffer.alloc(32, 1));
const base = () => ({
	version: 1,
	id: 'm1',
	actors: {A: {source: 'ephemeral'}},
	cases: [
		{
			id: 'c1',
			call: {contractId: C, function: 'f', args: [{actor: 'A'}]},
			authorization: [{actor: 'A', variant: 'valid'}],
		},
	],
});

test('a minimal matrix is valid and defaults to simulate-only', t => {
	const m = parseAuthzMatrix(base());
	t.is(m.mode, 'simulate-only');
	t.is(m.cases[0]!.authorization[0]!.variant, 'valid');
});

test('broadcast requires authorizationRecord', t => {
	const error = t.throws(
		() => parseAuthzMatrix({...base(), mode: 'broadcast'}),
		{instanceOf: AuthzConfigError},
	);
	t.regex(error!.message, /requires authorizationRecord/);
});

test('secrets cannot be placed in the file: only source "env" with a variable NAME', t => {
	const error = t.throws(
		() =>
			parseAuthzMatrix({
				...base(),
				actors: {A: {source: 'file', secret: 'SABC'}},
			}),
		{instanceOf: AuthzConfigError},
	);
	t.regex(error!.message, /secrets never go in the file/);
	t.throws(() =>
		parseAuthzMatrix({
			...base(),
			actors: {A: {source: 'env', secretEnv: 'lowercase'}},
		}),
	);
});

test('every problem is reported: unknown keys, unknown actor, bad variant, bad contract id, dangling control, duplicate id', t => {
	const bad = {
		...base(),
		extra: 1,
		cases: [
			{
				id: 'c1',
				call: {contractId: 'nope', function: 'f', args: [{actor: 'Z'}]},
				authorization: [{actor: 'A', variant: 'weird'}],
				control: 'ghost',
			},
			{
				id: 'c1',
				call: {contractId: C, function: 'f', args: []},
				authorization: [],
			},
		],
	};
	const error = t.throws(() => parseAuthzMatrix(bad), {
		instanceOf: AuthzConfigError,
	});
	const text = error!.problems.join('|');
	for (const piece of [
		'unknown key "extra"',
		'valid contract id',
		'unknown actor "Z"',
		'variant invalid',
		'control "ghost"',
		'duplicated',
	])
		t.true(text.includes(piece), `${piece}`);
});

test('expect stages are validated', t => {
	const m = base();
	(m.cases[0] as Record<string, unknown>)['expect'] = {
		outcome: 'rejection',
		stage: 'made_up',
	};
	t.throws(() => parseAuthzMatrix(m), {instanceOf: AuthzConfigError});
});

test('loadAuthzMatrix maps file and JSON errors to AuthzConfigError', async t => {
	await t.throwsAsync(
		loadAuthzMatrix('/x', async () => {
			throw new Error('ENOENT');
		}),
		{message: /cannot read/},
	);
	await t.throwsAsync(
		loadAuthzMatrix('/x', async () => '{no'),
		{message: /not valid JSON/},
	);
	const loaded = await loadAuthzMatrix('/x', async () =>
		JSON.stringify(base()),
	);
	t.is(loaded.id, 'm1');
});

test('custom account spec: valid contract id required; unknown account keys rejected', t => {
	const m = base();
	(m.cases[0]!.authorization[0] as Record<string, unknown>)['account'] = {
		contractId: 'nope',
	};
	t.throws(() => parseAuthzMatrix(m), {
		instanceOf: AuthzConfigError,
		message: /account\.contractId/,
	});
	const m2 = base();
	(m2.cases[0]!.authorization[0] as Record<string, unknown>)['account'] = {
		contractId: C,
		extra: 1,
	};
	t.throws(() => parseAuthzMatrix(m2), {message: /unknown key "extra"/});
	const m3 = base();
	(m3.cases[0]!.authorization[0] as Record<string, unknown>)['account'] = {
		contractId: C,
		publicKeyField: 'pk',
	};
	t.is(
		parseAuthzMatrix(m3).cases[0]!.authorization[0]!.account!.publicKeyField,
		'pk',
	);
});
