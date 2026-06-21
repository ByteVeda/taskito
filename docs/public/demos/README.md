# Interactive demos (vendored static micro-app)

These files power the **live demos** the homepage scenario finder opens in a modal
(`app/components/landing/demo-modal.tsx`). They are a self-contained vanilla
HTML/CSS/JS micro-app, served verbatim as static assets and loaded into an
`<iframe>` in **embed mode**:

```text
/demos/interactive.html?embed=<demoId>&theme=<light|dark>&accent=brand#<demoId>
```

Embed mode (the inline script in `interactive.html`) strips all page chrome and
mounts only the requested demo, inheriting the host theme.

`demoId` ∈ `ratelimit · recovery · scaling · workflow · mesh · saga · worksteal`.

## Provenance

Copied from the design sign-off package `Taskito docs design 2/taskito/`. **Two
edits on import, both in `interactive.html`:**

1. Removed the `<script src="landing.js">` (nav/theme-toggle) and
   `<script src="search.js">` (⌘K palette) tags — chrome-only, unused in embed.
2. Since `landing.js` also ran the scroll-reveal observer, the embed bootstrap now
   adds `.in` to the shown demo's `.reveal` children directly (they default to
   `opacity:0`), so the demo is visible without that observer.

Everything else is verbatim. To update a demo, re-copy the matching `demo-*.js`
from the source package.

## Files
- `interactive.html` — demo host page + embed-mode bootstrap
- `theme.css`, `interactive.css` — design tokens + demo styles
- `demo-{ratelimit,recovery,playground,workflow,mesh,saga,worksteal}.js` — one per demo
- `favicon.svg`
