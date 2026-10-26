import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {renderPng} from '../src/core/card_png.js';
import {abbreviateContract, buildCardModel, buildCardSvg, cardText, CARD_HEIGHT, CARD_WIDTH, formatDate, placeLogo} from '../src/core/report_card.js';

const require = createRequire(import.meta.url);
const wasmBytes = new Uint8Array(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const font = (name: string) => new Uint8Array(readFileSync(new URL(`../src/assets/fonts/${name}`, import.meta.url)));
const deps = {wasm: wasmBytes, fonts: [font('IBMPlexMono-400.ttf'), font('IBMPlexMono-500.ttf')]};
const logoSvg = readFileSync(new URL('../src/assets/kuyfi-logo.svg', import.meta.url), 'utf8');

const ID = 'C' + 'A'.repeat(55); // placeholder-shaped, not a real contract
const base = {schemaVersion: '1.0.0', reportId: 'kyf-20261026T021733Z-0123456789ab', generatedAt: '2026-10-26T02:17:33.000Z', target: {contractId: ID, network: 'testnet'}};

export const fuzzClean = {
	...base,
	kind: 'fuzz',
	mode: 'simulate',
	execution: {vectorsExecuted: 16, vectorsGenerated: 16, vectorsNotRun: 0, vectorsNotGenerated: 4},
	verdict: 'no findings in this run',
	summary: {totalFindings: 0, byStatus: {supported: 0, hypothesis: 0, inconclusive: 0}, noFinding: 14, notEvaluated: 2, operationalErrors: 0},
	findings: [],
	coverage: {notEvaluated: [], operationalErrors: [], notRun: ['call-order sequences']},
};

export const fuzzFindings = {
	...fuzzClean,
	summary: {totalFindings: 5, byStatus: {supported: 1, hypothesis: 2, inconclusive: 2}, noFinding: 9, notEvaluated: 0, operationalErrors: 0},
	findings: [
		{id: 'KYF-001', severity: 'CRITICAL', status: 'hypothesis', signal: 'POTENTIAL_VULN', functionName: 'set_admin_value', vectorName: 'admin::RANDOM_ADDR_A'},
		{id: 'KYF-002', severity: 'MEDIUM', status: 'supported', signal: 'UNCONTROLLED_PANIC', functionName: 'withdraw', vectorName: 'amount::I128_MAX'},
		{id: 'KYF-003', severity: 'MEDIUM', status: 'inconclusive', signal: 'UNEXPECTED_ERROR', functionName: 'deposit', vectorName: 'amount::ZERO'},
		{id: 'KYF-004', severity: 'MEDIUM', status: 'inconclusive', signal: 'UNEXPECTED_ERROR', functionName: 'deposit', vectorName: 'amount::ONE'},
		{id: 'KYF-005', severity: 'HIGH', status: 'hypothesis', signal: 'POTENTIAL_VULN', functionName: 'a_function_with_a_very_long_name_that_must_be_truncated_safely', vectorName: 'x::y'},
	],
};

const scan = {...base, kind: 'scan', target: {...base.target, bytecodeSize: 5409}, scan: {totalFunctions: 6, functions: [], udts: [{}, {}, {}, {}]}};

describe('report card model and text', () => {
	it('abbreviates the contract to the first and last 6 characters and formats the date', () => {
		expect(abbreviateContract(ID)).toBe('CAAAAA…AAAAAA');
		expect(formatDate('2026-10-26T02:17:33.000Z')).toBe('2026-10-26 02:17 UTC');
	});

	it('a clean fuzz report says "no findings in this run" and shows exact numbers', () => {
		const m = buildCardModel(fuzzClean);
		expect(m.verdict).toBe('no findings in this run');
		expect(m.stats.map((s) => [s.label, s.value])).toEqual([
			['EXECUTED', '16 of 16'],
			['SUPPORTED', '0'],
			['HYPOTHESIS', '0'],
			['INCONCLUSIVE', '0'],
			['NO FINDING', '14'],
			['NOT EVALUATED', '2'],
		]);
		expect(m.notEvaluated).toContain('authorization checks (2 vectors)');
		expect(m.notEvaluated).toContain('stateful call sequences');
		expect(cardText(m)).toContain('Bounded black-box simulation on Testnet. Not a security guarantee.');
	});

	it('shows at most 3 findings and "+N more"', () => {
		const m = buildCardModel(fuzzFindings);
		expect(m.findings).toHaveLength(3);
		expect(m.moreFindings).toBe(2);
		expect(m.verdict).toBe('5 finding(s): 1 supported · 2 hypothesis · 2 inconclusive');
		expect(cardText(m)).toContain('+2 more');
	});

	it('a scan report shows functions, types and bytecode size', () => {
		const m = buildCardModel(scan);
		expect(m.stats.map((s) => [s.label, s.value])).toEqual([
			['FUNCTIONS', '6'],
			['TYPES', '4'],
			['BYTECODE', '5,409 bytes'],
		]);
		expect(m.mode).toBe('read-only');
	});

	it('rejects unknown report shapes', () => {
		expect(() => buildCardModel({kind: 'other'})).toThrow();
		expect(() => buildCardModel(null)).toThrow();
	});

	it('never claims a contract is safe or secure', () => {
		for (const r of [fuzzClean, fuzzFindings, scan]) {
			const m = buildCardModel(r);
			expect(cardText(m) + buildCardSvg(m)).not.toMatch(/\b(is|are) (safe|secure)\b|\bsecure\b/i);
		}
	});
});

describe('report card SVG', () => {
	it('is 1200x630 and carries the brand tagline in gold, the wordmark fallback and the disclaimer', () => {
		const svg = buildCardSvg(buildCardModel(fuzzClean));
		expect(svg).toContain(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`);
		expect(svg).toContain('BEFORE THE BREACH');
		expect(svg).toContain('#EBB700');
		expect(svg).toContain('>KUYFI<');
		expect(svg).toContain('Not a security guarantee.');
		expect(svg).toContain('simulation'.toUpperCase());
		expect(svg).not.toMatch(/DxRuiga/i);
	});

	it('escapes markup coming from the report and keeps long names within the card', () => {
		const evil = {...fuzzFindings, findings: [{...fuzzFindings.findings[0], functionName: '<script>&"x"', vectorName: 'v'}]};
		const svg = buildCardSvg(buildCardModel(evil));
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('&lt;script&gt;&amp;&quot;x&quot;');
		const long = buildCardSvg(buildCardModel(fuzzFindings));
		expect(long).toContain('…');
	});

	it('embeds the official logo file as given: position and size only, content untouched', () => {
		const logo = readFileSync(new URL('../src/assets/kuyfi-logo.svg', import.meta.url), 'utf8');
		const svg = buildCardSvg(buildCardModel(fuzzClean), {logoSvg: logo});
		// 72 px tall, top-left.
		expect(svg).toMatch(/<svg[^>]*x="48" y="34" width="72" height="72">/);
		expect(svg).not.toContain('<?xml');
		// Everything between the logo's own <svg> tags is byte-identical to the file.
		const inner = (s: string) => s.slice(s.indexOf('>', s.indexOf('<svg')) + 1, s.lastIndexOf('</svg>')).trim();
		expect(svg).toContain(inner(logo));
		// Tagline next to it, wordmark kept because the logo has no text.
		expect(svg).toContain('BEFORE THE BREACH');
		expect(svg).toContain('>KUYFI<');
	});

	it('rejects a logo that is not an SVG document', () => {
		expect(() => placeLogo('<html/>', 0, 0, 72)).toThrow();
	});
});

describe('report card PNG', () => {
	const dims = (png: Uint8Array) => {
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		return [view.getUint32(16), view.getUint32(20)];
	};

	for (const [name, report] of [['clean fuzz', fuzzClean], ['fuzz with findings', fuzzFindings], ['scan', scan]] as const) {
		it(`${name}: valid PNG signature and 1200x630`, async () => {
			const png = await renderPng(buildCardSvg(buildCardModel(report), {logoSvg}), deps);
			expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			expect(dims(png)).toEqual([CARD_WIDTH, CARD_HEIGHT]);
			expect(png.length).toBeGreaterThan(5000);
		});
	}
});
