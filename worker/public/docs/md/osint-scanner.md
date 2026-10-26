---
title: "OSINT Scanner"
description: "Map attack surface from WASM alone."
slug: "osint-scanner"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# OSINT Scanner

Read-only. No source, no ABI file, no author cooperation.

## Steps

1. `getContractWasmByContractId` (read-only RPC)
2. Decode `contractspecv0`
3. Build UDT registry
4. List functions + typed params

## ScanResult

```
contractId, bytecodeSize, functions[], udtRegistry
```

## Error codes

- `CONTRACT_NOT_FOUND`
- `XDR_ALIGN_FAILURE`
- `RPC_UNAVAILABLE`
- `UNKNOWN`

Switch on `ScanError.code` — never parse `message` text.

Paid HTTP: `GET /scan/:id` (x402) — scanner only, never Chaos Monkey.
