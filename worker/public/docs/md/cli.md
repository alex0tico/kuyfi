---
title: "CLI reference"
description: "kuyfi and kuyfi-server."
slug: "cli"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# CLI reference

## Binaries

- `kuyfi` → `dist/cli.js` (TUI or headless)
- `kuyfi-server` → `dist/server.js` (paid OSINT)

## Modes (`selectCliMode`)

- no args → `tui`
- valid Contract ID → `headless` (`runHeadlessAudit`)
- invalid ID → `invalid` → exit 1

## Usage

```bash
kuyfi
kuyfi <CONTRACT_ID>
kuyfi <CONTRACT_ID> --json
kuyfi <CONTRACT_ID> --pdf
kuyfi <CONTRACT_ID> --json --pdf
```

Flags only: `--json` / `--pdf`. Files: `kuyfi-report-<reportId>.json|.pdf` (`wx` — no overwrite).

Contract ID: `/^C[A-Z0-9]{55}$/` — "Expected 56 characters starting with C (A-Z, 0-9)."

## Exit codes

- `0` — audit completed (even with CRITICAL findings)
- `1` — tool failure (ScanError, invalid ID, I/O / EEXIST)

CI: parse JSON for severity — do not use exit as vuln signal.

## Errors (`describeAuditError`)

| Code | Message |
|------|---------|
| CONTRACT_NOT_FOUND | Contract not found on Testnet… |
| XDR_ALIGN_FAILURE | Could not parse the contract spec… |
| RPC_UNAVAILABLE | Soroban Testnet RPC is unreachable. |
| UNKNOWN | Scan failed: <msg> |
| other | Audit failed: <msg> |

Stdout success starts with `KUYFI AUDIT COMPLETE` + counters.

RPC: `https://soroban-testnet.stellar.org` (hardcoded; no --rpc).
