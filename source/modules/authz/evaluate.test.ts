import test from 'ava';
import {evaluateCase} from './evaluate.js';
import type {CaseState, ExpectSpec, ObservedResult} from './types.js';

const ok: ObservedResult = {outcome: 'success', stage: 'none', eventTopics: []};
const rej = (
	stage: ObservedResult['stage'],
	code?: number,
): ObservedResult => ({
	outcome: 'rejection',
	stage,
	eventTopics: [],
	...(code === undefined ? {} : {contractErrorCode: code}),
});

// Expectations are written by hand here: nothing is derived from the runner.
const table: Array<
	[
		string,
		ExpectSpec,
		ObservedResult | undefined,
		ObservedResult | undefined,
		boolean,
		CaseState,
		boolean,
	]
> = [
	[
		'success as expected',
		{outcome: 'success'},
		ok,
		undefined,
		false,
		'expected_success',
		true,
	],
	[
		'unexpected rejection',
		{outcome: 'success'},
		rej('authorization_missing'),
		undefined,
		false,
		'unexpected_rejection',
		false,
	],
	[
		'unexpected acceptance',
		{outcome: 'rejection', stage: 'authorization_missing'},
		ok,
		ok,
		true,
		'unexpected_acceptance',
		false,
	],
	[
		'rejection attributed to the right stage with control',
		{outcome: 'rejection', stage: 'signature_invalid'},
		rej('signature_invalid'),
		ok,
		true,
		'expected_rejection',
		true,
	],
	[
		'rejection at a different stage is not attributable',
		{outcome: 'rejection', stage: 'signature_invalid'},
		rej('authorization_missing'),
		ok,
		true,
		'inconclusive',
		false,
	],
	[
		'rejection without a succeeding control is inconclusive',
		{outcome: 'rejection', stage: 'signature_invalid'},
		rej('signature_invalid'),
		rej('contract_error'),
		true,
		'inconclusive',
		false,
	],
	[
		'contract error code must match',
		{outcome: 'rejection', stage: 'contract_error', contractErrorCode: 3},
		rej('contract_error', 4),
		ok,
		true,
		'inconclusive',
		false,
	],
	[
		'contract error code matches',
		{outcome: 'rejection', stage: 'contract_error', contractErrorCode: 3},
		rej('contract_error', 3),
		ok,
		true,
		'expected_rejection',
		true,
	],
	[
		'rejection with no stage is executed but never accepted',
		{outcome: 'rejection'},
		rej('authorization_missing'),
		ok,
		true,
		'expected_rejection',
		false,
	],
	[
		'not run',
		{outcome: 'success'},
		undefined,
		undefined,
		false,
		'not_exercised',
		false,
	],
];

for (const [
	name,
	expect,
	observed,
	control,
	needsControl,
	state,
	accepted,
] of table) {
	test(`evaluate: ${name}`, t => {
		const e = evaluateCase(expect, observed, control, needsControl);
		t.is(e.state, state);
		t.is(e.accepted, accepted);
	});
}

test('an operational error is inconclusive and neither executed nor accepted', t => {
	const e = evaluateCase(
		{outcome: 'rejection', stage: 'signature_invalid'},
		{
			outcome: 'operational_error',
			stage: 'operational',
			diagnostic: 'ETIMEDOUT',
			eventTopics: [],
		},
		ok,
		true,
	);
	t.deepEqual(
		[e.state, e.executed, e.accepted],
		['inconclusive', false, false],
	);
});

test('on-chain evidence is required when asked: simulation alone is executed but not accepted', t => {
	const sim = evaluateCase(
		{outcome: 'success', evidence: 'on-chain'},
		ok,
		undefined,
		false,
	);
	t.deepEqual(
		[sim.state, sim.executed, sim.accepted],
		['expected_success', true, false],
	);
	const chain = evaluateCase(
		{outcome: 'success', evidence: 'on-chain'},
		{...ok, onChain: {hash: 'h', ledger: 5, status: 'SUCCESS'}},
		undefined,
		false,
	);
	t.true(chain.accepted);
});

test('a required policy event must be observed', t => {
	t.false(
		evaluateCase(
			{outcome: 'success', eventTopic: 'policy_ok'},
			ok,
			undefined,
			false,
		).accepted,
	);
	t.true(
		evaluateCase(
			{outcome: 'success', eventTopic: 'policy_ok'},
			{...ok, eventTopics: ['policy_ok']},
			undefined,
			false,
		).accepted,
	);
});
