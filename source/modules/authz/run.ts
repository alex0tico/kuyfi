import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {
	Account,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
	rpc as SorobanRpc,
	scValToNative,
	xdr,
} from '@stellar/stellar-sdk';
import {TESTNET_RPC_URL} from '../network.js';
import {CampaignServer} from '../chaos_monkey/campaign.js';
import {generateEphemeralKeypair} from '../chaos_monkey/keypair_factory.js';
import {classifyRejection, eventTopics} from './classify.js';
import {
	argToScVal,
	buildCustomAccountEntry,
	buildEd25519Entry,
	buildInvocation,
	summarizeTree,
} from './entries.js';
import {evaluateCase} from './evaluate.js';
import type {
	AuthzMatrix,
	CaseEvaluation,
	CaseSpec,
	InvocationSpec,
	ObservedResult,
} from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as {version: string};

/** The SDK does not export its package.json: walk up from its entry point. */
function sdkVersion(): string {
	let dir = path.dirname(require.resolve('@stellar/stellar-sdk'));
	for (let i = 0; i < 6; i++) {
		const file = path.join(dir, 'package.json');
		if (existsSync(file)) {
			const pkgJson = JSON.parse(readFileSync(file, 'utf8')) as {
				name?: string;
				version?: string;
			};
			if (pkgJson.name === '@stellar/stellar-sdk')
				return pkgJson.version ?? 'unknown';
		}

		dir = path.dirname(dir);
	}

	return 'unknown';
}

export class AuthzRunError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuthzRunError';
	}
}

export interface AuthzDeps {
	/** Defaults to a CampaignServer enforcing the matrix mode (simulate-only blocks sendTransaction). */
	server?: SorobanRpc.Server;
	relay?: Keypair;
	createEphemeral?: () => Promise<Keypair>;
	env?: Record<string, string | undefined>;
	networkPassphrase?: string;
	now?: () => Date;
	onProgress?: (message: string) => void;
}

export interface AuthzCaseReport {
	id: string;
	description?: string;
	expectation?: CaseSpec['expect'];
	control?: string;
	call: {contractId: string; function: string};
	/** What was supplied: never signatures or keys. */
	entries: Array<{
		actor: string;
		/** Custom account contract the entry is for (the actor then only signs). */
		accountContract?: string;
		variant: string;
		supplied: boolean;
		nonce?: string;
		expirationLedger?: number;
		tree?: unknown;
	}>;
	/** `enforce` is always sent explicitly: omitting authMode would run in recording mode. */
	authModeSent: 'enforce';
	source: string;
	observed: ObservedResult;
	evaluation: CaseEvaluation;
}

export interface AuthzReport {
	schemaVersion: '1.0.0';
	kind: 'authz-matrix';
	matrixId: string;
	/** File name and SHA-256 of the matrix as read, so evidence is tied to the exact input. */
	matrix?: {file: string; sha256: string};
	generatedAt: string;
	tool: {name: 'kuyfi'; version: string};
	environment: {
		network: 'testnet';
		rpcUrl: string;
		rpcVersion?: string;
		rpcProtocol?: number;
		sdkVersion: string;
	};
	mode: AuthzMatrix['mode'];
	authorizationRecord?: string;
	/** Source (relay) and actors, public keys only. */
	accounts: {relay: string; actors: Record<string, string>};
	cases: AuthzCaseReport[];
	summary: {
		total: number;
		executed: number;
		accepted: number;
		byState: Record<string, number>;
		/** Honest statement of what this report is. */
		note: string;
	};
}

const SIM_NOTE =
	'Evidence type per case: simulation under explicit enforcing mode unless onChain is present. A simulation discards its effects and never proves a state change.';

function treeFor(
	c: CaseSpec,
	entryTree: InvocationSpec | undefined,
): InvocationSpec {
	return (
		entryTree ?? {
			contractId: c.call.contractId,
			function: c.call.function,
			args: c.call.args,
		}
	);
}

/** Runs every case of the matrix and evaluates it against its expectation. */
export async function runAuthzMatrix(
	matrix: AuthzMatrix,
	deps: AuthzDeps = {},
): Promise<AuthzReport> {
	const passphrase = deps.networkPassphrase ?? Networks.TESTNET;
	const progress = deps.onProgress ?? (() => {});
	const now = deps.now ?? (() => new Date());
	const server =
		deps.server ?? new CampaignServer(TESTNET_RPC_URL, {mode: matrix.mode});
	const createEphemeral = deps.createEphemeral ?? generateEphemeralKeypair;
	const env = deps.env ?? process.env;

	// Source/relay is always its own ephemeral account; actors authorize only via entries.
	const relay = deps.relay ?? (await createEphemeral());
	const actors = new Map<string, Keypair>();
	for (const [name, spec] of Object.entries(matrix.actors)) {
		if (spec.source === 'env') {
			const secret = env[spec.secretEnv];
			if (!secret)
				throw new AuthzRunError(
					`actor "${name}": environment variable ${spec.secretEnv} is not set`,
				);
			actors.set(name, Keypair.fromSecret(secret));
		} else {
			actors.set(name, await createEphemeral());
		}
	}

	for (const [name, kp] of actors) {
		if (kp.publicKey() === relay.publicKey())
			throw new AuthzRunError(
				`actor "${name}" equals the relay/source account: source and actor must be separate`,
			);
	}

	const resolve = (name: string): Keypair => {
		const kp = actors.get(name);
		if (!kp) throw new AuthzRunError(`unknown actor "${name}"`);
		return kp;
	};

	const meta = await readEnvironment(server);
	const observed = new Map<string, ObservedResult>();
	const reports: AuthzCaseReport[] = [];

	for (const c of matrix.cases) {
		progress(`[${c.id}] ${c.description ?? `${c.call.function}`}`);
		const {report, result} = await runCase(
			c,
			matrix,
			server,
			relay,
			resolve,
			passphrase,
		);
		observed.set(c.id, result);
		reports.push(report);
	}

	for (const r of reports) {
		const spec = matrix.cases.find(c => c.id === r.id)!;
		r.evaluation = evaluateCase(
			spec.expect,
			observed.get(r.id),
			spec.control ? observed.get(spec.control) : undefined,
			spec.expect?.outcome === 'rejection' && spec.control !== undefined,
		);
		if (spec.expect?.outcome === 'rejection' && spec.control === undefined) {
			r.evaluation.reasons.push(
				'no paired control: rejection cannot be attributed',
			);
			r.evaluation.accepted = false;
			if (r.evaluation.state === 'expected_rejection')
				r.evaluation.state = 'inconclusive';
		}
	}

	const byState: Record<string, number> = {};
	for (const r of reports)
		byState[r.evaluation.state] = (byState[r.evaluation.state] ?? 0) + 1;
	return {
		schemaVersion: '1.0.0',
		kind: 'authz-matrix',
		matrixId: matrix.id,
		generatedAt: now().toISOString(),
		tool: {name: 'kuyfi', version: pkg.version},
		environment: {
			network: 'testnet',
			rpcUrl: TESTNET_RPC_URL,
			...meta,
			sdkVersion: sdkVersion(),
		},
		mode: matrix.mode,
		...(matrix.authorizationRecord
			? {authorizationRecord: matrix.authorizationRecord}
			: {}),
		accounts: {
			relay: relay.publicKey(),
			actors: Object.fromEntries(
				[...actors].map(([n, k]) => [n, k.publicKey()]),
			),
		},
		cases: reports,
		summary: {
			total: reports.length,
			executed: reports.filter(r => r.evaluation.executed).length,
			accepted: reports.filter(r => r.evaluation.accepted).length,
			byState,
			note: SIM_NOTE,
		},
	};
}

async function readEnvironment(server: SorobanRpc.Server) {
	try {
		const v = await (
			server as unknown as {
				getVersionInfo(): Promise<{version: string; protocolVersion: number}>;
			}
		).getVersionInfo();
		return {rpcVersion: v.version, rpcProtocol: v.protocolVersion};
	} catch {
		return {};
	}
}

async function runCase(
	c: CaseSpec,
	matrix: AuthzMatrix,
	server: SorobanRpc.Server,
	relay: Keypair,
	actor: (n: string) => Keypair,
	passphrase: string,
): Promise<{report: AuthzCaseReport; result: ObservedResult}> {
	const entriesReport: AuthzCaseReport['entries'] = [];
	const base = {
		id: c.id,
		...(c.description ? {description: c.description} : {}),
		...(c.expect ? {expectation: c.expect} : {}),
		...(c.control ? {control: c.control} : {}),
		call: {contractId: c.call.contractId, function: c.call.function},
		authModeSent: 'enforce' as const,
		source: relay.publicKey(),
	};
	const pending: CaseEvaluation = {
		state: 'not_exercised',
		executed: false,
		accepted: false,
		reasons: [],
	};
	try {
		const latestResponse = await server.getLatestLedger();
		const latest = latestResponse.sequence;
		const auth: xdr.SorobanAuthorizationEntry[] = [];
		for (const spec of c.authorization) {
			if (spec.variant === 'missing') {
				entriesReport.push({
					actor: spec.actor,
					variant: 'missing',
					supplied: false,
				});
				continue;
			}

			const offset =
				spec.expirationOffset ?? (spec.variant === 'expired' ? 10 : 50);
			const expiration =
				spec.variant === 'expired' ? latest - offset : latest + offset;
			if (expiration < 1)
				throw new AuthzRunError(`${c.id}: expiration would be < 1`);
			const treeSpec = treeFor(c, spec.tree);
			const common = {
				signer: actor(spec.actor),
				invocation: buildInvocation(treeSpec, actor),
				expirationLedger: expiration,
				variant: spec.variant,
				networkPassphrase: passphrase,
			};
			const built = spec.account
				? buildCustomAccountEntry({
						...common,
						accountContractId: spec.account.contractId,
						publicKeyField: spec.account.publicKeyField,
						signatureField: spec.account.signatureField,
					})
				: buildEd25519Entry(common);
			auth.push(built.entry);
			entriesReport.push({
				actor: spec.actor,
				...(spec.account ? {accountContract: spec.account.contractId} : {}),
				variant: spec.variant,
				supplied: true,
				nonce: built.nonce,
				expirationLedger: built.expirationLedger,
				tree: summarizeTree(built.entry.rootInvocation()),
			});
		}

		const account = await server.getAccount(relay.publicKey());
		const tx = new TransactionBuilder(account, {
			fee: '1000000',
			networkPassphrase: passphrase,
		})
			.addOperation(
				Operation.invokeContractFunction({
					contract: c.call.contractId,
					function: c.call.function,
					args: c.call.args.map(a => argToScVal(a, actor)),
					auth,
				}),
			)
			.setTimeout(120)
			.build();

		// authMode is ALWAYS explicit: omitted, the RPC simulates in recording mode
		// when there are no entries and cannot reject a missing authorization.
		const sim = await server.simulateTransaction(tx, undefined, 'enforce');
		let result: ObservedResult;
		if (SorobanRpc.Api.isSimulationError(sim)) {
			const cls = classifyRejection(sim.error);
			result = {
				outcome: 'rejection',
				stage: cls.stage,
				...(cls.contractErrorCode === undefined
					? {}
					: {contractErrorCode: cls.contractErrorCode}),
				diagnostic: sim.error,
				simulationLedger: sim.latestLedger,
				eventTopics: eventTopics(sim.events),
			};
		} else {
			result = {
				outcome: 'success',
				stage: 'none',
				simulationLedger: sim.latestLedger,
				minResourceFee: sim.minResourceFee,
				eventTopics: eventTopics(sim.events),
			};
			if (c.submit)
				await maybeSubmit(c, matrix, server, relay, tx, sim, result, actor);
		}

		return {
			report: {
				...base,
				entries: entriesReport,
				observed: result,
				evaluation: pending,
			},
			result,
		};
	} catch (error) {
		const result: ObservedResult = {
			outcome: 'operational_error',
			stage: 'operational',
			diagnostic: error instanceof Error ? error.message : String(error),
			eventTopics: [],
		};
		return {
			report: {
				...base,
				entries: entriesReport,
				observed: result,
				evaluation: pending,
			},
			result,
		};
	}
}

async function readState(
	server: SorobanRpc.Server,
	spec: NonNullable<CaseSpec['stateRead']>,
	actor: (n: string) => Keypair,
): Promise<unknown> {
	const tx = new TransactionBuilder(
		new Account(Keypair.random().publicKey(), '0'),
		{fee: '100', networkPassphrase: Networks.TESTNET},
	)
		.addOperation(
			Operation.invokeContractFunction({
				contract: spec.contractId,
				function: spec.function,
				args: spec.args.map(a => argToScVal(a, actor)),
			}),
		)
		.setTimeout(30)
		.build();
	const sim = await server.simulateTransaction(tx);
	if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) return undefined;
	return jsonSafe(scValToNative(sim.result.retval));
}

function jsonSafe(v: unknown): unknown {
	const text = JSON.stringify(v, (_k, x: unknown) =>
		typeof x === 'bigint' ? x.toString() : x,
	);
	return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

async function maybeSubmit(
	c: CaseSpec,
	matrix: AuthzMatrix,
	server: SorobanRpc.Server,
	relay: Keypair,
	tx: ReturnType<TransactionBuilder['build']>,
	sim:
		| SorobanRpc.Api.SimulateTransactionSuccessResponse
		| SorobanRpc.Api.SimulateTransactionRestoreResponse,
	result: ObservedResult,
	actor: (n: string) => Keypair,
): Promise<void> {
	if (matrix.mode !== 'broadcast') {
		result.submissionSkipped = 'simulate-only campaign: nothing is sent';
		return;
	}

	const stateBefore = c.stateRead
		? await readState(server, c.stateRead, actor)
		: undefined;
	const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
	prepared.sign(relay);
	const sent = await server.sendTransaction(prepared);
	if (sent.status !== 'PENDING') {
		result.onChain = {
			hash: sent.hash,
			ledger: null,
			status: `SEND_${sent.status}`,
		};
		return;
	}

	const final = await server.pollTransaction(sent.hash, {attempts: 40});
	await new Promise<void>(resolve => {
		setTimeout(resolve, 6000);
	});
	const stateAfter = c.stateRead
		? await readState(server, c.stateRead, actor)
		: undefined;
	result.onChain = {
		hash: sent.hash,
		ledger: 'ledger' in final ? (final.ledger as number) : null,
		status: String(final.status),
		...(c.stateRead ? {stateBefore, stateAfter} : {}),
	};
}
