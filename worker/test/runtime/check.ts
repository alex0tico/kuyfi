// Runtime check, run under `wrangler dev` (workerd), not Node:
//   POST /scan   body = raw wasm bytes   -> functions/types + timings of the hand-written parser
//   GET  /sdk                            -> which Stellar SDK pieces work in this runtime
import {Keypair, rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {scanWasmBytes} from '../../src/core/scanner.js';
import {attackVals, baseline, typeName} from '../../src/core/type_gen.js';
import {TESTNET_RPC_URL} from '../../src/core/network.js';
import {fuzzContract, getReport, listFunctions, reportCard, scanContractTool, type ToolContext} from '../../src/tools.js';

const ITERATIONS = 200;

async function sdkChecks(): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const attempt = async (name: string, fn: () => unknown) => {
		try {
			out[name] = `ok ${JSON.stringify(await fn()) ?? ''}`.trim();
		} catch (error) {
			out[name] = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
		}
	};

	await attempt('Keypair.random', () => Keypair.random().publicKey().length);
	await attempt('WebAssembly.compile(runtime bytes)', async () => {
		await (WebAssembly as unknown as {compile(b: Uint8Array): Promise<unknown>}).compile(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
		return 'allowed';
	});
	await attempt('rpc.Server.getLatestLedger (1 subrequest)', async () => {
		const server = new SorobanRpc.Server(TESTNET_RPC_URL);
		return (await server.getHealth()).status;
	});
	return out;
}

interface CheckEnv {
	E2E_KV: KVNamespace;
	DEMO_CONTRACT_ID?: string;
}

/**
 * GET /e2e/<list_functions|scan_contract|fuzz_contract|get_report>?max=N&report=ID
 * Runs the real tool code against Testnet (read from DEMO_CONTRACT_ID in .dev.vars),
 * with a throwaway local KV and a fake user. Local verification only.
 */
async function e2e(url: URL, env: CheckEnv): Promise<Response> {
	const id = url.searchParams.get('id') ?? env.DEMO_CONTRACT_ID;
	if (!id) return new Response('DEMO_CONTRACT_ID is not set in worker/.dev.vars', {status: 500});
	const ctx: ToolContext = {kv: env.E2E_KV, login: url.searchParams.get('as') ?? 'e2e-local'};
	const tool = url.pathname.split('/')[2];
	const t0 = performance.now();
	let result;
	if (tool === 'list_functions') result = await listFunctions(ctx, {contract_id: id});
	else if (tool === 'scan_contract') result = await scanContractTool(ctx, {contract_id: id});
	else if (tool === 'fuzz_contract') result = await fuzzContract(ctx, {contract_id: id, max_vectors: Number(url.searchParams.get('max') ?? 20)});
	else if (tool === 'get_report') result = await getReport(ctx, {report_id: url.searchParams.get('report') ?? ''});
	else if (tool === 'report_card') result = await reportCard(ctx, {report_id: url.searchParams.get('report') ?? ''});
	else return new Response('unknown tool', {status: 404});
	const ms = Math.round(performance.now() - t0);
	const first = result.content[0]!;
	if (first.type === 'image') {
		return Response.json({ms, isError: false, image: {mimeType: first.mimeType, base64Length: first.data.length, base64: url.searchParams.get('png') ? first.data : undefined}, text: result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')});
	}

	return Response.json({ms, isError: result.isError ?? false, text: first.type === 'text' ? first.text : ''});
}

export default {
	async fetch(request: Request, env: CheckEnv): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/e2e/')) return e2e(url, env);
		if (url.pathname === '/sdk') return Response.json(await sdkChecks());

		if (url.pathname === '/scan' && request.method === 'POST') {
			const bytes = new Uint8Array(await request.arrayBuffer());
			const t0 = performance.now();
			const first = scanWasmBytes('CRUNTIMECHECK', bytes);
			const t1 = performance.now();
			for (let i = 0; i < ITERATIONS; i++) scanWasmBytes('CRUNTIMECHECK', bytes);
			const t2 = performance.now();

			// Type generation uses Keypair.random() and the SDK's xdr builders.
			let vectors = 0;
			for (const fn of first.functions) {
				for (const p of fn.params) {
					baseline(p.type, first.udtRegistry);
					vectors += attackVals(p.type, first.udtRegistry).length;
				}
			}

			return Response.json({
				bytes: bytes.length,
				functions: first.functions.map(f => ({
					name: f.name,
					params: f.params.map(p => [p.name, typeName(p.type)]),
					returns: f.outputs.map(o => typeName(o)),
				})),
				udts: first.udtRegistry.size,
				attackVectorsGenerated: vectors,
				timing: {
					firstCallMs: t1 - t0,
					avgOfIterationsMs: (t2 - t1) / ITERATIONS,
					iterations: ITERATIONS,
					note: 'performance.now() only advances across I/O in deployed Workers; 0 means the clock did not move.',
				},
			});
		}

		return new Response('POST /scan (wasm bytes) | GET /sdk', {status: 404});
	},
} satisfies ExportedHandler<CheckEnv>;
