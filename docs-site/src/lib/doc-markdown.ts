/**
 * Canonical Markdown for Agents — plain Markdown documents (NOT MDX).
 * MDX = Markdown + JSX components. This layer is token-efficient Markdown
 * for LLMs/agents: Copy as Markdown, /md/<slug>.md, llms.txt.
 */

import {
	MCP_CLAUDE_CODE,
	MCP_CONFIG_CURSOR,
	MCP_CURSOR_LINK,
	MCP_LIMITS,
	MCP_TOOLS,
	MCP_URL,
	MCP_VSCODE_CLI,
	MCP_VSCODE_LINK,
} from '../content/mcp';
import {SITE} from '../content/nav';

export type DocMarkdown = {
	slug: string;
	title: string;
	description: string;
	body: string;
};

function page(slug: string, title: string, description: string, body: string): DocMarkdown {
	return {slug, title, description, body: body.trim() + '\n'};
}

export const DOC_MARKDOWN: DocMarkdown[] = [
	page(
		'index',
		'KUYFI',
		'Black-box security for Soroban.',
		`# KUYFI

> v0.1.0 · OPEN SOURCE · Before the Breach.

Kuyfi analyzes deployed Soroban contracts from their on-chain interface, so you can inspect their attack surface, exercise inputs and review execution traces without requiring the source code.

## Install

\`\`\`bash
npm install -g @kuyfi/kuyfi
kuyfi
\`\`\`

## What it is

Automated **black-box** security terminal for Soroban. Layer *before* a formal audit — not a certification.

## Pipeline

1. Contract ID
2. OSINT Scanner — fetch WASM / contractspecv0
3. Reconstruct attack surface
4. Chaos Monkey — type-aware vectors
5. Simulate and classify
6. JSON / PDF SecurityReport

## Hard constraints

- Stellar **Testnet only**
- No private key persistence
- Findings are **signals**, not proven exploits
- Only test authorized contracts

## Docs map

| Page | URL |
|------|-----|
| Installation | /docs/installation |
| Quickstart | /docs/quickstart |
| Pipeline | /docs/pipeline |
| OSINT Scanner | /docs/osint-scanner |
| Chaos Monkey | /docs/chaos-monkey |
| Attack vectors | /docs/vectors |
| Findings | /docs/findings |
| Reports | /docs/reports |
| Report schema | /docs/report-schema |
| Agent setup | /docs/agent-setup |
| llms.txt | /docs/llms.txt |
`,
	),
	page(
		'installation',
		'Installation',
		'Install the kuyfi CLI globally, or run from a source checkout.',
		`# Installation

## Requirements

- Node.js ≥ 20
- npm
- Internet access to Stellar Testnet (\`https://soroban-testnet.stellar.org\`)

## Global install

\`\`\`bash
npm install -g @kuyfi/kuyfi
kuyfi
kuyfi --help
kuyfi <CONTRACT_ID> --json --pdf
\`\`\`

Package: \`@kuyfi/kuyfi\` · Command: \`kuyfi\`

## Windows / PowerShell

If \`.ps1\` is blocked:

\`\`\`powershell
kuyfi.cmd
npm.cmd install -g @kuyfi/kuyfi
\`\`\`

## From source

\`\`\`bash
git clone https://github.com/alex0tico/kuyfi.git
cd kuyfi && npm ci && npm run build
npm start
\`\`\`

## Paid scan server (optional)

\`\`\`bash
cp .env.example .env   # PAY_TO=G… public address only
npm run build
node --env-file=.env dist/server.js
\`\`\`
`,
	),
	page(
		'quickstart',
		'Quickstart',
		'From zero to a SecurityReport against a Testnet Contract ID.',
		`# Quickstart

1. Install: \`npm install -g @kuyfi/kuyfi\`
2. Get a Testnet Contract ID (\`C\` + 55 chars)
3. Interactive: \`kuyfi\` → OSINT Scanner → Chaos Monkey
4. Headless: \`kuyfi <CONTRACT_ID> --json --pdf\`

**Authorization required.** Chaos Monkey submits real Testnet transactions.

## Mental model

\`\`\`
Contract ID → OSINT → Chaos Monkey → classify → SecurityReport
\`\`\`
`,
	),
	page(
		'pipeline',
		'Pipeline',
		'From Contract ID to execution evidence.',
		`# Pipeline

## From Contract ID to execution evidence

1. **INPUT** — Contract ID
2. **OSINT SCANNER** — Fetch deployed WASM / specification
3. **RECONSTRUCT** — Attack surface (functions, params, UDTs)
4. **CHAOS MONKEY** — Type-aware vectors
5. **SIMULATE** — Simulate and classify DiagnosticEvent traces
6. **OUTPUT** — JSON / PDF report

The OSINT Scanner maps functions, arguments and UDTs first. Chaos Monkey generates type-aware inputs, simulates execution and classifies traces. When execution reaches the network, Kuyfi preserves transaction evidence alongside the report.

UI ≠ engine: TUI and headless CLI share \`source/modules/\`.
`,
	),
	page(
		'osint-scanner',
		'OSINT Scanner',
		'Map attack surface from WASM alone.',
		`# OSINT Scanner

Read-only. No source, no ABI file, no author cooperation.

## Steps

1. \`getContractWasmByContractId\` (read-only RPC)
2. Decode \`contractspecv0\`
3. Build UDT registry
4. List functions + typed params

## ScanResult

\`\`\`
contractId, bytecodeSize, functions[], udtRegistry
\`\`\`

## Error codes

- \`CONTRACT_NOT_FOUND\`
- \`XDR_ALIGN_FAILURE\`
- \`RPC_UNAVAILABLE\`
- \`UNKNOWN\`

Switch on \`ScanError.code\` — never parse \`message\` text.

Paid HTTP: \`GET /scan/:id\` (x402) — scanner only, never Chaos Monkey.
`,
	),
	page(
		'chaos-monkey',
		'Chaos Monkey',
		'Type-aware fuzzing — simulate first.',
		`# Chaos Monkey

Not random dumb fuzzing. Type-aware attack values; one variable at a time.

## Execution

\`\`\`
vector → simulate
  fail → classify diagnostics (nothing sent)
  ok   → sign ephemeral Friendbot key → broadcast Testnet → poll → classify
\`\`\`

**Type-correct ≠ semantically valid.** Random Address ≠ admin.

## Session order (\`runChaosMonkey\`)

1. Ephemeral keypair + Friendbot (3 retries; poll confirm 10×1s)
2. Per function: math → access → fee → liquidity
3. Once per session: call-order sequences
4. Aggregate ChaosReport (\`SECURE\` / \`PRECONDITION_FAIL\` filtered from findings list)

## expectedToFail

- Authorization family: \`true\`
- Math / fee / liquidity / call-order: \`false\`

## Router constants

- \`BASE_FEE='100'\`, tx timeout 30s
- Poll getTransaction: 20×1000ms → \`TIMEOUT\`
- \`broadcasted\` vs hash: hash may exist on SEND_ERROR with \`broadcasted:false\`

## Five families

1. Math / boundary
2. Authorization / access control
3. Fee / BPS
4. Liquidity ratio
5. Call ordering (end of session)

Full catalog: /docs/vectors

Keys never persisted. Testnet only.
`,
	),
	page(
		'vectors',
		'Attack vectors reference',
		'Complete Chaos Monkey vector catalog.',
		`# Attack vectors reference

## Math / boundary (\`fuzzer_math.ts\` + \`type_gen.ts\`)

OAT mutations. Unsigned: no \`NEG_ONE\`/\`MIN_*\`. Symbol: \`LONG_SYMBOL\`(32) \`OVERSIZE_SYMBOL\`(64). String \`LONG_STR\`=256. Bytes \`LARGE_BYTES\`=256. \`MAX_UDT_DEPTH=4\`. Names like \`amount::MAX_I128\`.

## Authorization (\`fuzzer_access.ts\`)

| Vector | Targets |
|--------|---------|
| \`UNAUTHORIZED_CALL\` | Admin-pattern substrings |
| \`REINIT_ATTACK\` | initialize / init / setup |
| \`SELF_CALL_ATTACK\` | **exact** \`set_admin\` \| \`set_pending_admin\` \| \`transfer_admin\` |
| \`UNAUTHORIZED_ADDR_CALL\` | Non-admin + Address param |

Admin substrings: pause, unpause, initialize, init, setup, upgrade, set_admin, set_pending_admin, transfer_admin, emergency.

Only this family sets \`expectedToFail=true\`.

## Call ordering (\`fuzzer_call_order.ts\`)

Once per session. ≤1 fn per group; no reuse across groups.

| Group | Patterns |
|-------|----------|
| \`REINIT_SEQUENCE\` | initialize, init, setup |
| \`REPEATED_WITHDRAW_SEQUENCE\` | withdraw, remove |
| \`REPEATED_CLAIM_SEQUENCE\` | \`claim\` only (no harvest) |

## Fee / BPS (\`fuzzer_fee.ts\`)

Param name \`/fee|fees|bps|basis_point/i\` + numeric types.
Labels: \`BPS_0|1|9999|10000|10001\` + \`MAX_<TYPE>\`.

## Liquidity (\`fuzzer_liquidity.ts\`)

Fn name \`/liquidity|swap|reserve/i\`; first two numeric params.
Labels: \`ZERO_A_MAX_B\`, \`MAX_A_ZERO_B\`, \`MAX_A_MAX_B\`, \`ONE_A_MAX_B\`, \`MAX_A_ONE_B\`, \`MIN_A_MAX_B\` (signed A only).
Name: \`LIQUIDITY::<paramA>x<paramB>::<pairLabel>\`
`,
	),
	page(
		'findings',
		'Findings & signals',
		'Six-signal taxonomy.',
		`# Findings & signals

Findings are **leads**, not verdicts. Zero findings ≠ secure.

## Signals

| Signal | In findings list? |
|--------|-------------------|
| \`SECURE\` | No (counters only) |
| \`PRECONDITION_FAIL\` | No (counters only) |
| \`UNEXPECTED_ERROR\` | Yes · MEDIUM |
| \`POTENTIAL_VULN\` | Yes · CRITICAL if admin name else HIGH |
| \`UNCONTROLLED_PANIC\` | Yes · MEDIUM |
| \`TIMEOUT\` | Yes · LOW |

\`POTENTIAL_VULN\` = investigate-first, **not** a confirmed exploit.

IDs: \`KYF-NNN\`. Traces from DiagnosticEvents.
`,
	),
	page(
		'reports',
		'Reports',
		'JSON/PDF from one SecurityReport.',
		`# Reports

One \`SecurityReport\` (\`schemaVersion: "1.0.0"\`). JSON and PDF are the same object.

## reportId

\`kyf-<ISO-stamp>-<8 uuid chars>\` — not derived from Contract ID alone. Headless \`--json --pdf\` share one \`buildSecurityReport()\` call.

## Evidence

- Run-wide counters (\`broadcastTransactions\` / \`transactionsWithHash\` over all results)
- Per-finding simulation/broadcast + trace
- Hash, ledger, \`https://stellar.expert/explorer/testnet/tx/<hash>\` when broadcast
- \`verificationTransactions\`: at most 2 — first success+hash and first failed+hash

## Export policy

- Filenames: \`kuyfi-report-<reportId>.json|.pdf\`
- Writes use \`flag: 'wx'\` — \`Refusing to overwrite existing file: …\`
- TUI \`[J]/[P]/[B]\`: formats attempted independently
- CLI write failure → exit 1

## CI

Exit 0 with CRITICAL findings is expected. Gate on JSON \`summary\`/\`findings\`, not process exit. Do not treat \`POTENTIAL_VULN\` as confirmed CVE.

Schema details: /docs/report-schema
`,
	),
	page(
		'report-schema',
		'Report schema',
		'SecurityReport 1.0.0 field map.',
		`# Report schema

\`schemaVersion\` is independent of npm \`tool.version\`.

## Top-level

\`schemaVersion\`, \`reportId\`, \`generatedAt\`, \`tool\`, \`target\`, \`scan\`, \`execution\`, \`summary\`, \`findings\`

## Findings

\`id\`, \`functionName\`, \`vectorName\`, \`signal\`, \`severity\`, \`details\`, \`evidence\`

Gate parsers on \`schemaVersion === "1.0.0"\`.
Do not auto-fail CI as “CVE confirmed” on \`POTENTIAL_VULN\`.
`,
	),
	page(
		'cli',
		'CLI reference',
		'kuyfi and kuyfi-server.',
		`# CLI reference

## Binaries

- \`kuyfi\` → \`dist/cli.js\` (TUI or headless)
- \`kuyfi-server\` → \`dist/server.js\` (paid OSINT)

## Modes (\`selectCliMode\`)

- no args → \`tui\`
- valid Contract ID → \`headless\` (\`runHeadlessAudit\`)
- invalid ID → \`invalid\` → exit 1

## Usage

\`\`\`bash
kuyfi
kuyfi <CONTRACT_ID>
kuyfi <CONTRACT_ID> --json
kuyfi <CONTRACT_ID> --pdf
kuyfi <CONTRACT_ID> --json --pdf
\`\`\`

Flags only: \`--json\` / \`--pdf\`. Files: \`kuyfi-report-<reportId>.json|.pdf\` (\`wx\` — no overwrite).

Contract ID: \`/^C[A-Z0-9]{55}$/\` — "Expected 56 characters starting with C (A-Z, 0-9)."

## Exit codes

- \`0\` — audit completed (even with CRITICAL findings)
- \`1\` — tool failure (ScanError, invalid ID, I/O / EEXIST)

CI: parse JSON for severity — do not use exit as vuln signal.

## Errors (\`describeAuditError\`)

| Code | Message |
|------|---------|
| CONTRACT_NOT_FOUND | Contract not found on Testnet… |
| XDR_ALIGN_FAILURE | Could not parse the contract spec… |
| RPC_UNAVAILABLE | Soroban Testnet RPC is unreachable. |
| UNKNOWN | Scan failed: \<msg\> |
| other | Audit failed: \<msg\> |

Stdout success starts with \`KUYFI AUDIT COMPLETE\` + counters.

RPC: \`https://soroban-testnet.stellar.org\` (hardcoded; no --rpc).
`,
	),
	page(
		'tui',
		'Interactive TUI',
		'Ink terminal UI.',
		`# Interactive TUI

1. OSINT Scanner — stores \`lastScanResult\`
2. Chaos Monkey — **requires** prior scan in-session (notice if null)
3. System Logs — **static** status panel (not live RPC stream)
4. About

Layout: large (≥100 cols) / compact (70–99) / tooSmall (<70 cols or <20 rows → TooSmallNotice).
Resize: debounced clear without killing in-flight runs.
Exports: \`[J]\` JSON · \`[P]\` PDF · \`[B]\` both (\`wx\` policy). Quit → exit 0.
`,
	),
	page(
		'paid-api',
		'Paid scan API',
		'x402 OSINT endpoint.',
		`# Paid scan API

\`\`\`
GET /scan/<CONTRACT_ID>
  → 400 INVALID_CONTRACT_ID (before paywall)
  → 402 Payment Required
  → 200 OK (scan surface)
  → 404/422/502/500 scan fail (not settled)
\`\`\`

**Scanner only.** Chaos Monkey never over HTTP.

## 200 body

\`{ contractId, network: "testnet", bytecodeSize, …toPublicScan(scan) }\`

## Status map

| ScanError | HTTP |
|-----------|------|
| CONTRACT_NOT_FOUND | 404 |
| XDR_ALIGN_FAILURE | 422 |
| RPC_UNAVAILABLE | 502 |
| UNKNOWN | 500 |

Failure body: \`{ "error": "<code>" }\`. x402 settles only if status < 400.

## Env

- \`PAY_TO\` required (public G…) — missing → exit 1
- \`PRICE\` default \`500 CLP\`
- \`NETWORK\` \`stellar:testnet\` | \`stellar:pubnet\` (payment; scans always Testnet)
- \`FACILITATOR_URL\` defaults: testnet \`https://local402.vercel.app/facilitator\`; pubnet \`https://local402-mainnet.vercel.app/facilitator\`
- \`PORT\` 4021
- \`LOCAL402_QUOTE_SECRET\` multi-instance only

Startup: \`kuyfi-server: GET http://localhost:<port>/scan/<CONTRACT_ID>\`
`,
	),
	page(
		'architecture',
		'Architecture',
		'UI vs audit engine.',
		`# Architecture

\`\`\`
cli.tsx → TUI | headless
         ↓
source/modules/  scanner → chaos_monkey → security_report → export
\`\`\`

Security: no key storage · Testnet only · paid endpoint scan-only · simulate-before-broadcast.
`,
	),
	page(
		'glossary',
		'Glossary',
		'Soroban + Kuyfi terms.',
		`# Glossary

- **Black-box** — no source; WASM + contractspec + runtime only
- **Contract ID** — \`C\` + 55 chars
- **contractspecv0** — on-chain function/type interface
- **UDT** — user-defined type (struct/enum/union)
- **DiagnosticEvent** — RPC trace evidence
- **Friendbot** — Testnet faucet for ephemeral keys
- **SecurityReport** — schemaVersion 1.0.0 JSON/PDF
- **Finding** — filtered signal; not a CVE
- **Vector** — one named attack attempt
- **Markdown for Agents** — plain Markdown for LLMs (not MDX)
`,
	),
	page(
		'troubleshooting',
		'Troubleshooting',
		'Common failures.',
		`# Troubleshooting

## CLI

- Exit 0 with CRITICAL findings = expected (parse JSON for severity)
- \`Refusing to overwrite existing file\` → rename/delete prior report (\`wx\`)
- Invalid ID → Expected 56 characters starting with C (A-Z, 0-9)

## Scanner

| Code | Try |
|------|-----|
| CONTRACT_NOT_FOUND | Confirm Testnet deploy / typo |
| RPC_UNAVAILABLE | Network / retry |
| XDR_ALIGN_FAILURE | Need standard contractspecv0 |

## Chaos Monkey

Many PRECONDITION results = normal (ephemeral account not authorized).
Friendbot: 3 retries then throw. TIMEOUT = 20×1s poll window.
Zero findings ≠ secure.

## TUI

Chaos without prior OSINT → notice, not crash. LogsScreen is static (not live RPC).

## Paid API

400 before quote; 404/422/502/500 after auth not settled. PAY_TO required.

## Windows

Use \`kuyfi.cmd\` if PowerShell blocks \`.ps1\`.
`,
	),
	page(
		'changelog',
		'Changelog',
		'Release notes.',
		`# Changelog

## Unreleased

- kuyfi-server paid OSINT scan (x402 / Local402)

## 0.1.0 — 2026-09-20

OSINT Scanner, Chaos Monkey (5 families), SecurityReport JSON/PDF, headless CLI, npm \`@kuyfi/kuyfi\`, responsive TUI.

Canonical: https://github.com/alex0tico/kuyfi/blob/main/CHANGELOG.md
`,
	),
	page(
		'for-llms',
		'For LLMs & agents',
		'Agent ingestion guide.',
		`# For LLMs & agents

> Prefer **Markdown for Agents** (plain Markdown). This is **not** MDX.
> MDX = Markdown + JSX components — a authoring format, not an agent feed.

## Ingest order

1. \`/docs/llms.txt\`
2. \`/docs/llms-full.txt\`
3. Per-page Markdown: \`/docs/md/<slug>.md\` or **Copy as Markdown** on any HTML page
4. HTML only if you need the visual UI

## Rules

- Testnet only
- Findings = signals
- Prefer \`kuyfi <ID> --json\`
- Do not invent MCP tools beyond the five documented ones (list_functions, scan_contract, fuzz_contract, get_report, report_card)

See also: /docs/agent-setup
`,
	),
	page(
		'agent-setup',
		'Agent setup',
		'Markdown for Agents — how coding agents should read Kuyfi docs.',
		`# Agent setup

How Cursor, Copilot, Claude Code, and similar tools should consume Kuyfi documentation.

## Terminology (important)

| Term | Meaning |
|------|---------|
| **Markdown for Agents** | Plain Markdown optimized for LLMs — fewer tokens than HTML |
| **MDX** | Markdown **+ JSX components** (authoring/UI format). **Not** what agents should ingest |
| **llms.txt** | Site index of docs for agents ([llmstxt.org](https://llmstxt.org)) |

Kuyfi docs ship **Markdown for Agents**. We do **not** call that MDX.

## Ways to get Markdown

### 1. Copy as Markdown

On any docs HTML page, use **Copy as Markdown** (page options). Paste into your agent chat.

### 2. View / fetch \`.md\`

Every page has a Markdown twin:

\`\`\`
${SITE.url}/docs/md/<slug>.md
\`\`\`

Examples:

\`\`\`bash
curl -sL ${SITE.url}/docs/md/chaos-monkey.md
curl -sL ${SITE.url}/docs/md/index.md
\`\`\`

### 3. Site-wide feeds

| Endpoint | Use |
|----------|-----|
| \`/docs/llms.txt\` | Compact index + project card |
| \`/docs/llms-full.txt\` | Full operator manual in one file |

### 4. HTML (last resort)

Human UI at \`/docs/...\` — richer layout, worse token efficiency for models.

## Recommended agent bootstrap

\`\`\`text
Fetch ${SITE.url}/docs/llms.txt then ${SITE.url}/docs/llms-full.txt.
For a specific topic, fetch ${SITE.url}/docs/md/<slug>.md
(e.g. vectors, findings, report-schema).
Kuyfi is Testnet-only black-box Soroban security CLI (@kuyfi/kuyfi).
Findings are signals, not formal audit results. A hosted MCP server is available (see /docs/mcp).
\`\`\`

## MCP

**MCP Connect** → \`/docs/mcp#connect\` — wire agents to the hosted Kuyfi MCP server (${MCP_URL}).
Simulation only; sign in with GitHub on first connect. Tools: ${MCP_TOOLS.map(t => t.name).join(', ')}.
`,
	),
	page(
		'mcp',
		'Conectar el MCP al server de Kuyfi',
		'Server MCP remoto: instalación en Claude Code, Cursor y VS Code, herramientas y límites.',
		`# Conectar el MCP al server de Kuyfi

Canonical button target: \`/docs/mcp#connect\`

Status: available (hosted, remote). Server: ${MCP_URL}
Simulation only — no transactions are sent. Sign in with GitHub the first time you connect.

## Claude Code

\`\`\`bash
${MCP_CLAUDE_CODE}
\`\`\`

## Cursor

One click: ${MCP_CURSOR_LINK}

Or merge into \`~/.cursor/mcp.json\` / \`.cursor/mcp.json\`:

\`\`\`json
${MCP_CONFIG_CURSOR}
\`\`\`

## VS Code

One click: ${MCP_VSCODE_LINK}

Or from the terminal:

\`\`\`bash
${MCP_VSCODE_CLI}
\`\`\`

## Tools

${MCP_TOOLS.map(t => `- \`${t.name}\` — ${t.desc}`).join('\n')}

## Report card

\`report_card\` returns a PNG summary card plus the same summary as text; the client decides whether to show the image.
Real output of report_card for scan_contract on the demo contract (Testnet, 2026-10-26). Reports expire after 24 hours.
Illustrative samples: the first uses the figures of a real run on the demo contract but its date and report ID are placeholders; the second is a made-up sample, not a result from a real contract.

## Limits

${MCP_LIMITS.map(l => `- ${l}`).join('\n')}

## Alternative: CLI and TUI

\`\`\`bash
npm install -g @kuyfi/kuyfi
kuyfi <CONTRACT_ID> --json
\`\`\`

Markdown for Agents: /docs/agent-setup
`,
	),
	page(
		'responsible-use',
		'Responsible use',
		'Authorization required.',
		`# Responsible use

- Only contracts you own or have written authorization to test
- Testnet only
- Findings ≠ certification
- Unauthorized fuzzing may be illegal / ToS violation

License: MIT. Not affiliated with the Stellar Development Foundation.
`,
	),
	page(
		'faq',
		'FAQ',
		'Common questions.',
		`# FAQ

**Auditor?** No — pre-audit black-box tooling.

**Need Rust source?** No.

**Mainnet?** No — Testnet only.

**POTENTIAL_VULN?** Investigate-first signal, not a confirmed exploit.

**Chaos Monkey on paid API?** No.

**Markdown vs MDX?** Agents should use plain Markdown (\`/docs/md/*.md\`, Copy as Markdown, llms.txt). MDX is JSX-in-Markdown for UI authoring — different thing.

**Agents:** /docs/agent-setup
`,
	),
];

const bySlug = new Map(DOC_MARKDOWN.map((d) => [d.slug, d]));

export function getDocMarkdown(slug: string): DocMarkdown | undefined {
	const key = slug.replace(/^\//, '').replace(/\/$/, '') || 'index';
	return bySlug.get(key);
}

export function listDocMarkdown(): DocMarkdown[] {
	return DOC_MARKDOWN;
}

/** Full Markdown document with YAML-ish header for agents. */
export function renderDocMarkdownFile(doc: DocMarkdown): string {
	return [
		'---',
		`title: ${JSON.stringify(doc.title)}`,
		`description: ${JSON.stringify(doc.description)}`,
		`slug: ${JSON.stringify(doc.slug)}`,
		'source: kuyfi-docs',
		'format: markdown-for-agents',
		'note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."',
		'---',
		'',
		doc.body,
	].join('\n');
}

/** Slug from a docs pathname (with or without /docs base). */
export function slugFromPathname(pathname: string, base = '/docs'): string {
	let path = pathname;
	const b = base.replace(/\/$/, '');
	if (path.startsWith(b)) path = path.slice(b.length) || '/';
	path = path.replace(/\/$/, '') || '/';
	if (path === '/' || path === '') return 'index';
	return path.replace(/^\//, '');
}
