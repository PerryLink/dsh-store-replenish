# Changelog

## [0.2.0] — 2026-11-13

### Breaking

- **Tool names now use an underscore separator instead of a dot.** The three tools are `replenish_suggest`, `replenish_plan` and `replenish_export`; previously the same names were joined by `.` after the `replenish` prefix. Providers validate `tools[].name` against `^[a-zA-Z0-9_-]+$`; a dot made the whole `tools` array invalid, so the plugin registered but every request carrying its tools was rejected with `Invalid 'tools[N].name'`. This is a minor bump because tool names are part of the 0.1.0 compatibility promise — update prompts, saved calls and permission rules that still use the old dotted spelling. There are no deprecated dotted aliases: only the three underscore names are registered.
- `test/tool-name-wire.test.mjs` pins the wire pattern, the absence of dots, the `replenish_` namespace and name uniqueness, so a new tool cannot reintroduce a dotted name.
- Earlier changelog entries use the underscore spelling, so a repository-wide search no longer finds dotted tool names.

## [0.1.0] — 2026-11-03

### Stable

- First non-alpha release: tool names and the CLI surface are covered by a
  compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures.

## 0.1.0-alpha.1 — 2026-11-03

- First public alpha of `dsh-store-replenish`.
- `replenish_suggest`: store-SKU sales/inventory CSV ingest, daily average over a declared `window_days` (default 30), target stock from cycle days plus safety days, MOQ-rounded suggested quantity, estimated value, slow-moving flag (turnover > 60 days) and stockout-risk/stockout-now flags.
- `replenish_plan`: per-store aggregation (SKU count, order lines, total units, estimated amount, risk and slow-moving counts, risk level) ranked by stockout risk.
- `replenish_export`: fixed 13-column Chinese replenishment CSV under `$DSH_HOME/dsh-store-replenish/exports/`, optional `include_zero`, safe-path checks and sha256 metadata.
- Synthetic 2-store × 8-SKU quickstart (1 slow-moving, 2 stockout risks), real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload, no purchase order.
