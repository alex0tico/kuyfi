# Architecture

## Overview

Kuyfi is a Node.js CLI/TUI application with **no backend server or daemon**. A single process either renders an interactive terminal UI or runs a headless audit and exits — both paths call into the exact same audit engine.

```
CLI ENTRY
  source/cli.tsx                 meow argument parsing, mode selection
        │
        ├─── mode.kind === 'tui' ───────────────────────────────┐
        │                                                       │
        │    TUI                                                │
        │    source/app.tsx              navigation orchestrator│
        │    source/screens/              one component per screen
        │    source/components/           shared chrome/branding
        │    source/hooks/useTerminalSize.ts   size + resize recovery
        │    source/ui/                  pure layout/format/ascii helpers
        │                                                       │
        └─── mode.kind === 'headless' ──────────────────────────┤
             source/modules/cli_runtime.ts   same engine, no Ink at all
                                                                 │
                                                                 ▼
                                              AUDIT ENGINE (source/modules/)
                                              scanner.ts → chaos_monkey/ →
                                              security_report.ts → report_export.ts
```

**UI ≠ audit engine.** Nothing under `source/screens/`, `source/components/`, `source/hooks/`, or `source/ui/` performs a scan, executes a fuzz vector, or builds a report — they only call into `source/modules/` and render whatever comes back. The headless CLI path (`cli_runtime.ts`) calls the identical `scanner.ts` / `chaos_monkey` / `security_report.ts` / `report_export.ts` functions the TUI does, with zero duplication. A bug fixed in the engine is fixed for both.

## Data flow

```
Contract ID
    │
    ▼
scanner.ts            fetch WASM, decode contractspecv0, build UDT registry
    │
    ▼
chaos_monkey/          fuzz every discovered function, real Testnet transactions
    │
    ▼
results + evidence     tx hashes, ledgers, DiagnosticEvent traces
    │
    ▼
security_report.ts     one SecurityReport object (schemaVersion 1.0.0)
    │
    ▼
report_export.ts       → pdf_report.ts (PDF)
                        → JSON.stringify (JSON)
```

## TUI layer

### `source/cli.tsx` — Entry point

Parses CLI arguments (`meow`), decides `selectCliMode()` (`tui` / `headless` / `invalid`), and either calls `runHeadlessAudit()` directly or `render(<App />)`. No render options are passed — Ink's own resize handling and defaults are relied on directly (see the `hooks/useTerminalSize.ts` note below for why no second listener is added here).

### `source/app.tsx` — Navigation orchestrator

Owns only the state that must survive a screen switch: `view`, `selectedModule`, `menuNotice`, `contractId`, `lastScanResult`. Handles the main menu's keyboard input (arrows, `1`–`4`, `Enter`). Computes the current `LayoutMode` via `useTerminalSize()` + `getLayoutMode()`, and routes to whichever screen `view` selects, wrapping non-home screens in `ViewShell`. Contains no screen implementation of its own — ~187 lines total.

### `source/screens/`

One file per screen, each owning its own local state and effects:

| File | Responsibility |
|---|---|
| `HomeScreen.tsx` | Main menu UI; also the source of `ViewId` and `MODULE_ROWS` (the module registry `App` uses for keyboard navigation) |
| `ScannerScreen.tsx` | OSINT Scanner UI — input, in-flight fetch effect, attack surface rendering |
| `ChaosMonkeyScreen.tsx` | Chaos Monkey UI — campaign effect, live log stream, findings report, JSON/PDF export controls |
| `LogsScreen.tsx` | Static system/RPC status display |
| `AboutScreen.tsx` | Static project info display |

### `source/components/`

Reusable, stateless (or near-stateless) UI pieces shared across screens:

| File | Responsibility |
|---|---|
| `AppHeader.tsx` | `TopStatusBar` (always-visible status line) + `AsciiHeader` (selects the large/compact logo lockup by column count) |
| `ViewShell.tsx` | Back-button (`Esc`) handling + border chrome wrapped around every non-home screen |
| `TooSmallNotice.tsx` | Shown when the terminal is below the minimum usable size |
| `ResizingNotice.tsx` | Shown briefly while a terminal shrink is being debounced (see below) |

### `source/hooks/useTerminalSize.ts` — Size + shrink-resize recovery

The single app-level resize listener (Ink maintains its own internal one separately, which this hook does not duplicate or fight). Beyond tracking `columns`/`rows`, it mitigates a known upstream Ink limitation ([vadimdemedes/ink#907](https://github.com/vadimdemedes/ink/issues/907), closed `NOT_PLANNED`): shrinking a terminal can cause already-painted content to reflow into more physical rows than Ink's own erase logic accounts for, leaving stale frame fragments on screen. On a detected shrink, the hook sets `isResizeSettling`, debounces further resize events for ~130ms, then performs one full-screen ANSI clear before flipping `isResizeSettling` back to `false` — which is a real React state transition, not a forced remount, so `ScannerScreen`/`ChaosMonkeyScreen` never unmount and an in-progress scan or Chaos Monkey campaign is never interrupted by a resize.

### `source/ui/`

Pure, non-React helpers with no Ink/side effects:

| File | Responsibility |
|---|---|
| `layout.ts` | `getLayoutMode(columns, rows)` — classifies the terminal into `large` (≥100 cols) / `compact` (70–99) / `tooSmall` (<70 cols or <20 rows) |
| `format.ts` | `truncateContractId`, `formatBytes` — shared string formatting |
| `ascii/logo.ts`, `ascii/cats.ts`, `ascii/index.ts` | The header lockups and the About screen's cat, as plain string-array constants (see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to add a new one) |

## Audit engine (`source/modules/`)

### `scanner.ts` — Attack-surface reconstruction

`getContractWasmByContractId(contractId)` (read-only RPC) → `WebAssembly.compile()` → `customSections('contractspecv0')` → an alignment-tolerant XDR parse loop that builds the function list (names, parameter types, return type) and the UDT registry, entirely from the deployed bytecode. No source code, no ABI file.

### `chaos_monkey/` — Fuzzing engine

| File | Responsibility |
|---|---|
| `keypair_factory.ts` | Ephemeral keypair generation + Friendbot funding + on-chain confirmation. Never persists a key. |
| `type_gen.ts` | Generates type-correct baseline and attack `ScVal` values from a parameter's XDR `ScSpecTypeDef`, including recursive types (`Vec`, `Map`, `Option`) and UDT structs |
| `udt_registry.ts` | The UDT struct/union/enum registry type_gen.ts and the scanner share |
| `fuzzer_math.ts` | Math boundary vectors: `ZERO`, `MAX_VALUE`, `NEGATIVE`, `MIN_BOUNDARY`, one variable at a time |
| `fuzzer_access.ts` | Access-control vectors on admin-pattern functions: `UNAUTHORIZED_CALL`, `REINIT_ATTACK`, `SELF_CALL_ATTACK` |
| `fuzzer_call_order.ts` | Call-order-dependent attack vectors |
| `fuzzer_fee.ts` | Vectors targeting fee/basis-point-shaped parameters |
| `fuzzer_liquidity.ts` | Vectors targeting liquidity/swap/reserve-shaped functions (AMM-pattern contracts) |
| `router.ts` | `invokeContract()` — the transaction lifecycle: simulate → assemble → sign → broadcast → poll. Never throws; always returns a typed `InvokeResult`. |
| `trace_analyzer.ts` | Parses a transaction's `DiagnosticEvent` trace into a structured error category (`AUTH`/`CONTRACT`/`CONTEXT`/`OBJECT`/`STORAGE`/`WASM_VM`/`OTHER`/`UNKNOWN`) |
| `result_parser.ts` | Maps a `trace_analyzer` result to one of the six `VulnerabilitySignal`s (`SECURE`, `PRECONDITION_FAIL`, `UNEXPECTED_ERROR`, `POTENTIAL_VULN`, `TIMEOUT`, `SIMULATION_FAIL`) and a `Severity` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INFO`) |
| `reporter.ts` | Aggregates all vector results into a `ChaosReport`; filters `SECURE`/`PRECONDITION_FAIL` out of the findings list (summary counters only); assigns sequential `KYF-NNN` finding IDs |
| `index.ts` | `runChaosMonkey()` — the public orchestrator; re-exports the types `app.tsx`/screens need |

### `audit.ts`, `security_report.ts`, `report_export.ts`, `pdf_report.ts` — Reporting

- `audit.ts` — combines a `ScanResult` + `ChaosReport` into one `AuditRun`.
- `security_report.ts` — builds the canonical `SecurityReport` (`schemaVersion: "1.0.0"`) from an `AuditRun`: target info, scan summary, execution evidence (tx hashes, ledgers, explorer URLs), findings, and severity/signal counts.
- `report_export.ts` — writes a `SecurityReport` to JSON and/or calls `pdf_report.ts`; used identically by the TUI's `[J]/[P]/[B]` keys and the headless `--json`/`--pdf` flags.
- `pdf_report.ts` — renders the same `SecurityReport` as a PDF via `pdfkit`.

### `cli_runtime.ts`, `network.ts`

- `cli_runtime.ts` — the headless code path: `selectCliMode()`, `runHeadlessAudit()`, error-message formatting. Calls the same `scanner.ts`/`chaos_monkey`/`security_report.ts`/`report_export.ts` functions the TUI calls.
- `network.ts` — the Testnet RPC URL constant.

## Security notes

- **No private key storage.** Ephemeral keypairs are generated in memory and never written to disk or logged.
- **Testnet only.** The RPC endpoint is hardcoded to `https://soroban-testnet.stellar.org`. Mainnet is not supported.
- **Read-only phase first.** The OSINT Scanner issues no transactions — only `getContractWasmByContractId`.
- **Real transactions.** Chaos Monkey submits real signed transactions to Stellar Testnet, each costing a small XLM fee from a Friendbot-funded ephemeral account.
