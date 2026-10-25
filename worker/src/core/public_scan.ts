import {typeName} from './type_gen.js';
import type {UdtDef} from './udt_registry.js';
import type {ScanResult, ScannedFunction} from './scanner.js';
import {TESTNET_RPC_URL} from './network.js';

export const TOOL = {name: 'kuyfi-mcp', version: '0.0.1'};
export const SCHEMA_VERSION = '1.0.0';

export function toPublicFunction(fn: ScannedFunction) {
	return {
		name: fn.name,
		parameters: fn.params.map(p => ({name: p.name, type: typeName(p.type)})),
		returns: fn.outputs.map(o => typeName(o)),
		hasReturn: fn.hasReturn,
	};
}

export function toPublicUdt(def: UdtDef) {
	switch (def.kind) {
		case 'struct':
			return {kind: 'struct' as const, name: def.name, fields: def.fields.map(f => ({name: f.name, type: typeName(f.type)}))};
		case 'enum':
			return {kind: 'enum' as const, name: def.name, cases: def.cases.map(c => ({name: c.name, value: c.value}))};
		case 'union':
			return {kind: 'union' as const, name: def.name, cases: def.cases.map(c => ({name: c.name, valueTypes: c.valueTypes.map(typeName)}))};
	}
}

/** Same `target` + `scan` blocks as the CLI's JSON security report. */
export function buildScanReport(scan: ScanResult, reportId: string, now: Date = new Date()) {
	return {
		schemaVersion: SCHEMA_VERSION,
		reportId,
		kind: 'scan' as const,
		generatedAt: now.toISOString(),
		tool: TOOL,
		target: {contractId: scan.contractId, network: 'testnet' as const, rpcUrl: TESTNET_RPC_URL, bytecodeSize: scan.bytecodeSize},
		scan: {
			totalFunctions: scan.functions.length,
			functions: scan.functions.map(toPublicFunction),
			udts: [...scan.udtRegistry.values()].map(toPublicUdt),
		},
	};
}

export type ScanReport = ReturnType<typeof buildScanReport>;
