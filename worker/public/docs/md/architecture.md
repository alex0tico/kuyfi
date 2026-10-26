---
title: "Architecture"
description: "UI vs audit engine."
slug: "architecture"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Architecture

```
cli.tsx → TUI | headless
         ↓
source/modules/  scanner → chaos_monkey → security_report → export
```

Security: no key storage · Testnet only · paid endpoint scan-only · simulate-before-broadcast.
