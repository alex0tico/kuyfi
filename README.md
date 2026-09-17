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
[![npm version](https://img.shields.io/badge/npm-v0.1.0-gray?style=flat-square)](https://www.npmjs.com/package/kuyfi)
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

Kuyfi never sees your Rust source. Everything it knows about a contract comes from what's actually observable from the outside: the WASM bytecode a deployed contract publishes, the `contractspecv0` XDR section describing its functions and types, and how the contract actually behaves when real transactions are sent to it. This mirrors how an external attacker — or a black-box pentest — would approach a closed target.

## How it works

```
Contract ID
    ↓
OSINT Scanner            fetch + decode WASM, no source needed
    ↓
Attack Surface           functions, parameter types, UDT structs
    ↓
Chaos Monkey             type-aware fuzzing, real Testnet transactions
    ↓
Execution Trace Classification   DiagnosticEvent-based signal taxonomy
    ↓
SecurityReport            one shared result object
    ↓
JSON / PDF                 same data, two export formats
```

## Installation

**Planned public npm installation for v0.1.0:**

```bash
npm install -g kuyfi
kuyfi
```

This package has not been published to npm yet. Until then, run it from source:

```bash
git clone https://github.com/alex0tico/kuyfi_tui.git
cd kuyfi_tui
npm ci
npm run build
npm start
```

**Requirements:** Node.js ≥ 20, npm, internet access to Stellar Testnet.

## Usage

**Interactive TUI:**

```bash
kuyfi
```

(From source, before publishing: `npm start`.)

**Headless CLI** — same scanner and Chaos Monkey engine, no TUI, for scripting/CI use:

```bash
kuyfi <CONTRACT_ID>
kuyfi <CONTRACT_ID> --json
kuyfi <CONTRACT_ID> --pdf
kuyfi <CONTRACT_ID> --json --pdf
```

The global `kuyfi` command above corresponds to the npm distribution being prepared for v0.1.0 (`bin: {"kuyfi": "dist/cli.js"}`). Running from a local clone today, the equivalent is `node dist/cli.js <CONTRACT_ID> [--json] [--pdf]`.

## OSINT Scanner

Given only a Contract ID, the scanner:

- fetches the contract's WASM bytecode via a read-only RPC call (`getContractWasmByContractId`) — no transactions, nothing broadcast;
- decodes the `contractspecv0` custom section directly from the WASM binary;
- builds a registry of user-defined types (structs, unions, enums) referenced by the contract;
- renders the attack surface: every function, its parameter types, and its return type.

Nothing here requires the contract's source code, an ABI file, or any cooperation from the contract's author.

## Chaos Monkey

Chaos Monkey is **not** random/dumb fuzzing. For each function the scanner discovers, it generates **type-aware** attack values from the function's actual XDR parameter types (`i128`, `u32`, `Address`, `Vec<T>`, UDT structs, and more), and tests them **one variable at a time** — every other parameter holds a type-correct baseline value, so a failure can be attributed to the specific input that triggered it, not attributed to "some parameter, we're not sure which."

Two vector families:

- **Math boundary vectors** — `ZERO`, `MAX_VALUE`, `NEGATIVE`, `MIN_BOUNDARY` attacks against numeric parameters.
- **Access control vectors** — `UNAUTHORIZED_CALL`, `REINIT_ATTACK`, `SELF_CALL_ATTACK` against functions whose names match admin patterns (`initialize`, `set_admin`, `upgrade`, etc.).

Every vector is a **real, signed transaction broadcast to Stellar Testnet** from an ephemeral, Friendbot-funded keypair — never a simulation-only guess. Keypairs are generated in memory and never persisted to disk or logged.

## Finding semantics

Every executed vector is classified into one of six signals, based on Soroban's `DiagnosticEvent` execution trace — not just whether the transaction succeeded or failed:

| Signal | Meaning |
|---|---|
| `SECURE` | The contract rejected the attack the way you'd expect (an auth check, a business-logic guard, a reserved-function boundary). Filtered out of the findings list; counted in the summary only. |
| `PRECONDITION_FAIL` | The transaction failed for a structural reason unrelated to a vulnerability — most commonly, the ephemeral test account lacks the signer/allowance the call legitimately requires. Filtered out of findings; counted in the summary only. |
| `SIMULATION_FAIL` | The transaction never made it past simulation. Not evidence of anything either way. |
| `TIMEOUT` | The transaction wasn't confirmed within the polling window. Inconclusive, not a finding. |
| `UNEXPECTED_ERROR` | The trace doesn't clearly explain the failure (or storage was reached before an auth check could be confirmed). Reported as a finding, honestly labeled as inconclusive rather than forced into `SECURE` or `POTENTIAL_VULN`. |
| `POTENTIAL_VULN` | The contract panicked on a type-correct, in-range input, or an access-control vector was **not** rejected. This is the signal worth investigating first. |

Findings also carry a severity — `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO` — based on the signal and whether the function looks like an admin-only entry point.

**What Kuyfi does not claim:**

- Zero findings does not prove the absence of vulnerabilities.
- A `POTENTIAL_VULN` finding is a signal to investigate, not a proven exploit.
- Kuyfi does not replace a formal audit, and does not issue any certification.

## Execution evidence

Every finding carries the data needed to verify it independently, without trusting Kuyfi's own output:

- `broadcasted` — whether the transaction was actually sent to the network;
- `transactionHash` — the real Testnet transaction hash;
- `ledger` — the ledger it landed in;
- `trace` — the parsed `DiagnosticEvent` execution trace that produced the classification;
- an explorer URL (`stellar.expert`) for every transaction hash, so any claim in a report can be checked on-chain by a third party.

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
github.com/alex0tico/kuyfi_tui
```

Kuyfi runs entirely on Stellar Testnet infrastructure and is built with the official `@stellar/stellar-sdk`. It is not affiliated with the Stellar Development Foundation.
