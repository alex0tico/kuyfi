import test from 'ava';
import {Keypair} from '@stellar/stellar-sdk';
import {
	CampaignConfigError,
	CampaignServer,
	SimulateOnlyViolation,
	isFamilyAllowed,
	isFunctionAllowed,
	loadCampaignConfig,
	parseCampaignConfig,
} from './campaign.js';

const ADMIN = Keypair.random().publicKey();

test('a campaign with no limits is simulate-only by default', t => {
	const c = parseCampaignConfig({version: 1});
	t.is(c.limits.mode, 'simulate-only');
	t.is(c.limits.maxVectors, undefined);
	t.is(c.context, undefined);
});

test('broadcast requires an authorization record', t => {
	const error = t.throws(
		() => parseCampaignConfig({version: 1, limits: {mode: 'broadcast'}}),
		{instanceOf: CampaignConfigError},
	);
	t.regex(error!.message, /requires authorizationRecord/);
	const ok = parseCampaignConfig({
		version: 1,
		limits: {mode: 'broadcast'},
		authorizationRecord: 'AR-A-1',
	});
	t.is(ok.limits.mode, 'broadcast');
	t.is(ok.authorizationRecord, 'AR-A-1');
});

test('parseCampaignConfig reports every problem and rejects unknown keys', t => {
	const error = t.throws(
		() =>
			parseCampaignConfig({
				version: 2,
				oops: 1,
				limits: {
					mode: 'yolo',
					maxVectors: 0,
					families: ['math', 'nope'],
					functions: [],
					extra: true,
				},
			}),
		{instanceOf: CampaignConfigError},
	);
	t.true(error!.problems.length >= 6);
});

test('context is validated through the existing ContextConfig rules', t => {
	const c = parseCampaignConfig({
		version: 1,
		context: {roles: {admin: ADMIN}, knownValues: {n: {type: 'u32', value: 5}}},
	});
	t.is(c.context!.roles['admin'], ADMIN);
	const error = t.throws(
		() => parseCampaignConfig({version: 1, context: {roles: {admin: 'x'}}}),
		{instanceOf: CampaignConfigError},
	);
	t.regex(error!.message, /context: roles\.admin/);
});

test('loadCampaignConfig turns unreadable files and invalid JSON into CampaignConfigError', async t => {
	await t.throwsAsync(
		loadCampaignConfig('/x.json', async () => {
			throw new Error('ENOENT');
		}),
		{instanceOf: CampaignConfigError, message: /cannot read/},
	);
	await t.throwsAsync(
		loadCampaignConfig('/x.json', async () => '{nope'),
		{
			instanceOf: CampaignConfigError,
			message: /not valid JSON/,
		},
	);
	const c = await loadCampaignConfig('/x.json', async () =>
		JSON.stringify({version: 1, limits: {maxVectors: 3}}),
	);
	t.is(c.limits.maxVectors, 3);
});

test('family and function allow-lists', t => {
	t.true(isFamilyAllowed(undefined, 'fee'));
	t.false(isFamilyAllowed({mode: 'simulate-only', families: ['math']}, 'fee'));
	t.true(isFunctionAllowed(undefined, 'x'));
	t.false(isFunctionAllowed({mode: 'broadcast', functions: ['a']}, 'b'));
});

test('CampaignServer budget: reserves up to maxVectors then refuses', t => {
	const s = new CampaignServer('https://example.invalid', {
		mode: 'simulate-only',
		maxVectors: 2,
	});
	t.true(s.reserveInvocation());
	t.true(s.reserveInvocation());
	t.false(s.reserveInvocation());
	t.true(s.budgetExhausted);
	t.is(s.started, 2);
	t.is(s.refused, 1);
});

test('CampaignServer in simulate-only refuses sendTransaction for any caller', async t => {
	const s = new CampaignServer('https://example.invalid', {
		mode: 'simulate-only',
	});
	await t.throwsAsync(s.sendTransaction({} as never), {
		instanceOf: SimulateOnlyViolation,
	});
	t.is(s.blockedSends, 1);
});
