# Chaos Monkey — Fuzzing Engine

The Chaos Monkey is Kuyfi's automated black-box fuzzer for Soroban smart contracts. It requires no source code — it works from the function spec recovered by the OSINT Scanner.

---

## Overview

A fuzzing session:

1. Generates an ephemeral Stellar keypair and funds it via Friendbot (Testnet only).
2. Confirms the account exists on-chain before proceeding.
3. For each contract function discovered by the Scanner, runs the vector families whose shape the function matches (see [Vector families](#vector-families)): math/boundary, authorization/access-control, fee/basis-point, and liquidity-ratio.
4. Once per session, runs call-ordering vectors against the functions whose names match a sequence group.
5. Builds a `ChaosReport` and displays it in the terminal; the same run can be exported as a `SecurityReport` (JSON/PDF).

**Every vector is simulated first.** Only vectors whose simulation succeeds are signed and broadcast to Testnet. A vector that fails simulation is classified from the simulation's diagnostic events and nothing is sent, so many vectors — and many findings — have no on-chain transaction.

**Type-correct does not mean semantically valid.** Generated values match the declared parameter types, but a random `Address` is not a funded account, a token, or an authorized signer. The classifier is conservative for that reason (see [Classification](#classification)).

---

## Vector families

Chaos Monkey has five vector families.

### 1. Math / boundary

**Module:** `fuzzer_math.ts` — runs against every function that has parameters.

**Strategy:** one-variable-at-a-time (OAT). For each parameter, every other parameter receives a **type-correct baseline** value (a zero-like value for its type) and the targeted parameter receives each attack value in turn. This isolates which specific input causes a contract to misbehave.

Attack values are generated per type:

| Type | Attack vectors |
|---|---|
| Integers | `ZERO`, `ONE`, `NEG_ONE` (signed types), and type-specific `MAX_*` / `MIN_*` values, for example `MAX_I128`, `MIN_I128` |
| `Address` | `RANDOM_ADDR_A`, `RANDOM_ADDR_B` (random, unfunded, unauthorized keypairs) |
| `Bool` | `TRUE`, `FALSE` |
| `Bytes` / `BytesN` | `EMPTY_BYTES`, `ZERO_BYTES_N`, `FF_BYTES_N`, `LARGE_BYTES` |
| `String` / `Symbol` | `EMPTY_STR`, `LONG_STR`, `EMPTY_SYMBOL`, `LONG_SYMBOL`, `OVERSIZE_SYMBOL` |
| `Vec<T>` | `EMPTY_VEC`, `ONE_ELEM_VEC`, `TWO_ELEM_VEC` |
| `Option<T>` | `NONE`, `SOME_BASELINE` |
| `Timepoint` / `Duration` | `ZERO_TS`, `MAX_TS`, `ZERO_DUR`, `MAX_DUR` |
| UDTs | Structs one field at a time, enums per case, unions per case and payload slot, recursively. |

A type that cannot be resolved (an unknown UDT, or a depth or cycle limit) yields no vector: the parameter, or the whole function, is skipped rather than filled with a made-up value. Functions with zero parameters get no math vectors.

Vector names combine the parameter and the attack, for example `amount::MAX_I128`, or `p::Point.x::ZERO` for a struct field.

### 2. Authorization / access control

**Module:** `fuzzer_access.ts`

A function is treated as an admin function if its lowercase name contains any of:

```
pause, unpause, initialize, init, setup, upgrade,
set_admin, set_pending_admin, transfer_admin, emergency
```

| Vector | Runs against | What it does |
|---|---|---|
| `UNAUTHORIZED_CALL` | Admin-pattern functions | Calls the function from the random ephemeral keypair (not the contract admin) with baseline arguments. |
| `REINIT_ATTACK` | `initialize`, `init`, `setup` | Calls an initializer on an already-deployed contract. |
| `SELF_CALL_ATTACK` | `set_admin`, `set_pending_admin`, `transfer_admin` | Passes the attacker's own address in every address parameter. |
| `UNAUTHORIZED_ADDR_CALL` | Non-admin functions with an `Address` parameter | Calls the function with a random, unrelated address in that slot, signed only by the ephemeral keypair. |

These vectors are **expected to fail**. If the call succeeds despite the address never authorizing it, the result is `POTENTIAL_VULN`. This is a hypothesis, not a certainty: a black-box tool cannot see whether the contract calls `require_auth()` internally, and a getter that takes an address legitimately needs no authorization from it. If the call fails, the classifier decides what the failure evidence shows.

### 3. Call ordering

**Module:** `fuzzer_call_order.ts` — runs once per session.

Calls the **same function twice in a row** with baseline arguments and records both outcomes. At most one function is matched per group, by name:

| Group | Name patterns |
|---|---|
| `REINIT_SEQUENCE` | `initialize`, `init`, `setup` |
| `REPEATED_WITHDRAW_SEQUENCE` | `withdraw`, `remove` |
| `REPEATED_CLAIM_SEQUENCE` | `claim` |

### 4. Fee / basis-point

**Module:** `fuzzer_fee.ts`

Applies to numeric parameters whose names look fee- or BPS-shaped (`fee`, `fees`, `bps`, `basis_point`). Values: `0`, `1`, `9999`, `10000`, `10001` (the 100%-in-basis-points boundary) and the type's maximum, named `BPS_*`. Rejecting `10001` is expected behavior for a well-guarded fee setter; the vector checks that boundaries are handled.

### 5. Liquidity-ratio

**Module:** `fuzzer_liquidity.ts`

Applies to functions whose names contain `liquidity`, `swap` or `reserve` and that declare at least two numeric parameters. It attacks the first two numeric parameters jointly with a small fixed set of paired boundaries: `ZERO_A_MAX_B`, `MAX_A_ZERO_B`, `MAX_A_MAX_B`, `ONE_A_MAX_B`, `MAX_A_ONE_B`, and `MIN_A_MAX_B` (signed types only).

---

## Transaction lifecycle

**Module:** `router.ts`

```
getAccount(keypair.publicKey())
  └─ TransactionBuilder.build()
       └─ simulateTransaction()          ← preflight; no transaction is sent
            ├─ simulation error ──→ return the simulation's diagnostic events; nothing is sent
            └─ assembleTransaction()
                 └─ sign with keypair
                      └─ sendTransaction()
                           ├─ status ERROR ──→ rejected before entering the network
                           └─ accepted ──→ poll getTransaction() every 1 s (up to 20 attempts)
                                ├─ SUCCESS  ──→ return resultValue
                                ├─ FAILED   ──→ TX_FAILED (failed on-chain)
                                └─ (20 attempts) ──→ TIMEOUT
```

The function never throws — all error paths are caught and returned as a typed `InvokeResult`. A transaction hash can exist without a broadcast: when `sendTransaction()` rejects the envelope, the locally computed hash is recorded with `broadcasted: false`.

---

## Classification

**Modules:** `trace_analyzer.ts`, `result_parser.ts`

Classification is **trace-primary**. Kuyfi decodes the structured `DiagnosticEvent` array returned by Soroban RPC (for simulations and for transactions) into call frames and typed errors, and reasons from those. A text/error-code matcher is used only as a fallback when no events are available, and the two are never blended for one result.

The guiding rule is that ambiguity must not become either a vulnerability claim or a security claim. Where the trace has no positive evidence for one specific cause, the result is `UNEXPECTED_ERROR`.

Kuyfi emits six signals:

| Signal | Meaning |
|---|---|
| `SECURE` | A confident, expected outcome (a contract-level error, a reserved-function/context error, a host object error), or a non-access-control vector that was accepted. |
| `PRECONDITION_FAIL` | A confident rejection explained by missing setup, typically a structural auth rejection (`sceAuth`): the ephemeral test account is not an authorized signer. |
| `UNEXPECTED_ERROR` | Manual-review, inconclusive: the vector failed and the trace does not explain why. |
| `POTENTIAL_VULN` | A security signal requiring contextual/manual review; not a confirmed vulnerability. |
| `UNCONTROLLED_PANIC` | The target traps on a runtime-safety fault with no nested-call activity: a robustness signal, not a proven exploitable bug. |
| `TIMEOUT` | Not confirmed within the polling window. |

Trace decision table (structured-trace path):

| Trace evidence | Signal |
|---|---|
| No decodable error event | `UNEXPECTED_ERROR` |
| Any auth error (`sceAuth`) | `PRECONDITION_FAIL` |
| Last error is a contract, context, or object error | `SECURE` |
| Last error is a storage error or another host error category | `UNEXPECTED_ERROR` |
| VM trap attributed to a nested/callee contract | `UNEXPECTED_ERROR` |
| Runtime-safety fault (`scecArithDomain`, `scecIndexBounds`) at the root, no nested calls | `UNCONTROLLED_PANIC` |
| The same fault at the root after nested calls | `POTENTIAL_VULN` |
| Generic trap at the root, no nested calls | `UNEXPECTED_ERROR` |
| Generic trap at the root after nested calls, and the call includes a fabricated `Address` argument | `UNEXPECTED_ERROR` |
| Generic trap at the root after nested calls, and no fabricated `Address` argument | `POTENTIAL_VULN` |

Vector-level rules on top of that:

- **Access-control vectors** are expected to fail. If the call **succeeds**, the result is `POTENTIAL_VULN`. If it is rejected, the vector is only recorded as `SECURE` when the execution verdict is confident (`SECURE` or `PRECONDITION_FAIL`); an inconclusive `UNEXPECTED_ERROR` is passed through unchanged.
- **Math and other vectors:** success is `SECURE`; a failure keeps the execution classification.
- A transaction that is not confirmed within the polling window is `TIMEOUT`.

The `VulnerabilitySignal` type also contains a legacy `SIMULATION_FAIL` member. The classifier never emits it: a failed simulation is classified from its diagnostic events like any other outcome.

---

## Severity

| Signal | Admin-pattern function | Other function |
|---|---|---|
| `POTENTIAL_VULN` | **CRITICAL** | HIGH |
| `UNCONTROLLED_PANIC` | MEDIUM | MEDIUM |
| `UNEXPECTED_ERROR` | MEDIUM | MEDIUM |
| `TIMEOUT` | LOW | LOW |
| `PRECONDITION_FAIL` | LOW (summary only) | LOW (summary only) |
| `SECURE` | INFO (summary only) | INFO (summary only) |

---

## Report format

**Module:** `reporter.ts`

`buildReport()` produces a `ChaosReport` with:

- Contract ID, scan timestamp, network, functions scanned and vectors run.
- Summary counters (CRITICAL, HIGH, MEDIUM, LOW, PRECONDITION_FAIL, INFO), tallied over **every** vector, plus `broadcastTransactions` and `transactionsWithHash`.
- A findings list: every result that is not `SECURE` or `PRECONDITION_FAIL`. Each finding has an ID (`KYF-001`, `KYF-002`, …, assigned in execution order), severity, function, vector, signal and details, and the list is sorted by severity.
- `verificationTransactions`: a small, deterministic sample (the first broadcast that succeeded and the first that failed), not the full result set. It keeps a report with zero findings from exposing no verifiable transaction.

The exported `SecurityReport` (JSON/PDF) carries the same run-wide counters and, per finding, the simulation status, broadcast status, a trace summary, and the transaction hash, ledger and explorer URL when a transaction was broadcast. The terminal summary counts every vector; the `SecurityReport` severity summary counts `findings[]` only. Not every finding has an on-chain transaction, and only broadcast transactions can be verified independently on-chain.

---

## Responsible use

- **Only fuzz contracts you own or are authorized to test.** Vectors that pass simulation are submitted as real transactions.
- The ephemeral keypair is generated fresh each session and is never persisted to disk.
- All activity is on Stellar Testnet. Mainnet support does not exist in the current version.
- Every finding is a lead to investigate, not a verdict. `UNEXPECTED_ERROR` is inconclusive by design, and zero findings does not prove a contract is secure.
