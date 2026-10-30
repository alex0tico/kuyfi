# Kuyfi Docs Site

Standalone documentation app for [kuyfi.vercel.app/docs](https://kuyfi.vercel.app/docs).

This folder is **separate** from the repo’s existing `docs/` markdown notes (`demo.md`, technical writeup, etc.).

## Stack

- Astro 7
- Dark brand theme (yellow CTAs, pink labels, nebula grid, keyhole mark) matching the marketing site
- Client-side docs search (`⌘K` / `/`)
- **Markdown for Agents** (plain Markdown — **not MDX**): Copy as Markdown, `/md/<slug>.md`, `llms.txt`
- Agent setup page + MCP Connect stub
- Report schema page + changelog mirror

## Develop

```bash
cd docs-site
npm install
npm run dev
```

Open the printed local URL — pages are under the `/docs` base path (e.g. `http://localhost:4321/docs/`).

## Build

```bash
npm run build
npm run preview
```

Output: `docs-site/dist/` with assets prefixed for `/docs`.

## Deploy on Vercel (alongside landing)

Option A — monorepo root of this folder:

1. Vercel project Root Directory = `docs-site`
2. Attach to the same domain and rewrite `/docs` → this deployment, **or**
3. Deploy as the docs project and set the marketing site to proxy `/docs/*`.

Option B — merge routes into the existing landing app later; keep `base: '/docs'` in `astro.config.mjs`.

## Note for maintainers

Do not confuse:

| Path | Purpose |
|------|---------|
| `docs/` | Repo notes / writeups / assets for developers |
| `docs-site/` | Public documentation website |
