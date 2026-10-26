import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport, McpServer} from '@modelcontextprotocol/server';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {expect, it} from 'vitest';
import {z} from 'zod';
import {renderPng} from '../src/core/card_png.js';
import {scanWasmBytes} from '../src/core/scanner.js';
import {StrKey} from '@stellar/stellar-sdk';
import {reportCard, scanContractTool, type ToolContext} from '../src/tools.js';

const require = createRequire(import.meta.url);
const font = (n: string) => new Uint8Array(readFileSync(new URL(`../src/assets/fonts/${n}`, import.meta.url)));
const wasm = new Uint8Array(readFileSync(new URL('./fixtures/broken_access_control.wasm', import.meta.url)));
const deps = {wasm: new Uint8Array(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))), fonts: [font('IBMPlexMono-400.ttf'), font('IBMPlexMono-500.ttf')]};

it('an MCP client receives report_card as an image block followed by text, over the protocol', async () => {
	const store = new Map<string, string>();
	const kv = {get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v)} as unknown as KVNamespace;
	const ctx: ToolContext = {kv, login: 'alice', scan: async (id) => scanWasmBytes(id, wasm), renderPng: (svg) => renderPng(svg, deps)};
	const scanned = await scanContractTool(ctx, {contract_id: StrKey.encodeContract(Buffer.alloc(32, 7))});
	const scan = JSON.parse((scanned.content[0] as {text: string}).text);

	const server = new McpServer({name: 'test', version: '0'});
	server.registerTool('report_card', {description: 'card', inputSchema: z.object({report_id: z.string()})}, (args) => reportCard(ctx, args));
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const client = new Client({name: 'client', version: '0'});
	await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

	const result = await client.callTool({name: 'report_card', arguments: {report_id: scan.report_id}});
	const content = result.content as Array<{type: string; data?: string; mimeType?: string; text?: string}>;
	expect(content.map((c) => c.type)).toEqual(['image', 'text']);
	expect(content[0]!.mimeType).toBe('image/png');
	expect([...Buffer.from(content[0]!.data!, 'base64').subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	expect(content[1]!.text).toContain('Not a security guarantee');
});
