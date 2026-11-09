import {Keypair, rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL as RPC_URL} from '../network.js';
import type {Rng} from '../seed.js';

const FRIENDBOT_URL = 'https://friendbot.stellar.org/?addr=';
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 10;

/**
 * Generates a Keypair and funds it via Friendbot. With `rng` the keypair is
 * derived from the seed (Testnet throwaway: it holds nothing of value), so
 * a repeated run uses the same account; one that already exists on-chain is
 * reused instead of funded again (Friendbot refuses to fund twice).
 * Returns the funded keypair ready to sign transactions.
 * Throws if Friendbot fails after 3 retries.
 */
export async function generateEphemeralKeypair(rng?: Rng): Promise<Keypair> {
	const keypair = rng ? rng.keypair() : Keypair.random();
	const server = new SorobanRpc.Server(RPC_URL);

	if (rng) {
		try {
			await server.getAccount(keypair.publicKey());
			return keypair;
		} catch {
			// Not on-chain yet: fund it below.
		}
	}

	let lastError: Error = new Error('No attempts made');
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			const response = await fetch(`${FRIENDBOT_URL}${keypair.publicKey()}`);
			if (!response.ok) {
				throw new Error(
					`Friendbot HTTP ${response.status}: ${response.statusText}`,
				);
			}

			const activated = await waitForAccountActivation(
				keypair.publicKey(),
				server,
			);
			if (!activated) {
				throw new Error(
					'Account never confirmed on-chain after Friendbot funding',
				);
			}

			return keypair;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < MAX_RETRIES) {
				await new Promise<void>(resolve => {
					setTimeout(resolve, POLL_INTERVAL_MS * attempt);
				});
			}
		}
	}

	throw new Error(
		`Ephemeral keypair funding failed after ${MAX_RETRIES} retries: ${lastError.message}`,
	);
}

/**
 * Verifies the account exists on-chain before returning.
 * Polls getAccount() every 1000ms up to 10 attempts.
 */
export async function waitForAccountActivation(
	publicKey: string,
	server: SorobanRpc.Server,
): Promise<boolean> {
	for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
		try {
			await server.getAccount(publicKey);
			return true;
		} catch {
			// Account not yet on-chain — keep polling
		}

		await new Promise<void>(resolve => {
			setTimeout(resolve, POLL_INTERVAL_MS);
		});
	}

	return false;
}
