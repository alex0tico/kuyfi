---
title: "Paid scan API"
description: "x402 OSINT endpoint."
slug: "paid-api"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Paid scan API

```
GET /scan/<CONTRACT_ID>
  → 400 INVALID_CONTRACT_ID (before paywall)
  → 402 Payment Required
  → 200 OK (scan surface)
  → 404/422/502/500 scan fail (not settled)
```

**Scanner only.** Chaos Monkey never over HTTP.

## 200 body

`{ contractId, network: "testnet", bytecodeSize, …toPublicScan(scan) }`

## Status map

| ScanError | HTTP |
|-----------|------|
| CONTRACT_NOT_FOUND | 404 |
| XDR_ALIGN_FAILURE | 422 |
| RPC_UNAVAILABLE | 502 |
| UNKNOWN | 500 |

Failure body: `{ "error": "<code>" }`. x402 settles only if status < 400.

## Env

- `PAY_TO` required (public G…) — missing → exit 1
- `PRICE` default `500 CLP`
- `NETWORK` `stellar:testnet` | `stellar:pubnet` (payment; scans always Testnet)
- `FACILITATOR_URL` defaults: testnet `https://local402.vercel.app/facilitator`; pubnet `https://local402-mainnet.vercel.app/facilitator`
- `PORT` 4021
- `LOCAL402_QUOTE_SECRET` multi-instance only

Startup: `kuyfi-server: GET http://localhost:<port>/scan/<CONTRACT_ID>`
