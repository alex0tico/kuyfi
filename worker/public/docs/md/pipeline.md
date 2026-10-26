---
title: "Pipeline"
description: "From Contract ID to execution evidence."
slug: "pipeline"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Pipeline

## From Contract ID to execution evidence

1. **INPUT** — Contract ID
2. **OSINT SCANNER** — Fetch deployed WASM / specification
3. **RECONSTRUCT** — Attack surface (functions, params, UDTs)
4. **CHAOS MONKEY** — Type-aware vectors
5. **SIMULATE** — Simulate and classify DiagnosticEvent traces
6. **OUTPUT** — JSON / PDF report

The OSINT Scanner maps functions, arguments and UDTs first. Chaos Monkey generates type-aware inputs, simulates execution and classifies traces. When execution reaches the network, Kuyfi preserves transaction evidence alongside the report.

UI ≠ engine: TUI and headless CLI share `source/modules/`.
