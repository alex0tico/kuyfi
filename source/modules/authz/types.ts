import type {KnownValueType} from '../chaos_monkey/context_config.js';

/**
 * Authorization-aware test matrix: configuration, expectations and results.
 *
 * Product code only knows HOW to build, sign and evaluate authorization
 * entries. Contract IDs, actors and expected outcomes come from the matrix
 * file (fixture/campaign specific); nothing here is tied to a fixture.
 */

/** An argument: the Address of a named actor, or a typed literal. */
export type ArgSpec =
	{actor: string} | {type: KnownValueType; value: string | number | boolean};

/** A node of the authorized invocation tree. */
export interface InvocationSpec {
	contractId: string;
	function: string;
	args: ArgSpec[];
	children?: InvocationSpec[];
}

/**
 * What the entry for an actor looks like.
 *  - valid: signed correctly, expiration `expirationOffset` ledgers ahead.
 *  - missing: no entry is supplied for the actor (recorded, not skipped silently).
 *  - invalid_signature: correct tree, corrupted signature.
 *  - foreign_signature: correct tree, signature made by another key.
 *  - expired: correctly signed, expiration `expirationOffset` ledgers BEHIND the simulation ledger.
 */
export type AuthVariant =
	'valid' | 'missing' | 'invalid_signature' | 'foreign_signature' | 'expired';

/**
 * Custom account (contract) credentials: the entry's address is the account
 * contract, and `actor` is the key that signs the payload. The signature is
 * an ScMap with the given field names (a user-defined format, as in
 * `__check_auth`'s signature type); defaults match {public_key, signature}.
 */
export interface CustomAccountSpec {
	contractId: string;
	publicKeyField?: string;
	signatureField?: string;
}

export interface AuthEntrySpec {
	/** Ed25519: the account that authorizes. Custom account: the key that signs for it. */
	actor: string;
	account?: CustomAccountSpec;
	variant: AuthVariant;
	/** Defaults to the call itself as a single root node. */
	tree?: InvocationSpec;
	/** Ledgers ahead (or behind, for `expired`) of the simulation ledger. Default 50 / 10. */
	expirationOffset?: number;
}

export type ActorSpec =
	| {source: 'ephemeral'}
	/** Secret supplied through the environment; never read from or written to files. */
	| {source: 'env'; secretEnv: string};

export type AuthzStage =
	| 'none'
	| 'authorization_missing'
	| 'signature_invalid'
	| 'signature_expired'
	| 'nonce_reused'
	| 'account_not_found'
	| 'contract_error'
	| 'check_auth_signature'
	| 'check_auth_policy'
	| 'operational'
	| 'unclassified';

export interface ExpectSpec {
	outcome: 'success' | 'rejection';
	/** Required for a rejection to count as attributed. */
	stage?: AuthzStage;
	/** Expected `Error(Contract, #n)` code, when the stage is contract-level. */
	contractErrorCode?: number;
	/** `on-chain` requires an included transaction as evidence. */
	evidence?: 'simulation' | 'on-chain';
	/** A diagnostic/contract event topic that must be observed (e.g. a policy branch marker). */
	eventTopic?: string;
}

export interface CaseSpec {
	id: string;
	description?: string;
	call: {contractId: string; function: string; args: ArgSpec[]};
	authorization: AuthEntrySpec[];
	/** Send the transaction (only honoured in `broadcast` mode, after a successful enforcing simulation). */
	submit?: boolean;
	/** Read-only call run before and after a submitted transaction to observe state. */
	stateRead?: {contractId: string; function: string; args: ArgSpec[]};
	expect?: ExpectSpec;
	/** Id of the case whose success rules out an earlier failure (footprint, fee, sequence). */
	control?: string;
}

export interface AuthzMatrix {
	version: 1;
	id: string;
	/** Defaults to simulate-only. `broadcast` requires authorizationRecord. */
	mode: 'simulate-only' | 'broadcast';
	authorizationRecord?: string;
	actors: Record<string, ActorSpec>;
	cases: CaseSpec[];
}

export type CaseState =
	| 'expected_success'
	| 'expected_rejection'
	| 'unexpected_acceptance'
	| 'unexpected_rejection'
	| 'not_exercised'
	| 'inconclusive';

export interface ObservedResult {
	/** simulation outcome under explicit enforcing mode */
	outcome: 'success' | 'rejection' | 'operational_error';
	stage: AuthzStage;
	contractErrorCode?: number;
	/** Full RPC error text (diagnostic events included); public data only. */
	diagnostic?: string;
	simulationLedger?: number;
	minResourceFee?: string;
	eventTopics: string[];
	onChain?: {
		hash: string;
		ledger: number | null;
		status: string;
		stateBefore?: unknown;
		stateAfter?: unknown;
	};
	/** Why a requested submission did not happen (e.g. simulate-only). */
	submissionSkipped?: string;
}

export interface CaseEvaluation {
	state: CaseState;
	/** Executed = one of the four result states with saved evidence. */
	executed: boolean;
	/** Accepted = matches the expectation WITH the required evidence type. */
	accepted: boolean;
	reasons: string[];
}
