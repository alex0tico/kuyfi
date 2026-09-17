import test from 'ava';
import {
	selectCliMode,
	runHeadlessAudit,
	describeAuditError,
	defaultReportFileName,
	defaultPdfReportFileName,
} from './cli_runtime.js';
import {ScanError} from './scanner.js';
import type {ScanResult} from './scanner.js';
import type {ChaosReport} from './chaos_monkey/index.js';

/**
 * D2.2 — CASE D/E/F: pure mode selection, no Ink/meow/process involved.
 */

test('CASE D — no positional args selects the TUI path', t => {
	t.deepEqual(selectCliMode([]), {kind: 'tui'});
});

test('CASE E — a valid Contract ID selects the headless path', t => {
	const contractId = `C${'A'.repeat(55)}`;
	t.deepEqual(selectCliMode([contractId]), {kind: 'headless', contractId});
});

test('CASE F — an invalid Contract ID is rejected (not silently sent to TUI or headless)', t => {
	t.deepEqual(selectCliMode(['NOTVALID']), {
		kind: 'invalid',
		contractId: 'NOTVALID',
	});
});

// --- CASE G/H: runHeadlessAudit exit-code behavior, via the scan/chaos injection seam ---

function fakeScanResult(contractId: string): ScanResult {
	return {contractId, bytecodeSize: 10, functions: [], udtRegistry: new Map()};
}

function fakeChaosReport(
	contractId: string,
	overrides: Partial<ChaosReport['summary']> = {},
): ChaosReport {
	return {
		contractId,
		scannedAt: new Date().toISOString(),
		network: 'testnet',
		totalFunctions: 0,
		totalVectorsRun: 1,
		findings: [],
		summary: {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			preconditionFail: 0,
			broadcastTransactions: 0,
			transactionsWithHash: 0,
			...overrides,
		},
		verificationTransactions: [],
	};
}

test('CASE G — a run that completes with an UNEXPECTED_ERROR/CRITICAL finding still exits 0 (a security finding is not a tool failure)', async t => {
	const contractId = `C${'B'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId, {critical: 1}),
	});

	t.is(result.exitCode, 0);
	t.is(result.errorOutput, null);
	t.truthy(result.output);
	t.true(result.output!.includes('KUYFI AUDIT COMPLETE'));
});

test('CASE H — a scanner ScanError propagates as a tool failure: exitCode 1, clear message, no report', async t => {
	const contractId = `C${'C'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => {
			throw new ScanError('CONTRACT_NOT_FOUND', 'CONTRACT_NOT_FOUND');
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.output, null);
	t.truthy(result.errorOutput);
	t.true(result.errorOutput!.toLowerCase().includes('not found'));
});

test('CASE H (continued) — a Chaos Monkey internal failure also propagates as exitCode 1', async t => {
	const contractId = `C${'D'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => {
			throw new Error('Ephemeral keypair funding failed after 3 retries');
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.output, null);
	t.regex(result.errorOutput!, /funding failed/);
});

// --- D2.3 — CASE O/P/Q/R: --json file output, via the writeFile injection seam (no real disk I/O) ---

test('CASE Q — headless without --json behaves exactly as D2.2 (no file, no reportFilePath)', async t => {
	const contractId = `C${'E'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
	});

	t.is(result.exitCode, 0);
	t.is(result.reportFilePath, null);
	t.truthy(result.output);
	t.false(result.output!.includes('JSON report written'));
});

test('CASE R / CASE O — headless with --json writes a valid SecurityReport JSON file and reports its path', async t => {
	const contractId = `C${'F'.repeat(55)}`;
	let writtenPath: string | undefined;
	let writtenContent: string | undefined;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
		writeJson: true,
		writeFile: async (path, data) => {
			writtenPath = path as string;
			writtenContent = data as string;
		},
	});

	t.is(result.exitCode, 0);
	t.truthy(result.reportFilePath);
	t.is(writtenPath, result.reportFilePath ?? undefined);
	t.true(result.output!.includes('JSON report written to'));

	// The file content is a valid, parseable SecurityReport — not a raw AuditRun/ChaosReport dump.
	const parsed = JSON.parse(writtenContent!) as {
		schemaVersion: string;
		target: {contractId: string};
	};
	t.is(parsed.schemaVersion, '1.0.0');
	t.is(parsed.target.contractId, contractId);
});

test('CASE P — an existing-file collision (EEXIST) does not silently overwrite: exitCode 1, clear message', async t => {
	const contractId = `C${'G'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
		writeJson: true,
		writeFile: async () => {
			const error = new Error('file already exists') as NodeJS.ErrnoException;
			error.code = 'EEXIST';
			throw error;
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.reportFilePath, null);
	t.is(result.output, null);
	t.true(result.errorOutput!.toLowerCase().includes('refusing to overwrite'));
});

test('a non-EEXIST file write failure is also a tool failure (exitCode 1), distinctly worded from a collision', async t => {
	const contractId = `C${'H'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
		writeJson: true,
		writeFile: async () => {
			throw new Error('disk full');
		},
	});

	t.is(result.exitCode, 1);
	t.true(result.errorOutput!.includes('disk full'));
	t.false(result.errorOutput!.toLowerCase().includes('refusing to overwrite'));
});

test('defaultReportFileName is stable and filesystem-safe', t => {
	t.is(
		defaultReportFileName('kyf-20260909T120000Z-a1b2c3d4'),
		'kuyfi-report-kyf-20260909T120000Z-a1b2c3d4.json',
	);
	// Defensive sanitization even if reportId's format ever changes.
	t.is(defaultReportFileName('weird/../id'), 'kuyfi-report-weird_.._id.json');
});

// --- D2.4 — --pdf output and the --json --pdf single-run guarantee ---------

test("defaultPdfReportFileName mirrors defaultReportFileName's convention, with a .pdf extension", t => {
	t.is(
		defaultPdfReportFileName('kyf-20260909T120000Z-a1b2c3d4'),
		'kuyfi-report-kyf-20260909T120000Z-a1b2c3d4.pdf',
	);
	t.is(defaultPdfReportFileName('weird/../id'), 'kuyfi-report-weird_.._id.pdf');
});

test('headless with --pdf writes a PDF file via renderSecurityReportPdf, without calling the real PDF renderer', async t => {
	const contractId = `C${'I'.repeat(55)}`;
	let renderedReport: {reportId: string} | undefined;
	let writtenPath: string | undefined;
	let writtenIsBuffer = false;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
		writePdf: true,
		renderPdf: async report => {
			renderedReport = report;
			return Buffer.from('%PDF-fake-content');
		},
		writeFile: async (path, data) => {
			writtenPath = path as string;
			writtenIsBuffer = Buffer.isBuffer(data);
		},
	});

	t.is(result.exitCode, 0);
	t.truthy(result.pdfFilePath);
	t.is(writtenPath, result.pdfFilePath ?? undefined);
	t.true(writtenIsBuffer);
	t.true(result.output!.includes('PDF report written to'));
	t.regex(result.pdfFilePath!, /\.pdf$/);
	t.truthy(renderedReport, 'the injected renderPdf must have been invoked');
});

test('a PDF file collision (EEXIST) does not silently overwrite: exitCode 1, clear message, distinct from JSON wording', async t => {
	const contractId = `C${'J'.repeat(55)}`;

	const result = await runHeadlessAudit(contractId, {
		scan: async () => fakeScanResult(contractId),
		chaos: async () => fakeChaosReport(contractId),
		writePdf: true,
		renderPdf: async () => Buffer.from('%PDF-fake-content'),
		writeFile: async () => {
			const error = new Error('file already exists') as NodeJS.ErrnoException;
			error.code = 'EEXIST';
			throw error;
		},
	});

	t.is(result.exitCode, 1);
	t.is(result.pdfFilePath, null);
	t.true(result.errorOutput!.toLowerCase().includes('refusing to overwrite'));
	t.true(result.errorOutput!.endsWith('.pdf'));
});

test('--json --pdf together: runAudit and buildSecurityReport each run exactly once, and both files come from the SAME SecurityReport (same reportId)', async t => {
	const contractId = `C${'K'.repeat(55)}`;
	let auditCallCount = 0;
	let renderCallCount = 0;
	let jsonReportId: string | undefined;
	let pdfReportId: string | undefined;
	const writes: Array<{path: string; isBuffer: boolean}> = [];

	const result = await runHeadlessAudit(contractId, {
		runAudit: async () => {
			auditCallCount++;
			return {
				scan: fakeScanResult(contractId),
				chaos: fakeChaosReport(contractId),
			};
		},
		writeJson: true,
		writePdf: true,
		renderPdf: async report => {
			renderCallCount++;
			pdfReportId = report.reportId;
			return Buffer.from('%PDF-fake-content');
		},
		writeFile: async (path, data) => {
			writes.push({path: path as string, isBuffer: Buffer.isBuffer(data)});
			if (!Buffer.isBuffer(data)) {
				jsonReportId = (JSON.parse(data as string) as {reportId: string})
					.reportId;
			}
		},
	});

	t.is(auditCallCount, 1, 'runAudit must run exactly once');
	t.is(renderCallCount, 1, 'the PDF renderer must run exactly once');
	t.is(writes.length, 2, 'exactly one JSON write and one PDF write');
	t.is(result.exitCode, 0);
	t.truthy(result.reportFilePath);
	t.truthy(result.pdfFilePath);
	t.not(result.reportFilePath, result.pdfFilePath);
	t.truthy(jsonReportId);
	t.is(
		jsonReportId,
		pdfReportId,
		'JSON and PDF must share the exact same reportId — one SecurityReport, not two',
	);
});

test('describeAuditError maps every ScanError code to a distinct, clear message', t => {
	t.true(
		describeAuditError(new ScanError('CONTRACT_NOT_FOUND', 'x'))
			.toLowerCase()
			.includes('not found'),
	);
	t.true(
		describeAuditError(new ScanError('XDR_ALIGN_FAILURE', 'x'))
			.toLowerCase()
			.includes('parse'),
	);
	t.true(
		describeAuditError(new ScanError('RPC_UNAVAILABLE', 'x'))
			.toLowerCase()
			.includes('unreachable'),
	);
	t.true(describeAuditError(new ScanError('UNKNOWN', 'boom')).includes('boom'));
	t.true(
		describeAuditError(new Error('generic failure')).includes(
			'generic failure',
		),
	);
});
