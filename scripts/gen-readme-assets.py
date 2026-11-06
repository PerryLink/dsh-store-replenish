#!/usr/bin/env python3
"""Generate README image assets for dsh-store-replenish (docs/assets/).

Outputs (idempotent overwrite):
  dsh-store-replenish-flow-light.svg / dsh-store-replenish-flow-dark.svg
      Hero data-flow diagram. Two hand-written SVG files (vector — never
      rasterized to webp). Text inside is command-surface tokens only
      (replenish.suggest, window_days, moq, ...), so all five README
      languages share the same pair.

This plugin is pure host-side tooling with no UI and the repo ships no
benchmark dataset, so there is no raster evidence chart here. The CJK font
probe below is kept from the family skeleton as a guard: the moment a
Pillow-rendered (raster) asset with Chinese text is added, the script must
abort loudly instead of rendering tofu boxes.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (bundled DSH runtime Python already ships it)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont  # noqa: F401  (raster assets later)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# 1. Hero data-flow SVG (light + dark)
# ---------------------------------------------------------------------------
FLOW_MAIN = [
    ("store-SKU CSV", "sales · stock · transit"),
    ("replenish.suggest", "daily avg × (cycle + safety)"),
    ("replenish.plan", "per-store rollup · risk order"),
    ("replenish.export", "exports/ · 13 columns"),
]
FLOW_SIDE = [
    ("window_days", "declares the window"),
    ("moq", "ceil(qty / moq) × moq"),
    ("slow_moving", "turnover &gt; 60 days"),
    ("stockout_risk", "cover &lt; daily × cycle"),
    ("stockout_now", "stock = 0, demand &gt; 0"),
    ("include_zero", "export every SKU"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 470
    mw, mh, mgap = 250, 92, 27
    y0 = 146
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" '
        f'aria-label="dsh-store-replenish data flow">',
        '<title>dsh-store-replenish data flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="60" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-store-replenish</text>',
        f'<text x="60" y="92" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="16">store-SKU CSV · suggestions · per-store '
        f'plan · local CSV · no purchase order</text>',
        f'<line x1="60" y1="114" x2="1140" y2="114" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_MAIN):
        x = 60 + i * (mw + mgap)
        accent = GREEN[skin] if i == len(FLOW_MAIN) - 1 else (
            FAMILY if i == 1 else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{mw}" height="{mh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + mw // 2}" y="{y0 + 38}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="16" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + mw // 2}" y="{y0 + 66}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="12">{sub}</text>')
        if i < len(FLOW_MAIN) - 1:
            ax = x + mw + 4
            ay = y0 + mh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{mgap - 10}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + mgap - 12} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # write-root bar under the suggest/plan/export nodes
    by, bh = 282, 52
    for cx in (60 + mw + mgap + mw // 2, 60 + 3 * (mw + mgap) + mw // 2):
        parts.append(
            f'<path d="M{cx} {y0 + mh}v{by - y0 - mh}" stroke="{FAMILY}" '
            f'stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="60" y="{by}" width="1080" height="{bh}" rx="12" '
        f'fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="600" y="{by + 33}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="14">$DSH_HOME/dsh-store-replenish/exports/ · source CSV '
        f'read-only · DSH_STORE_REPLENISH_HOME override · no network</text>')
    # secondary row: the flags and the two knobs the formula reads
    sw, sh, sgap = 165, 64, 15
    sy = 380
    parts.append(
        f'<text x="60" y="{sy - 14}" fill="{s["sub"]}" '
        f'font-family="ui-monospace,monospace" font-size="12">'
        f'per-SKU flags and inputs</text>')
    for i, (label, sub) in enumerate(FLOW_SIDE):
        x = 60 + i * (sw + sgap)
        accent = FAMILY if i >= 2 else s["border"]
        parts.append(
            f'<rect x="{x}" y="{sy}" width="{sw}" height="{sh}" rx="12" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + sw // 2}" y="{sy + 26}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11.5" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + sw // 2}" y="{sy + 47}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        if i < len(FLOW_SIDE) - 1:
            ax = x + sw + 2
            ay = sy + sh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{sgap - 4}" stroke="{s["sub"]}" '
                f'stroke-width="2"/>')
    parts.append(
        f'<text x="60" y="462" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="12.5">replenish.suggest · replenish.plan = R0 '
        f'read-only · replenish.export = R1 local write · integer units · '
        f'integer cents · no network</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-store-replenish-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    print("wrote 2 SVG assets to docs/assets/ "
          "(no raster evidence chart: this repo ships no benchmark dataset)")


if __name__ == "__main__":
    main()
