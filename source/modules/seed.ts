import {createHash, randomInt} from 'node:crypto';
import {Keypair} from '@stellar/stellar-sdk';

/** Highest seed accepted: keeps the value exact in JSON and easy to retype. */
export const MAX_SEED = 2 ** 32 - 1;

export interface SeedInfo {
	/** The seed that drove every generated test datum of the run. */
	value: number;
	/** True when no `--seed` was given and Kuyfi picked one (to be repeated later). */
	generated: boolean;
}

export class SeedError extends Error {}

/**
 * Validates `--seed`. Absent: a seed is generated so the run can still be
 * repeated from its report. Anything that is not an integer in [0, 2^32-1]
 * is refused rather than silently coerced.
 */
export function resolveSeed(
	given?: number,
	generate: () => number = () => randomInt(0, MAX_SEED + 1),
): SeedInfo {
	if (given === undefined) return {value: generate(), generated: true};
	if (!Number.isInteger(given) || given < 0 || given > MAX_SEED)
		throw new SeedError(
			`Invalid --seed "${String(given)}": expected an integer from 0 to ${MAX_SEED}.`,
		);
	return {value: given, generated: false};
}

/**
 * Deterministic byte stream: block i is SHA-256(`seed:path:i`). Not meant for
 * secrets — it makes TEST DATA (throwaway addresses, nonces, Testnet-only
 * keys) reproducible. `fork(label)` gives an independent stream per
 * function/family, so one family generating more or fewer values never shifts
 * what another family generates.
 */
export class Rng {
	private counter = 0;

	constructor(
		readonly seed: number,
		private readonly path = '',
	) {}

	fork(label: string): Rng {
		return new Rng(this.seed, `${this.path}/${label}`);
	}

	bytes(length: number): Buffer {
		const blocks: Buffer[] = [];
		let have = 0;
		while (have < length) {
			const block = createHash('sha256')
				.update(`${this.seed}:${this.path}:${this.counter++}`)
				.digest();
			blocks.push(block);
			have += block.length;
		}

		return Buffer.concat(blocks).subarray(0, length);
	}

	keypair(): Keypair {
		return Keypair.fromRawEd25519Seed(this.bytes(32));
	}
}
