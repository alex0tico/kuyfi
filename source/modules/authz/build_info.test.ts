import test from 'ava';
import {resolveCommit} from './build_info.js';

const SHA = 'a'.repeat(40);

test('KUYFI_COMMIT set by the operator wins over git', t => {
	t.is(
		resolveCommit({KUYFI_COMMIT: ' abc123 '}, () => {
			throw new Error('git must not be consulted');
		}),
		'abc123',
	);
});

test('clean tree: the HEAD sha; modified tree: marked +dirty', t => {
	const clean = (args: string[]) => (args[0] === 'rev-parse' ? `${SHA}\n` : '');
	const dirty = (args: string[]) =>
		args[0] === 'rev-parse' ? `${SHA}\n` : ' M source/x.ts\n';
	t.is(resolveCommit({}, clean), SHA);
	t.is(resolveCommit({}, dirty), `${SHA}+dirty`);
});

test('no git (installed package) or an unexpected answer: no commit, never a made-up value', t => {
	t.is(
		resolveCommit({}, () => {
			throw new Error('not a git repository');
		}),
		undefined,
	);
	t.is(
		resolveCommit({}, () => 'not-a-sha'),
		undefined,
	);
});
