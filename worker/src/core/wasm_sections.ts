/**
 * Minimal WebAssembly binary reader. Cloudflare Workers block
 * WebAssembly.compile() on runtime bytes, so the custom sections are read by
 * hand instead of via WebAssembly.Module.customSections(). Pure: no Node APIs.
 */

export class WasmFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WasmFormatError';
	}
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d];
const VERSION = [0x01, 0x00, 0x00, 0x00];

/** Reads an unsigned LEB128 that must fit in 32 bits. Returns [value, nextOffset]. */
export function readU32Leb(bytes: Uint8Array, offset: number): [number, number] {
	let result = 0;
	let shift = 0;
	let pos = offset;
	for (let i = 0; i < 5; i++) {
		if (pos >= bytes.length) throw new WasmFormatError('unexpected end of data in LEB128');
		const byte = bytes[pos]!;
		pos++;
		// The 5th byte may only carry the top 4 bits of a u32.
		if (i === 4 && (byte & 0xf0) !== 0) throw new WasmFormatError('LEB128 does not fit in u32');
		result |= (byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return [result >>> 0, pos];
		shift += 7;
	}

	throw new WasmFormatError('LEB128 is longer than 5 bytes');
}

/**
 * Returns the payload of every custom section (id 0) named `name`, in file
 * order, like WebAssembly.Module.customSections(module, name).
 */
export function readCustomSections(bytes: Uint8Array, name: string): Uint8Array[] {
	if (bytes.length < 8) throw new WasmFormatError('file shorter than the 8-byte header');
	for (let i = 0; i < 4; i++) {
		if (bytes[i] !== MAGIC[i]) throw new WasmFormatError('bad magic number');
		if (bytes[4 + i] !== VERSION[i]) throw new WasmFormatError('unsupported version');
	}

	const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false});
	const found: Uint8Array[] = [];
	let offset = 8;

	while (offset < bytes.length) {
		const id = bytes[offset]!;
		const [size, bodyStart] = readU32Leb(bytes, offset + 1);
		const bodyEnd = bodyStart + size;
		if (bodyEnd > bytes.length) throw new WasmFormatError('section extends past end of file');

		if (id === 0) {
			const [nameLen, nameStart] = readU32Leb(bytes, bodyStart);
			const nameEnd = nameStart + nameLen;
			if (nameEnd > bodyEnd) throw new WasmFormatError('custom section name overruns its section');
			let sectionName: string;
			try {
				sectionName = decoder.decode(bytes.subarray(nameStart, nameEnd));
			} catch {
				throw new WasmFormatError('custom section name is not valid UTF-8');
			}

			if (sectionName === name) found.push(bytes.subarray(nameEnd, bodyEnd));
		}

		offset = bodyEnd;
	}

	return found;
}
