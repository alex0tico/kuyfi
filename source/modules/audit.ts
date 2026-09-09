import {rpc as SorobanRpc} from '@stellar/stellar-sdk';
import {scanContract} from './scanner.js';
import type {ScanResult} from './scanner.js';
import {TESTNET_RPC_URL} from './network.js';
import {runChaosMonkey} from './chaos_monkey/index.js';
import type {ChaosMonkeyOptions, ChaosReport} from './chaos_monkey/index.js';

/**
 * Result of one full audit run: the OSINT scan phase plus the Chaos Monkey
 * phase. Internal/runtime shape for D2.2 — NOT the public JSON schema
 * (that's D2.3's SecurityReport). No data is duplicated: ChaosReport already
 * carries its own contractId/network, so AuditRun only adds `scan` alongside
 * it rather than re-flattening fields.
 */
export interface AuditRun {
	scan: ScanResult;
	chaos: ChaosReport;
}

export interface RunAuditOptions {
	/** Defaults to a Testnet SorobanRpc.Server — override only for tests. */
	server?: SorobanRpc.Server;
	onProgress?: (message: string) => void;
	/** Injection seams for tests — production callers never need these. */
	scan?: typeof scanContract;
	chaos?: (options: ChaosMonkeyOptions) => Promise<ChaosReport>;
}

/**
 * Thin, Ink-free orchestrator: scanContract() → runChaosMonkey(), passing
 * scan.functions and scan.udtRegistry straight through as Chaos Monkey's
 * inputs. This is the one place TUI and CLI both call to run a complete
 * audit — neither reimplements the scan→chaos wiring itself.
 */
export async function runAudit(contractId: string, options: RunAuditOptions = {}): Promise<AuditRun> {
	const server = options.server ?? new SorobanRpc.Server(TESTNET_RPC_URL);
	const onProgress = options.onProgress ?? (() => {});
	const scan = options.scan ?? scanContract;
	const chaos = options.chaos ?? runChaosMonkey;

	onProgress(`Scanning ${contractId}...`);
	const scanResult = await scan(contractId, server);
	onProgress(
		`Scan complete — ${scanResult.functions.length} function(s), ${scanResult.udtRegistry.size} UDT type(s).`,
	);

	const chaosReport = await chaos({
		contractId,
		functions: scanResult.functions,
		udtRegistry: scanResult.udtRegistry,
		onProgress,
	});

	return {scan: scanResult, chaos: chaosReport};
}

/**
 * Human-readable headless summary, rendered from the existing domain
 * objects only (ScanResult + ChaosReport) — no string-parsing of `details`,
 * no re-derivation of anything the audit already computed. Not a source of
 * truth; D2.3's JSON/PDF will read the same domain objects independently.
 */
export function formatAuditSummary(scan: ScanResult, chaos: ChaosReport): string {
	const lines: string[] = [];

	lines.push('KUYFI AUDIT COMPLETE');
	lines.push('');
	lines.push(`Contract: ${scan.contractId}`);
	lines.push(`Network: ${chaos.network.toUpperCase()}`);
	lines.push(`Functions scanned: ${scan.functions.length}`);
	lines.push(`Vectors executed: ${chaos.totalVectorsRun}`);
	lines.push(`Findings: ${chaos.findings.length}`);
	lines.push(`  Critical: ${chaos.summary.critical}`);
	lines.push(`  High: ${chaos.summary.high}`);
	lines.push(`  Medium: ${chaos.summary.medium}`);
	lines.push(`  Low: ${chaos.summary.low}`);
	lines.push(`  Info: ${chaos.summary.info}`);
	lines.push('');
	lines.push('Evidence:');
	lines.push(`  Broadcast transactions: ${chaos.summary.broadcastTransactions}`);
	lines.push(`  Transactions with hash: ${chaos.summary.transactionsWithHash}`);

	return lines.join('\n');
}
