---
title: "For LLMs & agents"
description: "Agent ingestion guide."
slug: "for-llms"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# For LLMs & agents

> Prefer **Markdown for Agents** (plain Markdown). This is **not** MDX.
> MDX = Markdown + JSX components — a authoring format, not an agent feed.

## Ingest order

1. `/docs/llms.txt`
2. `/docs/llms-full.txt`
3. Per-page Markdown: `/docs/md/<slug>.md` or **Copy as Markdown** on any HTML page
4. HTML only if you need the visual UI

## Rules

- Testnet only
- Findings = signals
- Prefer `kuyfi <ID> --json`
- Do not invent MCP tools beyond the four documented ones (list_functions, scan_contract, fuzz_contract, get_report)

See also: /docs/agent-setup
