# Kuyfi Docs — agent notes

This is the **public documentation website** for Kuyfi (`docs-site/`), not the CLI package and not the markdown notes in repo `docs/`.

## Markdown for Agents ≠ MDX

- **MDX** = Markdown + JSX components (UI authoring).
- **Markdown for Agents** = plain Markdown for LLMs (`Copy as Markdown`, `/docs/md/<slug>.md`, `llms.txt`).

Never describe MDX as “Markdown for machines.”

## Facts

- Site path: `https://kuyfi.vercel.app/docs`
- Brand: dark UI, yellow CTAs (`#f5c518`), pink labels, Syne + Outfit + IBM Plex Mono
- Agent feeds: `/docs/llms.txt`, `/docs/llms-full.txt`, `/docs/md/*.md`, `/docs/agent-setup`
- MCP Connect button opens `/docs/mcp`: the hosted Kuyfi MCP server is live (simulation only; tools list_functions, scan_contract, fuzz_contract, get_report, report_card)

## Commands

```bash
cd docs-site
npm install
npm run dev      # open /docs/
npm run build
npm run preview
```

## Do not

- Commit as a co-author / push unless the maintainer (`wrever`) asks
- Confuse this folder with `docs/` (demo writeups)
- Claim MCP tools beyond the five live ones (list_functions, scan_contract, fuzz_contract, get_report, report_card)
- Call the agent Markdown layer “MDX”
