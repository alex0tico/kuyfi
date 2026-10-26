import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {runFuzz, SCAN_SUBREQUESTS} from './core/fuzz_runner.js';
import {assertTestnet, parseContractId, parseMaxVectors, parseMode, testnetRpcUrl, ToolError} from './core/guards.js';
import {buildScanReport, toPublicFunction} from './core/public_scan.js';
import {scanContract, ScanError} from './core/scanner.js';
import type {ScanResult} from './core/scanner.js';
import {buildCardModel, buildCardSvg, cardText} from './core/report_card.js';
import {consumeQuota, loadReport, newReportId, saveReport} from './core/storage.js';

export const FUZZ_PER_HOUR = 20;
export const SCAN_PER_HOUR = 60;
const DEFAULT_SUBREQUEST_BUDGET = 50; // Workers Free plan; raise via SUBREQUEST_BUDGET on a paid plan.

export interface ToolContext {
	kv: KVNamespace;
	/** GitHub login from the OAuth session. Required: every tool is per-user. */
	login: string | undefined;
	subrequestBudget?: number;
	/** Injectable for tests: SVG -> PNG. Production loads resvg-wasm lazily. */
	renderPng?: (svg: string) => Promise<Uint8Array>;
	/** Injectable for tests: official logo file contents. */
	logoSvg?: string;
	/** Injectable for tests; production uses the Testnet RPC. */
	scan?: (contractId: string) => Promise<ScanResult>;
}

export interface ToolResult {
	[key: string]: unknown;
	content: Array<{type: 'text'; text: string} | {type: 'image'; data: string; mimeType: 'image/png'}>;
	isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({content: [{type: 'text', text: JSON.stringify(value, null, 2)}]});
const fail = (message: string): ToolResult => ({content: [{type: 'text', text: message}], isError: true});

function requireLogin(ctx: ToolContext): string {
	if (!ctx.login) throw new ToolError('Authentication required: sign in with GitHub to use this tool.');
	return ctx.login;
}

async function doScan(ctx: ToolContext, contractId: string): Promise<ScanResult> {
	if (ctx.scan) return ctx.scan(contractId);
	return scanContract(contractId, new SorobanRpc.Server(testnetRpcUrl(), {allowHttp: false}));
}

function describeScanError(error: ScanError): string {
	switch (error.code) {
		case 'CONTRACT_NOT_FOUND':
			return 'Contract not found on Testnet (no deployed wasm for that contract_id).';
		case 'XDR_ALIGN_FAILURE':
			return 'The contract wasm has no readable contract spec (contractspecv0 section missing or malformed).';
		case 'RPC_UNAVAILABLE':
			return 'The Testnet RPC is unavailable right now. Try again shortly.';
		default:
			return `Scan failed: ${error.message}`;
	}
}

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof ToolError) return fail(error.message);
		if (error instanceof ScanError) return fail(describeScanError(error));
		console.error('tool failure', error instanceof Error ? error.name : 'unknown');
		return fail('Unexpected error while running the tool.');
	}
}

export function listFunctions(ctx: ToolContext, args: {contract_id: string; network?: string}): Promise<ToolResult> {
	return guarded(async () => {
		const login = requireLogin(ctx);
		assertTestnet(args.network);
		const contractId = parseContractId(args.contract_id);
		await consumeQuota(ctx.kv, login, 'scan', SCAN_PER_HOUR);
		const scan = await doScan(ctx, contractId);
		return ok({contract_id: contractId, network: 'testnet', functions: scan.functions.map(toPublicFunction)});
	});
}

export function scanContractTool(ctx: ToolContext, args: {contract_id: string; network?: string}): Promise<ToolResult> {
	return guarded(async () => {
		const login = requireLogin(ctx);
		assertTestnet(args.network);
		const contractId = parseContractId(args.contract_id);
		await consumeQuota(ctx.kv, login, 'scan', SCAN_PER_HOUR);
		const scan = await doScan(ctx, contractId);
		const report = buildScanReport(scan, newReportId());
		await saveReport(ctx.kv, login, report);
		return ok({report_id: report.reportId, expires_in: '24h', ...report});
	});
}

export function getReport(ctx: ToolContext, args: {report_id: string}): Promise<ToolResult> {
	return guarded(async () => {
		const login = requireLogin(ctx);
		return ok(await loadReport(ctx.kv, login, args.report_id));
	});
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** A PNG summary card for one of the caller's own reports, plus the same summary as text. */
export function reportCard(ctx: ToolContext, args: {report_id: string}): Promise<ToolResult> {
	return guarded(async () => {
		const login = requireLogin(ctx);
		// Same loader and owner rule as get_report.
		const report = await loadReport(ctx.kv, login, args.report_id);
		let model;
		try {
			model = buildCardModel(report);
		} catch {
			throw new ToolError('This report cannot be summarized as a card.');
		}

		const summary = cardText(model);
		try {
			let png: Uint8Array;
			if (ctx.renderPng) {
				png = await ctx.renderPng(buildCardSvg(model, {logoSvg: ctx.logoSvg ?? null}));
			} else {
				const worker = await import('./card_worker.js');
				png = await worker.renderCardPng(buildCardSvg(model, {logoSvg: worker.LOGO_SVG}));
			}

			return {content: [{type: 'image', data: toBase64(png), mimeType: 'image/png'}, {type: 'text', text: summary}]};
		} catch (error) {
			console.error('report_card render failed', error instanceof Error ? error.name : 'unknown');
			// The text summary still carries everything the image would.
			return {content: [{type: 'text', text: `${summary}\n\n(The image could not be generated.)`}]};
		}
	});
}

export function fuzzContract(
	ctx: ToolContext,
	args: {contract_id: string; mode?: string; max_vectors?: number; network?: string},
): Promise<ToolResult> {
	return guarded(async () => {
		const login = requireLogin(ctx);
		assertTestnet(args.network);
		parseMode(args.mode);
		const contractId = parseContractId(args.contract_id);
		const maxVectors = parseMaxVectors(args.max_vectors);
		const quota = await consumeQuota(ctx.kv, login, 'fuzz', FUZZ_PER_HOUR);
		const scan = await doScan(ctx, contractId);
		const report = await runFuzz(scan, {maxVectors, subrequestBudget: ctx.subrequestBudget ?? DEFAULT_SUBREQUEST_BUDGET}, newReportId());
		await saveReport(ctx.kv, login, report);
		return ok({report_id: report.reportId, expires_in: '24h', fuzz_calls_this_hour: `${quota.used}/${quota.limit}`, ...report});
	});
}

export {SCAN_SUBREQUESTS};
