import type {xdr} from '@stellar/stellar-sdk';
import type {InvokeResult} from './router.js';
import {analyzeDiagnosticTrace} from './trace_analyzer.js';
import type {DiagnosticTraceAnalysis} from './trace_analyzer.js';

export type VulnerabilitySignal =
	| 'SECURE'
	| 'POTENTIAL_VULN'
	| 'UNCONTROLLED_PANIC'
	| 'UNEXPECTED_ERROR'
	| 'TIMEOUT'
	| 'PRECONDITION_FAIL'
	| 'SIMULATION_FAIL';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * JSON-safe execution evidence for one invocation, carried forward from
 * InvokeResult so it survives past classification instead of being
 * discarded. Never holds a raw SDK/XDR object — `trace` is the already
 * JSON-safe DiagnosticTraceAnalysis (structured, not stringified), and
 * `transactionHash`/`ledger` are plain values straight off InvokeResult.
 *
 * `broadcasted` and `transactionHash` are deliberately independent: a
 * SEND_ERROR outcome can carry a locally-computed envelope hash while
 * `broadcasted` is false (the node rejected it before it reached the
 * network) — never infer one field from the other.
 */
export interface ExecutionEvidence {
	broadcasted: boolean;
	/**
	 * Mirrors InvokeResult.success — whether the transaction actually
	 * confirmed SUCCESS on-chain (as opposed to broadcasted-but-TX_FAILED,
	 * or never broadcast at all). Added in D2.3 so a report can distinguish
	 * "first successful broadcast" from "first failed broadcast" when
	 * selecting verification transaction evidence — see reporter.ts.
	 */
	success: boolean;
	transactionHash: string | null;
	ledger: number | null;
	simulationFailed: boolean;
	trace: DiagnosticTraceAnalysis;
}

export interface ParsedResult {
	signal: VulnerabilitySignal;
	severity: Severity;
	details: string;
	rawErrorCode: string | null;
	functionName: string;
	vectorName: string;
	evidence: ExecutionEvidence;
}

/**
 * Pure, Testnet-only URL builder — no mainnet path, per current project
 * scope (Testnet-only sprint). Returns null for an empty/falsy hash so
 * callers never have to special-case "no evidence" themselves.
 */
export function stellarExpertTestnetUrl(
	transactionHash: string | null,
): string | null {
	if (!transactionHash) return null;
	return `https://stellar.expert/explorer/testnet/tx/${transactionHash}`;
}

export function signalToSeverity(
	signal: VulnerabilitySignal,
	isAdminFunction: boolean,
): Severity {
	switch (signal) {
		case 'POTENTIAL_VULN':
			return isAdminFunction ? 'CRITICAL' : 'HIGH';
		case 'UNCONTROLLED_PANIC':
			return 'MEDIUM';
		case 'UNEXPECTED_ERROR':
			return 'MEDIUM';
		case 'PRECONDITION_FAIL':
			return 'LOW';
		case 'TIMEOUT':
			return 'LOW';
		case 'SIMULATION_FAIL':
			return 'LOW';
		case 'SECURE':
			return 'INFO';
	}
}

/**
 * Error taxonomy for Soroban RPC error strings:
 *
 *   TX_FAILED (on-chain)                    → PRECONDITION_FAIL (passed simulation but failed on-chain;
 *                                              typically missing token balance or protocol state)
 *   Failed nested/cross-contract call in the
 *     event log (e.g. a token `transfer`)    → PRECONDITION_FAIL (the trap is a downstream symptom of a
 *                                              failed external call, not a bug in the contract under test)
 *   Error(Auth,) / require_auth             → PRECONDITION_FAIL (test account has no admin signer/allowance)
 *   REINIT_ATTACK / RANDOM_ADDR_* vector
 *     against an initialize/init/setup fn    → PRECONDITION_FAIL (expected: contract already initialized)
 *   WasmVm / unreachable / vmtrap,
 *     trap right after the function's own
 *     entry frame, no nested call recorded   → UNCONTROLLED_PANIC (MEDIUM) — the function panics instead of
 *                                              returning a clean Error(Contract,...) on invalid state; a
 *                                              robustness/error-handling finding, not a proven exploitable bug
 *   WasmVm / unreachable / vmtrap,
 *     with nested call frame(s) recorded
 *     before the trap                        → POTENTIAL_VULN  (real candidate vulnerability — the deeper
 *                                              trace means the panic isn't explained by an empty precondition
 *                                              check at function entry)
 *   Error(Contract,)                        → SECURE          (expected business-logic rejection)
 *   Error(Object,) / "not a contract"       → SECURE          (host error; expected with random address inputs)
 *   Error(Context,) / reserved              → SECURE          (reserved function, e.g. __check_auth)
 *   Error(Storage,)                         → UNEXPECTED_ERROR (function reached storage — note: verify auth precedes this)
 *   Anything else                           → UNEXPECTED_ERROR
 *
 * IMPORTANT: `msg` is the raw Soroban RPC error string, which for a failed
 * simulation already contains the full diagnostic event log as text (nested
 * fn_call frames into other contracts, "escalating error to VM trap from
 * failed host function call", etc). A bare "unreachable"/"vmtrap" substring
 * match is not enough to call something a vulnerability — that trap is
 * frequently the last line of a trace whose real cause, a few lines up, is a
 * failed call into another contract (e.g. a token transfer the ephemeral
 * fuzzing account has no balance/trustline/auth for). We must read the rest
 * of the event log before trusting the "unreachable" match.
 */
const INIT_FUNCTION_PATTERNS = ['initialize', 'init', 'setup'];

/**
 * String/errorCode-based classifier — FALLBACK ONLY.
 *
 * Used exclusively when diagnosticEvents.length === 0 (no structured trace
 * available, e.g. an RPC provider with diagnostics disabled, or a TIMEOUT/
 * EXCEPTION outcome that never produced an RPC response to read events
 * from). When a structured trace is available, classifyErrorFromTrace() is
 * used instead and this function is not consulted — the two sources are
 * never blended for a single result.
 */
export function classifyErrorFromString(
	msg: string | null,
	code: string | null,
	vectorName: string,
	functionName: string,
): {signal: VulnerabilitySignal; details: string} {
	const m = (msg ?? '').toLowerCase();

	// On-chain failure that passed simulation — almost always a precondition issue
	// (missing token balance, non-admin signer, protocol state not set up)
	if (code === 'TX_FAILED') {
		return {
			signal: 'PRECONDITION_FAIL',
			details: `On-chain execution failed (simulation passed — likely missing token balance or protocol state, not a code vulnerability): ${
				msg ?? 'no details'
			}`,
		};
	}

	// A nested/cross-contract call failed before the trap — the event log shows
	// the contract under test calling out (typically a token `transfer`) and that
	// call failing, which then escalates into a VM trap. This is a precondition
	// issue with the fuzzing account (no balance/trustline/auth), not a
	// vulnerability in the contract under test.
	const hasFailedCrossContractCall =
		m.includes('contract call failed') ||
		(m.includes('escalating error') &&
			(m.includes('vm trap') || m.includes('host function call'))) ||
		/fn_call[^\n]*transfer/i.test(msg ?? '');

	if (hasFailedCrossContractCall) {
		return {
			signal: 'PRECONDITION_FAIL',
			details: `Event log shows a failed nested/cross-contract call (e.g. a token transfer) before the trap — likely missing balance, trustline, or allowance on the test account, not a contract vulnerability: ${
				msg ?? code
			}`,
		};
	}

	// Auth errors — expected for a protected function called without a real
	// admin/authorized signer. Checked before the trap check below because an
	// auth failure can itself escalate into a VM trap deeper in the call.
	if (
		m.includes('error(auth,') ||
		m.includes('require_auth') ||
		m.includes('auth failed')
	) {
		return {
			signal: 'PRECONDITION_FAIL',
			details: `Auth check rejected the call — test account is not an authorized signer for this function: ${
				msg ?? code
			}`,
		};
	}

	// REINIT_ATTACK / RANDOM_ADDR_* vectors against initialize/init/setup are
	// expected to trap once the contract is already initialized.
	const isInitFunction = INIT_FUNCTION_PATTERNS.some(p =>
		functionName.toLowerCase().includes(p),
	);
	const isReinitVector =
		vectorName === 'REINIT_ATTACK' || vectorName.includes('RANDOM_ADDR');
	const looksLikeTrap =
		m.includes('wasmvm') || m.includes('unreachable') || m.includes('vmtrap');

	if (isInitFunction && isReinitVector && looksLikeTrap) {
		return {
			signal: 'PRECONDITION_FAIL',
			details: `${vectorName} trapped on ${functionName} — expected, contract is already initialized: ${
				msg ?? code
			}`,
		};
	}

	// WASM panics — every precondition cause above has been ruled out from the
	// event log, so this is either an uncontrolled panic or a real candidate
	// vulnerability, distinguished by how deep the call trace goes before the
	// trap fires:
	//   - exactly one fn_call frame (the function's own entry) → the trap
	//     fires right at/near entry with no nested call ever attempted. Almost
	//     always an unwrap()/assert() on missing state (e.g. empty pool
	//     reserves, already-initialized storage) rather than a proven
	//     exploitable bug — the function should have returned
	//     Error(Contract,...) instead of panicking. Flag as a robustness
	//     finding (UNCONTROLLED_PANIC/MEDIUM), not HIGH/CRITICAL.
	//   - more than one fn_call frame → the trap fired after real nested
	//     call/state activity was recorded, so an empty-precondition
	//     explanation doesn't fit — keep this as a genuine POTENTIAL_VULN
	//     candidate at full severity. Do not collapse the two cases.
	if (looksLikeTrap) {
		const fnCallFrames =
			(msg ?? '').match(/topics:\s*\[fn_call/gi)?.length ?? 0;

		if (fnCallFrames === 1) {
			return {
				signal: 'UNCONTROLLED_PANIC',
				details: `Function panics (VM trap) instead of returning a clean Error(Contract,...) on invalid state/precondition — the trap fires immediately after the function's own entry frame with no nested call recorded in the event log (e.g. unwrap()/assert() on empty pool reserves or already-initialized storage). This is a robustness/error-handling finding, not a proven exploitable vulnerability: ${
					msg ?? code
				}`,
			};
		}

		return {
			signal: 'POTENTIAL_VULN',
			details: `WASM panic on type-correct input, after ${fnCallFrames} nested call frame(s) recorded in the event log — no failed cross-contract call or auth rejection found to explain it: ${
				msg ?? code
			}`,
		};
	}

	// Contract-level business-logic errors — e.g. Error(Contract, #1) = AlreadyInitialized
	if (m.includes('error(contract,')) {
		return {
			signal: 'SECURE',
			details: `Contract validation rejected input: ${msg ?? code}`,
		};
	}

	// Host-level object error — typically "not a contract address" when G... keypair
	// is passed where a contract address is expected. Expected with random address inputs.
	if (m.includes('error(object,') || m.includes('not a contract address')) {
		return {
			signal: 'SECURE',
			details: `Host error (non-contract address, expected with random address inputs): ${
				msg ?? code
			}`,
		};
	}

	// Context / reserved function errors
	if (
		m.includes('error(context,') ||
		m.includes('reservedfunction') ||
		m.includes('reserved function')
	) {
		return {
			signal: 'SECURE',
			details: `Reserved/context error (expected): ${msg ?? code}`,
		};
	}

	// Storage errors — function reached a storage operation during simulation.
	// For admin functions (e.g. upgrade calling update_current_contract_wasm), this indicates
	// the function body was executed past any auth check — verify auth is enforced before
	// the storage operation that caused this error.
	if (m.includes('error(storage,')) {
		return {
			signal: 'UNEXPECTED_ERROR',
			details: `Function reached storage operation before failure — verify auth is enforced before this call: ${
				msg ?? code
			}`,
		};
	}

	return {
		signal: 'UNEXPECTED_ERROR',
		details: `Unexpected failure (code: ${code ?? 'unknown'}): ${
			msg ?? 'no details'
		}`,
	};
}

// Codes with a documented Soroban/XDR meaning that essentially never arises
// from a deliberate contract-level guard: arithmetic overflow/div-by-zero and
// out-of-bounds indexing are runtime-safety faults, not error-signaling idioms
// a contract author would use on purpose. scecExceededLimit was previously
// included here but is NOT — it commonly fires on host-level size/resource
// limits, including exactly the oversized-input attack vectors this fuzzer
// itself sends (OVERSIZE_SYMBOL, LARGE_BYTES, ...), where tripping the limit
// is the CORRECT/expected host behavior, not evidence of a bug.
const STRONG_RUNTIME_FAULT_CODES = new Set([
	'scecArithDomain',
	'scecIndexBounds',
]);

/**
 * Structured-trace classifier — PRIMARY SOURCE when diagnosticEvents is
 * non-empty. Reasons purely from the real xdr.DiagnosticEvent[] array (via
 * analyzeDiagnosticTrace()), never from errorMessage text.
 *
 * Guiding rule: ambiguity must not become either a vulnerability claim or a
 * security claim. Where the trace doesn't contain positive evidence for one
 * specific cause, the result is UNEXPECTED_ERROR — the taxonomy's honest
 * "inconclusive, needs review" bucket (MEDIUM, appears in findings, but
 * asserts neither SECURE nor POTENTIAL_VULN).
 *
 * Decision table:
 *   no decodable error event in trace          → UNEXPECTED_ERROR (trace present but doesn't explain the failure)
 *   any error anywhere has category AUTH       → PRECONDITION_FAIL (confident: sceAuth is a structural, XDR-typed
 *       signal that the Soroban auth framework itself rejected the call)
 *   last error category CONTRACT               → SECURE (confident: contract's own business-logic rejection)
 *   last error category CONTEXT                → SECURE (confident: reserved/context function)
 *   last error category OBJECT                 → SECURE (confident: host address/object mismatch, expected with
 *       random test addresses)
 *   last error category STORAGE                → UNEXPECTED_ERROR (reached storage before failing — verify auth ordering)
 *   last error category OTHER (sceCrypto/sceEvents/sceBudget/sceValue)      → UNEXPECTED_ERROR (rare, no strong
 *       domain reasoning yet)
 *   last error WASM_VM/UNKNOWN, nestedCallCount>=1 AND failureLocation!=='ROOT'
 *     → UNEXPECTED_ERROR, REGARDLESS OF CODE. The failure is attributed (or its
 *       attribution is unknown) to a NESTED/callee contract, not the contract
 *       under test — do not automatically credit or blame the root contract for
 *       a callee's fault. This is exactly SOW category (c), "nested failed
 *       cross-contract call": we can name the pattern, but the trace alone
 *       doesn't tell us whether it's the root's bug (didn't validate before
 *       calling out) or the callee's own precondition (e.g. missing balance).
 *   last error WASM_VM/UNKNOWN, root-attributed (nestedCallCount===0, OR
 *   nestedCallCount>=1 AND failureLocation==='ROOT'):
 *     strong fault code (scecArithDomain/scecIndexBounds), nestedCallCount=0  → UNCONTROLLED_PANIC (confident
 *         runtime-safety fault at root — real robustness signal, not yet confirmed exploitable)
 *     strong fault code, nestedCallCount>=1 (root-attributed)                → POTENTIAL_VULN (confident fault +
 *         real nested activity + confirmed root attribution — strongest justified escalation. UNAFFECTED by
 *         hasUnverifiedAddressArg: an arithmetic-overflow/index-bounds fault is evidence about the NUMERIC
 *         attack value we deliberately crafted, not about whether an unrelated Address parameter's real-world
 *         semantics — funded, authorized, a real deployed contract — happen to hold. There is no plausible
 *         "the fake address explains this" story for this code family.)
 *     other/generic code (scecInvalidAction, scecInternalError,
 *     scecMissingValue, scecExceededLimit, ...), nestedCallCount=0
 *       → UNEXPECTED_ERROR — CONSERVATIVE, NOT PRECONDITION_FAIL. A root-level
 *         generic host trap with no nested-call activity and no auth signal
 *         cannot be distinguished, from the trace alone, between a genuine
 *         unguarded panic and a precondition guard implemented via
 *         panic!()/.unwrap() instead of a clean Error(Contract,...).
 *         PRECONDITION_FAIL would assert a cause (benign precondition) the
 *         trace doesn't actually prove — UNEXPECTED_ERROR states the honest
 *         "inconclusive" position instead. This is exactly the shape of the
 *         two real Testnet traces (initialize, swap_exact_in — both
 *         WasmVm/InvalidAction, single fn_call frame) this analyzer was
 *         built and verified against.
 *     other/generic code, nestedCallCount>=1 (root-attributed), hasUnverifiedAddressArg=false
 *       → POTENTIAL_VULN (real nested-call activity recorded before a trap confirmed to be the root's own,
 *         AND no Address-typed parameter exists whose fabricated/unverified semantics could explain the
 *         nested call reaching a wall — the "trivial precondition check at entry" explanation doesn't fit,
 *         and neither does "our fake address tripped a downstream precondition")
 *     other/generic code, nestedCallCount>=1 (root-attributed), hasUnverifiedAddressArg=true
 *       → UNEXPECTED_ERROR, NOT POTENTIAL_VULN. type-correct input != semantically valid input: the call
 *         includes at least one Address parameter this fuzzer fabricated (a random, unfunded, unauthorized
 *         keypair — see type_gen.ts baseline()), never a real externally-supplied address. A generic host
 *         trap reached only after nested/cross-contract activity is EXACTLY the shape produced when that
 *         fabricated address trips a downstream contract's own precondition (missing balance/trustline/auth
 *         on a token call, for example) and the root contract's error handling for that case happens to
 *         panic instead of returning a clean Error. We cannot rule that story out, so we do not escalate —
 *         "runtime behavior suspicious, but semantic preconditions are not established."
 */
export function classifyErrorFromTrace(
	analysis: DiagnosticTraceAnalysis,
	hasUnverifiedAddressArg: boolean,
): {signal: VulnerabilitySignal; details: string} {
	if (analysis.errors.length === 0) {
		return {
			signal: 'UNEXPECTED_ERROR',
			details: analysis.malformed
				? `Structured trace present but could not be decoded safely (${analysis.callFrames.length} call frame(s) parsed) — cannot explain the failure from the trace.`
				: `Structured trace present (${analysis.callFrames.length} call frame(s)) but recorded no error event — cannot explain the failure from the trace.`,
		};
	}

	if (analysis.hasAuthError) {
		return {
			signal: 'PRECONDITION_FAIL',
			details: `Structured trace shows an auth rejection (ScError type sceAuth) — test account is not an authorized signer for this call. nestedCallCount=${analysis.nestedCallCount}.`,
		};
	}

	const lastError = analysis.errors[analysis.errors.length - 1]!;

	switch (lastError.category) {
		case 'CONTRACT':
			return {
				signal: 'SECURE',
				details: `Structured trace shows a contract-level rejection (${
					lastError.code ?? 'ScError(Contract)'
				}) — expected business-logic validation.`,
			};
		case 'CONTEXT':
			return {
				signal: 'SECURE',
				details:
					'Structured trace shows a reserved/context error — expected for reserved functions.',
			};
		case 'OBJECT':
			return {
				signal: 'SECURE',
				details:
					'Structured trace shows a host object/address-type error — expected with random test addresses.',
			};
		case 'STORAGE':
			return {
				signal: 'UNEXPECTED_ERROR',
				details:
					'Structured trace shows the call reached a storage operation before failing — verify auth is enforced before this point.',
			};
		case 'OTHER':
			return {
				signal: 'UNEXPECTED_ERROR',
				details: `Structured trace shows an uncommon host error category (${
					lastError.code ?? 'unknown'
				}) — no strong domain classification yet.`,
			};
		case 'WASM_VM':
		case 'UNKNOWN': {
			const depthNote = `nestedCallCount=${analysis.nestedCallCount}, failureLocation=${analysis.failureLocation}`;
			const rootAttributed =
				analysis.nestedCallCount === 0 || analysis.failureLocation === 'ROOT';

			if (!rootAttributed) {
				return {
					signal: 'UNEXPECTED_ERROR',
					details: `Structured trace shows a failure after ${
						analysis.nestedCallCount
					} nested call frame(s), attributed to a nested/callee contract rather than the contract under test (${
						lastError.code ?? 'undecodable ScError'
					}) — cannot conclude this is the target contract's fault (could be its own bug for not validating before calling out, or the callee's own precondition, e.g. missing balance). ${depthNote}.`,
				};
			}

			const isStrongFault =
				lastError.code !== null &&
				STRONG_RUNTIME_FAULT_CODES.has(lastError.code);

			if (isStrongFault) {
				return analysis.nestedCallCount === 0
					? {
							signal: 'UNCONTROLLED_PANIC',
							details: `Structured trace shows a root-level runtime-safety fault (${lastError.code}) with no nested-call activity — a real robustness signal (arithmetic/bounds fault), not yet confirmed exploitable. ${depthNote}.`,
						}
					: {
							signal: 'POTENTIAL_VULN',
							details: `Structured trace shows a runtime-safety fault (${lastError.code}) after ${analysis.nestedCallCount} nested call frame(s), confirmed attributed to the root contract — stronger candidate, real execution activity recorded before the trap. ${depthNote}.`,
						};
			}

			if (analysis.nestedCallCount === 0) {
				return {
					signal: 'UNEXPECTED_ERROR',
					details: `Structured trace shows a root-level generic host trap (${
						lastError.code ?? 'undecodable ScError'
					}) with no nested-call activity and no auth signal — cannot distinguish a genuine unguarded panic from a precondition guard implemented via panic. Inconclusive from the trace alone; flagged for manual review, not confirmed as either safe or a bug. ${depthNote}.`,
				};
			}

			// Nested activity happened AND the trap is confirmed root-attributed —
			// but if the call includes an Address parameter, that address is a
			// fuzzer-fabricated, unfunded, unauthorized keypair (never a real
			// externally-supplied one — see type_gen.ts baseline()). A generic
			// trap reached only after crossing into another contract is exactly
			// the shape produced by that fake address tripping a downstream
			// precondition (missing balance/trustline/auth), not necessarily a
			// bug in the contract under test. Semantic validity of the input is
			// UNKNOWN, so we do not escalate on nesting alone in that case.
			if (hasUnverifiedAddressArg) {
				return {
					signal: 'UNEXPECTED_ERROR',
					details: `Structured trace shows a generic host trap (${
						lastError.code ?? 'undecodable ScError'
					}) after ${
						analysis.nestedCallCount
					} nested call frame(s), confirmed attributed to the root contract — runtime behavior is suspicious (real nested-call activity occurred), but this call includes at least one Address parameter this fuzzer fabricated (unfunded/unauthorized), so semantic validity of the input is not established. Not escalated: could be the root contract mishandling a downstream precondition failure caused by our fake address, not a genuine bug. ${depthNote}.`,
				};
			}

			return {
				signal: 'POTENTIAL_VULN',
				details: `Structured trace shows a generic host trap (${
					lastError.code ?? 'undecodable ScError'
				}) after ${
					analysis.nestedCallCount
				} nested call frame(s), confirmed attributed to the root contract — the trivial "precondition check at entry" explanation doesn't fit, and this call has no Address-typed parameter whose fabricated semantics could otherwise explain the nested call hitting a wall. ${depthNote}.`,
			};
		}

		// AUTH is handled earlier via analysis.hasAuthError — unreachable here,
		// but kept as a safe, conservative default rather than an assertion.
		default:
			return {
				signal: 'UNEXPECTED_ERROR',
				details: `Structured trace produced an unrecognized error category (${
					lastError.category as string
				}) — conservative fallback.`,
			};
	}
}

/**
 * Dispatches to the structured-trace classifier when a real DiagnosticEvent[]
 * trace is available, falling back to the legacy string/errorCode classifier
 * only when it isn't. The two sources are never combined for one result —
 * whichever is used produces the signal on its own.
 */
function classifyError(
	msg: string | null,
	code: string | null,
	vectorName: string,
	functionName: string,
	diagnosticEvents: xdr.DiagnosticEvent[],
	hasUnverifiedAddressArg: boolean,
): {signal: VulnerabilitySignal; details: string} {
	if (diagnosticEvents.length > 0) {
		return classifyErrorFromTrace(
			analyzeDiagnosticTrace(diagnosticEvents),
			hasUnverifiedAddressArg,
		);
	}

	return classifyErrorFromString(msg, code, vectorName, functionName);
}

/**
 * Maps a raw InvokeResult to a structured ParsedResult.
 *
 * This function draws a deliberate line between two different questions:
 *   A. Execution classification — "what happened technically?" This is
 *      entirely classifyError()'s job (trace-primary or string-fallback).
 *   B. Vector outcome — "what does that mean for the attack vector we were
 *      running?" This is this function's job, layered ON TOP of (A).
 *
 * For an access-control vector (expectedToFail = true), a rejected call is
 * only reinterpreted as a vector-level SECURE ("the access-control check
 * worked") when the execution layer gave a CONFIDENT non-vulnerability
 * verdict — SECURE (contract/context/object rejection) or PRECONDITION_FAIL
 * (a structural auth rejection, or a confident string-fallback match). Any
 * other execution signal — POTENTIAL_VULN, UNCONTROLLED_PANIC, and
 * critically UNEXPECTED_ERROR (the taxonomy's "inconclusive" bucket) — is
 * passed through unchanged. The trace classifier itself never knows which
 * vector produced the call it's looking at, so it must not have its
 * inconclusive verdicts silently upgraded into a vector-level security claim
 * here; only a confident execution verdict earns that upgrade.
 *
 * Math vectors (expectedToFail = false):
 *   - success → SECURE
 *   - failure → the execution classification is reported as-is, with no
 *     vector-level reinterpretation (there's no "expected to fail" framing
 *     to layer on top of a plain function call).
 *
 * `hasUnverifiedAddressArg` tells the trace classifier whether this call's
 * arguments include an Address-typed parameter — which this fuzzer always
 * fills with a fabricated, unfunded, unauthorized keypair (see
 * type_gen.ts baseline()), never a real externally-known address. It is
 * used to withhold a POTENTIAL_VULN escalation when the only evidence for
 * it (nested-call activity before a root-attributed generic trap) could
 * equally be explained by that fabricated address failing a downstream
 * precondition — see classifyErrorFromTrace().
 */
export function parseInvokeResult(
	result: InvokeResult,
	expectedToFail: boolean,
	functionName: string,
	vectorName: string,
	isAdminFunction: boolean,
	hasUnverifiedAddressArg: boolean,
): ParsedResult {
	// Computed once, unconditionally, purely to carry evidence forward —
	// this does NOT feed the classification decisions below. classifyError()
	// (and classifyErrorFromTrace() inside it) independently re-derives its
	// own trace analysis from result.diagnosticEvents exactly as before D2.1;
	// the two calls are redundant but deliberately kept separate so the
	// approved D1 classification code path is untouched by this change.
	const evidence: ExecutionEvidence = {
		broadcasted: result.broadcasted,
		success: result.success,
		transactionHash: result.transactionHash,
		ledger: result.ledger,
		simulationFailed: result.simulationFailed,
		trace: analyzeDiagnosticTrace(result.diagnosticEvents),
	};

	if (result.errorCode === 'TIMEOUT') {
		return {
			signal: 'TIMEOUT',
			severity: 'LOW',
			details: 'Transaction did not confirm within the polling window',
			rawErrorCode: result.errorCode,
			functionName,
			vectorName,
			evidence,
		};
	}

	if (!result.success) {
		const classified = classifyError(
			result.errorMessage,
			result.errorCode,
			vectorName,
			functionName,
			result.diagnosticEvents,
			hasUnverifiedAddressArg,
		);

		if (expectedToFail) {
			// Access control vector: only a CONFIDENT non-vulnerability execution
			// verdict earns a vector-level SECURE ("the access-control check
			// worked"). SECURE = confident business-logic/context/object
			// rejection; PRECONDITION_FAIL = a confident auth rejection (either
			// the trace's structural sceAuth, or the string fallback's own
			// confident matches). Anything else — including UNEXPECTED_ERROR,
			// the taxonomy's inconclusive bucket — is passed through unchanged:
			// the rejection may still be a correct access-control outcome, but
			// this layer does not assert that on ambiguous evidence.
			if (
				classified.signal === 'SECURE' ||
				classified.signal === 'PRECONDITION_FAIL'
			) {
				return {
					signal: 'SECURE',
					severity: 'INFO',
					details: classified.details,
					rawErrorCode: result.errorCode,
					functionName,
					vectorName,
					evidence,
				};
			}

			return {
				signal: classified.signal,
				severity: signalToSeverity(classified.signal, isAdminFunction),
				details: classified.details,
				rawErrorCode: result.errorCode,
				functionName,
				vectorName,
				evidence,
			};
		}

		// Math vector: contract failed on a type-correct input — classify why
		return {
			signal: classified.signal,
			severity: signalToSeverity(classified.signal, isAdminFunction),
			details: classified.details,
			rawErrorCode: result.errorCode,
			functionName,
			vectorName,
			evidence,
		};
	}

	// Transaction succeeded
	if (expectedToFail) {
		return {
			signal: 'POTENTIAL_VULN',
			severity: signalToSeverity('POTENTIAL_VULN', isAdminFunction),
			details: `${vectorName}: access control bypass — call was NOT rejected on ${functionName}`,
			rawErrorCode: null,
			functionName,
			vectorName,
			evidence,
		};
	}

	return {
		signal: 'SECURE',
		severity: 'INFO',
		details: `${vectorName}: accepted gracefully by ${functionName}`,
		rawErrorCode: null,
		functionName,
		vectorName,
		evidence,
	};
}
