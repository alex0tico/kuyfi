# Contributing

## Requirements

Node.js ≥ 20, npm.

## Development setup

```bash
git clone https://github.com/alex0tico/kuyfi.git
cd kuyfi
npm ci
```

## Running the TUI in development

Open two terminal tabs:

```bash
# Tab 1 — watch TypeScript and recompile on save
npm run dev

# Tab 2 — run the compiled output
npm start
```

Changes to `source/**/*.ts(x)` are recompiled automatically by the TypeScript watcher. Restart `npm start` after each recompile to pick up the new output.

## Building and testing

```bash
npm run build
npm test
```

`npm test` runs Prettier, XO, and the full AVA suite. The whole suite must pass — the exact test count will keep growing as the project does, so don't treat any specific number as a contract; treat "all green" as the bar.

## Project structure

```
kuyfi/
├── source/
│   ├── cli.tsx                    # Entry point — mode selection (TUI vs headless)
│   ├── app.tsx                    # TUI navigation orchestrator
│   ├── screens/                   # One file per screen (Home, Scanner, ChaosMonkey, Logs, About)
│   ├── components/                # Shared chrome/branding (AppHeader, ViewShell, notices)
│   ├── hooks/                     # useTerminalSize (size + shrink-resize recovery)
│   ├── ui/                        # Pure helpers: layout classification, formatting, ASCII assets
│   └── modules/
│       ├── scanner.ts             # Attack-surface reconstruction from deployed WASM
│       ├── audit.ts               # Combines scan + Chaos Monkey results
│       ├── chaos_monkey/          # Fuzzing engine (see ARCHITECTURE.md for the full module list)
│       ├── security_report.ts     # Canonical SecurityReport builder
│       ├── report_export.ts       # JSON/PDF export, shared by TUI and headless CLI
│       ├── pdf_report.ts          # PDF rendering
│       └── cli_runtime.ts         # Headless CLI code path
├── test-fixtures/                 # Soroban contract fixtures used to validate the engine
├── ARCHITECTURE.md
├── ROADMAP.md
├── CHANGELOG.md
└── README.md
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full component breakdown and data-flow diagram.

## Code conventions

- TypeScript throughout — no `any` beyond existing `AnyTypeDef` aliases (XDR types are untyped by design).
- No comments except where the WHY is non-obvious.
- Ink components receive only what they need via props — no context or global state.

## ASCII Art

Header and branding ASCII art lives in `source/ui/ascii/`, not embedded in components. To add a new asset:

1. Add the constant in `source/ui/ascii/` (`cats.ts`, `logo.ts`, or a new file if it's a genuinely new category).
2. Export it from `source/ui/ascii/index.ts`.
3. Import it from the component that renders it.
4. Preserve width/spacing exactly. One caveat: a line ending in a literal backslash can't use `String.raw` — a trailing backslash immediately before the closing backtick escapes the backtick itself (template-literal lexing, not a `String.raw` quirk). Keep that specific line as a normal escaped string literal instead.
5. Verify both the `large` and `compact` layout tiers still render correctly after the change.

## Adding to the audit engine

- **New fuzzer / attack vector**: add it alongside the existing families in `source/modules/chaos_monkey/` (see `fuzzer_math.ts`/`fuzzer_access.ts` for the simplest examples), and wire it into `index.ts`'s orchestration. Vectors should produce a `FuzzResult` classified through the existing `result_parser.ts` taxonomy — don't invent a parallel classification path.
- **New UI screen**: add a file under `source/screens/`, following the existing screens' pattern (own local state/effects, an `isTooSmall`/`isResizeSettling` guard if it should survive being backgrounded during a resize), and wire it into `app.tsx`'s routing.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes. Keep PRs focused — one concern per PR.
3. Run `npm test` to verify formatting, linting, and the full test suite pass.
4. Open a pull request against `main` with a clear description of what changed and why.

Bug reports and feature ideas are welcome as GitHub Issues.

## Testing against Testnet

The Chaos Monkey submits real transactions to Stellar Testnet. Friendbot provides test XLM automatically — you don't need a funded account of your own to run the fuzzer, but you do need a live internet connection to `soroban-testnet.stellar.org`.

Only test against contracts you own or have explicit authorization to test.
