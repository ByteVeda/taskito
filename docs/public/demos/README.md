# Interactive demos (vendored static micro-app)

These files power the **live demos** the homepage scenario finder opens in a modal
(`app/components/landing/demo-modal.tsx`). They are a self-contained vanilla
HTML/CSS/JS micro-app, served verbatim as static assets and loaded into an
`<iframe>` in **embed mode**:

```text
/demos/interactive.html?embed=<demoId>&theme=<light|dark>&accent=brand#<demoId>
```

The modal is the only entry point, so `interactive.html` carries no standalone
page chrome — it is purely the embed host. The inline bootstrap keeps only the
requested demo and inherits the host theme.

`demoId` ∈ `ratelimit · recovery · scaling · workflow · mesh · saga · worksteal`.

## Provenance

Copied from the design sign-off package `Taskito docs design 2/taskito/`. **Edits
on import, all in `interactive.html`:**

1. Removed the `<script src="landing.js">` (nav/theme-toggle) and
   `<script src="search.js">` (⌘K palette) tags — chrome-only, unused in embed.
2. Since `landing.js` also ran the scroll-reveal observer, the embed bootstrap now
   adds `.in` to the shown demo's `.reveal` children directly (they default to
   `opacity:0`), so the demo is visible without that observer.
3. Removed the page chrome (nav, hero, CTA, footer, capability probe) — the
   homepage modal loads this file only in embed mode, so the standalone page was
   dead weight.

The demo sections and `demo-*.js` are otherwise verbatim. To update a demo,
re-copy the matching `demo-*.js` from the source package.

## Files
- `interactive.html` — demo host page + embed-mode bootstrap
- `theme.css`, `interactive.css` — design tokens + demo styles
- `demo-{ratelimit,recovery,playground,workflow,mesh,saga,worksteal}.js` — one per demo
- `favicon.svg`
