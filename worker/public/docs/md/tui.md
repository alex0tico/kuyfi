---
title: "Interactive TUI"
description: "Ink terminal UI."
slug: "tui"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Interactive TUI

1. OSINT Scanner — stores `lastScanResult`
2. Chaos Monkey — **requires** prior scan in-session (notice if null)
3. System Logs — **static** status panel (not live RPC stream)
4. About

Layout: large (≥100 cols) / compact (70–99) / tooSmall (<70 cols or <20 rows → TooSmallNotice).
Resize: debounced clear without killing in-flight runs.
Exports: `[J]` JSON · `[P]` PDF · `[B]` both (`wx` policy). Quit → exit 0.
