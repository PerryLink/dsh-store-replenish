<div align="center">

# dsh-store-replenish

> **Official repository.** The only official repository of this package, maintained by PerryLink. Same-name repositories under other accounts are not affiliated. Apache-2.0.

[![npm](https://img.shields.io/npm/v/dsh-store-replenish)](https://www.npmjs.com/package/dsh-store-replenish)
[![CI](https://github.com/PerryLink/dsh-store-replenish/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-store-replenish/actions)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Turn a store-SKU sales/inventory CSV into per-SKU replenishment suggestions, per-store replenishment orders and a replenishment CSV.**

> **Status: alpha / public-synthetic / partial / not counted / not GA.** No store data, product data or sales evidence, and no production-readiness, procurement or financial claim.

[English](README.md) · [简体中文](README-zh.md)

```sh
dsh plugin --profile <profile> add dsh-store-replenish
```

</div>

## One-liner

Compute `daily average × (cycle days + safety days) − stock − in-transit`, round the gap up to the MOQ, and return one suggested replenishment quantity per store-SKU — flagging SKUs whose turnover exceeds 60 days and SKUs whose stock cannot cover the next replenishment cycle.

## Fit / not a fit

- **Fits:** tens to thousands of store-SKU combinations; fixing one auditable rule for daily average, stock, in-transit, safety days, cycle days and MOQ; per-store SKU counts, total units and estimated amount; deciding replenishment order by stockout risk first; a replenishment list for a store manager, buyer or warehouse to review.
- **Does not fit:** raising purchase orders, transfers or ERP/POS/WMS integration; multi-warehouse, multi-currency, tax or tax-inclusive pricing; promotions, seasons, shelf life, batches or expiry; EOQ, carrying cost, service level or safety-stock optimisation (safety days are an input); reading Excel/PDF/images directly (export CSV first); treating a suggestion as a purchasing commitment.

## Input

- UTF-8 CSV with a header row and comma separators. RFC 4180 quotes, embedded newlines, CRLF and a UTF-8 BOM are supported.
- Header: `store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents`. Chinese aliases such as `门店 / SKU / 品名 / 销量 / 当前库存 / 在途 / 安全天数 / 补货周期天数 / 起订量 / 单价分` work too; `name` is optional and falls back to the SKU; extra columns are ignored.
- Sales: `sales_qty` is cumulative demand **inside the declared window** in the same unit as stock. The window is the `window_days` tool argument, default 30.
- Numbers: sales, stock, in-transit, safety days, cycle days, MOQ and unit price are non-negative integers; MOQ is at least 1; safety and cycle days are capped at 3650; price is integer **cents**. Negative, fractional, empty or out-of-range values are `E_REPL_QTY`.
- Store-SKU: a `(store, SKU)` pair may appear once per file; different stores may carry the same SKU.
- Size: up to 20 MB per file; split by store or category beyond that.
- Source: the local CSV the user names; it is read-only and never modified.

## Output

- **`replenish.suggest`**: `{ window_days, source_sha256, totals, items }`. Each SKU carries daily average, cover days, turnover days, target quantity, raw gap, suggested quantity, estimated value and the `slow_moving`, `stockout_risk` and `stockout_now` flags. Items sort deterministically by store, risk, quantity and SKU.
- **`replenish.plan`**: `{ window_days, source_sha256, totals, stores }`. Per store: `sku_count`, `order_lines`, `total_units`, `estimated_value_cents`, risk and slow-moving counts, and `risk_level` (high/medium/low). Stores are ranked by stockout risk and keep every per-SKU item.
- **`replenish.export`**: writes the replenishment order as CSV under `$DSH_HOME/dsh-store-replenish/exports/` with columns `门店,SKU,品名,当前库存,在途,日均销量,补货周期天数,安全天数,建议补货量,预估金额,缺货风险,滞销,周转天数`; returns path, `sha256`, bytes and row counts. Only SKUs with a positive suggested quantity are written by default; `include_zero=true` appends the rest for review.

## Rules

1. Daily average = `sales_qty / window_days`; `window_days` defaults to 30 and accepts 1–3650. It declares what the sales column means; the tool does not fetch history.
2. Target stock = `daily average × (cycle_days + safety_days)`.
3. Gap = `target − stock − in-transit`; in-transit counts as available stock.
4. Suggested quantity = 0 when the gap is ≤ 0, otherwise `ceil(gap / moq) × moq`. MOQ rounding uses integer numerator/denominator math so an exact multiple is never pushed to the next case by floating-point drift.
5. Turnover days = `stock / daily average`; stock > 0 with turnover > 60 days is slow-moving. No sales but stock on hand gives `turnover_days: null` (treated as infinite) and the slow-moving flag; no sales and no stock is not flagged.
6. Stockout risk = `stock + in-transit < daily average × cycle_days`, i.e. available stock cannot cover one replenishment cycle. `stockout_now=true` additionally means stock is 0 with positive demand.
7. Store order: `stockout_now` count desc → stockout-risk count desc → estimated amount desc → store name asc. Risk outranks amount, so a smaller store can rank first.
8. Item order inside a store: `stockout_now` → stockout risk → needs replenishment → slow-moving → other; within a tier, quantity desc then SKU asc.
9. Estimated value = `suggested quantity × unit price cents`; the API returns integer cents and the CSV renders two decimals.
10. `replenish.export` writes only positive suggested quantities; if there is no such row it raises `E_REPL_EMPTY`. With `include_zero=true` every SKU is written, while `order_lines` still counts only positive rows.

## Example

Paste this one line into the agent:

> 用这份 2 门店 × 8 SKU 的销售库存表，按 30 天窗口算补货建议，汇总成门店补货单并导出补货 CSV。

Reproduce the bundled sample and compare with the golden file:

```sh
node samples/quickstart/run.mjs --check
```

![dsh-store-replenish quickstart terminal output](docs/assets/quickstart.png)

The sample is 16 synthetic rows (2 stores × 8 SKUs). It contains one slow-moving SKU (成都高新店 `抑菌洗手液 500ml`, turnover 100 days) and two stockout-risk SKUs (上海静安店 `苏打饼干 400g` and `鲜牛奶 950ml`). It also covers exact MOQ multiples (`每日坚果` 12 → 12), non-multiples (`苏打饼干` 70 → 72), an exact-zero gap (Shanghai `成猫粮`) and a no-sales SKU (Chengdu `抑菌洗手液`). `samples/quickstart/expected/result.json` is the real stdout of `node samples/quickstart/run.mjs --json`, not hand-written; the screenshot is the real `--check` output.

## Permissions

Read: the store-SKU sales/inventory CSV the user names (sample: `samples/quickstart/input/store-replenish.csv`); nothing else.
Write: `$DSH_HOME/dsh-store-replenish/exports/` (replenishment CSV) only; the source CSV is not modified.
Network: no.
External systems: none.

`replenish.suggest` and `replenish.plan` are **R0** (read-only). `replenish.export` is **R1** (local write under `exports/`). `DSH_STORE_REPLENISH_HOME` can override the local write root for tests; the default is exactly `$DSH_HOME/dsh-store-replenish`.

## FAQ

### 1. Why does the suggestion differ from my hand calculation by one case?

Because it rounds up to the MOQ. A gap of 70 with MOQ 24 becomes `ceil(70/24)=3`, i.e. 72 rather than 70. Check `raw_qty` and `moq`; `suggested_qty` is always a multiple of MOQ.

### 2. Are slow-moving SKUs excluded from replenishment?

No. The formula comes first: a positive gap still yields a suggestion, with `slow_moving=true` as a warning. In practice you would check why stock is slow; this package flags it and does not zero the suggestion or make a stop-buy decision.

### 3. Does `window_days` fetch the last N days automatically?

No. It declares how many days the `sales_qty` column covers. Passing 15 means the same column is read as 15-day demand, so the daily average rises. The tool never reads history or calls an external system.

### 4. Is in-transit counted as stock or turnover?

In-transit counts as available stock (it reduces the gap and affects stockout risk) but is **not** part of turnover, which uses stock on hand only.

### 5. What is the difference between `stockout_risk` and `stockout_now`?

`stockout_now` means stock is already 0 with positive demand. `stockout_risk` means stock plus in-transit cannot last until the next replenishment (`< daily average × cycle_days`). With plenty of in-transit you can have `stockout_now=true` while `stockout_risk=false`.

### 6. Does it modify or upload my file?

No. It reads the named CSV, writes only under `$DSH_HOME/dsh-store-replenish/exports/`, and never uses the network, a model call or an upload. The source CSV is not modified.

### 7. Can it read Excel or connect to a purchasing system?

No. CSV input only; it does not raise purchase orders, call ERP/POS/WMS or send messages. Hand the exported CSV to your existing process and review it.

## Version

`0.1.0` · 121 tests pass (`node --test test/*.test.mjs`).

> ⭐ If this helps, a star makes it easier for the next person to find it. Nothing is gated behind it.

## Install

```sh
dsh plugin --profile <profile> add dsh-store-replenish
dsh --profile <profile> --dump-config | grep dsh-store-replenish
```

Uninstall:

```sh
dsh plugin --profile <profile> remove dsh-store-replenish
```

### Install channels

- **npm (recommended):** `dsh plugin --profile <profile> add dsh-store-replenish`
- **git channel:** `dsh plugin --profile <profile> add github:PerryLink/dsh-store-replenish`
- **tarball:** `pnpm pack`, then `dsh plugin --profile <profile> add ./dsh-store-replenish-<version>.tgz`

## Tools

Tool names are stable API; descriptions stay in English to match runtime output.

| Tool | Purpose | Risk |
|---|---|---|
| `replenish.suggest` | Read the store-SKU CSV and compute each SKU's suggested replenishment quantity from daily average, cycle days, safety days, stock, in-transit and MOQ; flag slow-moving and stockout risk | R0 |
| `replenish.plan` | Aggregate a per-store replenishment order (SKU count, order lines, units, estimated amount, risk counts), ranked by stockout risk | R0 |
| `replenish.export` | Write the replenishment CSV (store/SKU/name/stock/in-transit/daily/cycle/safety/suggested/value/risk/slow/turnover), returning path + sha256 | R1 local write |

## Errors

| Code | When | Next action |
|---|---|---|
| `E_REPL_QTY` | Sales/stock/in-transit/safety days/cycle days/MOQ/price is negative, fractional, empty or out of range; MOQ 0; `window_days` outside 1–3650 | Use non-negative integers, MOQ ≥ 1, window 1–3650 |
| `E_REPL_CSV_ROW` | Wrong column count, missing/duplicate header, empty store/SKU, duplicate store-SKU pair, file > 20 MB | Fix the named row; `(store, SKU)` must be unique |
| `E_REPL_EMPTY` | Empty/header-only CSV; export with no positive suggested quantity | Check for data rows; pass `include_zero=true` to see every SKU |
| `E_REPL_PATH_INVALID` | Missing/directory/unreadable input, unsafe export filename, or a write failure | Pass an existing CSV; export with `[A-Za-z0-9._-]` only |

The message format is `<one sentence>（E_REPL_XXX）｜下一步：<one action>`. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Acceptance evidence

Public/synthetic fixtures live in `samples/quickstart/`; `ACCEPTANCE.csv` records 15 tool checks plus the quickstart golden. Every row is `counted=false` except the quickstart row.

| req_id | metric | threshold | actual | pass | source | counted |
|---|---|---|---|---|---|---|
| AC-R01 | suggest totals | rows=16 order_lines=11 units=398 | rows=16 order_lines=11 units=398 | true | public/synthetic | false |
| AC-R02 | MOQ rounding | 苏打=72 牛奶=60 | 苏打=72 牛奶=60 | true | public/synthetic | false |
| AC-R03 | flags | risk=2 slow=1 | risk=2 slow=1 | true | public/synthetic | false |
| AC-R04 | store aggregation | 上海=282 成都=116 | 上海=282 成都=116 | true | public/synthetic | false |
| AC-R07 | replenishment CSV | rows=11 lines=12 | rows=11 lines=12 | true | public/synthetic | false |
| AC-R09 | 15-day window | order_lines=14 units=1774 | order_lines=14 units=1774 | true | public/synthetic | false |
| PS1-QS01 | quickstart golden | 1/1 | 1 | true | synthetic/quickstart | true |

*Fixture-backed rows, not a store run; no output is invented.*

## Limits and known limitations

- **No ordering or transfers:** suggestions and a local CSV only; no purchasing, ERP/POS/WMS integration or messaging.
- **Single warehouse/currency:** the input has no warehouse, currency or tax columns; split files or convert in the source system.
- **Safety days are input:** no demand forecast, seasonality, promotion, service level or EOQ optimisation.
- **No shelf life/batches:** no expiry, batch, serial, FIFO or shrinkage modelling.
- **The window is declared:** `sales_qty` covers `window_days` days; the tool does not fetch history.
- **Turnover is a flag:** slow-moving uses a 60-day threshold only; stop-buy, clearance or returns are your decision.
- CSV only: no Excel/PDF/images and no OCR.
- Exported CSV uses RFC 4180 quoting only; Excel formula prefixes are not sanitised.
- Integer units and integer cents only; no split cases, weighed goods or decimal measures.
- Public/synthetic samples only; alpha/partial, not counted, no GA or production-readiness claim.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck
node --test test/*.test.mjs
node scripts/gate.mjs
```

## Compatibility

| Surface | Status |
|---|---|
| Harness | `dsh >=0.2.1-rc.3 <0.4.0` |
| Node | `>=24.9.0 <25` |
| Platforms | All; local files only |
| Data | No network, no model call, no upload |

## Related work

- [dsh-pim-lint](https://github.com/PerryLink/dsh-pim-lint) (product master-data validation)
- [dsh-pim-listing](https://github.com/PerryLink/dsh-pim-listing) (product listing checks)
- [Domain index](https://perrylink.github.io/dsh-plugins/)

## License

Apache-2.0. See `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES`.
