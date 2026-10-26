---
title: "Conectar el MCP al server de Kuyfi"
description: "Server MCP remoto: instalación en Claude Code, Cursor y VS Code, herramientas y límites."
slug: "mcp"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Conectar el MCP al server de Kuyfi

Canonical button target: `/docs/mcp#connect`

Status: available (hosted, remote). Server: https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp
Simulation only — no transactions are sent. Sign in with GitHub the first time you connect.

## Claude Code

```bash
claude mcp add --transport http kuyfi https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp
```

## Cursor

One click: cursor://anysphere.cursor-deeplink/mcp/install?name=kuyfi&config=eyJ1cmwiOiJodHRwczovL2t1eWZpLW1jcC5hbGV4Ym5qbW5jaC53b3JrZXJzLmRldi9tY3AifQ==

Or merge into `~/.cursor/mcp.json` / `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kuyfi": {
      "url": "https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp"
    }
  }
}
```

## VS Code

One click: vscode:mcp/install?%7B%22name%22%3A%22kuyfi%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fkuyfi-mcp.alexbnjmnch.workers.dev%2Fmcp%22%7D

Or from the terminal:

```bash
code --add-mcp '{"name":"kuyfi","type":"http","url":"https://kuyfi-mcp.alexbnjmnch.workers.dev/mcp"}'
```

## Tools

- `list_functions` — Lista las funciones de un contrato de Testnet con sus tipos de entrada y de salida.
- `scan_contract` — Devuelve la superficie de ataque (funciones y tipos) y guarda el reporte 24 h con un report_id.
- `fuzz_contract` — Genera vectores de ataque y los ejecuta solo en simulación (hasta 50 vectores; 20 corridas por hora y usuario).
- `get_report` — Recupera un reporte que creaste antes; solo lo puede leer quien lo creó.

## Limits

- Cuota: 20 corridas de fuzz_contract por hora y por usuario; los reportes duran 24 h.
- Solo Testnet; fuzz_contract solo acepta mode="simulate". No se envía ninguna transacción ni se manejan claves.
- Las pruebas de autorización quedan «no evaluadas»: la simulación registra la autorización pero no la aplica.
- La simulación no conserva estado entre llamadas: las secuencias que dependen de estado no se ejercitan.
- Cero hallazgos no es prueba de seguridad: el reporte dice «no findings in this run» y los inconclusos se informan como inconclusos.

## Alternative: CLI and TUI

```bash
npm install -g @kuyfi/kuyfi
kuyfi <CONTRACT_ID> --json
```

Markdown for Agents: /docs/agent-setup
