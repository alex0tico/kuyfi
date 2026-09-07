import {xdr} from '@stellar/stellar-sdk';

/**
 * Category of a structured Soroban ScError, derived from ScErrorType.
 * 'OTHER' covers real-but-rare XDR categories (sceCrypto/sceEvents/sceBudget/
 * sceValue) we don't yet have strong domain reasoning for. 'UNKNOWN' means the
 * error topic's payload could not be decoded as an ScError at all.
 */
export type TraceErrorCategory =
	| 'AUTH'
	| 'CONTRACT'
	| 'CONTEXT'
	| 'OBJECT'
	| 'STORAGE'
	| 'WASM_VM'
	| 'OTHER'
	| 'UNKNOWN';

export interface TraceCallFrame {
	kind: 'fn_call' | 'fn_return';
	/** Hex-encoded contract id, best-effort. Null if undecodable. */
	contractId: string | null;
	/** Best-effort function name, only when a Symbol topic could be read. */
	functionName: string | null;
}

export interface TraceErrorObservation {
	category: TraceErrorCategory;
	/** ScErrorCode name (e.g. 'scecInvalidAction'), or 'Contract#<n>' for sceContract, or null if undecodable. */
	code: string | null;
	/** Hex-encoded contract id the error event is attributed to, if present. */
	contractId: string | null;
}

export interface DiagnosticTraceAnalysis {
	/** Ordered fn_call/fn_return frames, in the order they appear in the array. */
	callFrames: TraceCallFrame[];
	/** First fn_call frame, assumed to be the root invocation under test. */
	rootCall: TraceCallFrame | null;
	/** fn_call frame count minus the root, floored at 0. */
	nestedCallCount: number;
	/** Deduplicated hex contract ids seen anywhere in the trace. */
	involvedContractIds: string[];
	/** Ordered error observations. */
	errors: TraceErrorObservation[];
	/** True if any observed error has category AUTH. */
	hasAuthError: boolean;
	/** Best-effort: whether the last error appears attributable to the root call's contract. */
	failureLocation: 'ROOT' | 'NESTED' | 'UNKNOWN';
	/** True if at least one event in the array could not be decoded as expected. */
	malformed: boolean;
}

function topicSymbolName(v: xdr.ScVal): string | null {
	try {
		return v.switch().name === 'scvSymbol' ? v.sym().toString() : null;
	} catch {
		return null;
	}
}

function eventContractId(event: xdr.DiagnosticEvent): string | null {
	try {
		const id = event.event().contractId();
		// xdr.Hash's .d.ts type (Opaque[]) doesn't match its runtime Buffer/Uint8Array shape.
		return id ? Buffer.from(id as unknown as Uint8Array).toString('hex') : null;
	} catch {
		return null;
	}
}

/**
 * Best-effort fallback only: fn_call/fn_return frames carry the target
 * contract id and function name among their topics, but the exact position
 * is not a guarantee we've verified beyond the two real traces this analyzer
 * was built from. Used only when event.contractId() (the documented,
 * first-class field) is null.
 */
function decodeFrameFromTopics(topics: xdr.ScVal[]): {
	contractId: string | null;
	functionName: string | null;
} {
	let contractId: string | null = null;
	let functionName: string | null = null;

	for (const t of topics.slice(1)) {
		try {
			const n = t.switch().name;
			if (n === 'scvSymbol' && functionName === null) {
				functionName = t.sym().toString();
			} else if (n === 'scvBytes' && contractId === null) {
				contractId = t.bytes().toString('hex');
			}
		} catch {
			// Unreadable topic entry — skip it, not fatal for the whole frame.
		}
	}

	return {contractId, functionName};
}

const ERROR_CATEGORY_MAP: Record<string, TraceErrorCategory> = {
	sceAuth: 'AUTH',
	sceContract: 'CONTRACT',
	sceContext: 'CONTEXT',
	sceObject: 'OBJECT',
	sceStorage: 'STORAGE',
	sceWasmVm: 'WASM_VM',
	sceCrypto: 'OTHER',
	sceEvents: 'OTHER',
	sceBudget: 'OTHER',
	sceValue: 'OTHER',
};

function decodeError(event: xdr.DiagnosticEvent, errorTopic: xdr.ScVal): TraceErrorObservation {
	const contractId = eventContractId(event);
	try {
		const scError = errorTopic.error();
		const typeName = scError.switch().name;
		const category = ERROR_CATEGORY_MAP[typeName] ?? 'UNKNOWN';
		const code = typeName === 'sceContract' ? `Contract#${scError.contractCode()}` : scError.code().name;
		return {category, code, contractId};
	} catch {
		return {category: 'UNKNOWN', code: null, contractId};
	}
}

/**
 * Extracts a structured, best-effort execution-trace analysis from a
 * DiagnosticEvent[] array. Never throws — any decode failure on an
 * individual event is swallowed and reflected in `malformed`; the function
 * always returns a usable (possibly mostly-empty) analysis object.
 *
 * Root-first frame ordering is assumed (matches the order observed in real
 * Testnet responses used to build this analyzer), but has only been
 * empirically verified against single-frame traces so far — treat
 * `failureLocation`/`nestedCallCount` on deeper traces as best-effort.
 */
export function analyzeDiagnosticTrace(events: xdr.DiagnosticEvent[]): DiagnosticTraceAnalysis {
	const callFrames: TraceCallFrame[] = [];
	const errors: TraceErrorObservation[] = [];
	const involvedContractIds = new Set<string>();
	let malformed = false;

	for (const event of events) {
		try {
			const topics = event.event().body().v0().topics();
			if (topics.length === 0) continue;

			const kind = topicSymbolName(topics[0]!);
			const directContractId = eventContractId(event);
			if (directContractId) involvedContractIds.add(directContractId);

			if (kind === 'fn_call' || kind === 'fn_return') {
				const decoded = decodeFrameFromTopics(topics);
				const contractId = directContractId ?? decoded.contractId;
				if (contractId) involvedContractIds.add(contractId);
				callFrames.push({kind, contractId, functionName: decoded.functionName});
			} else if (kind === 'error') {
				const errorTopic = topics.find(t => {
					try {
						return t.switch().name === 'scvError';
					} catch {
						return false;
					}
				});
				if (errorTopic) {
					errors.push(decodeError(event, errorTopic));
				} else {
					malformed = true;
				}
			}
			// 'log' and any other topic-0 kind are ignored — not used as evidence.
		} catch {
			malformed = true;
		}
	}

	const fnCallFrames = callFrames.filter(f => f.kind === 'fn_call');
	const rootCall = fnCallFrames[0] ?? null;
	const nestedCallCount = Math.max(fnCallFrames.length - 1, 0);
	const hasAuthError = errors.some(e => e.category === 'AUTH');

	let failureLocation: DiagnosticTraceAnalysis['failureLocation'] = 'UNKNOWN';
	const lastError = errors.length > 0 ? errors[errors.length - 1] : undefined;
	if (lastError?.contractId && rootCall?.contractId) {
		failureLocation = lastError.contractId === rootCall.contractId ? 'ROOT' : 'NESTED';
	} else if (lastError && nestedCallCount === 0) {
		failureLocation = 'ROOT';
	}

	return {
		callFrames,
		rootCall,
		nestedCallCount,
		involvedContractIds: [...involvedContractIds],
		errors,
		hasAuthError,
		failureLocation,
		malformed,
	};
}
