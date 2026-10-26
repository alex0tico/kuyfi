---
title: "Reports"
description: "JSON/PDF from one SecurityReport."
slug: "reports"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Reports

One `SecurityReport` (`schemaVersion: "1.0.0"`). JSON and PDF are the same object.

## reportId

`kyf-<ISO-stamp>-<8 uuid chars>` — not derived from Contract ID alone. Headless `--json --pdf` share one `buildSecurityReport()` call.

## Evidence

- Run-wide counters (`broadcastTransactions` / `transactionsWithHash` over all results)
- Per-finding simulation/broadcast + trace
- Hash, ledger, `https://stellar.expert/explorer/testnet/tx/<hash>` when broadcast
- `verificationTransactions`: at most 2 — first success+hash and first failed+hash

## Export policy

- Filenames: `kuyfi-report-<reportId>.json|.pdf`
- Writes use `flag: 'wx'` — `Refusing to overwrite existing file: …`
- TUI `[J]/[P]/[B]`: formats attempted independently
- CLI write failure → exit 1

## CI

Exit 0 with CRITICAL findings is expected. Gate on JSON `summary`/`findings`, not process exit. Do not treat `POTENTIAL_VULN` as confirmed CVE.

Schema details: /docs/report-schema
