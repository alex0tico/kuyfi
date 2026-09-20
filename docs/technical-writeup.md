# Auditing Soroban Without Source Code:

## Building Kuyfi's Black-Box Security Pipeline

_From a deployed Contract ID to reproducible security evidence, tested on two controlled fixtures and two real Stellar Testnet contracts._

> **Scope.** Kuyfi is automated black-box security testing and pre-audit tooling for Soroban contracts on Stellar Testnet. It does not replace a formal audit, it does not verify contracts formally, and it does not certify anything. A _finding_ in a Kuyfi report is a signal that needs a human to look at it. It is not a confirmed vulnerability. This article reports what the tool produced, including the parts that are inconclusive, noisy, or not covered.

> **How claims are labeled.** Numbers and results come from four kinds of source, and the text says which where it matters. _Measured_: read from a `SecurityReport`, raw campaign output, or an on-chain lookup. _Inferred_: derived by reading Kuyfi's code paths or by arithmetic on measured values, and marked as inference. _Historical_: development context from earlier work, cited from project notes. _Not in the evidence bundle_: referenced, but not available for independent checking. Where sources disagree, the `SecurityReport` JSON wins over raw campaign output, which wins over an on-chain lookup, then the evidence index notes, then repository docs. Every broadcast transaction cited below was also looked up on Horizon (Testnet) on 2026-09-19, and, wherever a report lists a ledger, it matches. The one cited hash that was never broadcast (`KYF-033`) is, as expected, not found.

---

## 1. The problem

Anyone can invoke a deployed Soroban contract. Not everyone has its source code. A developer integrating a third-party contract, a reviewer doing a first pass before a real audit, or a security engineer looking at a contract found on the network often starts with only a Contract ID.

That is less than it sounds like. The contract's WASM is on-chain. For contracts built with the Soroban SDK, so is its interface: the `contractspecv0` custom section lists every exported function, its parameter types, and every user-defined type (UDT). That is enough to know what can be called and with which value shapes, even though it says nothing about what the code does.

Kuyfi starts there:

```
Contract ID
  → on-chain WASM / contract spec
  → attack surface
  → type-aware attack vectors
  → execution traces
  → SecurityReport
```

The limitation is built into the approach. A black-box tool observes behavior at the contract boundary: it sends an input and sees what happens. It cannot see the author's intent, the state the contract expects, or which addresses are supposed to be authorized. Much of this article is about where that gap shows up.

## 2. Architecture

```
Contract ID
      ↓
OSINT Scanner
      ↓
Attack Surface
      ↓
Chaos Monkey
      ↓
Execution Trace Classification
      ↓
SecurityReport
      ↓
JSON / PDF / Testnet evidence
```

**OSINT Scanner.** Fetches the contract's WASM through Soroban RPC, decodes `contractspecv0`, and produces the function list (name, parameters, whether it returns a value) and the UDT list. It is read-only and sends no transactions.

**UDT registry.** Indexes the contract's structs, enums, and unions (Rust-style enums with payloads) by name so nested types can be resolved. Resolution has a depth limit and cycle detection.

**Type-aware generators.** Two operations per Soroban type. `baseline(type)` builds a neutral, type-correct value. `attackVals(type)` builds boundary values for that type (for example `ZERO`, `ONE`, `NEG_ONE`, `MAX_I128`, `MIN_I128` for `i128`). For composite types the generators recurse: a struct attacks one field at a time, a union attacks each case's payload slots, and `Vec<T>` and `Option<T>` are expanded. If a type cannot be resolved (an unknown UDT, or a depth or cycle limit) the generator returns nothing and the function is skipped. It never substitutes a made-up value.

**Chaos Monkey.** Generates an ephemeral keypair and funds it through Friendbot. Each vector is built and simulated (preflight). If the simulation succeeds, the transaction is assembled, signed, sent to Testnet, and polled; if it fails, Kuyfi classifies the vector from the simulation's diagnostic events and sends nothing (section 10 explains why this matters for counting evidence). Vector families:

- math boundary vectors, one variable at a time, with all other parameters at their baseline;
- access-control vectors (`UNAUTHORIZED_CALL`, `REINIT_ATTACK`, `SELF_CALL_ATTACK`, `UNAUTHORIZED_ADDR_CALL`);
- fee/BPS vectors, liquidity-ratio vectors, and call-ordering sequences.

**DiagnosticEvent trace analysis.** Soroban RPC returns structured diagnostic events for simulations and transactions. Kuyfi decodes them into call frames and typed errors (category and code) and uses them as the primary evidence for classification. Matching text in an error message is only a fallback for when no events are available.

**Classification and SecurityReport.** Each vector's outcome is classified into a signal and a severity (section 3). One audit run produces one versioned `SecurityReport` (`schemaVersion 1.0.0`). The JSON and the PDF are rendered from that same object, so they share the same `reportId`, and neither reclassifies anything.

## 3. Classification: type-correct does not mean semantically valid

The central design constraint is this: **type-correct does not mean semantically valid.**

A random `Address` that is a valid Soroban value is not automatically an initialized account, a token, an authorized admin, a known signer, or part of valid contract state. A contract that rejects, or traps on, an input built only from types is not necessarily misbehaving. The tool cannot tell from a signature alone whether the input reached the contract's real logic.

So Kuyfi classifies conservatively and treats ambiguity as ambiguity:

| Signal              | What it means                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECURE`            | A confident, expected outcome: a contract-level rejection (`Error(Contract)`), a context or object error, or, for a non-access-control vector, the call was accepted.                                                                                                                                                                                                                                      |
| `PRECONDITION_FAIL` | A confident rejection explained by missing setup: a structural auth rejection (`sceAuth`, "the test account is not an authorized signer"), or, in the text-based fallback classifier, an on-chain failure after a passing simulation.                                                                                                                                                                                                                |
| `UNEXPECTED_ERROR`  | A manual-review, inconclusive signal under the current black-box context. The call failed, but the trace does not say why. For example, a generic host trap at the root of the call with no nested calls and no auth signal cannot be told apart from a precondition check written as a panic.                                                                                                                                                 |
| `POTENTIAL_VULN`    | A security signal requiring contextual review. It is raised when a call that an access-control vector expected to be rejected succeeds, or when a runtime-safety fault (`scecArithDomain`, `scecIndexBounds`) follows nested calls, or when a root-attributed generic trap follows nested calls and the call has no fabricated `Address` argument that could explain it. Severity is `CRITICAL` if the function name matches an admin pattern (`pause`, `initialize`, `set_admin`, `upgrade`, ...) and `HIGH` otherwise. |

Two consequences matter for everything below.

First, `SECURE` and `PRECONDITION_FAIL` results are counted but are not listed in `findings[]`. A report with few findings does not mean few vectors ran, and a report with zero findings means only that no vector produced an ambiguous or suspicious outcome.

Second, `POTENTIAL_VULN` is a hypothesis. For access-control vectors the source says so directly: the vector is "a genuine attack HYPOTHESIS, not a certainty", because a black-box tool cannot see whether the contract calls `require_auth()` internally. It can only observe what happens when the call is made without the address's authorization.

The taxonomy also defines `UNCONTROLLED_PANIC`, `TIMEOUT`, and `SIMULATION_FAIL`. None of them appears in any report discussed here.

## 4. Case study 1: composite UDT fixture

> **CONTROLLED TEST FIXTURE.** A minimal contract we wrote and deployed to Testnet. It is not a third-party contract, and it has no business logic to audit.

- **Contract ID:** `CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ`
- **Report:** `kyf-20260909T235037Z-99dcfda0` (PDF)
- **Surface:** 6 functions, 4 UDTs, 5,409 bytes of WASM

Every function validates the shape of its input and echoes it back. The point of the fixture is to expose each composite Soroban type Kuyfi has to handle:

| Kuyfi concept | Fixture type                                                 | Wire representation (`ScVal`)          |
| ------------- | ------------------------------------------------------------ | -------------------------------------- |
| struct        | `Point { x: i128, y: i128 }`                                 | `Map`, sorted by field name            |
| enum          | `Status { Active = 1, Paused = 2, Closed = 3 }`              | `U32(discriminant)`                    |
| union         | `Action { Noop, SetValue(u32), Move(Point, Point) }`         | `Vec([Symbol(case), ...payload])`      |
| nested struct | `Wrapper { status: Status, anchor: Point }`                  | nested values per the rules above      |
| `Vec<UDT>`    | `echo_points(pts: Vec<Point>)`                               | `Vec` of the element's `ScVal`         |
| `Option<UDT>` | `echo_maybe_point(p: Option<Point>)`                         | `Void` for `None`, or the inner value  |

The functions are `echo_point`, `echo_action`, `echo_points`, `echo_status`, `echo_wrapper`, and `echo_maybe_point`.

What this exercises is recursion. Chaos Monkey started out handling primitives and, later, flat structs; this fixture covers the rest. For a parameter of type `Action`, the generator now selects each declared union case and, inside a case, attacks each payload slot with its own boundary values while keeping the discriminant and payload coherent. `Move(Point, Point)` nests a struct inside a union case, so a vector can target one field of one `Point` inside one case. Vector names encode that path (the archived sample is `p::Point.x::ZERO`; union payload vectors follow the pattern `Action::Move.<slot>::...`).

The archived report records **57 vectors executed, 57 broadcast transactions, 57 transactions with a hash, and 0 findings**. It lists one sample transaction (`echo_point`, `p::Point.x::ZERO`), which we confirmed on-chain at ledger 4594794. What the report supports is that all 57 vectors were sent and none produced a finding.

_Historical local development evidence._ A D1 development log (2026-09-07) also records a one-off script that generated the vector `Action::Move.0::Point.x::MAX_I128` (the `x` of the first `Point` in `Action::Move` set to `i128::MAX`), sent it to `echo_action` on this fixture, and logged `success=true` with the value echoed back. That is the clearest example of a nested-union vector executing. It is not a `SecurityReport`: the script is not in the repository and the log recorded no transaction hash, so we treat it as development context, not as evidence, and nothing else in this article depends on it.

Zero findings on this fixture is expected by construction. It shows that the type machinery works against a real deployed contract. It says nothing about security.

## 5. Case study 2: intentionally vulnerable fixture

> **CONTROLLED INTENTIONALLY VULNERABLE TEST FIXTURE.** A contract with a deliberate access-control bug, written to test the tool. Testnet only.

- **Contract ID:** `CDYUQRWYE6INSGTMJWHPU32VSWVOZ456EUHJMMQXTCFXPFUXPH2JTPV7`
- **Report:** `kyf-20260911T220317Z-074f925b` (JSON and PDF); a second run, `kyf-20260911T222017Z-4ff82516` (PDF)
- **Surface:** 3 functions, 0 UDTs, 1,700 bytes of WASM

The fixture is an A/B pair:

```rust
// VULNERABLE: no authorization check.
pub fn set_admin_value(env: Env, admin: Address, value: i128) {
    let _ = admin;
    env.storage().persistent().set(&VALUE_KEY, &value);
}

// CONTROL: same operation, guarded.
pub fn secure_set_admin_value(env: Env, admin: Address, value: i128) {
    admin.require_auth();
    env.storage().persistent().set(&VALUE_KEY, &value);
}
```

`set_admin_value` never calls `admin.require_auth()`, so any caller can pass any address as `admin` and the write goes through. `secure_set_admin_value` performs the same write only after the `admin` address has authorized the call. A third function, `get_value`, reads the stored value.

**What the evidence supports.** Three separate things are established here, from three different sources.

- **A. Source and tests.** The fixture source omits `admin.require_auth()` in `set_admin_value` and includes it in `secure_set_admin_value`. Rust unit tests in the fixture's repository encode both behaviors (`vulnerable_write_succeeds_without_auth`, `secure_write_rejected_without_auth`).
- **B. The Kuyfi campaign.** Kuyfi produced `KYF-001` as a `CRITICAL` `POTENTIAL_VULN` on `set_admin_value` and no finding on the protected variant (below).
- **C. A manual exploit during development validation (2026-09-11).** The transaction is verifiable on-chain: `0b1a0fbb98a6b46d1ff8c8e183d24e8d33cf6e82957e906070c4d311f83ba0d4`, ledger 4628079. A Horizon lookup confirms that it succeeded, carried one signature (the caller's) and no Soroban authorization entries, and invoked `set_admin_value` with a freshly generated `admin` address and the value `999999`. That address never signed. So a caller that was not the admin changed the contract's state without the admin's signature.

_Historical local development evidence._ The development session also recorded state reads of `0` before that transaction and `999999` after it. Those readings are not public or verifiable evidence. They come from a local session, and they cannot be verified independently today: the ledger is older than the public RPC's retention window, and Horizon does not return result metadata. The published proof of C is the transaction itself, not the before/after values.

**What Kuyfi produced.** In the first run: 16 vectors executed, 16 broadcast, 16 with a hash, and one finding:

```
UNAUTHORIZED_CALL → POTENTIAL_VULN → CRITICAL → KYF-001
Function : set_admin_value
Details  : access control bypass — call was NOT rejected on set_admin_value
Tx       : 2414467c1788a311f2c9c4043b20443d43055462c9f592c053f556b130b173da
Ledger   : 4628114
```

The trace attached to the finding shows one root call to `set_admin_value`, no nested calls, and no auth error. The second run reproduced the same finding (`KYF-001`, ledger 4628318, transaction `0f032b7b72aa3accb3a3ec1467fd08dd8b59c4ec5dcef6d4c72acacf68c7ed2c`).

The two transactions behind `KYF-001` succeeded on-chain and carried no authorization entries. The protected `secure_set_admin_value` produced no finding. The report's verification section keeps two sample transactions, the first broadcast that succeeded and the first that failed on-chain. In both runs they are a call to `set_admin_value` (succeeded) and a call to `secure_set_admin_value` (failed). On-chain, each `secure_set_admin_value` sample is `txFailed` with `invokeHostFunctionTrapped` and carries one address-credentialed authorization entry with no signature, which is what a rejected authorization looks like.

**What this does and does not show.** Kuyfi separated a known missing-`require_auth()` bug from its guarded twin, using the same vectors and the same classifier, without a change to either. Two limits apply. First, `set_admin_value` was named on purpose to match an admin pattern in Kuyfi's heuristic (`set_admin`), which is why the finding is `CRITICAL` rather than `HIGH`. This is a test of the mechanism, not of how well the tool recognizes administrative functions in general. Second, the fixture is 1,700 bytes and has one code path. Detecting a bug here is a lower bound on the tool's usefulness, not an estimate of its detection rate.

## 6. Case study 3: a real AMM

> **REAL THIRD-PARTY STELLAR TESTNET CONTRACT.**

- **Contract ID:** `CCSJ3REOFONMUJUINMZWBL45UXJYFXVFSXAWINLTDKFNEYBCRR4VF2Q2`
- **Report:** `kyf-20260917T190315Z-444ca562` (JSON and PDF, one run of `kuyfi <id> --json --pdf`)
- **Baseline:** 19 functions, 6 UDTs (`BurnEvent`, `InitEvent`, `MintEvent`, `SwapEvent`, `FeeClaimEvent`, `DataKey`), 23,605 bytes of WASM

The AMM exposes an LP-token surface (`lp_name`, `lp_balance`, `lp_transfer`, `lp_approve`, ...), pool operations (`add_liquidity`, `remove_liquidity`, `swap_exact_in`, `claim_protocol_fees`), and administrative functions (`initialize`, `pause`, `unpause`).

### What was executed

161 vectors were executed and 36 transactions were broadcast, each with a hash. Nine functions take no parameters and received no math vectors. The report contains **127 findings**. We call them signals, not vulnerabilities:

| Signal             | Severity | Count |
| ------------------ | -------- | ----- |
| `UNEXPECTED_ERROR` | MEDIUM   | 125   |
| `POTENTIAL_VULN`   | HIGH     | 2     |

The report contains 127 findings/signals, not 127 confirmed vulnerabilities. `UNEXPECTED_ERROR` is a manual-review, inconclusive signal under the current black-box context. `POTENTIAL_VULN` is a security signal requiring contextual review.

### The 125 `UNEXPECTED_ERROR` signals

These are manual-review signals. By function: `initialize` 36, `add_liquidity` 29, `remove_liquidity` 28, `swap_exact_in` 21, `claim_protocol_fees` 5, `lp_transfer` 3, `lp_transfer_from` 3.

They share one trace shape. In every one, the failure is a generic `scecInvalidAction` host trap attributed to the root contract, and every one failed during simulation, so none of them was sent to the network (see section 10 on what that means for evidence). Of the 125, 106 have no nested calls; 19 (all on `add_liquidity`) show nested calls before the trap (18 with two nested frames, 1 with one). The classifier does not escalate those 19 to `POTENTIAL_VULN`, because each call includes an `Address` argument the fuzzer fabricated and the trap could be that fake address failing a downstream precondition, such as a token balance.

Some of the 125 are on functions where a trap is unsurprising: `initialize` under `UNAUTHORIZED_CALL` (`KYF-021`) and `REINIT_ATTACK` (`KYF-022`) both trapped at the root without a clean contract error. That is neither a confirmed re-initialization bug nor a demonstrated rejection. The trace cannot tell a real guard from a panic used as a guard, so the signal stays at `UNEXPECTED_ERROR`.

### The two HIGH signals

Both come from the `UNAUTHORIZED_ADDR_CALL` vector and both are on read-shaped functions:

| ID        | Function       | Vector                   | Tx (prefix)         | Ledger  |
| --------- | -------------- | ------------------------ | ----------------- | ------- |
| `KYF-035` | `lp_balance`   | `UNAUTHORIZED_ADDR_CALL` | `9d09409390760bb4…` | 4729614 |
| `KYF-039` | `lp_allowance` | `UNAUTHORIZED_ADDR_CALL` | `14aa53d807b01c55…` | 4729626 |

(Full hashes are in section 10.) The vector calls a non-admin function that takes an `Address` with a random, unrelated address, signed only by the ephemeral test key. If the call succeeds, Kuyfi records that as a possible missing-authorization bug. Here it succeeded, which is plausible behavior for a getter. `lp_balance(owner)` and `lp_allowance(owner, spender)` return values, and a getter that takes an address does not necessarily require that address's authorization. These two signals are plausible black-box false positives. The tool matched the shape (a function with an `Address` parameter that was not rejected) without understanding what the function does.

The contrast matters. `pause()`, an actual administrative operation, received the `UNAUTHORIZED_CALL` vector and was rejected: the transaction was included at ledger 4729597 as `txFailed` with `invokeHostFunctionTrapped`, carrying one authorization entry with no signature, and it produced **no finding**. `unpause` also produced none. The state-changing token functions `lp_approve`, `lp_transfer`, and `lp_transfer_from` received `UNAUTHORIZED_ADDR_CALL` and produced no finding for that vector. The vector succeeded on the two getters and was not accepted on those state-changing functions, which is the outcome one would hope for, although Kuyfi has no way to know that is the reason. For four pool functions (`add_liquidity`, `remove_liquidity`, `swap_exact_in`, `claim_protocol_fees`) the same vector ended as `UNEXPECTED_ERROR`, which is inconclusive.

### Connection to Week 1

_Historical context, not in the evidence bundle._ During development in Week 1, an earlier AMM run was observed producing 18 HIGH false-positive escalations, attributed largely to semantically invalid generated addresses (Week 1 changelog). That historical run is not included in the current evidence bundle, and this article does not use it as a reproducible metric. The classifier work that followed introduced DiagnosticEvent-based classification and a rule that a call including a fabricated `Address` is not escalated to `POTENTIAL_VULN` on nested-call activity alone.

_Measured in this campaign._ The report contains 19 findings whose traces show nested calls before the trap, all on `add_liquidity`. None was escalated: all 19 are `UNEXPECTED_ERROR`. We have not compared the historical escalations with these 19 vector by vector, so we make no claim that they are the same vectors, and this run alone does not show a regression.

Read together: classification work reduced one earlier false-positive class, while the real campaign exposed a remaining limitation in function-semantic understanding, the two HIGH getters above, where the problem is not the trace but the tool's lack of knowledge about what a function is for. That is an engineering finding about Kuyfi.

## 7. Case study 4: a real passkey wallet

> **REAL THIRD-PARTY STELLAR TESTNET CONTRACT.** A Testnet deployment attributed to `stellar/passkey-kit`. We did not verify the deployed WASM against the upstream source.

- **Contract ID:** `CCYQXFQIXV6FOLAA4ITLFTBSWZCKC5IZC2BJWCWN2MZGF5ZPACSMZSUS`
- **Report:** `kyf-20260917T190742Z-13329bb0` (JSON and PDF)
- **Baseline:** 7 functions, 9 UDTs, 34,105 bytes of WASM
- **Executed:** 110 vectors, 8 broadcast transactions, 9 transactions with a hash
- **Findings:** 62 findings/signals, not 62 confirmed vulnerabilities. All are `UNEXPECTED_ERROR` / `MEDIUM`, a manual-review signal under the current black-box context. **No `POTENTIAL_VULN`.**

### Why this surface is different

The AMM is mostly numbers and addresses. A smart-account wallet is an authorization system. Its functions are `upgrade`, `add_signer`, `get_signer`, `__check_auth`, `__constructor`, `remove_signer`, and `update_signer`. Its nine UDTs (`Signer`, `Signature`, `SignerKey`, `SignerVal`, `Signatures`, `SignerLimits`, `SignerStorage`, `SignerExpiration`, `Secp256r1Signature`) describe signer types (ed25519, secp256r1 for passkeys, and policy contracts), signer limits and storage, and signatures. The security question shifts from "what happens at `i128::MAX`" to "who can add a signer, who can upgrade the code, and does `__check_auth` verify what it should". Most of those questions depend on host-provided authentication context and on the wallet's own state, which type signatures do not expose.

### Per-function results

| Function        | Vectors | Findings | Notes                                                                       |
| --------------- | ------- | -------- | --------------------------------------------------------------------------- |
| `upgrade`       | 3       | 3        | 2 math + 1 `UNAUTHORIZED_CALL`; all `UNEXPECTED_ERROR` (`Storage / scecMissingValue`) |
| `add_signer`    | 29      | 29       | all `UNEXPECTED_ERROR`, root-level `scecInvalidAction`; no access-control vector ran |
| `get_signer`    | 9       | 1        | `KYF-033`, `UNEXPECTED_ERROR` (`Storage / scecExceededLimit`), not broadcast |
| `__check_auth`  | 0       | 0        | **coverage gap** (below)                                                    |
| `__constructor` | 29      | 0        | no findings                                                                 |
| `remove_signer` | 9       | 0        | no findings                                                                 |
| `update_signer` | 29      | 29       | all `UNEXPECTED_ERROR`, root-level `scecInvalidAction`; no access-control vector ran |
| call-ordering   | 2       | 0        | not attributable to one function                                            |
| **Total**       | **110** | **62**   |                                                                             |

## 8. The `__check_auth` coverage gap

`__check_auth` received **0 vectors**. Kuyfi logged `Math done (0 invocations)` and `Access done (0 invocations)` for it.

This does not mean `__check_auth` is secure, and it does not mean it rejected attacks. Kuyfi never called it.

Its signature is `__check_auth(signature_payload: BytesN<32>, signatures: Signatures, auth_contexts: Vec<Context>)`. The math fuzzer requires a valid baseline for every parameter, and skips the whole function if any one cannot be built. `Context` is not among the nine UDTs the scan found, so the registry cannot resolve `Vec<Context>`, which is consistent with the function being skipped. This is an inference from the code path: we did not instrument the run to log which parameter blocked. Either way the outcome is the same: **current type and input generation cannot construct the context needed to meaningfully exercise this entry point.**

We classify this as a **COVERAGE GAP**.

There is also a reason that goes beyond a missing generator. `__check_auth` is not an ordinary externally called function. On a custom-account contract, the Soroban host invokes it while authorizing some other operation, passing the signature payload, the signatures supplied by the caller, and the list of authorization contexts. Exercising it meaningfully means building a transaction in which this account is the authorizing party, with credentials and a payload that the host derives, rather than filling in three arguments and sending them. Black-box fuzzing over externally supplied arguments is a poor fit for an entry point whose inputs come from the host's authentication machinery. This is the main honest limitation of the passkey campaign.

## 9. Signer management results

- **`add_signer`**: 29 `UNEXPECTED_ERROR` signals, requiring manual review. All 29 are root-level `scecInvalidAction` traps with no nested calls, and all failed during simulation, so none was sent. Inconclusive under the current black-box context.
- **`update_signer`**: the same pattern (root-level `scecInvalidAction`, simulation failure, nothing sent), 29 signals, requiring manual review.
- **`remove_signer`**: no findings in this campaign. Nine vectors ran and each was classified `SECURE` or `PRECONDITION_FAIL` (accepted, cleanly rejected, or an expected precondition). The report does not retain the traces of vectors filtered out of `findings[]`, so we cannot say more about why.
- **`upgrade`**: inconclusive. All three vectors are `UNEXPECTED_ERROR`, each failing at simulation with a `Storage / scecMissingValue` error at the root. This includes the `UNAUTHORIZED_CALL` vector. That call did not succeed (which would have been `POTENTIAL_VULN`), but it was not classified as a clean rejection either. Because it failed at simulation it was never sent, so whether the contract's on-chain authorization would have rejected it was not exercised.
- **`get_signer`**: one signal, `KYF-033`, on the vector `signer_key::SignerKey::Secp256r1.0::LARGE_BYTES`, with a `Storage / scecExceededLimit` error at the root, not broadcast (see section 10). An oversized input hitting a host limit can be expected host behavior, but the classifier does not assume that.

None of these `UNEXPECTED_ERROR` signals is a vulnerability claim. They are places where Kuyfi's trace evidence ran out.

There is one structural limitation to state plainly. `add_signer`, `update_signer`, and `remove_signer` received **no access-control vectors at all**. Access-control vectors run on functions whose names match admin patterns, or on non-admin functions that take an `Address` parameter at the top level. The three signer-management functions take a `Signer` or `SignerKey` UDT, so neither condition holds. In a smart wallet these are among the most sensitive functions, and the campaign never tried calling them without the wallet's authorization.

## 10. Verifiable Testnet evidence

Every run's transactions are on Stellar Testnet. Explorer URL pattern: `https://stellar.expert/explorer/testnet/tx/<hash>`. The selection below is small and representative; the per-run evidence index remains the exhaustive source. "Verification sample" means one of the sample transactions a report keeps to make its counts checkable. Each broadcast transaction below was confirmed on Horizon (Testnet) on 2026-09-19 and its ledger matches the report; the unsent `KYF-033` hash returns 404.

**Composite UDT fixture** (`kyf-20260909T235037Z-99dcfda0`)

| Function / vector           | Role                | Ledger  | Transaction hash                                                   |
| --------------------------- | ------------------- | ------- | ------------------------------------------------------------------ |
| `echo_point` / `p::Point.x::ZERO` | verification sample | 4594794 | `ac714bfa22b39cd72fe8aab375e9c21cf9cad6a3812483c0f9a91a40e922e0f2` |

**Intentionally vulnerable fixture** (`kyf-20260911T220317Z-074f925b`, and second run `kyf-20260911T222017Z-4ff82516`)

| Function / vector                                    | Role                                    | Ledger  | Transaction hash                                                   |
| ---------------------------------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------ |
| `set_admin_value` / `UNAUTHORIZED_CALL`              | `KYF-001`, `POTENTIAL_VULN`, `CRITICAL` | 4628114 | `2414467c1788a311f2c9c4043b20443d43055462c9f592c053f556b130b173da` |
| `set_admin_value` / `admin::RANDOM_ADDR_A`           | verification sample                     | 4628107 | `4a474792a3bbe11fb365dbd4689b7b6ead25b4e186cef966fe789a72ec071def` |
| `secure_set_admin_value` / `admin::RANDOM_ADDR_A`    | verification sample, protected variant; failed on-chain | 4628115 | `0b20585d2c7ac8a9cf61a383d17ee0dfd1f21f6693e5adfdbd4e6fab6910d72b` |
| `set_admin_value` / `UNAUTHORIZED_CALL` (second run) | `KYF-001`, `POTENTIAL_VULN`, `CRITICAL` | 4628318 | `0f032b7b72aa3accb3a3ec1467fd08dd8b59c4ec5dcef6d4c72acacf68c7ed2c` |

**Real AMM** (`kyf-20260917T190315Z-444ca562`)

| Function / vector                          | Role                                                | Ledger  | Transaction hash                                                   |
| ------------------------------------------ | --------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `lp_balance` / `owner::RANDOM_ADDR_A`      | verification sample                                 | 4729612 | `c39b80782523e7125a58bae9564ab827a7fffbf5f2f5e6c5feb0a41cd51e2ce3` |
| `pause` / `UNAUTHORIZED_CALL`              | verification sample; failed on-chain (rejected), 0 findings | 4729597 | `a6d2765ac72a6a2ee967dafb7fd48920a94d3548a23ce94b07aa4cb99b3af872` |
| `lp_balance` / `UNAUTHORIZED_ADDR_CALL`    | `KYF-035`, `POTENTIAL_VULN`, `HIGH`                 | 4729614 | `9d09409390760bb444f28ae67e94e8140f555903c2dee716cb00a4322ab21b2e` |
| `lp_allowance` / `UNAUTHORIZED_ADDR_CALL`  | `KYF-039`, `POTENTIAL_VULN`, `HIGH`                 | 4729626 | `14aa53d807b01c557e6b88c146757dd4f95cf8b4361da6de265051b1ce09313c` |

**Real passkey wallet** (`kyf-20260917T190742Z-13329bb0`)

| Function / vector                                       | Role                                   | Ledger | Transaction hash                                                   |
| ------------------------------------------------------- | -------------------------------------- | ------ | ------------------------------------------------------------------ |
| `get_signer` / `signer_key::SignerKey::Policy`          | verification sample, broadcast         | 4729683 | `750daedb1be0cd6557e6b1c25812987009850c1b9467716c0f2b8036d9243f23` |
| `get_signer` / `signer_key::SignerKey::Secp256r1.0::LARGE_BYTES` | `KYF-033`, `UNEXPECTED_ERROR`; hash present, not broadcast, not found on Horizon | none | `64c6f1e9be4a27925dce5f950afd9164c8fcac5e8c14058c5c3e8b2172cce74a` |

### Findings, vectors, simulations, and transactions

These counts measure different things and are not expected to match. A finding does not need its own transaction.

| Term                       | What it counts                                                                                       | AMM | Passkey wallet |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | --- | -------------- |
| Vectors executed           | Attack invocations attempted. Each one starts with a simulation (preflight).                         | 161 | 110            |
| Findings                   | Entries in `findings[]`: vectors classified as anything other than `SECURE` or `PRECONDITION_FAIL`. | 127 | 62             |
| Transactions with hash     | Vectors that got as far as a signed transaction envelope.                                            | 36  | 9              |
| Broadcast transactions     | Vectors whose transaction was accepted by the network (`broadcasted: true`).                         | 36  | 8              |
| Hashes listed in the report | Hashes preserved in the JSON: findings that carry one, plus the verification samples.               | 4   | 2              |

The architecture explains the gaps. Every vector is simulated first. When the simulation fails, Kuyfi classifies the vector from the diagnostic events the simulation returned and sends nothing. Only vectors whose simulation succeeds are signed and sent. So many vectors are classified without a successful on-chain broadcast, and simulation can generate actionable signals, `UNEXPECTED_ERROR` among them. Only broadcast transactions can be observed independently on-chain. A signal that came from simulation is backed by the trace stored in the JSON, not by a transaction you can open in an explorer.

Measured from the reports, the origin of the findings is:

- **AMM:** 125 findings were classified from simulation diagnostics (`simulationFailed: true`, no hash, not broadcast). 2 findings were broadcast (both `POTENTIAL_VULN`).
- **Passkey wallet:** 61 findings were classified from simulation diagnostics. 1 finding (`KYF-033`) has a hash but was not broadcast. 0 findings were broadcast.

The remaining vectors, those classified `SECURE` or `PRECONDITION_FAIL`, follow by arithmetic (inferred from the counters, not listed in the report). For the AMM, 161 − 127 = 34 such vectors, and 36 broadcast − 2 broadcast findings = 34, so every one of them was broadcast. For the passkey wallet, 110 − 62 = 48 such vectors, of which 8 were broadcast and 40 were classified without a broadcast.

**Broadcast versus hash, passkey: 8 versus 9.** This is not a bug. It comes from `KYF-033`. What the `SecurityReport` stores for it: `simulationFailed: false`, `broadcasted: false`, a `transactionHash`, `ledger: null`, and a trace whose last error is `Storage / scecExceededLimit` at the root. A Horizon lookup for that hash on 2026-09-19 returned 404, so it never entered a ledger. The report does not store the RPC's error string or the send status, so the node-side cause is not evidenced. _Implementation-level inference:_ based on the control flow in `router.ts`, the combination (hash present, not broadcast, simulation not failed) maps to the send-error path, where the transaction was signed locally, `sendTransaction` returned an error status, and the locally computed hash was recorded. In the AMM report, broadcast and hash counts are both 36.

**Terminal summary versus SecurityReport.** These are two different metrics, not one number reported twice. The terminal summary counts vector classifications: it reads the internal `ChaosReport` counters, which cover every executed vector, including `SECURE` ones. The `SecurityReport` severity summary counts `findings[]` only, and `SECURE` and `PRECONDITION_FAIL` vectors are excluded from it by design. That is why the terminal printed `Info: 11` (AMM) and `Info: 48` (passkey wallet) while the JSON has `summary.bySeverity.info: 0` in both. The terminal counters add up to the vectors executed: for the AMM, 0 critical + 2 high + 125 medium + 0 low + 11 info = 138 of 161, and the remaining 23 must be `PRECONDITION_FAIL` vectors, which the terminal does not print (inferred by subtraction). For the passkey wallet, 62 + 48 = 110. `Findings:` is the same in both places (127 and 62).

**Why the report lists so few hashes.** This is intended design, not data loss, and it has a cost. `ChaosReport.verificationTransactions` is documented in the code as "A small, deterministic sample of real transaction evidence from the whole run — NOT the full result set.": the first broadcast that succeeded and the first that failed. The `SecurityReport` copies that sample and adds the hash of any finding that has one. The per-vector result list is not kept once the report is built, and the JSON and PDF exporters only project what the report holds, so no exporter drops anything. The counters are tallied over every vector, so a report can count transactions it does not list. For the AMM, 4 of 36 hashes are listed (2 finding transactions and 2 samples); the other 32 belong to vectors filtered out of `findings[]`. For the passkey wallet, 2 of 9 are listed (`KYF-033` and one sample); the other 7 belong to broadcast vectors filtered out of `findings[]`. The cost is that most broadcast transactions cannot be checked from the report alone (section 12).

## 11. What Kuyfi did well

- **Reconstructed real attack surfaces from deployed Contract IDs**: 19 functions and 6 UDTs for the AMM, 7 functions and 9 UDTs for the passkey wallet, with no source code.
- **Handled composite Soroban types**: structs, enums, unions with payloads, nested UDTs, `Vec<UDT>`, and `Option<UDT>`, verified against a real deployed contract (57 of 57 vectors sent) and then applied to the 9 UDTs of a real wallet.
- **Preserved on-chain evidence**: transaction hash, ledger, broadcast status, explorer URL, and a structured trace for each finding, carried into both JSON and PDF.
- **Distinguished a known access-control bug from its protected counterpart** with the same vectors and classifier (section 5).
- **Handled the administrative cases it could reach**: `pause` was rejected under `UNAUTHORIZED_CALL` and produced no finding.
- **Did not turn ambiguity into a claim.** No `POTENTIAL_VULN` on the passkey wallet, and no escalation of the 19 nested-call traces on the AMM.
- **Produced stable, machine-readable and human-readable reports.** One `SecurityReport` per run, `schemaVersion 1.0.0`, with JSON and PDF sharing one `reportId`.

## 12. What the campaign exposed about Kuyfi

These are engineering directions found by running the tool on real contracts. They are not hidden failures.

1. **Name and shape heuristics can over-interpret `Address`-taking getters.** `lp_balance` and `lp_allowance` were flagged HIGH (section 6). The tool cannot separate "a getter that legitimately needs no authorization" from "a function that forgot `require_auth()`".
2. **`UNEXPECTED_ERROR` is intentionally conservative, and it is noisy.** Of the 189 findings across the two real contracts, 187 are `UNEXPECTED_ERROR`, and 183 of those share one trace shape (a root-level `scecInvalidAction` trap). The signal is honest but hard to triage by hand at this volume.
3. **`__check_auth` has a real coverage gap** (section 8). Host and auth context cannot currently be synthesized, so the most security-critical entry point of the wallet was not exercised.
4. **Type signatures do not carry semantic state requirements.** Baselines are zero-like values and random unfunded addresses. A contract that needs prior state, real balances, or real signers will trap on almost any input, and the tool cannot always tell that from a bug.
5. **Zero findings does not prove safety.** `remove_signer`, `__constructor`, and the call-ordering vectors produced no findings. That means their vectors were classified `SECURE` or `PRECONDITION_FAIL`, not that those functions are secure.
6. **Access-control coverage depends on names and top-level `Address` parameters** (section 9). The signer-management functions of the wallet received no access-control vectors.
7. **Simulation-only signals say nothing about on-chain behavior.** The `UNAUTHORIZED_CALL` vectors on `initialize` (AMM, `KYF-021`) and `upgrade` (wallet, `KYF-003`) failed during simulation and were never sent. By contrast, the `pause` transaction (AMM) and both `secure_set_admin_value` samples (fixture) reached the network and were rejected there, each carrying an authorization entry with no signature. _Inference:_ simulation records the authorization a call needs instead of enforcing signatures, so an unsigned-authorization rejection appears on-chain, and a call that fails in simulation for another reason never reaches that check. For those two vectors, on-chain authorization was not exercised.
8. **The report keeps representative transaction evidence, not all of it** (release follow-up). The counters cover every vector, but the report lists only a small sample of hashes (section 10), so most broadcast transactions cannot be checked from the report alone. The exhaustive list existed at run time and is not retained. A follow-up would keep every broadcast hash in the report. This does not affect any claim in this article, which rests on the listed transactions and on counts read from the report.

## 13. How we got here

- **Week 1: type support, trace classification, and a false-positive investigation.** UDT struct support and the `PRECONDITION_FAIL` signal, then DiagnosticEvent-based classification after the AMM produced false-positive escalations.
- **Week 2: a unified audit pipeline.** One headless pipeline from Contract ID to `SecurityReport`, with execution evidence preserved, a versioned JSON schema, a PDF renderer, and Testnet evidence.
- **Week 3: an installable, modular tool.** Preparation of the CLI as an installable package, a stable TUI, a modular architecture, an open-source repository, and the real-contract campaigns described here.

## 14. Reproducing this

From a clone of the repository (`https://github.com/alex0tico/kuyfi_tui`):

```bash
npm ci
npm run build
node dist/cli.js <CONTRACT_ID> --json --pdf
```

This scans the contract, runs Chaos Monkey against Testnet, and writes `kuyfi-report-<reportId>.json` and `.pdf` from a single run. Kuyfi is Testnet-only and has no Mainnet support. It sends real transactions, so run it only against contracts you own or are authorized to test, even on Testnet. The ephemeral key is generated per run and never written to disk. The AMM and passkey wallet used here are public Testnet deployments where no funds are at stake, and we are not presenting any result on them as a confirmed vulnerability.

## 15. Conclusion

Kuyfi now demonstrates an end-to-end black-box audit workflow: from a deployed Soroban Contract ID, through an attack surface rebuilt from on-chain data, type-aware vectors, and trace-based classification, to a report with on-chain evidence that others can check. It separated a known access-control bug from its guarded twin. On two real Testnet contracts it reconstructed the interface, ran 271 vectors, and emitted 189 signals, none of which we can call a vulnerability without more work.

It is not a formal verification system and it does not certify a contract. Its findings need context, and its coverage limitations (the `__check_auth` gap, the missing access-control vectors on signer management, and the distance between a type signature and what a function means) are documented above.

Before the Breach.

---

### Appendix: evidence index

| Target                    | Contract ID                                                | Report ID                       | Functions | UDTs | Vectors | Broadcast | With hash | Findings |
| ------------------------- | ---------------------------------------------------------- | ------------------------------- | --------- | ---- | ------- | --------- | --------- | -------- |
| Composite UDT fixture     | `CDVIVACU3XJQYHLFNWYA3OE3DRRN2S3UDFK43654C3AS4QZFAPFFD5IZ` | `kyf-20260909T235037Z-99dcfda0` | 6         | 4    | 57      | 57        | 57        | 0        |
| Vulnerable fixture        | `CDYUQRWYE6INSGTMJWHPU32VSWVOZ456EUHJMMQXTCFXPFUXPH2JTPV7` | `kyf-20260911T220317Z-074f925b` | 3         | 0    | 16      | 16        | 16        | 1        |
| Real AMM                  | `CCSJ3REOFONMUJUINMZWBL45UXJYFXVFSXAWINLTDKFNEYBCRR4VF2Q2` | `kyf-20260917T190315Z-444ca562` | 19        | 6    | 161     | 36        | 36        | 127      |
| Real passkey wallet       | `CCYQXFQIXV6FOLAA4ITLFTBSWZCKC5IZC2BJWCWN2MZGF5ZPACSMZSUS` | `kyf-20260917T190742Z-13329bb0` | 7         | 9    | 110     | 8         | 9         | 62       |
