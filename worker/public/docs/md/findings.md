---
title: "Findings & signals"
description: "Six-signal taxonomy."
slug: "findings"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Findings & signals

Findings are **leads**, not verdicts. Zero findings ≠ secure.

## Signals

| Signal | In findings list? |
|--------|-------------------|
| `SECURE` | No (counters only) |
| `PRECONDITION_FAIL` | No (counters only) |
| `UNEXPECTED_ERROR` | Yes · MEDIUM |
| `POTENTIAL_VULN` | Yes · CRITICAL if admin name else HIGH |
| `UNCONTROLLED_PANIC` | Yes · MEDIUM |
| `TIMEOUT` | Yes · LOW |

`POTENTIAL_VULN` = investigate-first, **not** a confirmed exploit.

IDs: `KYF-NNN`. Traces from DiagnosticEvents.
