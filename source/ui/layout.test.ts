import test from 'ava';
import {getLayoutMode} from './layout.js';

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
