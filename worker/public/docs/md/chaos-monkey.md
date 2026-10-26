---
title: "Chaos Monkey"
description: "Type-aware fuzzing — simulate first."
slug: "chaos-monkey"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Chaos Monkey

Not random dumb fuzzing. Type-aware attack values; one variable at a time.

## Execution

```
vector → simulate
  fail → classify diagnostics (nothing sent)
  ok   → sign ephemeral Friendbot key → broadcast Testnet → poll → classify
```

**Type-correct ≠ semantically valid.** Random Address ≠ admin.

## Session order (`runChaosMonkey`)

1. Ephemeral keypair + Friendbot (3 retries; poll confirm 10×1s)
2. Per function: math → access → fee → liquidity
3. Once per session: call-order sequences
4. Aggregate ChaosReport (`SECURE` / `PRECONDITION_FAIL` filtered from findings list)

## expectedToFail

- Authorization family: `true`
- Math / fee / liquidity / call-order: `false`

## Router constants

- `BASE_FEE='100'`, tx timeout 30s
- Poll getTransaction: 20×1000ms → `TIMEOUT`
- `broadcasted` vs hash: hash may exist on SEND_ERROR with `broadcasted:false`

## Five families

1. Math / boundary
2. Authorization / access control
3. Fee / BPS
4. Liquidity ratio
5. Call ordering (end of session)

Full catalog: /docs/vectors

Keys never persisted. Testnet only.
