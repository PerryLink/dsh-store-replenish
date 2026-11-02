# Evidence — dsh-store-replenish 0.1.0-alpha.1

All runs are local, over a synthetic 2-store × 8-SKU sales/inventory table. No store data, no
product data, no network call, no model call and no purchase order. No `git commit/push` and no
`npm publish` were performed.

## Environment

- Node `v24.22.1`
- pnpm `11.28.5` (`package.json` pins `pnpm@11.28.5`)
- TypeScript `7.0.2` (NodeNext, strict)
- Date: 2026-11-03 (Asia/Shanghai)

## Commands and results

| Command | Result |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.json` | exit 0, emits `lib/` |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | exit 0 |
| `node --test test/*.test.mjs` | 121 tests, 121 pass, 0 fail |
| `node samples/quickstart/run.mjs --check` | golden `expected/result.json` matches |
| `node scripts/lint.mjs` | 9 source files, 15 test files / 121 tests, 16 published entries |
| `node scripts/gate.mjs` | lint ok, acceptance ok, 16/16 acceptance rows pass |
| `npm pack --dry-run --json` | 38 files, 214,571 bytes unpacked, no publish |

## Local Package Standard v1 score

The package is intentionally **not** added to `04-build/dsh-plugins/family.json` (not in the
family yet, so the committed roster does not count it). To verify the standard locally, the
official `04-build/dsh-plugins/scripts/score-packages.mjs` was copied to a temporary harness,
pointed at a one-item temporary family file, and run against a copy of this checkout:

```
PS1 scores: 1 packages | green 1 / yellow 0 / red 0
domain packages: 1, avg 10.0
10 green  dsh-store-replenish
gate 8: ok
```

Per-category score: `page=1 sample=2 prompt=1 expected=1 permissions=2 errors=1 evidence=2 total=10`
(green; every category non-zero).

## Screenshot / golden hashes

| Artifact | SHA-256 |
|---|---|
| `docs/assets/quickstart.png` | `af9d4c0d7e538f399e209f4275eebf0e75933b430301ce91c257f7556de02470` |
| `docs/assets/quickstart.log` | `cc34a46265ece93c098e32c8df3c3c7ce565c23f25561b5c681e285281418409` |
| `samples/quickstart/expected/result.json` | `967c1b17b3b356ea704ca7b05150e19d2ba8a4a7d509ca115fa1a1494d16f1d7` |
| `ACCEPTANCE.csv` quickstart row | uses the `expected/result.json` hash above |

The screenshot was rendered by `04-build/dsh-plugins/scripts/render-capture.py` from the real
captured terminal output in `docs/assets/quickstart.log` with
`RENDER_CAPTURE_FONT=/mnt/c/Windows/Fonts/msyh.ttc`; no output text was invented.

## Error-path coverage

- `E_REPL_QTY` — negative / fractional / empty numeric cells, MOQ 0 or negative, day counts above 3650, unsafe integer overflow, invalid `window_days`.
- `E_REPL_CSV_ROW` — wrong column count, missing or duplicate header, empty store/SKU, duplicate `(store, SKU)`, malformed quotes, NUL bytes, file above 20 MB.
- `E_REPL_EMPTY` — empty file, header-only CSV, export with no positive suggested quantity.
- `E_REPL_PATH_INVALID` — missing path, empty path, directory, unsafe export filename, traversal, absolute path, symlink re-anchor, write failure.

All four codes are exercised by `test/*.test.mjs` and by `scripts/acceptance.mjs`.

## Scope notes

- The 16-row sample is synthetic; store names, SKU codes, product names and prices are placeholders.
- `ACCEPTANCE.csv` has 16 rows: 15 fixture-backed tool checks (`counted=false`) and one
  quickstart golden row (`counted=true`).
- No purchase order is created, no ERP/POS/WMS is contacted and no message is sent.
