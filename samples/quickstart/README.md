# dsh-store-replenish quickstart

- `input/store-replenish.csv` — synthetic 16-row store-SKU table: 2 stores × 8 SKUs, 1 slow-moving SKU, 2 stockout-risk SKUs, no real store data.
- `expected/result.json` — the real stdout of `node samples/quickstart/run.mjs --json`; it is regenerated, never hand-written.
- `run.mjs` — computes the 30-day replenishment suggestions, aggregates them into two store orders and writes the replenishment CSV into a temporary directory.

```sh
node samples/quickstart/run.mjs            # human-readable summary
node samples/quickstart/run.mjs --json     # golden output
node samples/quickstart/run.mjs --check    # recompute and diff against expected/result.json
```

The sample deliberately includes MOQ rounding in both directions (exact multiples such as `每日坚果` 12 → 12, and non-multiples such as `苏打饼干` 70 → 72), an exact-zero raw quantity (`成猫粮`, Shanghai), no-sales stock (`抑菌洗手液`, Chengdu, turnover 100 days) and two stockout risks (`苏打饼干` and `鲜牛奶`, both in Shanghai). Store ranking therefore puts Shanghai first even though Chengdu's demand is comparable.
