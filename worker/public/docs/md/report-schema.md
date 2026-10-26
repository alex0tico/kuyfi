---
title: "Report schema"
description: "SecurityReport 1.0.0 field map."
slug: "report-schema"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Report schema

`schemaVersion` is independent of npm `tool.version`.

## Top-level

`schemaVersion`, `reportId`, `generatedAt`, `tool`, `target`, `scan`, `execution`, `summary`, `findings`

## Findings

`id`, `functionName`, `vectorName`, `signal`, `severity`, `details`, `evidence`

Gate parsers on `schemaVersion === "1.0.0"`.
Do not auto-fail CI as “CVE confirmed” on `POTENTIAL_VULN`.
