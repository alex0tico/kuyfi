import test from 'ava';
import {xdr} from '@stellar/stellar-sdk';
import {auditGateInput} from './audit.js';
import {runHeadlessAudit} from './cli_runtime.js';
import type {ScanResult} from './scanner.js';
import type {ChaosReport} from './chaos_monkey/index.js';
import type {FindingStatus, Severity} from './chaos_monkey/result_parser.js';
import type {CampaignConfig} from './chaos_monkey/campaign.js';

const ID = `C${'G'.repeat(55)}`;

const U32 = xdr.ScSpecTypeDef.scSpecTypeU32();
const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();

/** A name is a function with one u32 parameter; `name()` is parameterless; `name(addr)` takes an Address. */
const scan = (functions: string[] = []): ScanResult =>
	({
		contractId: ID,
		bytecodeSize: 10,
		functions: functions.map(spec => {
			if (spec.endsWith('()')) return {name: spec.slice(0, -2), params: []};
			if (spec.endsWith('(addr)'))
				return {
					name: spec.slice(0, -6),
					params: [{name: 'who', type: ADDR}],
				};
			return {name: spec, params: [{name: 'x', type: U32}]};
		}),
		udtRegistry: new Map(),
	}) as unknown as ScanResult;

interface ChaosOpts {
	findings?: Array<[Severity, FindingStatus]>;
	operationalErrors?: number;
	notEvaluated?: number;
	budgetRefused?: number;
	excludedFunctions?: string[];
	timeout?: {seconds: number; reached: boolean};
	invoked?: string[];
	allowedFamilies?: string[];
}

const chaos = (o: ChaosOpts = {}): ChaosReport => {
	const findings = (o.findings ?? []).map(([severity, status], i) => ({
		id: `F-${i}`,
		severity,
		status,
		functionName: 'f',
		vectorName: 'v',
		signal: 'POTENTIAL_VULN',
		details: 'd',
		evidence: {
			simulationFailed: false,
			broadcasted: false,
			success: false,
			transactionHash: null,
			ledger: null,
			trace: {
				rootCall: null,
				nestedCallCount: 0,
				involvedContractIds: [],
				errors: [],
				hasAuthError: false,
				failureLocation: null,
				malformed: false,
			},
		},
	}));
	const byStatus = {supported: 0, hypothesis: 0, inconclusive: 0};
	for (const f of findings) byStatus[f.status]++;
	return {
		contractId: ID,
		scannedAt: '2026-01-01T00:00:00.000Z',
		network: 'testnet',
		totalFunctions: 0,
		totalVectorsRun: 1,
		findings,
		summary: {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			preconditionFail: 0,
			broadcastTransactions: 0,
			transactionsWithHash: 0,
			operationalErrors: o.operationalErrors ?? 0,
			notEvaluated: o.notEvaluated ?? 0,
			byStatus,
		},
		verificationTransactions: [],
		invocations: (o.invoked ?? []).map(functionName => ({functionName})),
		coverageNotes: [],
		...(o.budgetRefused === undefined &&
		o.excludedFunctions === undefined &&
		o.allowedFamilies === undefined
			? {}
			: {
					campaign: {
						mode: 'simulate-only',
						refusedByBudget: o.budgetRefused ?? 0,
						blockedSends: 0,
						functionsSkippedByLimit: o.excludedFunctions ?? [],
						...(o.allowedFamilies ? {allowedFamilies: o.allowedFamilies} : {}),
						contextKeysUsed: [],
						contextKeysUnused: [],
					},
				}),
		...(o.timeout ? {timeout: o.timeout} : {}),
	} as unknown as ChaosReport;
};

const run = async (
	chaosOpts: ChaosOpts,
	options: Record<string, unknown> = {},
	scanned = scan(),
) =>
	runHeadlessAudit(ID, {
		scan: async () => scanned,
		chaos: async () => chaos(chaosOpts),
		...options,
	});

// --- what counts as incomplete ----------------------------------------------

test('auditGateInput: a clean run is complete', t => {
	t.deepEqual(
		auditGateInput(scan(['f']), chaos({invoked: ['f']})).incomplete,
		[],
	);
});

test('auditGateInput: each kind of incompleteness is reported', t => {
	const reasons = (o: ChaosOpts, fns = ['f']) =>
		auditGateInput(scan(fns), chaos({invoked: ['f'], ...o})).incomplete.join(
			' | ',
		);
	t.regex(reasons({operationalErrors: 2}), /2 operational error/);
	t.regex(reasons({notEvaluated: 1}), /1 vector\(s\) not evaluated/);
	t.regex(reasons({budgetRefused: 3}), /vector budget exhausted/);
	t.regex(
		reasons({timeout: {seconds: 30, reached: true}}),
		/time limit of 30s reached/,
	);
	t.regex(reasons({}, ['f', 'idle']), /without invocations: idle/);
	t.regex(
		reasons({findings: [['LOW', 'inconclusive']]}),
		/1 inconclusive finding/,
	);
});

test('auditGateInput: a time limit that was not reached is not incomplete', t => {
	t.deepEqual(
		auditGateInput(
			scan(['f']),
			chaos({invoked: ['f'], timeout: {seconds: 30, reached: false}}),
		).incomplete,
		[],
	);
});

test('auditGateInput: a parameterless function with no invocations is outside the rule', t => {
	t.deepEqual(
		auditGateInput(scan(['f', 'get_value()']), chaos({invoked: ['f']}))
			.incomplete,
		[],
	);
});

test('auditGateInput: a function with parameters and no invocations still counts, even next to a parameterless one', t => {
	const reasons = auditGateInput(
		scan(['f', 'idle', 'get_value()']),
		chaos({invoked: ['f']}),
	).incomplete.join(' | ');
	t.regex(reasons, /without invocations: idle$/);
	t.notRegex(reasons, /get_value/);
});

test('auditGateInput: with math off, a function counts only if another enabled family could attack it', t => {
	const familiesOff = (families: string[], fns: string[]) =>
		auditGateInput(
			scan(fns),
			chaos({invoked: [], allowedFamilies: families}),
		).incomplete.join(' | ');
	// fee family only: a plain u32 parameter is not fee-shaped, so nothing could attack it.
	t.deepEqual(
		auditGateInput(scan(['plain']), chaos({allowedFamilies: ['fee']}))
			.incomplete,
		[],
	);
	// access family: an Address parameter can be attacked.
	t.regex(
		familiesOff(['access'], ['transfer(addr)']),
		/without invocations: transfer/,
	);
	// access family: a plain u32 parameter on a non-admin function cannot.
	t.is(familiesOff(['access'], ['plain']), '');
});

test('auditGateInput: functions the campaign excluded on purpose do not count as idle', t => {
	t.deepEqual(
		auditGateInput(
			scan(['f', 'skipped']),
			chaos({invoked: ['f'], excludedFunctions: ['skipped']}),
		).incomplete,
		[],
	);
});

// --- exit codes ---------------------------------------------------------------

test('exit 0: no gate flags, whatever was found or left incomplete', async t => {
	const r = await run({
		findings: [['CRITICAL', 'supported']],
		operationalErrors: 4,
	});
	t.is(r.exitCode, 0);
	t.notRegex(r.output!, /Gate:/);
});

test('exit 0: --fail-on and nothing at or above the threshold; counts are printed', async t => {
	const r = await run({findings: [['MEDIUM', 'supported']]}, {failOn: 'high'});
	t.is(r.exitCode, 0);
	t.regex(r.output!, /supported\s+critical=0 high=0 medium=1/);
	t.regex(r.output!, /gate passed \(exit 0\)/);
});

test('exit 1: an invalid --fail-on or --timeout is a tool error before any scan', async t => {
	const calls: string[] = [];
	for (const bad of [{failOn: 'severe'}, {timeout: 0}, {timeout: -3}]) {
		// eslint-disable-next-line no-await-in-loop
		const r = await runHeadlessAudit(ID, {
			...bad,
			scan: async () => {
				calls.push('scan');
				return scan();
			},
		});
		t.is(r.exitCode, 1, `invalid ${JSON.stringify(bad)}`);
		t.regex(r.errorOutput!, /Invalid --(fail-on|timeout)/);
	}

	t.deepEqual(calls, []);
});

test('exit 1: a scan failure is a tool error even with gates set', async t => {
	const r = await runHeadlessAudit(ID, {
		failOn: 'info',
		failOnIncomplete: true,
		scan: async () => {
			throw new Error('rpc down');
		},
	});
	t.is(r.exitCode, 1);
});

test('exit 2: a supported finding at the threshold', async t => {
	const r = await run({findings: [['HIGH', 'supported']]}, {failOn: 'high'});
	t.is(r.exitCode, 2);
	t.regex(r.output!, /--fail-on high.*\(exit 2\)/);
});

test('exit 0: hypotheses and inconclusive findings do not trip --fail-on', async t => {
	const r = await run(
		{
			findings: [
				['CRITICAL', 'hypothesis'],
				['CRITICAL', 'inconclusive'],
			],
		},
		{failOn: 'info'},
	);
	t.is(r.exitCode, 0);
});

test('exit 2: --fail-on-include-hypotheses makes hypotheses count (inconclusive still not)', async t => {
	const hyp = await run(
		{findings: [['HIGH', 'hypothesis']]},
		{failOn: 'high', failOnIncludeHypotheses: true},
	);
	t.is(hyp.exitCode, 2);
	const inc = await run(
		{findings: [['CRITICAL', 'inconclusive']]},
		{failOn: 'high', failOnIncludeHypotheses: true},
	);
	t.is(inc.exitCode, 0);
});

test('exit 3: --fail-on-incomplete on an incomplete run', async t => {
	const r = await run({operationalErrors: 1}, {failOnIncomplete: true});
	t.is(r.exitCode, 3);
	t.regex(r.output!, /--fail-on-incomplete: 1 operational error/);
});

test('exit 3: reaching the time limit counts as incomplete', async t => {
	const r = await run(
		{timeout: {seconds: 5, reached: true}},
		{failOnIncomplete: true, timeout: 5},
	);
	t.is(r.exitCode, 3);
	t.regex(r.output!, /time limit of 5s reached/);
});

test('exit 0: --fail-on-incomplete on a complete run', async t => {
	const r = await run({}, {failOnIncomplete: true});
	t.is(r.exitCode, 0);
});

test('without --fail-on-incomplete, incompleteness is listed but does not fail', async t => {
	const r = await run({budgetRefused: 2}, {failOn: 'critical'});
	t.is(r.exitCode, 0);
	t.regex(r.output!, /Incomplete: vector budget exhausted/);
});

// --- precedence 1 > 2 > 3 > 0 -------------------------------------------------

test('precedence: 2 beats 3 when both gates fire', async t => {
	const r = await run(
		{findings: [['HIGH', 'supported']], operationalErrors: 1},
		{failOn: 'high', failOnIncomplete: true},
	);
	t.is(r.exitCode, 2);
});

test('precedence: 3 beats 0', async t => {
	const r = await run(
		{findings: [['LOW', 'supported']], notEvaluated: 1},
		{failOn: 'high', failOnIncomplete: true},
	);
	t.is(r.exitCode, 3);
});

test('precedence: 1 beats 2 and 3 when the report cannot be written', async t => {
	const r = await run(
		{findings: [['CRITICAL', 'supported']], operationalErrors: 1},
		{
			failOn: 'info',
			failOnIncomplete: true,
			writeJson: true,
			writeFile: async () => {
				throw new Error('EEXIST');
			},
		},
	);
	t.is(r.exitCode, 1);
	t.is(r.output, null);
});

// --- the JSON records which gate fired ---------------------------------------

const jsonGate = async (
	chaosOpts: ChaosOpts,
	options: Record<string, unknown>,
) => {
	let written = '';
	const r = await run(chaosOpts, {
		...options,
		writeJson: true,
		writeFile: async (_p: unknown, data: unknown) => {
			written = data as string;
		},
	});
	return {
		r,
		gate: (JSON.parse(written) as {gate?: Record<string, unknown>}).gate,
	};
};

test('JSON: records the gate that fired, every gate that fired, and the counts', async t => {
	const {r, gate} = await jsonGate(
		{findings: [['HIGH', 'supported']], operationalErrors: 1},
		{failOn: 'high', failOnIncomplete: true, timeout: 60},
	);
	t.is(r.exitCode, 2);
	t.is(gate!['decidedBy'], 'fail_on');
	t.deepEqual(gate!['triggered'], ['fail_on', 'fail_on_incomplete']);
	t.is(gate!['exitCode'], 2);
	t.deepEqual(gate!['settings'], {
		failOn: 'high',
		includeHypotheses: false,
		failOnIncomplete: true,
		timeoutSeconds: 60,
	});
	t.is((gate!['counts'] as {supported: {HIGH: number}}).supported.HIGH, 1);
});

test('JSON: a passing gate is recorded with decidedBy null', async t => {
	const {gate} = await jsonGate({}, {failOn: 'high'});
	t.is(gate!['decidedBy'], null);
	t.is(gate!['exitCode'], 0);
});

test('JSON: without any gate option the report has no gate field', async t => {
	const {gate} = await jsonGate({}, {});
	t.is(gate, undefined);
});

// --- --timeout reaches the audit -----------------------------------------------

test('--timeout is handed to the audit as seconds', async t => {
	let seen: number | undefined;
	await runHeadlessAudit(ID, {
		timeout: 12,
		scan: async () => scan(),
		chaos: async options => {
			seen = options.timeoutSeconds;
			return chaos();
		},
	});
	t.is(seen, 12);
});

// --- config + flags -------------------------------------------------------------

const fileConfig = (extra: Partial<CampaignConfig>): CampaignConfig => ({
	version: 1,
	limits: {mode: 'simulate-only'},
	...extra,
});

const runWithConfig = async (
	config: CampaignConfig,
	chaosOpts: ChaosOpts,
	flags: Record<string, unknown> = {},
) => {
	let seenSeed: number | undefined;
	let seenTimeout: number | undefined;
	const r = await runHeadlessAudit(ID, {
		configPath: 'c.json',
		loadConfig: async () => config,
		...flags,
		scan: async () => scan(),
		chaos: async options => {
			seenSeed = options.seed?.value;
			seenTimeout = options.timeoutSeconds;
			return chaos(chaosOpts);
		},
	});
	return {r, seenSeed, seenTimeout};
};

test('config only: seed, failOn, failOnIncomplete and timeout all come from the file', async t => {
	const file = fileConfig({
		seed: 7,
		failOn: 'high',
		failOnIncomplete: true,
		timeout: 99,
	});
	const a = await runWithConfig(file, {findings: [['HIGH', 'supported']]});
	t.is(a.r.exitCode, 2);
	t.is(a.seenSeed, 7);
	t.is(a.seenTimeout, 99);
	const b = await runWithConfig(file, {operationalErrors: 1});
	t.is(b.r.exitCode, 3);
});

test('config + flags: a flag wins over the file, field by field', async t => {
	const file = fileConfig({seed: 7, failOn: 'low', timeout: 99});
	const {r, seenSeed, seenTimeout} = await runWithConfig(
		file,
		{findings: [['MEDIUM', 'supported']]},
		{seedValue: 3, failOn: 'critical', timeout: 5},
	);
	t.is(seenSeed, 3); // flag, not 7
	t.is(seenTimeout, 5); // flag, not 99
	t.is(r.exitCode, 0); // threshold critical (flag), not low (file): a MEDIUM does not fire
});

test('config + flags: a field the flags leave out falls back to the file', async t => {
	const file = fileConfig({failOn: 'high', failOnIncomplete: true});
	const {r} = await runWithConfig(
		file,
		{operationalErrors: 1},
		{failOn: 'critical'},
	);
	t.is(r.exitCode, 3); // failOnIncomplete still comes from the file
});

test('config + flags: a flag can switch off what the file turned on', async t => {
	const file = fileConfig({failOnIncomplete: true});
	const {r} = await runWithConfig(
		file,
		{operationalErrors: 1},
		{failOnIncomplete: false},
	);
	t.is(r.exitCode, 0);
});

test('config: an invalid value in the file is a tool error', async t => {
	const r = await runHeadlessAudit(ID, {
		configPath: 'c.json',
		loadConfig: async () => ({
			...fileConfig({}),
			failOn: 'severe' as never,
		}),
		scan: async () => scan(),
	});
	t.is(r.exitCode, 1);
	t.regex(r.errorOutput!, /Invalid --fail-on/);
});

test('JSON coverage lists parameterless functions that were never invoked, apart from the incompleteness rule', async t => {
	let written = '';
	const r = await runHeadlessAudit(ID, {
		failOnIncomplete: true,
		writeJson: true,
		writeFile: async (_p: unknown, data: unknown) => {
			written = data as string;
		},
		scan: async () => scan(['f', 'get_value()', 'reset()']),
		chaos: async () => chaos({invoked: ['f']}),
	});
	const coverage = (
		JSON.parse(written) as {
			coverage: {
				functionsWithoutParameters: string[];
				functionsWithZeroInvocations: string[];
			};
		}
	).coverage;
	t.deepEqual(coverage.functionsWithoutParameters, ['get_value', 'reset']);
	// Still part of the existing "never invoked" list, unchanged.
	t.deepEqual(coverage.functionsWithZeroInvocations, ['get_value', 'reset']);
	// ...but they do not make the run incomplete.
	t.is(r.exitCode, 0);
});
