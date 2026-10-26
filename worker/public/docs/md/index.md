---
title: "KUYFI"
description: "Black-box security for Soroban."
slug: "index"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# KUYFI

> v0.1.0 · OPEN SOURCE · Before the Breach.

Kuyfi analyzes deployed Soroban contracts from their on-chain interface, so you can inspect their attack surface, exercise inputs and review execution traces without requiring the source code.

## Install

```bash
npm install -g @kuyfi/kuyfi
kuyfi
```

## What it is

Automated **black-box** security terminal for Soroban. Layer *before* a formal audit — not a certification.

## Pipeline

1. Contract ID
2. OSINT Scanner — fetch WASM / contractspecv0
3. Reconstruct attack surface
4. Chaos Monkey — type-aware vectors
5. Simulate and classify
6. JSON / PDF SecurityReport

## Hard constraints

- Stellar **Testnet only**
- No private key persistence
- Findings are **signals**, not proven exploits
- Only test authorized contracts

## Docs map

| Page | URL |
|------|-----|
| Installation | /docs/installation |
| Quickstart | /docs/quickstart |
| Pipeline | /docs/pipeline |
| OSINT Scanner | /docs/osint-scanner |
| Chaos Monkey | /docs/chaos-monkey |
| Attack vectors | /docs/vectors |
| Findings | /docs/findings |
| Reports | /docs/reports |
| Report schema | /docs/report-schema |
| Agent setup | /docs/agent-setup |
| llms.txt | /docs/llms.txt |
