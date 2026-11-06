#!/usr/bin/env python3
"""Generate README visuals for dsh-store-replenish (docs/assets/).

Outputs (idempotent overwrite):
  dsh-store-replenish-hero-{zh,en}-{light,dark}.webp   1440x576 raster (Pillow)
  dsh-store-replenish-flow-v5-{light,dark}.svg         1100x660 hand-written SVG

Design notes
------------
Grammar: STOCK-LEVEL GAUGE -> MOQ PACK LADDER -> STORE ROLL-UP -> 13-COLUMN
EXPORT BAND.  It is the plugin's real pipeline expressed in its own units of
measure: one store-SKU row is drawn on a vertical level gauge (the target
stock line, the available block = stock + in-transit, the gap between them),
the gap is packed along a ladder of MOQ boxes, many rows collapse into
per-store ranked rows (stores ordered by stockout risk), and the whole thing
closes on the fixed 13-column CSV the export tool writes.  Deliberately NOT a
row of five boxes with arrows: the middle of the picture is a measuring
instrument, not a box.

* Hero: the left column is prose (kicker / title / two value lines / one
  subtitle / one meta line / a fixture line / footer); the right column is one
  worked row from the checked-in quickstart fixture - Shanghai Jing'an,
  SKU-SN-001: sales_qty 300 over a 30-day window (daily 10), cycle 7, safety 3
  -> target 100; stock 20 + in-transit 10 -> available 30; gap 70; MOQ 24 ->
  ceil(70/24) = 3 packs = suggested 72; value 928.80; stockout_risk because
  available 30 < daily 10 x cycle 7.  Every number is read from
  samples/quickstart/expected/result.json at build time, so the drawing cannot
  drift from the golden fixture.
* Flow: the input card lists the 10 CSV columns (the 7 numeric ones that feed
  the formula are marked), the engine card is the gauge + pack ladder, the plan
  card is the two-store ranked roll-up, and the bottom band is the 13-column
  CSV written under $DSH_HOME/dsh-store-replenish/exports/.  Text is
  token-only English (tool names, field names, paths, numbers) so all five
  README languages share the same light/dark pair.

Run once:  python scripts/gen-readme-assets.py
Requires:  Python 3.10+ with Pillow; Windows fonts msyh.ttc / msyhbd.ttc /
           consola.ttf / consolab.ttf / segoeui.ttf / segoeuib.ttf.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"

for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD, FONT_EN,
           FONT_EN_BOLD):
    if not os.path.exists(_p):
        sys.exit(f"FATAL: font missing: {_p}")

WARNINGS: list[str] = []

# --------------------------------------------------------------- fixture data
GOLDEN = os.path.join(ROOT, "samples", "quickstart", "expected", "result.json")
with open(GOLDEN, encoding="utf-8") as _fh:
    GOLDEN_JSON = json.load(_fh)

SUG = GOLDEN_JSON["suggestions"]
TOT = SUG["totals"]
PLAN = GOLDEN_JSON["plan"]
WORKED = next(item for item in SUG["items"]
              if item["store"] == "上海静安店" and item["sku"] == "SKU-SN-001")
STORES = PLAN["stores"]
assert STORES[0]["store"] == "上海静安店" and STORES[1]["store"] == "成都高新店"
assert WORKED["target_qty"] == 100 and WORKED["raw_qty"] == 70
assert WORKED["suggested_qty"] == 72 and WORKED["moq"] == 24
assert WORKED["stockout_risk"] is True and WORKED["slow_moving"] is False
assert WORKED["suggested_qty"] // WORKED["moq"] == 3


def yuan(cents: int) -> str:
    """Integer cents -> `4,768.80` (no symbol; the call site adds it)."""
    return f"{cents // 100:,}.{cents % 100:02d}"


TOTALS = dict(
    rows=TOT["rows"], stores=TOT["stores"], skus=TOT["unique_skus"],
    lines=TOT["order_lines"], units=TOT["total_units"],
    value=yuan(TOT["estimated_value_cents"]),
    risk=TOT["stockout_risks"], slow=TOT["slow_moving"],
)

# ------------------------------------------------------------------- palette
SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
        card_edge="#e4e1ee", zone="#f5f2fb", zone_edge="#e3def1",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", warn="#b0470f", good="#16a34a",
        pill="#ece7f9", track="#eae6f3", grid="#e7e4f0",
        shadow=(32, 26, 64), transit_ink="#26325a",
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
        card_edge="#2e374b", zone="#171e2d", zone_edge="#2b3448",
        text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
        accent="#8496f5", warn="#d9a03c", good="#3fb950",
        pill="#242d42", track="#243049", grid="#1e2636",
        shadow=(0, 0, 0), transit_ink="#10151f",
    ),
}

# --------------------------------------------------------------- primitives


def hx(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def font(size: float, kind: str = "cjk") -> ImageFont.FreeTypeFont:
    path = {"cjk": FONT_CJK, "cjk_bold": FONT_CJK_BOLD, "mono": FONT_MONO,
            "mono_bold": FONT_MONO_BOLD, "en": FONT_EN,
            "en_bold": FONT_EN_BOLD}[kind]
    return ImageFont.truetype(path, max(8, int(round(size))))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = 0.22 * (y / h) + 0.78 * (y / h) ** 1.7
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(hx(c1), hx(c2))))
    return img


def glow(img, cx, cy, r, color, alpha=40):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(12, 0, -1):
        rr = r * i / 12
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 13)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def card(img, box, skin, radius=22, shadow=30):
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for i in range(shadow, 0, -3):
        sd.rounded_rectangle([x0 - i // 6, y0 + i // 2, x1 + i // 6, y1 + i],
                             radius=radius + i // 6,
                             fill=skin["shadow"] + (int(8 * (1 - i / shadow)),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(skin["card"]),
                        outline=hx(skin["card_edge"]), width=2)
    return base.convert("RGB")


def pill(img, xy, text, skin, size=20, kind="cjk_bold", fg="accent"):
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    tw = d.textlength(text, font=f)
    x, y = xy
    h = size + 22
    d.rounded_rectangle([x, y, x + tw + 36, y + h], radius=h // 2,
                        fill=hx(skin["pill"]))
    d.text((x + 18, y + 9), text, font=f, fill=hx(skin[fg]))
    return img


def fit(d, text, kind, max_w, size, min_size=14):
    size = int(size)
    while size > min_size:
        if d.textlength(text, font=font(size, kind)) <= max_w:
            return size
        size -= 1
    return max(min_size, size)


def write(img, xy, text, skin, size, kind="cjk", color="text", max_w=None,
          min_size=14, tag=""):
    d = ImageDraw.Draw(img)
    if max_w is not None:
        size = fit(d, text, kind, max_w, size, min_size)
        if d.textlength(text, font=font(size, kind)) > max_w:
            WARNINGS.append(f"{tag}: {text!r} wider than {max_w}px at {size}px")
    d.text(xy, text, font=font(size, kind), fill=hx(skin[color]))
    return size


def dashed(img, p0, p1, color, width=2, dash=9, gap=7):
    d = ImageDraw.Draw(img)
    (x0, y0), (x1, y1) = p0, p1
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    if length == 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        d.line([(x0 + ux * pos, y0 + uy * pos), (x0 + ux * end, y0 + uy * end)],
               fill=color, width=width)
        pos += dash + gap


# --------------------------------------------------------------- hero model
HERO = {
    "zh": dict(
        kicker="dsh-store-replenish · 补货计算插件",
        title="补货算得清",
        value=["每个门店-SKU 该补多少件", "缺口向上取整到起订量"],
        sub="读 CSV，出建议量与门店补货单，写本地 CSV",
        meta="R0 只读 / R1 本地写 · 不联网 · 不调模型 · 不下单",
        fixture=("quickstart 合成样例：%d 行 · %d 补货行 · %d 件 · ¥%s"
                 % (TOTALS["rows"], TOTALS["lines"], TOTALS["units"],
                    TOTALS["value"])),
        foot="Apache-2.0 · PerryLink DSH plugin family",
        card_kicker="worked row · synthetic quickstart",
        card_title="上海静安店 · SKU-SN-001 · 苏打饼干 400g",
        formula="日均 10 ×（补货周期 7 + 安全天数 3）= 目标 100",
        target="目标 100",
        avail="可用 30 件",
        gap="缺口 70",
        packs_top="建议 72 件",
        packs_cap="3 包 × 24",
        flags=["可用 30 件 · 撑 3.0 天", "缺货风险 · 周期 7 天",
               "滞销 否 · 周转 2.0 天", "MOQ 24 · 整数口径",
               "72 件 × ¥12.90 = ¥928.80"],
        totals_l=("%d 行 → %d 补货行 · %d 件 · ¥%s"
                  % (TOTALS["rows"], TOTALS["lines"], TOTALS["units"],
                     TOTALS["value"])),
        totals_r="%d 缺货风险 · %d 滞销" % (TOTALS["risk"], TOTALS["slow"]),
        kind_cjk=True,
    ),
    "en": dict(
        kicker="dsh-store-replenish · replenishment plugin",
        title="Refill by rule",
        value=["How much each store-SKU needs", "Gaps rounded up to the MOQ"],
        sub="CSV in, suggestions and per-store plans out",
        meta="R0 read-only / R1 local write · no network · no model call",
        fixture=("quickstart fixture: %d rows · %d order lines · %d units · %s"
                 % (TOTALS["rows"], TOTALS["lines"], TOTALS["units"],
                    TOTALS["value"])),
        foot="Apache-2.0 · PerryLink DSH plugin family",
        card_kicker="worked row · synthetic quickstart",
        card_title="Shanghai Jing'an · SKU-SN-001 · soda crackers 400 g",
        formula="daily 10 × (cycle 7 + safety 3) = target 100",
        target="target 100",
        avail="available 30",
        gap="gap 70",
        packs_top="suggested 72",
        packs_cap="3 packs × 24",
        flags=["available 30 · cover 3.0 d", "stockout_risk · cycle 7 d",
               "slow_moving · no", "MOQ 24 · integer maths",
               "72 × 12.90 = 928.80"],
        totals_l=("%d rows → %d order lines · %d units · %s"
                  % (TOTALS["rows"], TOTALS["lines"], TOTALS["units"],
                     TOTALS["value"])),
        totals_r="%d risks · %d slow" % (TOTALS["risk"], TOTALS["slow"]),
        kind_cjk=False,
    ),
}


def hero(lang: str, skin_name: str) -> None:
    s = SKIN[skin_name]
    m = HERO[lang]
    body = "cjk" if m["kind_cjk"] else "en"
    body_bold = "cjk_bold" if m["kind_cjk"] else "en_bold"
    w, h = 1440, 576
    img = gradient(w, h, s["bg_from"], s["bg_to"])
    img = glow(img, 1230, 40, 440, hx(s["accent"]),
               20 if skin_name == "light" else 38)
    img = glow(img, 110, 560, 300, hx(s["accent"]),
               9 if skin_name == "light" else 15)

    # ------------------------------------------------------------ left column
    m_left, col_w = 60, 600
    img = pill(img, (m_left, 58), m["kicker"], s,
               size=20 if m["kind_cjk"] else 19,
               kind="cjk_bold" if m["kind_cjk"] else "en_bold")

    d = ImageDraw.Draw(img)
    title_kind = "cjk_bold" if m["kind_cjk"] else body_bold
    tsize = fit(d, m["title"], title_kind, col_w, 88, 80)
    if tsize < 80:
        WARNINGS.append(f"hero.{lang}.title clamped to {tsize}px (<80px)")
    d.text((m_left, 122), m["title"], font=font(tsize, title_kind),
           fill=hx(s["text"]))

    vsize = 36 if m["kind_cjk"] else 33
    for line in m["value"]:
        vsize = min(vsize, fit(d, line, body_bold, col_w, vsize, 27))
    for i, line in enumerate(m["value"]):
        write(img, (m_left, 266 + i * (vsize + 12)), line, s, vsize,
              body_bold, "text", col_w, 27, f"hero.{lang}.value{i}")

    d = ImageDraw.Draw(img)
    d.line([m_left, 380, m_left + col_w, 380], fill=hx(s["grid"]), width=2)

    write(img, (m_left + 2, 394), m["sub"], s, 25, body, "sub", col_w, 22,
          f"hero.{lang}.sub")
    write(img, (m_left + 2, 440), m["meta"], s, 20, body, "faint", col_w, 17,
          f"hero.{lang}.meta")
    write(img, (m_left + 2, 476), m["fixture"], s, 16, body, "faint",
          col_w - 6, 14, f"hero.{lang}.fixture")

    d = ImageDraw.Draw(img)
    d.line([m_left + 2, 506, m_left + col_w, 506], fill=hx(s["grid"]), width=2)
    write(img, (m_left + 2, 516), m["foot"], s, 17, "en", "faint", col_w, 14,
          f"hero.{lang}.foot")

    # ------------------------------------------------- worked-row instrument
    img = card(img, (700, 52, 1390, 524), s, radius=22)
    d = ImageDraw.Draw(img)
    write(img, (726, 76), m["card_kicker"], s, 15, "mono", "accent", 320, 13,
          f"hero.{lang}.card_kicker")
    write(img, (726, 98), m["card_title"], s, 21, body_bold, "text", 638, 17,
          f"hero.{lang}.card_title")
    d = ImageDraw.Draw(img)
    d.line([726, 140, 1364, 140], fill=hx(s["grid"]), width=2)
    write(img, (726, 156), m["formula"], s, 15, body, "sub", 520, 13,
          f"hero.{lang}.formula")

    # gauge: 0..110 units, baseline 424, 2.05 px/unit
    base, scale = 424, 2.05
    axis_x = 790

    def uy(units: float) -> int:
        return int(round(base - units * scale))

    d = ImageDraw.Draw(img)
    d.line([axis_x, uy(110), axis_x, base], fill=hx(s["grid"]), width=2)
    for units in (0, 25, 50, 75, 100):
        y = uy(units)
        d.line([axis_x - 7, y, axis_x, y], fill=hx(s["sub"]), width=2)
        d.text((axis_x - 13, y), str(units), font=font(15, "mono"),
               fill=hx(s["faint"]), anchor="rm")

    bar_x0, bar_x1 = 802, 878
    transit_top = uy(WORKED["stock_qty"] + WORKED["in_transit"])
    stock_top = uy(WORKED["stock_qty"])
    d.rounded_rectangle([bar_x0, stock_top, bar_x1, base], radius=6,
                        fill=hx(s["accent"]))
    d.rounded_rectangle([bar_x0, transit_top, bar_x1, stock_top], radius=6,
                        fill=hx(s["accent"]))
    # lighter in-transit band so the two components read apart
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle([bar_x0, transit_top, bar_x1, stock_top], radius=6,
                         fill=(255, 255, 255, 110))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    d = ImageDraw.Draw(img)
    d.text(((bar_x0 + bar_x1) // 2, uy(WORKED["stock_qty"] / 2)),
           str(WORKED["stock_qty"]), font=font(17, "mono_bold"),
           fill=hx("#ffffff"), anchor="mm")
    d.text(((bar_x0 + bar_x1) // 2,
            uy(WORKED["stock_qty"] + WORKED["in_transit"] / 2)),
           str(WORKED["in_transit"]), font=font(14, "mono_bold"),
           fill=hx(s["transit_ink"]), anchor="mm")

    d.text((bar_x0, transit_top - 10), m["avail"], font=font(15, body),
           fill=hx(s["sub"]), anchor="lb")

    target_y = uy(WORKED["target_qty"])
    dashed(img, (800, target_y), (1010, target_y), hx(s["accent"]), 2, 9, 7)
    d = ImageDraw.Draw(img)
    d.text((1004, target_y - 12), m["target"], font=font(15, body),
           fill=hx(s["accent"]), anchor="rb")

    # gap bracket between the available top and the target line
    bracket_x = 906
    d.line([bracket_x, transit_top, bracket_x, target_y],
           fill=hx(s["accent"]), width=3)
    d.line([bracket_x - 7, transit_top, bracket_x + 7, transit_top],
           fill=hx(s["accent"]), width=3)
    d.line([bracket_x - 7, target_y, bracket_x + 7, target_y],
           fill=hx(s["accent"]), width=3)
    gap_mid = (transit_top + target_y) // 2
    d.text((922, gap_mid), m["gap"], font=font(21, body_bold),
           fill=hx(s["warn"]), anchor="lm")
    d.line([1000, gap_mid, 1026, gap_mid], fill=hx(s["accent"]), width=3)
    d.line([1016, gap_mid - 7, 1028, gap_mid], fill=hx(s["accent"]), width=3)
    d.line([1016, gap_mid + 7, 1028, gap_mid], fill=hx(s["accent"]), width=3)

    # MOQ pack ladder: 3 boxes of 24
    packs = WORKED["suggested_qty"] // WORKED["moq"]
    pk_x0, pk_x1, pk_h, pk_gap = 1040, 1140, 54, 4
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for i in range(packs):
        top = base - (i + 1) * pk_h - i * pk_gap
        ld.rounded_rectangle([pk_x0, top, pk_x1, top + pk_h], radius=12,
                             fill=hx(s["accent"]) + (255,))
        ld.rounded_rectangle([pk_x0 + 4, top + 4, pk_x1 - 4, top + 13],
                             radius=5, fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    d = ImageDraw.Draw(img)
    for i in range(packs):
        top = base - (i + 1) * pk_h - i * pk_gap
        d.text(((pk_x0 + pk_x1) // 2, top + pk_h // 2 + 1),
               str(WORKED["moq"]), font=font(22, "mono_bold"),
               fill=hx("#ffffff"), anchor="mm")

    top_pack = base - packs * pk_h - (packs - 1) * pk_gap
    d.text(((pk_x0 + pk_x1) // 2, top_pack - 14), m["packs_top"],
           font=font(18, body_bold), fill=hx(s["text"]), anchor="mb")
    d.text(((pk_x0 + pk_x1) // 2, base + 12), m["packs_cap"],
           font=font(15, body), fill=hx(s["faint"]), anchor="ma")

    # per-SKU facts rail
    for i, text in enumerate(m["flags"]):
        y = 196 + i * 52
        d = ImageDraw.Draw(img)
        d.ellipse([1154, y - 8, 1162, y], fill=hx(s["accent"]))
        size = fit(d, text, body, 196, 15, 12)
        if d.textlength(text, font=font(size, body)) > 196:
            WARNINGS.append(f"hero.{lang}.flag{i}: {text!r} wider than 196px")
        d.text((1172, y), text, font=font(size, body), fill=hx(s["sub"]),
               anchor="lm")

    # fixture totals footer inside the card
    d = ImageDraw.Draw(img)
    d.line([726, 466, 1364, 466], fill=hx(s["grid"]), width=2)
    d.text((726, 486), m["totals_l"], font=font(16, body), fill=hx(s["text"]),
           anchor="ls")
    d.text((1364, 486), m["totals_r"], font=font(15, body),
           fill=hx(s["faint"]), anchor="rs")

    path = os.path.join(OUT, f"dsh-store-replenish-hero-{lang}-{skin_name}.webp")
    img.save(path, "WEBP", quality=92)
    print(f"wrote {os.path.basename(path)}")


# ------------------------------------------------------------- flow diagram
FLOW = {
    "light": dict(bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
                  edge="#e4e1ee", zone="#f5f2fb", zone_edge="#e3def1",
                  text="#141419", sub="#4d5261", faint="#8f94a4",
                  accent="#4B67B4", warn="#b0470f", good="#16a34a",
                  pill="#ece7f9", track="#eae6f3", grid="#e7e4f0",
                  dot="#d9d3ea"),
    "dark": dict(bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
                 edge="#2e374b", zone="#171e2d", zone_edge="#2b3448",
                 text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
                 accent="#8496f5", warn="#d9a03c", good="#3fb950",
                 pill="#242d42", track="#243049", grid="#1e2636",
                 dot="#26314a"),
}
MONO = "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace"
SANS = ("ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', "
        "sans-serif")

CSV_COLUMNS = ["门店", "SKU", "品名", "当前库存", "在途", "日均销量",
               "补货周期天数", "安全天数", "建议补货量", "预估金额", "缺货风险",
               "滞销", "周转天数"]
INPUT_FIELDS = [
    ("store", None), ("sku", None), ("name", None),
    ("sales_qty", "300"), ("stock_qty", "20"), ("in_transit", "10"),
    ("safety_days", "3"), ("cycle_days", "7"), ("moq", "24"),
    ("unit_price_cents", "1290"),
]


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg_text(x, y, text, *, fill, size, family=MONO, weight=None, anchor=None,
             spacing=None):
    attrs = [f'x="{x}"', f'y="{y}"', f'fill="{fill}"',
             f'font-family="{family}"', f'font-size="{size}"']
    if weight:
        attrs.append(f'font-weight="{weight}"')
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if spacing:
        attrs.append(f'letter-spacing="{spacing}"')
    return f'<text {" ".join(attrs)}>{esc(text)}</text>'


def flow_svg(skin_name: str) -> str:
    s = FLOW[skin_name]
    p: list[str] = []
    shadow_op = "0.10" if skin_name == "light" else "0.55"
    shadow_col = "#1b1735" if skin_name == "light" else "#000000"
    white = "#ffffff"

    p.append(f'''<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" viewBox="0 0 1100 660" role="img" aria-label="dsh-store-replenish structure: one 10-column store-SKU CSV row is measured on a stock-level gauge (target stock, available stock, gap), the gap is packed along a MOQ ladder into a suggested quantity, rows roll up into per-store plans ranked by stockout risk, and replenish.export writes a fixed 13-column CSV under DSH_HOME">
<title>dsh-store-replenish: gauge, MOQ ladder, store roll-up, 13-column CSV</title>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0" stop-color="{s['bg_from']}"/>
    <stop offset="1" stop-color="{s['bg_to']}"/>
  </linearGradient>
  <filter id="soft" x="-25%" y="-25%" width="150%" height="170%">
    <feDropShadow dx="0" dy="8" stdDeviation="11" flood-color="{shadow_col}" flood-opacity="{shadow_op}"/>
  </filter>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
    <circle cx="1.3" cy="1.3" r="1.3" fill="{s['dot']}"/>
  </pattern>
</defs>
<rect width="1100" height="660" fill="url(#bg)"/>
<rect width="1100" height="660" fill="url(#dots)" opacity=".42"/>
{svg_text(44, 62, 'dsh-store-replenish', fill=s['text'], size=34, weight=700)}
{svg_text(44, 88, 'one store-SKU CSV · a gauge per row · MOQ ladder · per-store roll-up · 13-column CSV', fill=s['sub'], size=15, family=SANS)}
<rect x="812" y="36" width="244" height="34" rx="17" fill="{s['pill']}"/>
{svg_text(934, 58, 'window_days 30 · 16 rows', fill=s['accent'], size=14, anchor='middle')}
<line x1="44" y1="106" x2="1056" y2="106" stroke="{s['grid']}" stroke-width="1.5"/>''')

    # ------------------------------------------------------------- INPUT card
    p.append(f'''<g filter="url(#soft)"><rect x="40" y="118" width="236" height="360" rx="20" fill="{s['card']}" stroke="{s['edge']}" stroke-width="1.5"/></g>
{svg_text(60, 146, 'INPUT · CSV', fill=s['accent'], size=14, spacing=1.2)}
{svg_text(60, 172, 'store-replenish.csv', fill=s['text'], size=17, weight=700)}
{svg_text(60, 195, '16 rows · 2 stores · 8 SKUs', fill=s['sub'], size=14, family=SANS)}
{svg_text(60, 215, 'UTF-8 · ≤20 MB · header', fill=s['sub'], size=14, family=SANS)}
{svg_text(60, 237, '11 of 16 rows need an order', fill=s['warn'], size=14, family=SANS)}
<line x1="60" y1="252" x2="256" y2="252" stroke="{s['grid']}" stroke-width="1.4"/>
{svg_text(60, 272, 'columns · 10', fill=s['faint'], size=14, family=SANS)}
{svg_text(60, 290, 'accent feeds formula', fill=s['faint'], size=14, family=SANS)}''')

    for i, (name, value) in enumerate(INPUT_FIELDS):
        y = 306 + i * 18
        numeric = value is not None
        p.append(f'<circle cx="65" cy="{y - 5}" r="2.6" fill="{s["accent"]}"'
                 f' opacity="{".85" if numeric else ".28"}"/>')
        p.append(svg_text(74, y, name,
                          fill=s["text"] if numeric else s["faint"], size=14))
        if value is not None:
            p.append(svg_text(254, y, value, fill=s["accent"], size=14,
                              anchor="end"))

    # ------------------------------------------------------- ENGINE card
    p.append(f'''<g filter="url(#soft)"><rect x="292" y="118" width="420" height="360" rx="20" fill="{s['card']}" stroke="{s['edge']}" stroke-width="1.5"/></g>
<rect x="312" y="132" width="250" height="28" rx="14" fill="{s['pill']}"/>
{svg_text(324, 152, 'replenish.suggest · R0', fill=s['accent'], size=17)}
{svg_text(696, 152, 'value ¥928.80', fill=s['faint'], size=14, anchor='end')}
{svg_text(312, 186, 'target 100 = daily 10 × (cycle 7 + safety 3)', fill=s['text'], size=15)}
{svg_text(312, 206, 'daily 10 = sales_qty 300 ÷ window_days 30', fill=s['sub'], size=14)}
{svg_text(312, 226, 'suggested 72 = ceil(70 / 24) × 24', fill=s['accent'], size=14)}
<line x1="312" y1="240" x2="696" y2="240" stroke="{s['grid']}" stroke-width="1.4"/>''')

    # gauge axis and ticks (0..120, baseline 448, 1.6 px/unit)
    base, scale, axis_x = 448, 1.6, 368
    p.append(f'<line x1="{axis_x}" y1="{int(round(base - 120 * scale))}"'
             f' x2="{axis_x}" y2="{base}" stroke="{s["grid"]}"'
             f' stroke-width="1.6"/>')
    for units in range(0, 121, 20):
        y = int(round(base - units * scale))
        p.append(f'<line x1="{axis_x - 6}" y1="{y}" x2="{axis_x}" y2="{y}"'
                 f' stroke="{s["sub"]}" stroke-width="1.4"/>')
        p.append(svg_text(axis_x - 11, y + 5, str(units), fill=s["faint"],
                          size=14, anchor="end"))

    bar_x0, bar_x1 = 378, 428
    stock_top = int(round(base - WORKED["stock_qty"] * scale))
    transit_top = int(round(base - (WORKED["stock_qty"]
                                    + WORKED["in_transit"]) * scale))
    p.append(f'<rect x="{bar_x0}" y="{stock_top}" width="{bar_x1 - bar_x0}"'
             f' height="{base - stock_top}" rx="4" fill="{s["accent"]}"/>')
    p.append(f'<rect x="{bar_x0}" y="{transit_top}" width="{bar_x1 - bar_x0}"'
             f' height="{stock_top - transit_top}" rx="4" fill="{s["accent"]}"'
             f' opacity=".45"/>')
    p.append(svg_text((bar_x0 + bar_x1) // 2, stock_top + 24,
                      str(WORKED["stock_qty"]), fill=white, size=14,
                      weight=700, anchor="middle"))
    p.append(svg_text((bar_x0 + bar_x1) // 2, transit_top + 14,
                      str(WORKED["in_transit"]), fill=s["text"], size=14,
                      weight=700, anchor="middle"))
    p.append(svg_text(bar_x0, transit_top - 26, 'available 30', fill=s["sub"],
                      size=14))

    target_y = int(round(base - WORKED["target_qty"] * scale))
    p.append(f'<line x1="352" y1="{target_y}" x2="696" y2="{target_y}"'
             f' stroke="{s["accent"]}" stroke-width="1.6"'
             f' stroke-dasharray="8 7" opacity=".85"/>')
    p.append(svg_text(696, target_y - 10, 'target', fill=s["accent"], size=14,
                      anchor="end"))

    # gap bracket + gap label + arrow into the ladder
    bx = 480
    p.append(f'<path d="M{bx} {target_y} V {transit_top}" fill="none"'
             f' stroke="{s["accent"]}" stroke-width="2.2"/>')
    p.append(f'<path d="M{bx - 5} {target_y} h10 M{bx - 5} {transit_top} h10"'
             f' stroke="{s["accent"]}" stroke-width="2.2"/>')
    p.append(svg_text(494, 344, 'gap 70', fill=s["warn"], size=15,
                      weight=700))
    p.append(f'<path d="M558 340 h20" stroke="{s["accent"]}"'
             f' stroke-width="2.2"/>')
    p.append(f'<path d="M570 334 l8 6 -8 6" fill="none" stroke="{s["accent"]}"'
             f' stroke-width="2.2" stroke-linecap="round"'
             f' stroke-linejoin="round"/>')

    # MOQ pack ladder: three boxes of 24
    pk_x0, pk_x1, pk_h, pk_gap = 584, 680, 46, 4
    for i in range(WORKED["suggested_qty"] // WORKED["moq"]):
        top = base - (i + 1) * pk_h - i * pk_gap
        p.append(f'<rect x="{pk_x0}" y="{top}" width="{pk_x1 - pk_x0}"'
                 f' height="{pk_h}" rx="10" fill="{s["accent"]}"/>')
        p.append(f'<rect x="{pk_x0 + 4}" y="{top + 4}"'
                 f' width="{pk_x1 - pk_x0 - 8}" height="8" rx="4"'
                 f' fill="{white}" opacity=".16"/>')
        p.append(svg_text((pk_x0 + pk_x1) // 2, top + pk_h // 2 + 6,
                          str(WORKED["moq"]), fill=white, size=17, weight=700,
                          anchor="middle"))
    p.append(svg_text(560, 280, '3 × 24 = 72', fill=s["sub"], size=14,
                      anchor="end"))
    p.append(svg_text(312, 470, 'available = stock 20 + in_transit 10',
                      fill=s["sub"], size=14))

    # --------------------------------------------------------- PLAN card
    p.append(f'''<g filter="url(#soft)"><rect x="728" y="118" width="332" height="360" rx="20" fill="{s['card']}" stroke="{s['edge']}" stroke-width="1.5"/></g>
<rect x="748" y="132" width="220" height="28" rx="14" fill="{s['pill']}"/>
{svg_text(760, 152, 'replenish.plan · R0', fill=s['accent'], size=17)}
{svg_text(748, 184, 'per-store roll-up', fill=s['text'], size=17, weight=700, family=SANS)}
{svg_text(748, 204, 'sort: now↓ risk↓ value↓ name↑', fill=s['faint'], size=14)}
<line x1="748" y1="220" x2="1040" y2="220" stroke="{s['grid']}" stroke-width="1.4"/>''')

    bars_scale = 288 / max(st["total_units"] for st in STORES)
    for i, st in enumerate(STORES):
        y = 228 + i * 84
        risk_word = "risk" if st["stockout_risk_count"] == 1 else "risks"
        p.append(svg_text(748, y + 13, f'#{i + 1}', fill=s["faint"], size=14))
        p.append(svg_text(770, y + 13, st["store"], fill=s["text"], size=17,
                          weight=700))
        p.append(svg_text(1040, y + 13,
                          f'¥{yuan(st["estimated_value_cents"])}',
                          fill=s["text"], size=14, anchor="end"))
        bar_y = y + 21
        p.append(f'<rect x="748" y="{bar_y}" width="292" height="10" rx="5"'
                 f' fill="{s["track"]}"/>')
        p.append(f'<rect x="748" y="{bar_y}"'
                 f' width="{int(round(st["total_units"] * bars_scale))}"'
                 f' height="10" rx="5" fill="{s["accent"]}"/>')
        p.append(svg_text(748, bar_y + 29,
                          f'{st["sku_count"]} SKU · {st["order_lines"]} lines'
                          f' · {st["total_units"]} units',
                          fill=s["sub"], size=14))
        p.append(svg_text(748, bar_y + 47,
                          f'{st["risk_level"]}'
                          f' · {st["stockout_risk_count"]} stockout {risk_word}',
                          fill=s["faint"], size=14))

    p.append(f'<rect x="748" y="392" width="292" height="74" rx="14"'
             f' fill="{s["zone"]}" stroke="{s["zone_edge"]}"'
             f' stroke-width="1.4"/>')
    p.append(svg_text(764, 416, 'totals', fill=s["accent"], size=14))
    p.append(svg_text(1026, 416, f'{TOTALS["risk"]} risk · {TOTALS["slow"]} slow',
                      fill=s["faint"], size=14, anchor="end"))
    p.append(svg_text(764, 438,
                      f'{TOTALS["rows"]} rows · {TOTALS["lines"]} lines'
                      f' · {TOTALS["stores"]} stores',
                      fill=s["sub"], size=14))
    p.append(svg_text(764, 458,
                      f'{TOTALS["units"]} units · ¥{TOTALS["value"]}',
                      fill=s["text"], size=14))

    # connectors (16 px gaps, plus plan -> export band)
    for gx in (276, 712):
        p.append(f'<path d="M{gx + 3} 292 L{gx + 12} 300 L{gx + 3} 308"'
                 f' fill="none" stroke="{s["accent"]}" stroke-width="2.2"'
                 f' stroke-linecap="round" stroke-linejoin="round"'
                 f' opacity=".8"/>')
    p.append(f'<path d="M896 478 v8" stroke="{s["accent"]}"'
             f' stroke-width="2" opacity=".75"/>')
    p.append(f'<path d="M890 485 l6 6 6 -6" fill="none"'
             f' stroke="{s["accent"]}" stroke-width="2"'
             f' stroke-linecap="round" stroke-linejoin="round"'
             f' opacity=".75"/>')

    # ------------------------------------------------------- EXPORT band
    p.append(f'''<g filter="url(#soft)"><rect x="40" y="492" width="1020" height="118" rx="18" fill="{s['card']}" stroke="{s['edge']}" stroke-width="1.5"/></g>
<rect x="60" y="504" width="242" height="28" rx="14" fill="{s['pill']}"/>
{svg_text(72, 524, 'replenish.export · R1', fill=s['accent'], size=17)}
{svg_text(1040, 524, 'sha256 · bytes · rows', fill=s['faint'], size=14, anchor='end')}
{svg_text(60, 552, 'write → $DSH_HOME/dsh-store-replenish/exports/replenish-30d.csv', fill=s['text'], size=14)}''')

    cx = 60
    for name in CSV_COLUMNS:
        width = int(round(sum(14 if ord(ch) > 0x2E80 else 8.2 for ch in name)
                          + 20))
        p.append(f'<rect x="{cx}" y="562" width="{width}" height="26" rx="8"'
                 f' fill="{s["pill"]}"/>')
        p.append(svg_text(cx + 10, 580, name, fill=s["accent"], size=14))
        cx += width + 6

    p.append(f'''{svg_text(60, 602, 'default: suggested_qty > 0 only · include_zero=true appends the rest', fill=s['faint'], size=14)}
{svg_text(1040, 602, 'E_REPL_EMPTY when nothing to export', fill=s['faint'], size=14, anchor='end')}
{svg_text(44, 630, 'slow_moving ← turnover > 60 d · stockout_risk ← available < daily × cycle_days · stockout_now ← stock = 0 & daily > 0', fill=s['sub'], size=14)}
{svg_text(44, 648, 'R0 read-only · R1 local write · source CSV never modified · no network · integer units / integer cents', fill=s['faint'], size=14, family=SANS)}
</svg>''')

    return "\n".join(p) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin_name in ("light", "dark"):
        for lang in ("zh", "en"):
            hero(lang, skin_name)
        path = os.path.join(OUT, f"dsh-store-replenish-flow-v5-{skin_name}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin_name))
        print(f"wrote {os.path.basename(path)}")
    if WARNINGS:
        print(f"{len(WARNINGS)} layout warning(s):")
        for warning in WARNINGS:
            print("  WARN", warning)


if __name__ == "__main__":
    main()
