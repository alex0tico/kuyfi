import test from 'ava';
import {
	EXIT,
	GateConfigError,
	evaluateGate,
	finalExitCode,
	formatGateSummary,
	mergeGateSettings,
	parseFailOn,
	parseTimeout,
} from './gate.js';
import type {GateInput, GateSettings} from './gate.js';

const settings = (s: Partial<GateSettings> = {}): GateSettings => ({
	includeHypotheses: false,
	failOnIncomplete: false,
	...s,
});
const supported = (severity: GateInput['findings'][0]['severity']) => ({
	severity,
	status: 'supported' as const,
});
const hypothesis = (severity: GateInput['findings'][0]['severity']) => ({
	severity,
	status: 'hypothesis' as const,
});
const inconclusive = (severity: GateInput['findings'][0]['severity']) => ({
	severity,
	status: 'inconclusive' as const,
});

// --- exit 0 -----------------------------------------------------------------

test('exit 0: no gate requested, whatever the run found', t => {
	const g = evaluateGate(settings(), {
		findings: [supported('CRITICAL')],
		incomplete: ['operational errors: 3'],
	});
	t.is(g.exitCode, EXIT.OK);
	t.deepEqual(g.triggered, []);
	t.is(g.decidedBy, null);
});

test('exit 0: --fail-on with only findings below the threshold', t => {
	const g = evaluateGate(settings({failOn: 'high'}), {
		findings: [supported('MEDIUM'), supported('LOW'), supported('INFO')],
		incomplete: [],
	});
	t.is(g.exitCode, EXIT.OK);
});

test('exit 0: --fail-on-incomplete with a complete run', t => {
	const g = evaluateGate(settings({failOnIncomplete: true}), {
		findings: [],
		incomplete: [],
	});
	t.is(g.exitCode, EXIT.OK);
});

// --- exit 2 -----------------------------------------------------------------

test('exit 2: a supported finding at the threshold (>= is inclusive)', t => {
	const g = evaluateGate(settings({failOn: 'high'}), {
		findings: [supported('HIGH')],
		incomplete: [],
	});
	t.is(g.exitCode, EXIT.FAIL_ON);
	t.deepEqual(g.triggered, ['fail_on']);
	t.is(g.decidedBy, 'fail_on');
});

test('exit 2: severity above the threshold also counts', t => {
	const g = evaluateGate(settings({failOn: 'medium'}), {
		findings: [supported('CRITICAL')],
		incomplete: [],
	});
	t.is(g.exitCode, EXIT.FAIL_ON);
});

test('every threshold: a supported finding fires from its own level down, never above', t => {
	const levels = ['info', 'low', 'medium', 'high', 'critical'] as const;
	const sev = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
	for (const [i, level] of levels.entries()) {
		for (const [j, s] of sev.entries()) {
			const g = evaluateGate(settings({failOn: level}), {
				findings: [supported(s)],
				incomplete: [],
			});
			t.is(g.exitCode, j >= i ? EXIT.FAIL_ON : EXIT.OK, `${s} vs ${level}`);
		}
	}
});

test('hypotheses and inconclusive findings do not trip --fail-on by default', t => {
	const g = evaluateGate(settings({failOn: 'info'}), {
		findings: [hypothesis('CRITICAL'), inconclusive('CRITICAL')],
		incomplete: [],
	});
	t.is(g.exitCode, EXIT.OK);
});

test('--fail-on-include-hypotheses: hypotheses trip it, inconclusive still never do', t => {
	const withHyp = settings({failOn: 'high', includeHypotheses: true});
	t.is(
		evaluateGate(withHyp, {findings: [hypothesis('HIGH')], incomplete: []})
			.exitCode,
		EXIT.FAIL_ON,
	);
	t.is(
		evaluateGate(withHyp, {
			findings: [inconclusive('CRITICAL')],
			incomplete: [],
		}).exitCode,
		EXIT.OK,
	);
	t.is(
		evaluateGate(withHyp, {findings: [hypothesis('LOW')], incomplete: []})
			.exitCode,
		EXIT.OK,
	);
});

// --- exit 3 -----------------------------------------------------------------

test('exit 3: --fail-on-incomplete with any incompleteness', t => {
	const g = evaluateGate(settings({failOnIncomplete: true}), {
		findings: [],
		incomplete: ['timeout reached after 30s'],
	});
	t.is(g.exitCode, EXIT.INCOMPLETE);
	t.deepEqual(g.triggered, ['fail_on_incomplete']);
	t.is(g.decidedBy, 'fail_on_incomplete');
});

test('incompleteness is listed but does not fail without --fail-on-incomplete', t => {
	const g = evaluateGate(settings({failOn: 'high'}), {
		findings: [],
		incomplete: ['budget exhausted'],
	});
	t.is(g.exitCode, EXIT.OK);
	t.deepEqual(g.incomplete, ['budget exhausted']);
});

// --- precedence 1 > 2 > 3 > 0 ----------------------------------------------

test('precedence: 2 beats 3 when both gates fire, and both are recorded', t => {
	const g = evaluateGate(settings({failOn: 'high', failOnIncomplete: true}), {
		findings: [supported('HIGH')],
		incomplete: ['operational errors: 1'],
	});
	t.is(g.exitCode, EXIT.FAIL_ON);
	t.deepEqual(g.triggered, ['fail_on', 'fail_on_incomplete']);
	t.is(g.decidedBy, 'fail_on');
});

test('precedence: 3 beats 0', t => {
	const g = evaluateGate(
		settings({failOn: 'critical', failOnIncomplete: true}),
		{
			findings: [supported('LOW')],
			incomplete: ['functions without invocations: f'],
		},
	);
	t.is(g.exitCode, EXIT.INCOMPLETE);
});

test('precedence: a tool error (1) beats whatever the gate says', t => {
	const fired = evaluateGate(settings({failOn: 'info'}), {
		findings: [supported('CRITICAL')],
		incomplete: [],
	});
	t.is(fired.exitCode, EXIT.FAIL_ON);
	t.is(finalExitCode(fired, true), EXIT.TOOL_ERROR);
	t.is(finalExitCode(fired, false), EXIT.FAIL_ON);
});

// --- counts and output ------------------------------------------------------

test('counts by status and severity are exact and printed', t => {
	const g = evaluateGate(settings({failOn: 'high'}), {
		findings: [
			supported('HIGH'),
			supported('HIGH'),
			hypothesis('MEDIUM'),
			inconclusive('LOW'),
		],
		incomplete: [],
	});
	t.is(g.counts.supported.HIGH, 2);
	t.is(g.counts.hypothesis.MEDIUM, 1);
	t.is(g.counts.inconclusive.LOW, 1);
	const text = formatGateSummary(g).join('\n');
	t.regex(text, /supported\s+critical=0 high=2/);
	t.regex(text, /hypothesis\s+critical=0 high=0 medium=1/);
	t.regex(text, /Result: .*--fail-on high.*\(exit 2\)/);
});

test('a passing gate prints exit 0', t => {
	const text = formatGateSummary(
		evaluateGate(settings({failOn: 'high'}), {findings: [], incomplete: []}),
	).join('\n');
	t.regex(text, /gate passed \(exit 0\)/);
});

// --- parsing and config + flags --------------------------------------------

test('parseFailOn / parseTimeout refuse invalid values', t => {
	t.is(parseFailOn('medium'), 'medium');
	for (const bad of ['MEDIUM', 'severe', 3, undefined])
		t.throws(() => parseFailOn(bad), {instanceOf: GateConfigError});
	t.is(parseTimeout(0.5), 0.5);
	for (const bad of [0, -1, Number.NaN, Infinity, '30'])
		t.throws(() => parseTimeout(bad), {instanceOf: GateConfigError});
});

test('config only: the file supplies every gate setting', t => {
	t.deepEqual(
		mergeGateSettings(
			{},
			{
				failOn: 'high',
				failOnIncludeHypotheses: true,
				failOnIncomplete: true,
				timeout: 90,
			},
		),
		{
			failOn: 'high',
			includeHypotheses: true,
			failOnIncomplete: true,
			timeoutSeconds: 90,
		},
	);
});

test('flags only: no file needed', t => {
	t.deepEqual(mergeGateSettings({failOn: 'low', timeout: 5}), {
		failOn: 'low',
		includeHypotheses: false,
		failOnIncomplete: false,
		timeoutSeconds: 5,
	});
});

test('flags win over the file, field by field', t => {
	const merged = mergeGateSettings(
		{failOn: 'critical', timeout: 10},
		{failOn: 'low', failOnIncomplete: true, timeout: 300},
	);
	t.is(merged.failOn, 'critical'); // flag
	t.is(merged.timeoutSeconds, 10); // flag
	t.true(merged.failOnIncomplete); // not passed as a flag: file value
});

test('a flag can switch off a boolean the file turned on', t => {
	const merged = mergeGateSettings(
		{failOnIncomplete: false},
		{failOnIncomplete: true},
	);
	t.false(merged.failOnIncomplete);
});

test('an invalid value from either source is a configuration error', t => {
	t.throws(() => mergeGateSettings({failOn: 'nope'}), {
		instanceOf: GateConfigError,
	});
	t.throws(() => mergeGateSettings({}, {failOn: 'nope'}), {
		instanceOf: GateConfigError,
	});
	t.throws(() => mergeGateSettings({}, {timeout: -5}), {
		instanceOf: GateConfigError,
	});
});
