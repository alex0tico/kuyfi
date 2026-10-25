import {StrKey} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL} from './network.js';

export class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ToolError';
	}
}

/** C + 55 base32 chars (the CLI's shape rule) plus the StrKey checksum. */
export function parseContractId(value: string): string {
	const id = value.trim();
	if (!/^C[A-Z2-7]{55}$/.test(id) || !StrKey.isValidContract(id)) {
		throw new ToolError(
			'Invalid contract_id: expected a 56-character Soroban contract address starting with "C" (for example C...).',
		);
	}

	return id;
}

/** Testnet is the only network. Anything else is refused with a clear message. */
export function assertTestnet(network: string | undefined): void {
	if (network !== undefined && network.toLowerCase() !== 'testnet') {
		throw new ToolError(
			`Unsupported network "${network}". Kuyfi MCP works on Stellar Testnet only; there is no mainnet support.`,
		);
	}
}

export function parseMode(mode: string | undefined): 'simulate' {
	if (mode !== undefined && mode !== 'simulate') {
		throw new ToolError(
			`Unsupported mode "${mode}". Only mode="simulate" is available: this server never signs or sends transactions.`,
		);
	}

	return 'simulate';
}

export const HARD_MAX_VECTORS = 50;
export const DEFAULT_MAX_VECTORS = 20;

export function parseMaxVectors(value: number | undefined): number {
	const n = value ?? DEFAULT_MAX_VECTORS;
	if (!Number.isInteger(n) || n < 1 || n > HARD_MAX_VECTORS) {
		throw new ToolError(
			`max_vectors must be an integer between 1 and ${HARD_MAX_VECTORS} (hard limit).`,
		);
	}

	return n;
}

/** Fixed Testnet RPC; the URL is never taken from user input. */
export function testnetRpcUrl(): string {
	return TESTNET_RPC_URL;
}
