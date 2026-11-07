import test from 'ava';
import {Address, xdr} from '@stellar/stellar-sdk';
import {MAX_SEED, Rng, SeedError, resolveSeed} from './seed.js';
import {attackVals, baseline, seededCtx} from './chaos_monkey/type_gen.js';

const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();

const b64 = (v: xdr.ScVal | null) => v!.toXDR('base64');
const addrs = (vs: Array<{val: xdr.ScVal}>) => vs.map(v => b64(v.val));

test('resolveSeed: a given seed is used as is and flagged as not generated', t => {
	t.deepEqual(resolveSeed(42), {value: 42, generated: false});
	t.deepEqual(resolveSeed(0), {value: 0, generated: false});
	t.deepEqual(resolveSeed(MAX_SEED), {value: MAX_SEED, generated: false});
});

test('resolveSeed: with no seed one is generated, flagged, and usable to repeat the run', t => {
	const a = resolveSeed(undefined, () => 123_456);
	t.deepEqual(a, {value: 123_456, generated: true});
	const real = resolveSeed();
	t.true(real.generated);
	t.true(
		Number.isInteger(real.value) && real.value >= 0 && real.value <= MAX_SEED,
	);
	// The generated value is itself a valid --seed.
	t.deepEqual(resolveSeed(real.value), {value: real.value, generated: false});
});

test('resolveSeed: NaN, fractions, negatives and out-of-range values are refused, never coerced', t => {
	for (const bad of [Number.NaN, 1.5, -1, MAX_SEED + 1, Infinity]) {
		t.throws(() => resolveSeed(bad), {instanceOf: SeedError}, `${bad}`);
	}
});

test('Rng: the same seed gives the same bytes and keypair; another seed gives different ones', t => {
	t.deepEqual(new Rng(7).bytes(64), new Rng(7).bytes(64));
	t.not(
		new Rng(7).bytes(64).toString('hex'),
		new Rng(8).bytes(64).toString('hex'),
	);
	t.is(new Rng(7).keypair().publicKey(), new Rng(7).keypair().publicKey());
	t.not(new Rng(7).keypair().publicKey(), new Rng(8).keypair().publicKey());
});

test('Rng: consecutive draws differ, and a fork is stable and independent of draws on the parent', t => {
	const rng = new Rng(7);
	t.not(rng.keypair().publicKey(), rng.keypair().publicKey());
	const a = new Rng(7);
	a.bytes(100); // draws on the parent must not move the fork
	t.is(
		a.fork('f:math').keypair().publicKey(),
		new Rng(7).fork('f:math').keypair().publicKey(),
	);
	t.not(
		new Rng(7).fork('f:math').keypair().publicKey(),
		new Rng(7).fork('f:access').keypair().publicKey(),
	);
});

test('test data: the same seed yields the same throwaway addresses (baseline and attack vectors)', t => {
	const run = (seed: number) => {
		const ctx = seededCtx(new Rng(seed));
		return [
			b64(baseline(ADDR, new Map(), ctx)),
			...addrs(attackVals(ADDR, new Map(), ctx)),
		];
	};

	t.deepEqual(run(11), run(11));
});

test('test data: a different seed changes the generated addresses', t => {
	const run = (seed: number) =>
		addrs(attackVals(ADDR, new Map(), seededCtx(new Rng(seed))));
	t.notDeepEqual(run(11), run(12));
});

test('test data: without a seed the addresses stay random (v0.1.0 behaviour)', t => {
	const run = () => addrs(attackVals(ADDR, new Map()));
	t.notDeepEqual(run(), run());
});

test('test data: the seeded addresses are valid Stellar accounts', t => {
	const v = baseline(ADDR, new Map(), seededCtx(new Rng(1)));
	t.regex(Address.fromScVal(v!).toString(), /^G[A-Z2-7]{55}$/);
});
