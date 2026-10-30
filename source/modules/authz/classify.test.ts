import test from 'ava';
import {classifyRejection} from './classify.js';

// Texts below are abridged from REAL Testnet responses recorded on 2026-10-21
// (protocol 29, RPC 30.0.0). They test the classifier against observed data;
// they are NOT evidence of rejection by themselves.
const A = 'G-TEST-ACCOUNT-A';
const C = 'C-TEST-CONTRACT-C';
const wrap = (first: string, ...lines: string[]) =>
	[
		first,
		'',
		'Event log (newest first):',
		...lines.map((l, i) => `   ${i}: [Diagnostic Event] ${l}`),
	].join('\n');

test('missing authorization', t => {
	const text = wrap(
		'HostError: Error(Auth, InvalidAction)',
		`contract:CD5Z, topics:[error, Error(Auth, InvalidAction)], data:["Unauthorized function call for address", ${A}]`,
	);
	t.deepEqual(classifyRejection(text), {stage: 'authorization_missing'});
});

test('invalid ed25519 signature (classic account)', t => {
	const text = wrap(
		'HostError: Error(Auth, InvalidAction)',
		`topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${A}, Error(Crypto, InvalidInput)]`,
		'topics:[error, Error(Crypto, InvalidInput)], data:"failed ED25519 verification"',
	);
	t.deepEqual(classifyRejection(text), {stage: 'signature_invalid'});
});

test('expired signature', t => {
	const text = wrap(
		'HostError: Error(Auth, InvalidInput)',
		`topics:[error, Error(Auth, InvalidInput)], data:["signature has expired", ${A}, 5313319, 5313309]`,
	);
	t.deepEqual(classifyRejection(text), {stage: 'signature_expired'});
});

test('contract-level error after require_auth passed', t => {
	const text = wrap(
		'HostError: Error(Contract, #3)',
		'topics:[error, Error(Contract, #3)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"',
	);
	t.deepEqual(classifyRejection(text), {
		stage: 'contract_error',
		contractErrorCode: 3,
	});
});

test('failure inside a custom account __check_auth: signature vs policy', t => {
	const sig = wrap(
		'HostError: Error(Auth, InvalidAction)',
		`topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${C}, Error(Crypto, InvalidInput)]`,
		`contract:${C}, topics:[log], data:["VM call trapped with HostError", __check_auth, Error(Crypto, InvalidInput)]`,
		`contract:${C}, topics:[error, Error(Crypto, InvalidInput)], data:"escalating error to VM trap from failed host function call: verify_sig_ed25519"`,
	);
	t.deepEqual(classifyRejection(sig), {stage: 'check_auth_signature'});
	const pol = wrap(
		'HostError: Error(Auth, InvalidAction)',
		`topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", ${C}, Error(Contract, #12)]`,
		`topics:[fn_call, ${C}, __check_auth], data:[]`,
	);
	t.deepEqual(classifyRejection(pol), {
		stage: 'check_auth_policy',
		contractErrorCode: 12,
	});
});

test('nonce reuse and a non-existent account are distinguished from signature failures', t => {
	t.is(
		classifyRejection(
			wrap(
				'HostError: Error(Auth, ExistingValue)',
				`data:["nonce already exists for address", ${A}]`,
			),
		).stage,
		'nonce_reused',
	);
	t.is(
		classifyRejection(
			wrap(
				'HostError: Error(Auth, InvalidAction)',
				`data:["failed account authentication with error", ${A}, Error(Storage, MissingValue)]`,
				'data:"trying to get non-existing value for account"',
			),
		).stage,
		'account_not_found',
	);
});

test('anything else stays unclassified (never silently attributed)', t => {
	t.is(
		classifyRejection('HostError: Error(Budget, ExceededLimit)').stage,
		'unclassified',
	);
	t.is(classifyRejection('').stage, 'unclassified');
});
