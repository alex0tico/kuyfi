import {scValToNative, xdr} from '@stellar/stellar-sdk';
import type {SuppliedNode} from './entries.js';
import type {AuthzStage} from './types.js';

export interface Classification {
	stage: AuthzStage;
	contractErrorCode?: number;
	message?: string;
}

/**
 * The host reports the same text whether a call has no authorization node or
 * a node that does not match it, so the two are told apart by what was
 * supplied: the call that failed is read from the diagnostics (contract and
 * function that ran `require_auth`) and compared with the supplied tree.
 */
function classifyUnauthorized(
	errorText: string,
	supplied: SuppliedNode[] | undefined,
): Classification {
	const failing =
		/contract:(C[A-Z2-7]{55}), topics:\[error, Error\(Auth, InvalidAction\)\], data:\["Unauthorized function call for address"/.exec(
			errorText,
		);
	const contractId = failing?.[1];
	const fn =
		contractId === undefined
			? undefined
			: new RegExp(
					`contract:${contractId}, topics:\\[log\\], data:\\["VM call trapped with HostError", (\\w+), Error\\(Auth, InvalidAction\\)\\]`,
				).exec(errorText)?.[1];
	if (supplied?.length === 0)
		return {
			stage: 'authorization_missing',
			message: 'No authorization entry was supplied for the call.',
		};
	if (contractId === undefined || fn === undefined)
		return {
			stage: 'authorization_missing',
			message:
				'No authorization covers the call that required it (the failing contract and function could not be read from the diagnostics).',
		};
	const call = `${fn} on ${contractId}`;
	if (supplied?.some(n => n.contractId === contractId && n.function === fn))
		return {
			stage: 'authorization_mismatch',
			message: `An authorization node for ${call} was supplied, but it does not match the call that was made (different arguments).`,
		};
	return {
		stage: 'authorization_missing',
		message: `No authorization node was supplied for ${call}.`,
	};
}

/**
 * Attributes a rejected enforcing simulation to the stage that produced it,
 * from the RPC's error text (which embeds the diagnostic event log).
 *
 * The patterns were calibrated on Testnet (protocol 29, RPC 30.0.0) and are
 * VERSIONED here on purpose: the text is not a stable API. Order matters —
 * the most specific stages first. Nothing here knows about any fixture.
 */
export function classifyRejection(
	errorText: string,
	supplied?: SuppliedNode[],
): Classification {
	const firstLine = errorText.split('\n')[0] ?? '';
	const within =
		/failed account authentication with error[^\n]*Error\(Contract, #(\d+)\)/.exec(
			errorText,
		);
	const top = /^HostError: Error\(Contract, #(\d+)\)/.exec(firstLine);
	const contractErrorCode = within
		? Number(within[1])
		: top
			? Number(top[1])
			: undefined;

	if (errorText.includes('nonce already exists'))
		return {stage: 'nonce_reused'};
	if (errorText.includes('signature has expired'))
		return {stage: 'signature_expired'};
	if (errorText.includes('non-existing value for account'))
		return {stage: 'account_not_found'};

	const failedAccountAuth = errorText.includes(
		'failed account authentication with error',
	);
	const insideCheckAuth =
		/VM call trapped with HostError[^\n]*__check_auth/.test(errorText) ||
		errorText.includes('__check_auth');
	if (failedAccountAuth && insideCheckAuth) {
		if (contractErrorCode !== undefined)
			return {stage: 'check_auth_policy', contractErrorCode};
		if (
			/Error\(Crypto,|failed ED25519 verification|verify_sig_ed25519/.test(
				errorText,
			)
		)
			return {stage: 'check_auth_signature'};
		return {stage: 'unclassified'};
	}

	if (failedAccountAuth) {
		if (/Error\(Crypto,|failed ED25519 verification/.test(errorText))
			return {stage: 'signature_invalid'};
		return {stage: 'unclassified'};
	}

	if (
		errorText.includes('Unauthorized function call for address') &&
		errorText.includes('Error(Auth, InvalidAction)')
	)
		return classifyUnauthorized(errorText, supplied);

	if (
		/^HostError: Error\(Contract, #\d+\)/.test(firstLine) &&
		!errorText.includes('Error(Auth')
	)
		return {stage: 'contract_error', contractErrorCode};

	return {stage: 'unclassified'};
}

/** Event topics (as strings) from simulation diagnostic events; undecodable ones are skipped. */
export function eventTopics(
	events: xdr.DiagnosticEvent[] | undefined,
): string[] {
	const out: string[] = [];
	for (const e of events ?? []) {
		try {
			for (const t of e.event().body().v0().topics()) {
				const v = scValToNative(t) as unknown;
				if (typeof v === 'string') out.push(v);
			}
		} catch {
			// not a decodable contract event
		}
	}

	return out;
}
