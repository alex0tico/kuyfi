import test from 'ava';
import {runAuthzCli} from './cli.js';
import {authzGateInput} from './gate_input.js';
import type {AuthzReport} from './run.js';
import type {AuthzMatrix, CaseState} from './types.js';

const matrix: AuthzMatrix = {
	version: 1,
	id: 'm1',
	mode: 'simulate-only',
	actors: {},
	cases: [],
};

const reportWith = (
	cases: Array<{state: CaseState; accepted: boolean}>,
): AuthzReport =>
	({
		schemaVersion: '1.0.0',
		kind: 'authz-matrix',
		matrixId: 'm1',
		generatedAt: '2026-10-22T12:00:00.000Z',
		tool: {name: 'kuyfi', version: '0.1.0'},
		environment: {network: 'testnet', rpcUrl: 'u', sdkVersion: 'x'},
		mode: 'simulate-only',
		accounts: {relay: 'GR', actors: {}},
		cases: cases.map((c, i) => ({
			id: `c${i}`,
			entries: [],
			call: {contractId: 'C', function: 'f'},
			authModeSent: 'enforce',
			source: 'GR',
			observed: {outcome: 'success', stage: 'none', eventTopics: []},
			evaluation: {
				state: c.state,
				executed: true,
				accepted: c.accepted,
				reasons: [],
			},
		})),
		summary: {
			total: cases.length,
			executed: 0,
			accepted: 0,
			byState: {},
			note: 'n',
		},
	}) as unknown as AuthzReport;

const cli = async (
	cases: Array<{state: CaseState; accepted: boolean}>,
	options: Record<string, unknown> = {},
) => {
	let written = '';
	return runAuthzCli('m.json', {
		load: async () => matrix,
		run: async () => reportWith(cases),
		writeFile: (async (_p: string, data: string) => {
			written = data;
		}) as never,
		...options,
	}).then(r => ({
		r,
		json: () => JSON.parse(written) as {gate?: Record<string, unknown>},
	}));
};

const ok = {state: 'expected_success' as const, accepted: true};
const wrongAcceptance = {
	state: 'unexpected_acceptance' as const,
	accepted: false,
};
const wrongRejection = {
	state: 'unexpected_rejection' as const,
	accepted: false,
};
const unjudged = {state: 'inconclusive' as const, accepted: false};

// --- mapping ------------------------------------------------------------------

test('authz gate input: discrepancies are supported findings (acceptance HIGH, rejection MEDIUM)', t => {
	const g = authzGateInput(reportWith([ok, wrongAcceptance, wrongRejection]));
	t.deepEqual(g.findings, [
		{severity: 'HIGH', status: 'supported'},
		{severity: 'MEDIUM', status: 'supported'},
	]);
	t.deepEqual(g.incomplete, []);
});

test('authz gate input: cases that could not be judged make the run incomplete, never findings', t => {
	const g = authzGateInput(
		reportWith([
			unjudged,
			unjudged,
			{state: 'not_exercised', accepted: false},
			{state: 'expected_success', accepted: false},
		]),
	);
	t.deepEqual(g.findings, []);
	t.deepEqual(g.incomplete, [
		'2 case(s) inconclusive',
		'1 case(s) not_exercised',
		'1 case(s) not accepted (evidence missing)',
	]);
});

// --- exit codes ----------------------------------------------------------------

test('authz exit 0: no gate flags, even with discrepancies', async t => {
	const {r} = await cli([wrongAcceptance, unjudged]);
	t.is(r.exitCode, 0);
});

test('authz exit 0: --fail-on with a clean matrix; the gate block is printed', async t => {
	const {r} = await cli([ok], {failOn: 'low'});
	t.is(r.exitCode, 0);
	t.regex(r.output!, /gate passed \(exit 0\)/);
});

test('authz exit 1: an invalid --fail-on is a tool error and nothing runs', async t => {
	let ran = false;
	const {r} = await cli([ok], {
		failOn: 'severe',
		run: async () => {
			ran = true;
			return reportWith([ok]);
		},
	});
	t.is(r.exitCode, 1);
	t.regex(r.errorOutput!, /Invalid --fail-on/);
	t.false(ran);
});

test('authz exit 2: unexpected acceptance (HIGH) trips --fail-on high; unexpected rejection (MEDIUM) does not', async t => {
	const acceptance = await cli([wrongAcceptance], {failOn: 'high'});
	const rejectionHigh = await cli([wrongRejection], {failOn: 'high'});
	const rejectionMedium = await cli([wrongRejection], {failOn: 'medium'});
	t.is(acceptance.r.exitCode, 2);
	t.is(rejectionHigh.r.exitCode, 0);
	t.is(rejectionMedium.r.exitCode, 2);
});

test('authz exit 3: --fail-on-incomplete with an inconclusive case', async t => {
	const {r} = await cli([ok, unjudged], {failOnIncomplete: true});
	t.is(r.exitCode, 3);
	t.regex(r.output!, /1 case\(s\) inconclusive/);
});

test('authz exit 0: --fail-on-incomplete on a fully judged matrix', async t => {
	const {r} = await cli([ok], {failOnIncomplete: true});
	t.is(r.exitCode, 0);
});

// --- precedence -------------------------------------------------------------------

test('authz precedence: 2 beats 3', async t => {
	const {r} = await cli([wrongAcceptance, unjudged], {
		failOn: 'high',
		failOnIncomplete: true,
	});
	t.is(r.exitCode, 2);
});

test('authz precedence: 3 beats 0', async t => {
	const {r} = await cli([wrongRejection, unjudged], {
		failOn: 'critical',
		failOnIncomplete: true,
	});
	t.is(r.exitCode, 3);
});

test('authz precedence: 1 beats 2 and 3 when the evidence cannot be written', async t => {
	const {r} = await cli([wrongAcceptance, unjudged], {
		failOn: 'high',
		failOnIncomplete: true,
		writeFile: (async () => {
			throw new Error('EEXIST');
		}) as never,
	});
	t.is(r.exitCode, 1);
});

// --- JSON ----------------------------------------------------------------------------

test('authz JSON: records the gate that fired and every gate that fired', async t => {
	const {r, json} = await cli([wrongAcceptance, unjudged], {
		failOn: 'high',
		failOnIncomplete: true,
	});
	t.is(r.exitCode, 2);
	const gate = json().gate!;
	t.is(gate['decidedBy'], 'fail_on');
	t.deepEqual(gate['triggered'], ['fail_on', 'fail_on_incomplete']);
	t.is(gate['exitCode'], 2);
});

test('authz JSON: without gate flags there is no gate field', async t => {
	const {json} = await cli([wrongAcceptance]);
	t.is(json().gate, undefined);
});
