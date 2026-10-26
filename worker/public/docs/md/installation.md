---
title: "Installation"
description: "Install the kuyfi CLI globally, or run from a source checkout."
slug: "installation"
source: kuyfi-docs
format: markdown-for-agents
note: "Plain Markdown for LLMs/agents — NOT MDX (Markdown+JSX)."
---

# Installation

## Requirements

- Node.js ≥ 20
- npm
- Internet access to Stellar Testnet (`https://soroban-testnet.stellar.org`)

## Global install

```bash
npm install -g @kuyfi/kuyfi
kuyfi
kuyfi --help
kuyfi <CONTRACT_ID> --json --pdf
```

Package: `@kuyfi/kuyfi` · Command: `kuyfi`

## Windows / PowerShell

If `.ps1` is blocked:

```powershell
kuyfi.cmd
npm.cmd install -g @kuyfi/kuyfi
```

## From source

```bash
git clone https://github.com/alex0tico/kuyfi.git
cd kuyfi && npm ci && npm run build
npm start
```

## Paid scan server (optional)

```bash
cp .env.example .env   # PAY_TO=G… public address only
npm run build
node --env-file=.env dist/server.js
```
