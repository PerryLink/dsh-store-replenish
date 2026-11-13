#!/usr/bin/env node
/**
 * dsh-store-replenish quickstart — validates the bundled synthetic 2 × 8
 * store-SKU table, computes 30-day replenishment suggestions, aggregates two
 * store orders and exports the replenishment CSV.
 *
 *   node samples/quickstart/run.mjs            # human-readable summary
 *   node samples/quickstart/run.mjs --json     # the golden result on stdout
 *   node samples/quickstart/run.mjs --check    # recompute and diff against the golden file
 *
 * The golden file `expected/result.json` is the stdout of `--json`; it is a real
 * run over the committed CSV, not hand-written output.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatMoney } from '../../lib/core/money.js'
import { createTools } from '../../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const samplePath = path.join(here, 'input', 'store-replenish.csv')
const expectedPath = path.join(here, 'expected', 'result.json')
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--json') ? 'json' : 'summary'
const WINDOW_DAYS = 30

async function run() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-store-replenish-quickstart-'))
  const realTemp = await realpath(tempDir)
  try {
    const tools = Object.fromEntries(createTools({ baseDir: tempDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'quickstart' }

    const suggestions = await tools['replenish_suggest'].execute(
      { path: samplePath, window_days: WINDOW_DAYS },
      exec,
    )
    const plan = await tools['replenish_plan'].execute({ path: samplePath, window_days: WINDOW_DAYS }, exec)
    const exported = await tools['replenish_export'].execute(
      { path: samplePath, window_days: WINDOW_DAYS },
      exec,
    )
    const exportText = await readFile(exported.path, 'utf8')

    return {
      sample: 'samples/quickstart/input/store-replenish.csv',
      policy: { window_days: WINDOW_DAYS },
      suggestions,
      plan,
      exports: {
        replenishment: {
          ...exported,
          path: path.relative(realTemp, exported.path).split(path.sep).join('/'),
          text: exportText,
        },
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function flags(item) {
  return [
    item.stockout_now ? 'stockout now' : '',
    item.stockout_risk ? 'stockout risk' : '',
    item.slow_moving ? 'slow-moving' : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function printSummary(result) {
  const { suggestions, plan, exports } = result
  const totals = plan.totals
  console.log('dsh-store-replenish quickstart - synthetic 2 stores x 8 SKUs (not store data)')
  console.log(
    `${result.policy.window_days}-day window: ${totals.rows} store-SKU rows, ${totals.order_lines} order line(s), ${totals.total_units} unit(s), ${formatMoney(totals.estimated_value_cents)}; ${totals.stockout_risks} stockout risk(s), ${totals.slow_moving} slow-moving`,
  )
  console.log('stores by stockout risk:')
  for (const store of plan.stores) {
    console.log(
      `  ${store.store}: ${store.order_lines} order line(s), ${store.total_units} unit(s), ${formatMoney(store.estimated_value_cents)}, ${store.stockout_risk_count} risk (${store.risk_level})`,
    )
  }
  console.log('top suggestions:')
  for (const item of suggestions.items.filter((entry) => entry.replenish_needed).slice(0, 4)) {
    const note = flags(item)
    console.log(
      `  ${item.store} ${item.name}: ${item.suggested_qty} unit(s), ${formatMoney(item.estimated_value_cents)}${note ? ` [${note}]` : ''}`,
    )
  }
  const slow = suggestions.items.find((item) => item.slow_moving)
  if (slow) {
    console.log(
      `slow-moving: ${slow.store} ${slow.name} (turnover ${slow.turnover_days} days, suggested ${slow.suggested_qty})`,
    )
  }
  console.log(
    `replenishment CSV ${exports.replenishment.path}: ${exports.replenishment.rows} rows, ${exports.replenishment.bytes} bytes, sha256 ${exports.replenishment.sha256.slice(0, 12)}...`,
  )
}

const result = await run()

if (mode === 'json') {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else if (mode === 'check') {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(result, expected)
  printSummary(result)
  console.log('golden samples/quickstart/expected/result.json matches')
  console.log('quickstart ok')
} else {
  printSummary(result)
  console.log('run with --check to compare against expected/result.json')
}
