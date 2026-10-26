---
title: "Conectar el MCP al server de Kuyfi"
description: "Camino fijo: botón MCP Connect → config Cursor/Claude/HTTP."
slug: "mcp"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Conectar el MCP al server de Kuyfi

Canonical button target: `/docs/mcp#connect`

Status: coming soon until `@kuyfi/mcp` publishes — config below is the stable contract.

## Quick (Cursor / Claude stdio)

```json
{
  "mcpServers": {
    "kuyfi": {
      "command": "npx",
      "args": ["-y", "@kuyfi/mcp@latest"],
      "env": {
        "KUYFI_NETWORK": "stellar:testnet"
      }
    }
  }
}
```

1. Paste into Cursor MCP settings or `.cursor/mcp.json`
2. Or Claude Desktop `claude_desktop_config.json`
3. Reload MCP / restart the app
4. Confirm tools `kuyfi_*` appear

## Remote HTTP (when hosted)

```json
{
  "mcpServers": {
    "kuyfi": {
      "url": "https://mcp.kuyfi.vercel.app/mcp",
      "headers": {}
    }
  }
}
```

stdio = local (Chaos Monkey opt-in). HTTP = remote read-oriented tools.

## Tools

- `kuyfi_scan` — OSINT surface
- `kuyfi_audit` — Chaos Monkey (confirm; Testnet)
- `kuyfi_report_schema` — SecurityReport 1.0.0
- `kuyfi_signals` — taxonomy

## Fallback without MCP

```bash
npm install -g @kuyfi/kuyfi
kuyfi <CONTRACT_ID> --json
```

Markdown for Agents: /docs/agent-setup
