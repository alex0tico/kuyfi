---
title: "Quickstart"
description: "From zero to a SecurityReport against a Testnet Contract ID."
slug: "quickstart"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Quickstart

1. Install: `npm install -g @kuyfi/kuyfi`
2. Get a Testnet Contract ID (`C` + 55 chars)
3. Interactive: `kuyfi` → OSINT Scanner → Chaos Monkey
4. Headless: `kuyfi <CONTRACT_ID> --json --pdf`

**Authorization required.** Chaos Monkey submits real Testnet transactions.

## Mental model

```
Contract ID → OSINT → Chaos Monkey → classify → SecurityReport
```
