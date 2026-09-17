import test from 'ava';
import {didShrink} from './useTerminalSize.js';

test('didShrink: narrower columns is a shrink', t => {
	t.true(didShrink(100, 120));
});

test('didShrink: wider columns is not a shrink', t => {
	t.false(didShrink(120, 100));
});

test('didShrink: identical columns is not a shrink', t => {
	t.false(didShrink(100, 100));
});

test('didShrink: only compares columns, ignores any row change implicitly', t => {
	// Same signature everywhere in this codebase is columns-only by design —
	// this just documents that didShrink never looks at rows at all.
	t.true(didShrink(50, 51));
	t.false(didShrink(51, 50));
});
