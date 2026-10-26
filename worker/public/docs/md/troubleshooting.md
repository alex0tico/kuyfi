---
title: "Troubleshooting"
description: "Common failures."
slug: "troubleshooting"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Troubleshooting

## CLI

- Exit 0 with CRITICAL findings = expected (parse JSON for severity)
- `Refusing to overwrite existing file` → rename/delete prior report (`wx`)
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

Use `kuyfi.cmd` if PowerShell blocks `.ps1`.
