# Roadmap

## Phase 1 — OSINT Scanner

**Status: Shipped**

- [x] Fetch WASM bytecode from any Soroban Testnet contract via RPC
- [x] Alignment-tolerant XDR parse of `contractspecv0` custom section
- [x] UDT struct/union/enum registry from `scSpecEntryUdtStructV0`-family entries
- [x] Attack surface map rendered in terminal (functions, typed params, return types)

## Phase 2 — Chaos Monkey

**Status: Shipped**

- [x] Ephemeral keypair generation + Friendbot funding + on-chain confirmation
- [x] Type-aware math boundary attacks (`ZERO`, `ONE`, `NEG_ONE`, `MAX_*`/`MIN_*`, and per-type values for addresses, bytes, strings, vectors and UDTs), one variable at a time
- [x] Access control vectors: `UNAUTHORIZED_CALL`, `REINIT_ATTACK`, `SELF_CALL_ATTACK` on admin-pattern functions, and `UNAUTHORIZED_ADDR_CALL` on non-admin functions that take an `Address`
- [x] Composite UDT-aware fuzzing (structs/unions/enums, recursive types)
- [x] Five vector families in total: math/boundary, authorization/access-control, call-ordering, fee/basis-point, and liquidity-ratio
- [x] Execution lifecycle: simulate first; when the simulation succeeds, assemble → sign → submit → poll (a failed simulation is classified from its diagnostics and nothing is sent)
- [x] `DiagnosticEvent`-based execution-trace classification (structured error categories, not just success/failure)
- [x] Six-signal finding taxonomy (`SECURE`, `PRECONDITION_FAIL`, `UNEXPECTED_ERROR`, `POTENTIAL_VULN`, `UNCONTROLLED_PANIC`, `TIMEOUT`) with false-positive filtering
- [x] Severity classification (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INFO`)
- [x] Finding IDs (`KYF-001`…) assigned in execution order; findings listed by severity

## Phase 3 — Reporting & Distribution

**Status: Shipped**

- [x] Headless CLI mode (`kuyfi <CONTRACT_ID>`) — same engine as the TUI, no interactive UI
- [x] Stable JSON `SecurityReport` export (`schemaVersion: "1.0.0"`)
- [x] PDF report export from the same `SecurityReport`
- [x] TUI export workflow (`[J]`/`[P]`/`[B]` keys, same underlying export code as headless `--json`/`--pdf`)
- [x] Execution evidence in every report: broadcast/hash counters, a small representative sample of verification transactions, and per-finding execution traces (with hash, ledger and explorer URL where a transaction was broadcast)
- [x] npm CLI packaging readiness — `kuyfi` binary, package metadata, `prepack` build guarantee, verified isolated install
- [x] Publish `@kuyfi/kuyfi` to the public npm registry (v0.1.0)
- [x] Responsive TUI layout (large/compact/too-small tiers) and shrink-resize stabilization
- [x] Modular TUI architecture (screens/components/hooks/ui separation)
- [x] Reusable ASCII asset system

## Phase 4 — Not yet started

**Status: Planned, not committed to a specific scope**

- [ ] Broader semantic input provenance for generated attack values (beyond type-correct boundaries)
- [ ] Richer attack-vector coverage as real-world contract patterns are audited
- [ ] Additional contract family support as evidence from real campaigns justifies it
- [ ] Developer integrations (e.g. CI-friendly output formats) if real usage shows a need

## Notes

Kuyfi operates exclusively on Stellar Testnet. Mainnet support, other chains, a hosted/SaaS platform, and any form of certification are explicitly out of scope and not on this roadmap.
