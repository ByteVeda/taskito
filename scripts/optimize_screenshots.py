#!/usr/bin/env python3
"""Crunch the dashboard screenshots so the docs site stays light.

The capture script writes 2x HiDPI PNGs straight from Playwright, which
range from 50 KB to 350 KB each. This pass:

1. Converts to ``P`` mode (256-colour palette) where appropriate —
   screenshots are dominated by flat UI panels and large solid regions,
   so palette quantisation typically halves the file size with no
   visible loss.
2. Falls back to the original RGBA encoding if quantisation actually
   *grows* the file (rare on dense screenshots).
3. Reports before/after sizes so we can spot regressions.

Run after every screenshot regen:

    uv run --with pillow python scripts/optimize_screenshots.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = REPO_ROOT / "docs" / "public" / "screenshots" / "dashboard"


def optimize(path: Path) -> tuple[int, int]:
    """Return ``(before_bytes, after_bytes)``."""
    before = path.stat().st_size
    with Image.open(path) as img:
        img.load()
        # Quantise to a 256-colour palette. ``method=2`` (median cut) is
        # better for synthetic UI screenshots than the default libimagequant
        # path Pillow uses on lossier paths.
        quantised = img.convert("RGB").quantize(colors=256, method=2, dither=Image.Dither.NONE)
        tmp = path.with_suffix(".opt.png")
        quantised.save(tmp, format="PNG", optimize=True)
    after = tmp.stat().st_size
    if after < before:
        tmp.replace(path)
        return before, after
    tmp.unlink()
    return before, before


def main() -> int:
    if not SCREENSHOT_DIR.exists():
        print(f"No screenshots at {SCREENSHOT_DIR}", file=sys.stderr)
        return 1
    total_before = 0
    total_after = 0
    for png in sorted(SCREENSHOT_DIR.glob("*.png")):
        before, after = optimize(png)
        total_before += before
        total_after += after
        delta = (after - before) / before * 100 if before else 0.0
        print(
            f"{png.name:35s}  {before / 1024:7.1f} KB → {after / 1024:7.1f} KB"
            f"  ({delta:+5.1f}%)"
        )
    print(
        f"{'TOTAL':35s}  {total_before / 1024:7.1f} KB → {total_after / 1024:7.1f} KB"
        f"  ({(total_after - total_before) / total_before * 100:+5.1f}%)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
