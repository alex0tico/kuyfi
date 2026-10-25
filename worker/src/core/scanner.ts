import {Buffer} from 'node:buffer';
import {rpc as SorobanRpc, xdr} from '@stellar/stellar-sdk';
import {readCustomSections, WasmFormatError} from './wasm_sections.js';
import {buildUdtRegistry} from './udt_registry.js';
import type {UdtRegistry} from './udt_registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTypeDef = any;

export interface ScannedParam {
	name: string;
	type: AnyTypeDef;
}

export interface ScannedFunction {
	name: string;
	params: ScannedParam[];
	/** Plain domain fact (func.outputs().length > 0) — presentation layers turn this into their own label. */
	hasReturn: boolean;
	/** Worker addition: the output types (the original scanner only keeps hasReturn). */
	outputs: AnyTypeDef[];
}

/**
 * Domain/runtime object connecting the OSINT Scanner phase to Chaos Monkey.
 * Not a public JSON schema (D2.3) — UdtRegistry stays a Map, no XDR is
 * serialized here.
 */
export interface ScanResult {
	contractId: string;
	bytecodeSize: number;
	functions: ScannedFunction[];
	udtRegistry: UdtRegistry;
}

export type ScanErrorCode =
	'CONTRACT_NOT_FOUND' | 'XDR_ALIGN_FAILURE' | 'RPC_UNAVAILABLE' | 'UNKNOWN';

/**
 * Structured scan failure. `code` is the stable domain classification both
 * the TUI and the CLI switch on to produce their own presentation — neither
 * surface should ever parse `message` text to decide what happened.
 */
export class ScanError extends Error {
	readonly code: ScanErrorCode;

	constructor(code: ScanErrorCode, message: string) {
		super(message);
		this.name = 'ScanError';
		this.code = code;
	}
}

/** Shared Contract ID shape validation — used by both the TUI form and the CLI. */
export function isValidContractId(id: string): boolean {
	return /^C[A-Z0-9]{55}$/.test(id);
}

/**
 * Pure parse step: brute-force alignment-tolerant decode of a contractspecv0
 * custom section into entries[], then derives the function list + UDT
 * registry from those entries. No network, no WebAssembly — takes the raw
 * section bytes exactly as WebAssembly.Module.customSections() would hand
 * them to scanContract(). Exported directly so it can be unit-tested with a
 * synthetic buffer of real xdr.ScSpecEntry bytes, without needing a full
 * WASM module or a live RPC connection.
 */
export function parseContractSpecSection(specSectionBytes: Uint8Array): {
	functions: ScannedFunction[];
	udtRegistry: UdtRegistry;
} {
	let offset = 0;
	const entries: xdr.ScSpecEntry[] = [];

	while (offset < specSectionBytes.length) {
		let success = false;
		for (let len = 4; len <= specSectionBytes.length - offset; len += 4) {
			try {
				const chunk = Buffer.from(
					specSectionBytes.subarray(offset, offset + len),
				);
				const entry = xdr.ScSpecEntry.fromXDR(chunk);
				entries.push(entry);
				offset += len;
				success = true;
				break;
			} catch {
				// Not yet aligned on a full entry — keep growing the window.
			}
		}

		if (!success) {
			throw new ScanError('XDR_ALIGN_FAILURE', 'XDR_ALIGN_FAILURE');
		}
	}

	const udtRegistry = buildUdtRegistry(entries);

	const functions: ScannedFunction[] = entries
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.filter((e: any) => e.switch().name === 'scSpecEntryFunctionV0')
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.map((e: any) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const func = e.functionV0();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const params: ScannedParam[] = func.inputs().map((i: any) => ({
				name: i.name().toString('utf-8') as string,
				type: i.type() as AnyTypeDef,
			}));
			return {
				name: func.name().toString('utf-8') as string,
				params,
				hasReturn: func.outputs().length > 0,
				outputs: func.outputs() as AnyTypeDef[],
			};
		});

	return {functions, udtRegistry};
}

/**
 * Pure step: raw wasm bytes -> attack surface. Replaces the original
 * WebAssembly.compile() + customSections() with a hand-written section reader
 * (Workers forbid compiling wasm from runtime bytes). Same ScanError codes.
 */
export function scanWasmBytes(
	contractId: string,
	wasmBytecode: Uint8Array,
): ScanResult {
	let specSection: Uint8Array | undefined;
	try {
		[specSection] = readCustomSections(wasmBytecode, 'contractspecv0');
	} catch (error) {
		if (error instanceof WasmFormatError) {
			throw new ScanError('UNKNOWN', `INVALID_WASM: ${error.message}`);
		}

		throw error;
	}

	if (!specSection) {
		throw new ScanError('XDR_ALIGN_FAILURE', 'XDR_ALIGN_FAILURE');
	}

	const {functions, udtRegistry} = parseContractSpecSection(specSection);

	return {
		contractId,
		bytecodeSize: wasmBytecode.length,
		functions,
		udtRegistry,
	};
}

/**
 * Fetches deployed WASM for a Soroban contract, extracts its contractspecv0
 * section, and returns the parsed attack surface. The single reusable
 * scanner implementation — the TUI and any headless/CLI path both call this,
 * neither reimplements it.
 *
 * Never throws a raw SDK error — every failure is classified into a
 * ScanError with a stable `code` so callers can present it however they
 * need without string-matching `message`.
 */
export async function scanContract(
	contractId: string,
	server: SorobanRpc.Server,
): Promise<ScanResult> {
	try {
		const wasmBytecode = await server.getContractWasmByContractId(contractId);

		if (!wasmBytecode || wasmBytecode.length === 0) {
			throw new ScanError('CONTRACT_NOT_FOUND', 'CONTRACT_NOT_FOUND');
		}

		return scanWasmBytes(contractId, wasmBytecode);
	} catch (error) {
		if (error instanceof ScanError) throw error;

		const msg = error instanceof Error ? error.message : String(error);
		const rawMessage = msg.toLowerCase();

		if (rawMessage.includes('fetch') || rawMessage.includes('network')) {
			throw new ScanError('RPC_UNAVAILABLE', msg);
		}

		if (
			rawMessage.includes('404') ||
			rawMessage.includes('not found') ||
			rawMessage.includes('null')
		) {
			throw new ScanError('CONTRACT_NOT_FOUND', msg);
		}

		throw new ScanError('UNKNOWN', msg || 'Soroban RPC query failed.');
	}
}
