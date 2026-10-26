---
title: "Agent setup"
description: "Markdown for Agents — how coding agents should read Kuyfi docs."
slug: "agent-setup"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Agent setup

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

### 2. View / fetch `.md`

Every page has a Markdown twin:

```
https://kuyfi.vercel.app/docs/md/<slug>.md
```

Examples:

```bash
curl -sL https://kuyfi.vercel.app/docs/md/chaos-monkey.md
curl -sL https://kuyfi.vercel.app/docs/md/index.md
```

### 3. Site-wide feeds

| Endpoint | Use |
|----------|-----|
| `/docs/llms.txt` | Compact index + project card |
| `/docs/llms-full.txt` | Full operator manual in one file |

### 4. HTML (last resort)

Human UI at `/docs/...` — richer layout, worse token efficiency for models.

## Recommended agent bootstrap

```text
Fetch https://kuyfi.vercel.app/docs/llms.txt then https://kuyfi.vercel.app/docs/llms-full.txt.
For a specific topic, fetch https://kuyfi.vercel.app/docs/md/<slug>.md
(e.g. vectors, findings, report-schema).
Kuyfi is Testnet-only black-box Soroban security CLI (@kuyfi/kuyfi).
Findings are signals, not formal audit results. A hosted MCP server is available (see /docs/mcp).
```

## MCP

**MCP Connect** → `/docs/mcp#connect` — wire agents to the hosted Kuyfi MCP server (https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp).
Simulation only; sign in with GitHub on first connect. Tools: list_functions, scan_contract, fuzz_contract, get_report.
