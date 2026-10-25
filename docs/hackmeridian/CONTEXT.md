# HackMeridian: Kuyfi remote MCP server

## Goal
A remote MCP server for Kuyfi, deployed on Cloudflare Workers, so Stellar developers can add it to their agent (Claude Code, Cursor, VS Code) with one click or one command and audit their Soroban contracts while they code, without installing the CLI or the TUI. Format reference: Stellar Raven.

Planned pieces: GitHub login (`workers-oauth-provider`), a static landing page served by the same Worker, and documentation.

## Deadline
Monday 2026-10-26, 12:00 Lisbon time. No extension.

## MVP scope
- Tools: `list_functions`, `scan_contract`, `get_report`, `fuzz_contract` (`mode=simulate`).
- Simulation only by default.
- Testnet broadcast is an optional extension and is not part of the MVP.
- Nothing is announced as available until it works.

## Independence from Instawards 2
This project is separate from the Kuyfi Instawards 2 work. It lives on its own branch (`hackmeridian/mcp`), created from `main`. It must not be based on, merged with, or cherry-pick from any `instawards-2/*` branch, whose history contains third-party identifiers and must not be published.

## Rules
- No Contract IDs, account addresses, explorer links, transaction hashes, keys or environment variable values in any file.
- Do not change existing code unless a task says so; report anything sensitive found on `main` instead of fixing it silently.
- Do not touch or merge `instawards-2/*` branches.
