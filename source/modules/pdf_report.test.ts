import test from 'ava';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {renderSecurityReportPdf} from './pdf_report.js';
import {serializeSecurityReport} from './security_report.js';
import type {SecurityReport} from './security_report.js';

/**
 * D2.4 — pdf_report.ts consumes ONLY SecurityReport. Every fixture below is
 * a plain object literal conforming to that public type — no ScanResult,
 * ChaosReport, FuzzResult, InvokeResult, DiagnosticEvent, or XDR anywhere
 * in this file, proving the renderer (and these tests) never need them.
 */

const STANDARD_FONT_DATA_URL = new URL(
	'../../node_modules/pdfjs-dist/standard_fonts/',
	import.meta.url,
).href;

async function extractPdfText(
	pdfBuffer: Buffer,
): Promise<{numPages: number; fullText: string}> {
	const data = new Uint8Array(pdfBuffer);
	const pdf = await getDocument({
		data,
		standardFontDataUrl: STANDARD_FONT_DATA_URL,
	}).promise;
	const pageTexts: string[] = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		// eslint-disable-next-line no-await-in-loop
		const page = await pdf.getPage(i);
		// eslint-disable-next-line no-await-in-loop
		const content = await page.getTextContent();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		pageTexts.push(
			content.items
				.map((item: any) => ('str' in item ? (item.str as string) : ''))
				.join(' '),
		);
	}

	return {numPages: pdf.numPages, fullText: pageTexts.join('\n')};
}

/**
 * pdfjs-dist returns each wrapped line as a separate text item; a long
 * unbroken token (a 56-char Contract ID, a 64-char tx hash) that visually
 * wraps across two lines therefore comes back as two adjacent items joined
 * by a space, breaking a naive substring match on the original token even
 * though the PDF itself renders it correctly (confirmed by visual
 * inspection). Stripping whitespace from both sides before comparing is the
 * standard way to make this kind of extraction-based assertion robust to
 * line wrapping — it doesn't merge unrelated words, since it removes
 * ALL whitespace rather than any specific line break.
 */
function normalizedIncludes(haystack: string, needle: string): boolean {
	const strip = (s: string) => s.replace(/\s+/g, '');
	return strip(haystack).includes(strip(needle));
}

function baseReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
	return {
		schemaVersion: '1.0.0',
		reportId: 'kyf-20260101T000000Z-deadbeef',
		generatedAt: '2026-01-01T00:00:00.000Z',
		tool: {name: 'kuyfi', version: '0.0.0'},
		target: {
			contractId: 'CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ',
			network: 'testnet',
			rpcUrl: 'https://soroban-testnet.stellar.org',
			bytecodeSize: 5409,
		},
		scan: {
			totalFunctions: 1,
			functions: [
				{
					name: 'echo_point',
					parameters: [{name: 'p', type: 'Point'}],
					hasReturn: true,
				},
			],
			udts: [
				{
					kind: 'struct',
					name: 'Point',
					fields: [
						{name: 'x', type: 'I128'},
						{name: 'y', type: 'I128'},
					],
				},
			],
		},
		execution: {
			vectorsExecuted: 10,
			broadcastTransactions: 10,
			transactionsWithHash: 10,
			verificationTransactions: [],
		},
		summary: {
			totalFindings: 0,
			bySeverity: {
				critical: 0,
				high: 0,
				medium: 0,
				low: 0,
				info: 0,
				preconditionFail: 0,
			},
			findingsBySignal: {},
		},
		findings: [],
		...overrides,
	};
}

const HASH_64 =
	'ae0bd15d76dfe6b169f49b970f1644919c9ad1932cee336d086fd75b2395c157';

function findingFixture(): SecurityReport['findings'][number] {
	return {
		id: 'KYF-001',
		functionName: 'echo_point',
		vectorName: 'p::Point.x::ZERO',
		signal: 'UNEXPECTED_ERROR',
		severity: 'MEDIUM',
		details: 'Structured trace shows a root-level generic host trap.',
		evidence: {
			simulationFailed: false,
			transaction: {
				broadcasted: true,
				hash: HASH_64,
				ledger: 4587371,
				explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH_64}`,
			},
			trace: {
				rootCall: {
					kind: 'fn_call',
					contractId: 'aa'.repeat(32),
					functionName: 'echo_point',
				},
				nestedCallCount: 0,
				involvedContractIds: ['aa'.repeat(32)],
				errors: [
					{
						category: 'WASM_VM',
						code: 'scecInvalidAction',
						contractId: 'aa'.repeat(32),
					},
				],
				hasAuthError: false,
				failureLocation: 'ROOT',
				malformed: false,
			},
		},
	};
}

// --- CASE A-G: core metadata / scan content present ------------------------

test('CASE A — PDF contains reportId', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes(report.reportId));
});

test('CASE B — PDF contains contractId', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(normalizedIncludes(fullText, report.target.contractId));
});

test('CASE C — PDF contains schemaVersion', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes(report.schemaVersion));
});

test('CASE D — PDF contains vectorsExecuted', async t => {
	const report = baseReport({
		execution: {
			vectorsExecuted: 57,
			broadcastTransactions: 57,
			transactionsWithHash: 57,
			verificationTransactions: [],
		},
	});
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes('57'));
});

test('CASE E — PDF contains totalFindings', async t => {
	const report = baseReport({
		summary: {
			totalFindings: 3,
			bySeverity: {
				critical: 1,
				high: 1,
				medium: 1,
				low: 0,
				info: 0,
				preconditionFail: 0,
			},
			findingsBySignal: {},
		},
	});
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes('Total findings') && fullText.includes('3'));
});

test('CASE F — PDF contains a scanned function', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes('echo_point'));
});

test('CASE G — PDF contains a UDT', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes('Point'));
	t.true(fullText.includes('STRUCT'));
});

// --- CASE H: a finding shows id/severity/signal/function/vector ------------

test('CASE H — a finding shows ID, severity, signal, function, and vector', async t => {
	const finding = findingFixture();
	const report = baseReport({
		findings: [finding],
		summary: {
			totalFindings: 1,
			bySeverity: {
				critical: 0,
				high: 0,
				medium: 1,
				low: 0,
				info: 0,
				preconditionFail: 0,
			},
			findingsBySignal: {UNEXPECTED_ERROR: 1},
		},
	});
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes(finding.id));
	t.true(fullText.includes(finding.severity));
	t.true(fullText.includes(finding.signal));
	t.true(fullText.includes(finding.functionName));
	t.true(fullText.includes(finding.vectorName));
});

// --- CASE I: verification transaction visible even with zero findings ------

test('CASE I — PDF contains verification tx hash + ledger, present even with zero findings', async t => {
	const report = baseReport({
		execution: {
			vectorsExecuted: 57,
			broadcastTransactions: 57,
			transactionsWithHash: 57,
			verificationTransactions: [
				{
					functionName: 'echo_point',
					vectorName: 'baseline::NO_ARGS',
					broadcasted: true,
					hash: HASH_64,
					ledger: 4587371,
					explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH_64}`,
				},
			],
		},
	});
	t.is(report.findings.length, 0);
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(normalizedIncludes(fullText, HASH_64));
	t.true(fullText.includes('4587371'));
	t.true(fullText.includes('stellar.expert'));
});

// --- CASE J: conservative zero-findings language ----------------------------

test('CASE J — zero findings shows NO REPORTABLE FINDINGS and never claims the contract is safe', async t => {
	const report = baseReport();
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);
	t.true(fullText.includes('NO REPORTABLE FINDINGS'));
	t.true(fullText.toLowerCase().includes('does not constitute'));
	for (const forbidden of [
		'SAFE CONTRACT',
		'SECURE CONTRACT',
		'NO VULNERABILITIES EXIST',
	]) {
		t.false(
			fullText.toUpperCase().includes(forbidden),
			`must not claim "${forbidden}"`,
		);
	}
});

// --- CASE K: JSON and PDF, from the same SecurityReport, agree -------------

test('CASE K — the same SecurityReport produces JSON and PDF that agree on reportId, contractId, totalFindings, and verification tx', async t => {
	const finding = findingFixture();
	const report = baseReport({
		findings: [finding],
		summary: {
			totalFindings: 1,
			bySeverity: {
				critical: 0,
				high: 0,
				medium: 1,
				low: 0,
				info: 0,
				preconditionFail: 0,
			},
			findingsBySignal: {UNEXPECTED_ERROR: 1},
		},
		execution: {
			vectorsExecuted: 5,
			broadcastTransactions: 5,
			transactionsWithHash: 5,
			verificationTransactions: [
				{
					functionName: 'echo_point',
					vectorName: 'baseline::NO_ARGS',
					broadcasted: true,
					hash: HASH_64,
					ledger: 42,
					explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH_64}`,
				},
			],
		},
	});

	const json = JSON.parse(serializeSecurityReport(report)) as SecurityReport;
	const {fullText} = await extractPdfText(
		await renderSecurityReportPdf(report),
	);

	t.is(json.reportId, report.reportId);
	t.true(fullText.includes(report.reportId));

	t.is(json.target.contractId, report.target.contractId);
	t.true(normalizedIncludes(fullText, report.target.contractId));

	t.is(json.summary.totalFindings, 1);
	t.true(fullText.includes('Total findings') && fullText.includes('1'));

	t.is(json.execution.verificationTransactions[0]!.hash, HASH_64);
	t.true(normalizedIncludes(fullText, HASH_64));
});

// --- Section 13: PDF validity -----------------------------------------------

test('PDF validity — starts with the %PDF magic header, non-empty, parses cleanly, page count >= 1', async t => {
	const report = baseReport();
	const pdfBuffer = await renderSecurityReportPdf(report);

	t.true(pdfBuffer.length > 0);
	t.is(pdfBuffer.subarray(0, 5).toString('latin1'), '%PDF-');

	await t.notThrowsAsync(async () => {
		const {numPages} = await extractPdfText(pdfBuffer);
		t.true(numPages >= 1);
	});
});

test('PDF validity — a report with several findings and many functions/UDTs still parses cleanly across multiple pages', async t => {
	const manyFunctions = Array.from({length: 30}, (_, i) => ({
		name: `function_${i}`,
		parameters: [{name: 'amount', type: 'I128'}],
		hasReturn: i % 2 === 0,
	}));
	const manyUdts = Array.from({length: 15}, (_, i) => ({
		kind: 'struct' as const,
		name: `Struct${i}`,
		fields: [{name: 'a', type: 'U32'}],
	}));
	const findings = Array.from({length: 5}, (_, i) => ({
		...findingFixture(),
		id: `KYF-00${i + 1}`,
	}));

	const report = baseReport({
		scan: {
			totalFunctions: manyFunctions.length,
			functions: manyFunctions,
			udts: manyUdts,
		},
		findings,
		summary: {
			totalFindings: 5,
			bySeverity: {
				critical: 0,
				high: 0,
				medium: 5,
				low: 0,
				info: 0,
				preconditionFail: 0,
			},
			findingsBySignal: {UNEXPECTED_ERROR: 5},
		},
	});

	const pdfBuffer = await renderSecurityReportPdf(report);
	const {numPages, fullText} = await extractPdfText(pdfBuffer);

	t.true(numPages > 1);
	t.true(fullText.includes('function_29'));
	t.true(fullText.includes('Struct14'));
	t.true(fullText.includes('KYF-005'));
});
