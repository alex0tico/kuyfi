import test from 'ava';
import {getLayoutMode, didShrink} from './app.js';

test('getLayoutMode: large at 120x40', t => {
	t.is(getLayoutMode(120, 40), 'large');
});

test('getLayoutMode: large at the 100-column boundary', t => {
	t.is(getLayoutMode(100, 30), 'large');
});

test('getLayoutMode: compact at 80x24', t => {
	t.is(getLayoutMode(80, 24), 'compact');
});

test('getLayoutMode: compact at the 70-column boundary', t => {
	t.is(getLayoutMode(70, 24), 'compact');
});

test('getLayoutMode: tooSmall at 60x20 (narrow columns)', t => {
	t.is(getLayoutMode(60, 20), 'tooSmall');
});

test('getLayoutMode: tooSmall just below the column boundary', t => {
	t.is(getLayoutMode(69, 30), 'tooSmall');
});

test('getLayoutMode: tooSmall from rows alone, even with wide columns', t => {
	t.is(getLayoutMode(120, 19), 'tooSmall');
});

test('getLayoutMode: compact at the 20-row boundary', t => {
	t.is(getLayoutMode(80, 20), 'compact');
});

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
