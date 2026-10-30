import test from 'ava';
import {
	Account,
	Keypair,
	SorobanDataBuilder,
	StrKey,
	xdr,
} from '@stellar/stellar-sdk';
import {CampaignServer} from './chaos_monkey/campaign.js';
import {runChaosMonkey} from './chaos_monkey/index.js';
import {parseContextConfig} from './chaos_monkey/context_config.js';
import {
	buildSecurityReport,
	serializeSecurityReport,
} from './security_report.js';
import {runHeadlessAudit} from './cli_runtime.js';
import type {AuditRun} from './audit.js';
import type {ScanResult} from './scanner.js';

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const ADDR = xdr.ScSpecTypeDef.scSpecTypeAddress();
const I128 = xdr.ScSpecTypeDef.scSpecTypeI128();
const SECRET_LOOKING_ROLE = Keypair.random().publicKey();

class Fake extends CampaignServer {
	override async getAccount(a: string) {
		return new Account(a, '1');
	}

	override async simulateTransaction(): Promise<never> {
		return {
			id: '1',
			latestLedger: 1,
			events: [],
			_parsed: true,
			transactionData: new SorobanDataBuilder(),
			minResourceFee: '100',
			result: {auth: [], retval: xdr.ScVal.scvVoid()},
		} as unknown as never;
	}
}

const functions = [
	{
		name: 'transfer',
		params: [
			{name: 'to', type: ADDR},
			{name: 'amount', type: I128},
		],
	},
	{name: 'never_run', params: []},
];

async function auditRun(): Promise<AuditRun> {
	const limits = {mode: 'simulate-only' as const, functions: ['transfer']};
	const chaos = await runChaosMonkey({
		contractId: CONTRACT,
		functions,
		udtRegistry: new Map(),
		onProgress() {},
		keypair: Keypair.random(),
		server: new Fake('https://example.invalid', limits),
		limits,
		context: parseContextConfig({version: 1, roles: {to: SECRET_LOOKING_ROLE}}),
		authorizationRecord: 'AR-TEST-1',
	});
	const scan: ScanResult = {
		contractId: CONTRACT,
		bytecodeSize: 1,
		functions: functions.map(f => ({...f, hasReturn: false})),
		udtRegistry: new Map(),
	};
	return {scan, chaos};
}

test('JSON report exports provenance, coverage and campaign blocks additively', async t => {
	const report = buildSecurityReport(await auditRun());
	t.is(report.schemaVersion, '1.0.0');
	t.is(report.provenance!.audit.percent, 100);
	t.deepEqual(report.provenance!.audit.missing, []);
	t.true(report.provenance!.invocations.every(i => i.mode === 'simulation'));
	t.true(
		report.provenance!.invocations.some(i =>
			i.inputs.some(
				p => p.configKey === 'roles.to' && p.source === 'configured_context',
			),
		),
	);
	// Every executed vector carries its classification, also those that are not findings.
	t.true(report.provenance!.invocations.every(i => i.signal !== undefined));
	t.true(report.provenance!.invocations.every(i => i.outcome !== undefined));
	t.deepEqual(report.coverage!.functionsWithZeroInvocations, ['never_run']);
	t.is(report.campaign!.authorizationRecord, 'AR-TEST-1');
	t.deepEqual(report.campaign!.functionsSkippedByLimit, ['never_run']);
	t.deepEqual(report.campaign!.contextKeysUnused, []);
});

test('the serialized report never contains configured values (only config keys)', async t => {
	const json = serializeSecurityReport(buildSecurityReport(await auditRun()));
	t.false(json.includes(SECRET_LOOKING_ROLE));
	t.regex(json, /roles\.to/);
	t.notRegex(json, /\bS[A-Z2-7]{55}\b/); // no Stellar secret seeds
});

test('runHeadlessAudit: a bad --config is a tool failure before any audit starts', async t => {
	let audited = false;
	const result = await runHeadlessAudit(CONTRACT, {
		configPath: '/nope.json',
		runAudit: async () => {
			audited = true;
			throw new Error('should not run');
		},
	});
	t.is(result.exitCode, 1);
	t.regex(result.errorOutput!, /Invalid campaign configuration/);
	t.false(audited);
});

test('runHeadlessAudit: config target must match the Contract ID', async t => {
	let audited = false;
	const result = await runHeadlessAudit(CONTRACT, {
		configPath: '/c.json',
		loadConfig: async () => ({
			version: 1,
			target: StrKey.encodeContract(Buffer.alloc(32, 1)),
			limits: {mode: 'simulate-only'},
		}),
		runAudit: async () => {
			audited = true;
			throw new Error('should not run');
		},
	});
	t.is(result.exitCode, 1);
	t.regex(result.errorOutput!, /does not match/);
	t.false(audited);
});

test('runHeadlessAudit: the validated campaign reaches the audit; without --config none is passed', async t => {
	const seen: unknown[] = [];
	const stub = async (_id: string, o: {campaign?: unknown}) => {
		seen.push(o.campaign);
		return auditRun();
	};
	await runHeadlessAudit(CONTRACT, {
		configPath: '/c.json',
		loadConfig: async () => ({
			version: 1,
			limits: {mode: 'simulate-only', maxVectors: 4},
		}),
		runAudit: stub as never,
	});
	await runHeadlessAudit(CONTRACT, {runAudit: stub as never});
	t.deepEqual(seen[0], {
		version: 1,
		limits: {mode: 'simulate-only', maxVectors: 4},
	});
	t.is(seen[1], undefined);
});
