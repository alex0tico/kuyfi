import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
// The original CLI scanner, read-only: it compiles with WebAssembly.compile() in Node.
import {parseContractSpecSection as originalParse} from '../../source/modules/scanner.js';
import {typeName} from '../src/core/type_gen.js';
import {readCustomSections, readU32Leb, WasmFormatError} from '../src/core/wasm_sections.js';
import {ScanError, scanWasmBytes} from '../src/core/scanner.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const FIXTURES = ['composite_udt_fixture.wasm', 'broken_access_control.wasm'];

const normalize = (fns: Array<{name: string; params: Array<{name: string; type: unknown}>; hasReturn: boolean}>) =>
	fns.map(f => ({name: f.name, hasReturn: f.hasReturn, params: f.params.map(p => [p.name, typeName(p.type)])}));

describe('wasm section reader', () => {
	it('decodes LEB128 values', () => {
		expect(readU32Leb(Uint8Array.of(0x05), 0)).toEqual([5, 1]);
		expect(readU32Leb(Uint8Array.of(0xe5, 0x8e, 0x26), 0)).toEqual([624485, 3]);
		expect(readU32Leb(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x0f), 0)[0]).toBe(0xffffffff);
	});

	it('rejects malformed LEB128', () => {
		expect(() => readU32Leb(Uint8Array.of(0x80), 0)).toThrow(WasmFormatError);
		expect(() => readU32Leb(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x1f), 0)).toThrow(WasmFormatError);
		expect(() => readU32Leb(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x80, 0x01), 0)).toThrow(WasmFormatError);
	});

	it('rejects bad headers and truncated sections', () => {
		expect(() => readCustomSections(Uint8Array.of(1, 2, 3), 'x')).toThrow(WasmFormatError);
		expect(() => readCustomSections(Uint8Array.of(1, 2, 3, 4, 1, 0, 0, 0), 'x')).toThrow('bad magic');
		const truncated = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 0x20, 1, 120);
		expect(() => readCustomSections(truncated, 'x')).toThrow('past end');
	});

	it('returns every custom section with the name, in order, and ignores others', () => {
		const sec = (name: string, body: number[]) => [0, name.length + 1 + body.length, name.length, ...[...name].map(c => c.charCodeAt(0)), ...body];
		const bytes = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...sec('a', [1]), 1, 0, ...sec('a', [2, 3]), ...sec('b', [9]));
		expect(readCustomSections(bytes, 'a').map(s => [...s])).toEqual([[1], [2, 3]]);
		expect(readCustomSections(bytes, 'missing')).toEqual([]);
	});
});

describe('scanWasmBytes vs the original scanner', () => {
	for (const name of FIXTURES) {
		it(`${name}: same functions, parameter names and types, same UDTs`, async () => {
			const bytes = fixture(name);
			const mine = scanWasmBytes('CTEST', bytes);

			// Original path: WebAssembly.compile + customSections (Node only).
			const mod = await WebAssembly.compile(bytes);
			const [section] = WebAssembly.Module.customSections(mod, 'contractspecv0');
			const original = originalParse(Buffer.from(section!));

			expect(mine.functions.length).toBeGreaterThan(0);
			expect(normalize(mine.functions)).toEqual(normalize(original.functions as never));
			expect([...mine.udtRegistry.keys()]).toEqual([...original.udtRegistry.keys()]);
			expect(mine.bytecodeSize).toBe(bytes.length);
		});
	}

	it('the UDT fixture really exercises UDTs', () => {
		expect(scanWasmBytes('CTEST', fixture('composite_udt_fixture.wasm')).udtRegistry.size).toBeGreaterThan(0);
	});

	it('exposes output types (worker addition)', () => {
		const fns = scanWasmBytes('CTEST', fixture('broken_access_control.wasm')).functions;
		expect(fns.every(f => f.hasReturn === f.outputs.length > 0)).toBe(true);
	});

	it('classifies failures with the same codes', () => {
		const noSpec = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);
		expect(() => scanWasmBytes('C', noSpec)).toThrowError(expect.objectContaining({code: 'XDR_ALIGN_FAILURE'}));
		expect(() => scanWasmBytes('C', Uint8Array.of(1, 2, 3))).toThrowError(ScanError);
		expect(() => scanWasmBytes('C', Uint8Array.of(1, 2, 3))).toThrowError(expect.objectContaining({code: 'UNKNOWN'}));
	});
});
