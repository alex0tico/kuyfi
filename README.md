```text
      /\_/\               __ __  __  __  __  __  ____  ____               /\_/\
     ( o.o )             / // / / / / /  \ \/ / / __/ /  _/              ( o.o )
      > ^ <             / ,<   / /_/ /    \  / / _/  _/ /                 > ^ <
     /     \           /_/|_|  \____/     /_/ /_/   /___/                /     \
    (|     |)                                                           (|     |)
     \_____/                  [ CORE SECURITY MODULE ]                   \_____/
```

# Kuyfi

> Before the Breach.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](./LICENSE)
[![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-gray?style=flat-square)](./CHANGELOG.md)
[![Network: Stellar Testnet](https://img.shields.io/badge/Network-Stellar%20Testnet-8B5CF6?style=flat-square)](https://developers.stellar.org/docs/networks)
[![Stack: TypeScript + Ink + Soroban SDK](https://img.shields.io/badge/Stack-TypeScript%20%2B%20Ink%20%2B%20Soroban%20SDK-2563EB?style=flat-square)](https://docs.stellar.org/docs/smart-contracts/getting-started)

---

## What is Kuyfi?

Kuyfi is a black-box security terminal for Soroban smart contracts. It works directly against a **deployed** contract on Stellar Testnet — fetching and decoding its WASM bytecode on-chain — with no source code and no privileged access required.

## Why Kuyfi exists

Formal audits (Veridise, Ottersec, CoinFabrik, and peers) require source code, scheduling, and budget. Kuyfi is meant as the layer that comes *before* that: something a developer runs against their own deployed contract to catch obvious, surface-level issues automatically — so a formal audit starts from a cleaner baseline, not so it can be skipped.

```
run Kuyfi → fix obvious issues → submit to a formal audit with a cleaner baseline
```

Kuyfi is automated black-box security testing. It is **not** a formal audit, a certification, and it does not replace either.

## What black-box auditing means

Kuyfi never sees your Rust source. Everything it knows about a contract comes from what's actually observable from the outside: the WASM bytecode a deployed contract publishes, the `contractspecv0` XDR section describing its functions and types, and how the contract actually behaves when it is called — first in simulation, then on Testnet when the call proceeds. This mirrors how an external attacker — or a black-box pentest — would approach a closed target.

## How it works

```
Contract ID
    ↓
OSINT Scanner            fetch + decode WASM, no source needed
    ↓
Attack Surface           functions, parameter types, UDTs (structs, enums, unions)
    ↓
Chaos Monkey             type-aware fuzzing: simulate first, broadcast when it proceeds
    ↓
Execution Trace Classification   DiagnosticEvent-based signal taxonomy
    ↓
SecurityReport            one shared result object
    ↓
JSON / PDF                 same data, two export formats
```

## Installation

Public npm installation will become available with v0.1.0. Until then, run Kuyfi from source:

```bash
git clone https://github.com/alex0tico/kuyfi.git
cd kuyfi
npm ci
npm run build
npm start
```

**Requirements:** Node.js ≥ 20, npm, internet access to Stellar Testnet.

## Usage

The examples below use the `kuyfi` command. From a source checkout, use `npm start` in place of `kuyfi` for the TUI, and `node dist/cli.js` in place of `kuyfi` for the headless CLI.

**Interactive TUI:**

```bash
kuyfi
```

**Headless CLI** — same scanner and Chaos Monkey engine, no TUI, for scripting/CI use:

```bash
kuyfi <CONTRACT_ID>
kuyfi <CONTRACT_ID> --json
kuyfi <CONTRACT_ID> --pdf
kuyfi <CONTRACT_ID> --json --pdf
```

## OSINT Scanner

Given only a Contract ID, the scanner:

- fetches the contract's WASM bytecode via a read-only RPC call (`getContractWasmByContractId`) — no transactions, nothing broadcast;
- decodes the `contractspecv0` custom section directly from the WASM binary;
- builds a registry of user-defined types (structs, unions, enums) referenced by the contract;
- renders the attack surface: every function, its parameter types, and its return type.

Nothing here requires the contract's source code, an ABI file, or any cooperation from the contract's author.

## Chaos Monkey

Chaos Monkey is **not** random/dumb fuzzing. For each function the scanner discovers, it generates **type-aware** attack values from the function's actual XDR parameter types (`i128`, `u32`, `Address`, `Vec<T>`, UDTs, and more), and tests them **one variable at a time** — every other parameter holds a type-correct baseline value, so a failure can be attributed to the specific input that triggered it, not attributed to "some parameter, we're not sure which."

Generated values are type-correct, not semantically valid: a random `Address` is not a funded account, a token, or an authorized signer. Kuyfi classifies conservatively for that reason.

Five vector families:

- **Math / boundary** — per-type boundary values, for example `ZERO`, `ONE`, `NEG_ONE`, `MAX_I128`, `MIN_I128` for integers, `RANDOM_ADDR_A`/`RANDOM_ADDR_B` for addresses, and empty/oversized values for bytes, strings, symbols and vectors. UDTs are attacked recursively, one field or payload slot at a time.
- **Authorization / access control** — `UNAUTHORIZED_CALL`, `REINIT_ATTACK` and `SELF_CALL_ATTACK` against functions whose names match admin patterns (`initialize`, `set_admin`, `upgrade`, etc.), and `UNAUTHORIZED_ADDR_CALL` against non-admin functions that take an `Address`.
- **Call ordering** — the same function called twice in a row: `REINIT_SEQUENCE`, `REPEATED_WITHDRAW_SEQUENCE`, `REPEATED_CLAIM_SEQUENCE`, matched by function name.
- **Fee / basis-point** — `BPS_*` boundary values (0, 1, 9999, 10000, 10001, type max) on numeric parameters whose names look fee- or BPS-shaped.
- **Liquidity-ratio** — paired boundary combinations (`ZERO_A_MAX_B`, `MAX_A_MAX_B`, ...) on the first two numeric parameters of functions whose names suggest liquidity, swap or reserve logic.

**Execution model.** Every vector is simulated first (preflight). Only when the simulation succeeds is the transaction signed with an ephemeral, Friendbot-funded keypair, submitted to Stellar Testnet and polled for its result. Keypairs are generated in memory and never persisted to disk or logged.

```
vector → simulate (preflight)
           ├─ simulation fails    → classify from diagnostic events (nothing is sent)
           └─ simulation succeeds → sign → broadcast to Testnet → poll → classify
```

Many vectors, and many findings, are therefore classified without an on-chain transaction.

## Finding semantics

Every executed vector is classified into one of six signals, based on Soroban's `DiagnosticEvent` execution trace — not just whether the transaction succeeded or failed:

| Signal | Meaning |
|---|---|
| `SECURE` | A confident, expected outcome: the contract or host rejected the input the way you'd expect (a contract-level error, a reserved-function boundary, a host object error), or a non-access-control vector was accepted. Filtered out of the findings list; counted in the summary only. |
| `PRECONDITION_FAIL` | A confident rejection explained by missing setup — most commonly a structural auth rejection because the ephemeral test account is not an authorized signer. Filtered out of the findings list; counted in the summary only. |
| `UNEXPECTED_ERROR` | A manual-review, inconclusive signal: the vector failed but the trace does not explain why (for example a generic trap at the root of the call, or storage reached before an auth check can be confirmed). Reported as a `MEDIUM` finding, honestly labeled as inconclusive rather than forced into `SECURE` or `POTENTIAL_VULN`. |
| `POTENTIAL_VULN` | A security signal requiring contextual/manual review — not a confirmed vulnerability. Raised when an access-control vector is **not** rejected, when the trace shows a runtime-safety fault (arithmetic or index-bounds) after nested calls attributed to the target contract, or when a root-level trap follows nested calls and no fabricated `Address` argument could explain it. |
| `UNCONTROLLED_PANIC` | The target contract traps on a runtime-safety fault (arithmetic or index-bounds) with no nested-call activity — a robustness/error-handling signal, not a proven exploitable bug. Reported as a `MEDIUM` finding. |
| `TIMEOUT` | The transaction was not confirmed within the polling window. Inconclusive; reported as a `LOW` finding. |

Findings also carry a severity: `POTENTIAL_VULN` is `CRITICAL` when the function name matches an admin pattern and `HIGH` otherwise; `UNEXPECTED_ERROR` and `UNCONTROLLED_PANIC` are `MEDIUM`; `TIMEOUT` is `LOW`.

**What Kuyfi does not claim:**

- Zero findings does not prove the absence of vulnerabilities.
- A finding is a signal to investigate, not a proven exploit; `POTENTIAL_VULN` is the signal worth reviewing first, and `UNEXPECTED_ERROR` is inconclusive by design.
- Kuyfi does not replace a formal audit, and does not issue any certification.

## Execution evidence

Each `SecurityReport` includes execution evidence so its claims can be checked without trusting Kuyfi's own output:

- run-wide counters over every executed vector: vectors executed, broadcast transactions, and transactions with a hash;
- per finding: whether the simulation failed, whether a transaction was broadcast, and the parsed `DiagnosticEvent` trace that produced the classification;
- for findings whose transaction was broadcast: the `transactionHash`, the `ledger`, and a `stellar.expert` explorer URL;
- `verificationTransactions`: a small, deterministic, representative sample (the first broadcast that succeeded and the first that failed), not a complete list.

Not every vector or finding has an on-chain transaction: a vector that fails simulation is classified from its diagnostics and never sent. Only broadcast transactions can be independently verified on-chain.

## Reports

Both export formats are built from the exact same `SecurityReport` object, so a JSON and PDF export from the same run always agree on `reportId`, findings, and evidence.

- **JSON** — `schemaVersion: "1.0.0"`, machine-readable, suited for CI or further tooling.
- **PDF** — the same data laid out as a readable report, explicitly labeled as an automated black-box report, not a formal audit deliverable.

## Requirements

- Node.js ≥ 20
- Internet access to Stellar Testnet (`https://soroban-testnet.stellar.org`)

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full component breakdown — the TUI layer, the audit engine, and how they share the same code path as the headless CLI.

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development setup and how to open a pull request.

## Responsible Use & Limitations

Kuyfi sends **real on-chain transactions** to Stellar Testnet. Always:

- Run only against contracts you own or have explicit written authorization to test.
- Use Testnet only — never point Kuyfi at a Mainnet contract without the contract owner's consent.
- Treat every finding as a lead to investigate, not a verdict. Kuyfi does not prove a contract is secure, does not guarantee the absence of vulnerabilities, and is not a substitute for a formal audit.

Unauthorized fuzzing of third-party contracts may violate their terms of service and may be illegal in your jurisdiction.

## License

MIT — see [`LICENSE`](./LICENSE).

---

```
github.com/alex0tico/kuyfi
```

Kuyfi runs entirely on Stellar Testnet infrastructure and is built with the official `@stellar/stellar-sdk`. It is not affiliated with the Stellar Development Foundation.
