# Taskito docs

The Taskito documentation site — a polyglot (Python + Node.js) docs site built with
[React Router v7](https://reactrouter.com) in framework mode, statically prerendered
to HTML for GitHub Pages.

## Stack

- **React Router v7** (framework mode, `ssr: false` + `prerender`) — static export to
  `build/client/`.
- **MDX** via `@mdx-js/rollup` — the content under `content/docs/**/*.mdx` is the source,
  compiled at build and rendered through the component map in `app/components/mdx/`.
- **Shiki** for build-time code highlighting; **Mermaid** (client-side) for diagrams.
- **Tailwind v4** + a ported design system in `app/app.css` (dark + warm-light themes).
- **MiniSearch** for the client-side ⌘K search index.

## Develop

```bash
pnpm install
pnpm dev          # local dev server
pnpm typecheck    # react-router typegen + tsc
pnpm lint         # biome
pnpm build        # static prerender → build/client/
pnpm start        # serve the built output
```

Set `DOCS_BASE_PATH=/taskito` to build under the GitHub Pages base path (CI does this).

## Layout

```
content/docs/**/*.mdx     the documentation source (+ meta.json nav)
app/
  root.tsx                document shell, fonts, no-flash theme
  routes.ts               route config (landing, llms.txt, docs catch-all)
  routes/                 home, docs-layout, docs.$ (MDX page), llms[.txt]
  components/
    landing/              polyglot landing sections
    docs/                 sidebar, SDK switch, TOC, prev/next, search modal
    mdx/                  Callout/Tabs/Card shims + MDX component map
    ui/                   nav, theme toggle, RawHtml
    animated/             diagram components (reused in MDX)
  lib/                    content glob, nav tree, search index, theme, highlighters
```

Adding a page: drop an `.mdx` file under `content/docs/`, add it to the directory's
`meta.json`. It is picked up, prerendered, indexed for search, and slotted into the
sidebar automatically.
