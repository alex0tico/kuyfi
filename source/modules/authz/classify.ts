import {scValToNative, xdr} from '@stellar/stellar-sdk';
import type {AuthzStage} from './types.js';

export interface Classification {
	stage: AuthzStage;
	contractErrorCode?: number;
}

/**
 * Attributes a rejected enforcing simulation to the stage that produced it,
 * from the RPC's error text (which embeds the diagnostic event log).
 *
 * The patterns were calibrated on Testnet (protocol 29, RPC 30.0.0) and are
 * VERSIONED here on purpose: the text is not a stable API. Order matters —
 * the most specific stages first. Nothing here knows about any fixture.
 */
export function classifyRejection(errorText: string): Classification {
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
		return {stage: 'authorization_missing'};

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
