# Changelog

## 0.1.0-alpha.1 — 2026-11-03

- First public alpha of `dsh-store-replenish`.
- `replenish.suggest`: store-SKU sales/inventory CSV ingest, daily average over a declared `window_days` (default 30), target stock from cycle days plus safety days, MOQ-rounded suggested quantity, estimated value, slow-moving flag (turnover > 60 days) and stockout-risk/stockout-now flags.
- `replenish.plan`: per-store aggregation (SKU count, order lines, total units, estimated amount, risk and slow-moving counts, risk level) ranked by stockout risk.
- `replenish.export`: fixed 13-column Chinese replenishment CSV under `$DSH_HOME/dsh-store-replenish/exports/`, optional `include_zero`, safe-path checks and sha256 metadata.
- Synthetic 2-store × 8-SKU quickstart (1 slow-moving, 2 stockout risks), real-output golden file, real terminal screenshot and acceptance evidence.
- Local only: no network, no model call, no upload, no purchase order.
