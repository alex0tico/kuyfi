import {readFileSync} from 'node:fs';
import {rpc as SorobanRpc, StrKey} from '@stellar/stellar-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {simulationAllowance} from '../src/core/fuzz_runner.js';
import {scanWasmBytes} from '../src/core/scanner.js';
import {fuzzContract, getReport, listFunctions, scanContractTool, type ToolContext} from '../src/tools.js';

// Valid checksum, generated at runtime from 32 constant bytes; it points at nothing real.
const FAKE_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

class FakeKv {
	store = new Map<string, string>();
	ttl = new Map<string, number | undefined>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string, options?: {expirationTtl?: number}) {
		this.store.set(key, value);
		this.ttl.set(key, options?.expirationTtl);
	}
}

const wasm = new Uint8Array(readFileSync(new URL('./fixtures/broken_access_control.wasm', import.meta.url)));
const makeCtx = (kv: FakeKv, login: string | null = 'alice'): ToolContext => ({
	kv: kv as unknown as KVNamespace,
	login: login ?? undefined,
	scan: async id => scanWasmBytes(id, wasm),
});
const text = (r: {content: Array<{text: string}>}) => r.content[0]!.text;

afterEach(() => vi.restoreAllMocks());

describe('input validation', () => {
	it('rejects malformed contract ids, other networks, other modes and bad max_vectors', async () => {
		const ctx = makeCtx(new FakeKv());
		for (const bad of ['', 'G' + 'A'.repeat(55), 'C' + 'A'.repeat(54), 'c' + 'a'.repeat(55), 'C' + '1'.repeat(55)]) {
			const r = await listFunctions(ctx, {contract_id: bad});
			expect(r.isError).toBe(true);
			expect(text(r)).toContain('Invalid contract_id');
		}

		expect(text(await listFunctions(ctx, {contract_id: FAKE_ID, network: 'mainnet'}))).toContain('Testnet only');
		expect(text(await fuzzContract(ctx, {contract_id: FAKE_ID, network: 'public'}))).toContain('no mainnet');
		expect(text(await fuzzContract(ctx, {contract_id: FAKE_ID, mode: 'broadcast'}))).toContain('Only mode="simulate"');
		expect(text(await fuzzContract(ctx, {contract_id: FAKE_ID, max_vectors: 51}))).toContain('between 1 and 50');
		expect(text(await fuzzContract(ctx, {contract_id: FAKE_ID, max_vectors: 0}))).toContain('between 1 and 50');
	});

	it('requires a signed-in user', async () => {
		const r = await scanContractTool(makeCtx(new FakeKv(), null), {contract_id: FAKE_ID});
		expect(r.isError).toBe(true);
	});
});

describe('scan and reports', () => {
	it('list_functions returns input and output types', async () => {
		const r = JSON.parse(text(await listFunctions(makeCtx(new FakeKv()), {contract_id: FAKE_ID})));
		const fn = r.functions.find((f: {name: string}) => f.name === 'get_value');
		expect(fn.returns).toEqual(['I128']);
		const setter = r.functions.find((f: {name: string}) => f.name === 'set_admin_value');
		expect(setter.parameters).toEqual([
			{name: 'admin', type: 'Address'},
			{name: 'value', type: 'I128'},
		]);
	});

	it('scan_contract stores the report for 24h and only its owner can read it', async () => {
		const kv = new FakeKv();
		const scan = JSON.parse(text(await scanContractTool(makeCtx(kv, 'alice'), {contract_id: FAKE_ID})));
		expect(scan.report_id).toMatch(/^kyf-\d{8}T\d{6}Z-[0-9a-f]{12}$/);
		expect(scan.scan.totalFunctions).toBe(3);
		expect(kv.ttl.get(`report:${scan.report_id}`)).toBe(86400);

		const own = JSON.parse(text(await getReport(makeCtx(kv, 'alice'), {report_id: scan.report_id})));
		expect(own.reportId).toBe(scan.report_id);

		const other = await getReport(makeCtx(kv, 'bob'), {report_id: scan.report_id});
		expect(other.isError).toBe(true);
		expect(text(other)).toContain('Report not found');
		const missing = await getReport(makeCtx(kv, 'alice'), {report_id: 'kyf-20260101T000000Z-aaaaaaaaaaaa'});
		expect(text(missing)).toBe(text(other)); // does not reveal whether it exists
		expect((await getReport(makeCtx(kv, 'alice'), {report_id: '../x'})).isError).toBe(true);
	});
});

describe('fuzz_contract', () => {
	const mockSimulate = (impl: () => unknown) =>
		vi.spyOn(SorobanRpc.Server.prototype, 'simulateTransaction').mockImplementation((async () => impl()) as never);

	it('simulates only, honours max_vectors, and reports "no findings in this run" with a disclaimer', async () => {
		const sim = mockSimulate(() => ({_parsed: true, id: '1', latestLedger: 1, events: [], result: {auth: [], retval: undefined}}));
		const send = vi.spyOn(SorobanRpc.Server.prototype, 'sendTransaction');
		const r = JSON.parse(text(await fuzzContract(makeCtx(new FakeKv()), {contract_id: FAKE_ID, max_vectors: 5})));
		expect(sim.mock.calls.length).toBe(5);
		expect(send).not.toHaveBeenCalled();
		expect(r.execution).toMatchObject({vectorsExecuted: 5, broadcastTransactions: 0});
		expect(r.execution.vectorsNotRun).toBeGreaterThan(0);
		expect(r.verdict).toBe('no findings in this run');
		expect(r.disclaimer).toContain('Not a security guarantee');
		expect(r.summary.notEvaluated).toBeGreaterThanOrEqual(0);
		expect(text({content: [{text: JSON.stringify(r)}]})).not.toMatch(/\b(is|are|contract is) (secure|safe)\b/i);
	});

	it('an accepted access-control vector is NOT_EVALUATED, never a finding', async () => {
		mockSimulate(() => ({_parsed: true, id: '1', latestLedger: 1, events: [], result: {auth: [], retval: undefined}}));
		const r = JSON.parse(text(await fuzzContract(makeCtx(new FakeKv()), {contract_id: FAKE_ID, max_vectors: 50})));
		expect(r.summary.totalFindings).toBe(0);
		expect(r.summary.notEvaluated).toBeGreaterThan(0);
		expect(r.findings).toEqual([]);
	});

	it('a storage error with no explanatory trace is inconclusive, and tool failures are not findings', async () => {
		mockSimulate(() => ({_parsed: true, id: '1', latestLedger: 1, error: 'HostError: Error(Storage, MissingValue)', events: []}));
		const r = JSON.parse(text(await fuzzContract(makeCtx(new FakeKv()), {contract_id: FAKE_ID, max_vectors: 10})));
		expect(r.verdict).not.toBe('no findings in this run');
		expect(new Set(r.findings.map((f: {status: string}) => f.status))).toEqual(new Set(['inconclusive']));

		mockSimulate(() => {
			throw new Error('network down');
		});
		const e = JSON.parse(text(await fuzzContract(makeCtx(new FakeKv()), {contract_id: FAKE_ID, max_vectors: 3})));
		expect(e.summary.totalFindings).toBe(0);
		expect(e.summary.operationalErrors).toBeGreaterThan(0);
	});

	it('limits fuzz calls to 20 per hour per user, with a clear message', async () => {
		mockSimulate(() => ({_parsed: true, id: '1', latestLedger: 1, events: [], result: {auth: [], retval: undefined}}));
		const kv = new FakeKv();
		for (let i = 0; i < 20; i++) {
			expect((await fuzzContract(makeCtx(kv), {contract_id: FAKE_ID, max_vectors: 1})).isError).toBeUndefined();
		}

		const blocked = await fuzzContract(makeCtx(kv), {contract_id: FAKE_ID, max_vectors: 1});
		expect(blocked.isError).toBe(true);
		expect(text(blocked)).toMatch(/Rate limit reached: 20 fuzz calls per hour/);
		expect((await fuzzContract(makeCtx(kv, 'bob'), {contract_id: FAKE_ID, max_vectors: 1})).isError).toBeUndefined();
	});

	it('keeps simulations within the subrequest budget', () => {
		expect(simulationAllowance(50, 50)).toBe(47);
		expect(simulationAllowance(20, 50)).toBe(20);
		expect(simulationAllowance(50, 1000)).toBe(50);
		expect(simulationAllowance(50, 3)).toBe(0);
	});
});
