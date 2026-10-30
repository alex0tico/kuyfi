import {createHash, randomBytes} from 'node:crypto';
import {Address, Keypair, hash, xdr} from '@stellar/stellar-sdk';
import {knownValueToScVal} from '../chaos_monkey/context_config.js';
import type {ArgSpec, AuthVariant, InvocationSpec} from './types.js';

export type ActorResolver = (name: string) => Keypair;

export function argToScVal(arg: ArgSpec, actor: ActorResolver): xdr.ScVal {
	if ('actor' in arg)
		return new Address(actor(arg.actor).publicKey()).toScVal();
	return knownValueToScVal(arg);
}

/** Per-run nonce from the OS CSPRNG — never derived from a test-data seed. */
export function newNonce(): xdr.Int64 {
	return xdr.Int64.fromString(
		BigInt.asUintN(62, randomBytes(8).readBigUInt64BE()).toString(),
	);
}

export function buildInvocation(
	spec: InvocationSpec,
	actor: ActorResolver,
): xdr.SorobanAuthorizedInvocation {
	return new xdr.SorobanAuthorizedInvocation({
		function:
			xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
				new xdr.InvokeContractArgs({
					contractAddress: Address.fromString(spec.contractId).toScAddress(),
					functionName: spec.function,
					args: spec.args.map(a => argToScVal(a, actor)),
				}),
			),
		subInvocations: (spec.children ?? []).map(c => buildInvocation(c, actor)),
	});
}

/** SHA-256 of the HashIdPreimage(envelopeTypeSorobanAuthorization): the payload that is signed. */
export function authorizationPayload(
	networkPassphrase: string,
	nonce: xdr.Int64,
	signatureExpirationLedger: number,
	invocation: xdr.SorobanAuthorizedInvocation,
): Buffer {
	const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
		new xdr.HashIdPreimageSorobanAuthorization({
			networkId: hash(Buffer.from(networkPassphrase)),
			nonce,
			signatureExpirationLedger,
			invocation,
		}),
	);
	return createHash('sha256').update(preimage.toXDR()).digest();
}

export interface BuiltEntry {
	entry: xdr.SorobanAuthorizationEntry;
	nonce: string;
	expirationLedger: number;
}

type SignVariant = Exclude<AuthVariant, 'missing'>;

function signPayload(
	signer: Keypair,
	payload: Buffer,
	variant: SignVariant,
	foreignSigner?: Keypair,
): Buffer {
	let signature: Buffer = signer.sign(payload);
	if (variant === 'invalid_signature') {
		signature = Buffer.from(signature);
		signature[0] = (signature[0]! + 1) % 256;
	} else if (variant === 'foreign_signature') {
		signature = (foreignSigner ?? Keypair.random()).sign(payload);
	}

	return signature;
}

function addressEntry(
	address: string,
	nonce: xdr.Int64,
	expirationLedger: number,
	signature: xdr.ScVal,
	invocation: xdr.SorobanAuthorizedInvocation,
): xdr.SorobanAuthorizationEntry {
	return new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
			new xdr.SorobanAddressCredentials({
				address: Address.fromString(address).toScAddress(),
				nonce,
				signatureExpirationLedger: expirationLedger,
				signature,
			}),
		),
		rootInvocation: invocation,
	});
}

const symEntry = (key: string, bytes: Buffer) =>
	new xdr.ScMapEntry({
		key: xdr.ScVal.scvSymbol(key),
		val: xdr.ScVal.scvBytes(bytes),
	});

/**
 * Ed25519 (classic account) authorization entry. `variant` selects how the
 * signature is deliberately broken; `missing` is handled by the caller (no entry).
 */
export function buildEd25519Entry(args: {
	signer: Keypair;
	invocation: xdr.SorobanAuthorizedInvocation;
	expirationLedger: number;
	variant: SignVariant;
	networkPassphrase: string;
	nonce?: xdr.Int64;
	/** Used for `foreign_signature`; defaults to a fresh random key. */
	foreignSigner?: Keypair;
}): BuiltEntry {
	const nonce = args.nonce ?? newNonce();
	const payload = authorizationPayload(
		args.networkPassphrase,
		nonce,
		args.expirationLedger,
		args.invocation,
	);
	const signature = signPayload(
		args.signer,
		payload,
		args.variant,
		args.foreignSigner,
	);
	const credentialsSignature = xdr.ScVal.scvVec([
		xdr.ScVal.scvMap([
			symEntry('public_key', args.signer.rawPublicKey()),
			symEntry('signature', signature),
		]),
	]);
	return {
		entry: addressEntry(
			args.signer.publicKey(),
			nonce,
			args.expirationLedger,
			credentialsSignature,
			args.invocation,
		),
		nonce: nonce.toString(),
		expirationLedger: args.expirationLedger,
	};
}

/**
 * Custom-account entry: the address is the account CONTRACT; the signature is
 * a user-defined ScMap {publicKeyField: signer pubkey, signatureField: sig}
 * that the account's `__check_auth` interprets. Map keys are emitted sorted,
 * as Soroban requires for `#[contracttype]` structs.
 */
export function buildCustomAccountEntry(args: {
	signer: Keypair;
	accountContractId: string;
	publicKeyField?: string;
	signatureField?: string;
	invocation: xdr.SorobanAuthorizedInvocation;
	expirationLedger: number;
	variant: SignVariant;
	networkPassphrase: string;
	nonce?: xdr.Int64;
	foreignSigner?: Keypair;
}): BuiltEntry {
	const nonce = args.nonce ?? newNonce();
	const payload = authorizationPayload(
		args.networkPassphrase,
		nonce,
		args.expirationLedger,
		args.invocation,
	);
	const signature = signPayload(
		args.signer,
		payload,
		args.variant,
		args.foreignSigner,
	);
	const fields = [
		[args.publicKeyField ?? 'public_key', args.signer.rawPublicKey()],
		[args.signatureField ?? 'signature', signature],
	] as Array<[string, Buffer]>;
	fields.sort((x, y) => Buffer.compare(Buffer.from(x[0]), Buffer.from(y[0])));
	const credentialsSignature = xdr.ScVal.scvMap(
		fields.map(([k, v]) => symEntry(k, v)),
	);
	return {
		entry: addressEntry(
			args.accountContractId,
			nonce,
			args.expirationLedger,
			credentialsSignature,
			args.invocation,
		),
		nonce: nonce.toString(),
		expirationLedger: args.expirationLedger,
	};
}

/** Human/JSON summary of a tree (function names and argument count only; no values). */
export function summarizeTree(inv: xdr.SorobanAuthorizedInvocation): unknown {
	const f = inv.function().contractFn();
	return {
		function: f.functionName().toString(),
		argCount: f.args().length,
		children: inv.subInvocations().map(summarizeTree),
	};
}
