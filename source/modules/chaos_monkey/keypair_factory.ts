import {Keypair, rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL as RPC_URL} from '../network.js';

const FRIENDBOT_URL = 'https://friendbot.stellar.org/?addr=';
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 10;

/**
 * Generates a random Keypair and funds it via Friendbot.
 * Returns the funded keypair ready to sign transactions.
 * Throws if Friendbot fails after 3 retries.
 */
export async function generateEphemeralKeypair(): Promise<Keypair> {
	const keypair = Keypair.random();
	const server = new SorobanRpc.Server(RPC_URL);

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
