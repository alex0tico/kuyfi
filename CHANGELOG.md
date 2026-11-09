# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `kuyfi-server`: paid HTTP endpoint `GET /scan/:contractId` for the OSINT Scanner, charged per scan with x402 on Stellar and priced in CLP through Local402. Chaos Monkey is not exposed over HTTP.

## [0.2.0] - 2026-11-09

### Added

- Contextual configuration (`--config <file>`): `context.roles` and `context.knownValues` give the audit values it cannot invent, so it can get past semantic preconditions such as a stored-role check
- Per-campaign limits in the configuration: `functions`, `families`, `maxVectors` and `mode` (`simulate-only` by default, or `broadcast`). Without an `authorizationRecord` a campaign is simulate-only, and a simulate-only campaign blocks every send at the network client
- Provenance for every generated input and a per-vector outcome (blocked, accepted, signal) in the report
- `--seed <number>`: the same seed on the same contract regenerates the same test data; without it a seed is generated, printed and saved in the report (`seed`)
- Gates for CI: `--fail-on <info|low|medium|high|critical>`, `--fail-on-include-hypotheses`, `--fail-on-incomplete` and `--timeout <seconds>`; `seed`, `failOn`, `failOnIncludeHypotheses`, `failOnIncomplete` and `timeout` can also be set in the configuration file, and a flag always wins
- Exit codes `0` (ok), `1` (tool error), `2` (`--fail-on` fired) and `3` (`--fail-on-incomplete` fired), with precedence 1 > 2 > 3 > 0; the report records the gate that fired (`gate`) and the coverage of the run
- `kuyfi authz <matrix.json>`: builds, signs and simulates Soroban authorization entries in explicit enforcing mode (Ed25519, custom account and nested cases), with the relay account as transaction source, JSON evidence and a failure record when a run cannot complete; it accepts `--out`, `--fail-on` and `--fail-on-incomplete`
- Reproducible Testnet fixtures for the authorization matrix (`npm run authz:testnet`)

### Changed

- JSON report fields added to `schemaVersion` 1.0.0 are additive (`seed`, `gate`, coverage, provenance); without the new flags the run, the output and the exit codes (`0` completed, `1` tool failure) are unchanged

## [0.1.0] - 2026-09-20

### Added

- Black-box OSINT scanner: attack-surface reconstruction from deployed WASM, no source code required
- Chaos Monkey fuzzing engine: type-aware math boundary and access-control attack vectors
- Composite UDT-aware fuzzing (structs/unions/enums, recursive types) and additional vector families (call-order, fee, liquidity/swap-shaped functions)
- `DiagnosticEvent`-based execution-trace classification with a six-signal finding taxonomy
- Headless CLI mode (`kuyfi <CONTRACT_ID> [--json] [--pdf]`) — same engine as the interactive TUI
- Stable JSON `SecurityReport` export (`schemaVersion: "1.0.0"`)
- PDF report export from the same `SecurityReport`
- TUI export workflow (`[J]`/`[P]`/`[B]` keys)
- Execution evidence in every report: transaction hashes, ledgers, explorer URLs
- npm CLI packaging: `kuyfi` global binary, package metadata, `prepack` build guarantee
- Responsive TUI layout (large/compact/too-small tiers)
- Reusable ASCII asset system (`source/ui/ascii/`)

### Changed

- Renamed the npm package from `kuyfi_tui` to `@kuyfi/kuyfi` (the installed command remains `kuyfi`); bumped the pre-release version from `0.0.0` to `0.1.0`
- Split the monolithic `app.tsx` into a modular TUI architecture (`screens/`, `components/`, `hooks/`, `ui/`)
- Modernized release tooling (Prettier, XO, AVA) to a working, CI-safe baseline

### Fixed

- Terminal resize could leave stamped/overlapping frames on screen when the terminal was shrunk repeatedly; mitigated with shrink detection, a debounce, and a single controlled screen clear
- A sliding log list in the Chaos Monkey view could produce duplicate React keys during a run
- Several execution-trace edge cases that could escalate a benign precondition failure into a reported finding

## [0.0.0] — 2026-06-09

### Added

- **OSINT Scanner (Phase 1 — Stable)**
  - Fetch WASM bytecode from any Soroban Testnet contract via `getContractWasmByContractId`
  - Alignment-tolerant XDR parse of `contractspecv0` custom section
  - UDT struct registry built from `scSpecEntryUdtStructV0` entries
  - Attack surface map: function names, typed parameter list, return type
  - Input validation (56-char Contract ID starting with C)

- **Chaos Monkey (Phase 2 — Beta)**
  - Ephemeral keypair generation and Friendbot funding with on-chain confirmation
  - Type-aware math boundary fuzzer: ZERO, MAX_VALUE, NEGATIVE, MIN_BOUNDARY attacks
  - One-variable-at-a-time strategy with type-correct baseline values for other params
  - Access control fuzzer: UNAUTHORIZED_CALL, REINIT_ATTACK, SELF_CALL_ATTACK vectors
  - Admin function detection by name pattern
  - Full transaction lifecycle: simulate → assemble → sign → submit → poll
  - Error taxonomy: classifies WASM panics, auth errors, contract errors, storage errors, host errors
  - `PRECONDITION_FAIL` signal for TX_FAILED cases (simulation passed, on-chain state issue)
  - Severity classification: CRITICAL / HIGH / MEDIUM / LOW / INFO
  - Terminal report with sequential finding IDs (KYF-001…), sorted by severity
  - UDT struct support in both fuzzers via type_gen registry

- **TUI**
  - React + Ink terminal UI with SPA-style state routing
  - Four modules: OSINT Scanner, Chaos Monkey, System Logs, About
  - Keyboard navigation: `↑↓`, number shortcuts `1–4`, `Esc` to return
  - Terminal-resize-safe re-render (clears Ink cascade artifact on resize)
  - `[C]` shortcut from Scanner results to launch Chaos Monkey on the same contract
  - Responsive ASCII header (compact layout for narrow terminals)
