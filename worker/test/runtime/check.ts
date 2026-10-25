// Runtime check, run under `wrangler dev` (workerd), not Node:
//   POST /scan   body = raw wasm bytes   -> functions/types + timings of the hand-written parser
//   GET  /sdk                            -> which Stellar SDK pieces work in this runtime
import {Keypair, rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {scanWasmBytes} from '../../src/core/scanner.js';
import {attackVals, baseline, typeName} from '../../src/core/type_gen.js';
import {TESTNET_RPC_URL} from '../../src/core/network.js';

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

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
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
} satisfies ExportedHandler;
