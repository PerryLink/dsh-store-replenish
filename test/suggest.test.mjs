import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildSuggestReport, ingestReplenishCsv, normalizePolicy } from '../lib/core/replenish.js'
import {
  makeTemp,
  replenishCsv,
  row,
  samplePath,
  suggestFor,
  toolMap,
  writeReplenish,
} from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

async function suggestRows(t, rows, windowDays) {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'rows.csv', rows)
  const tools = toolMap(path.join(dir, 'store'))
  return tools['replenish.suggest'].execute(
    { path: file, ...(windowDays === undefined ? {} : { window_days: windowDays }) },
    exec,
  )
}

test('the base formula computes daily average, target, raw and MOQ rounding', async (t) => {
  const result = await suggestRows(t, [row()])
  const item = result.items[0]
  assert.equal(item.daily_avg, 10)
  assert.equal(item.target_qty, 100)
  assert.equal(item.raw_qty, 70)
  assert.equal(item.suggested_qty, 72)
  assert.equal(item.estimated_value_cents, 72_000)
  assert.equal(item.window_days, 30)
  assert.equal(item.replenish_needed, true)
})

test('an exact MOQ multiple is not rounded up', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 360, stock: 0, transit: 0, safety: 0, cycle: 10, moq: 24 }),
  ])
  assert.equal(result.items[0].raw_qty, 120)
  assert.equal(result.items[0].suggested_qty, 120)
})

test('anything above an exact multiple becomes the next MOQ case', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 363, stock: 0, transit: 0, safety: 0, cycle: 10, moq: 24 }),
  ])
  assert.equal(result.items[0].raw_qty, 121)
  assert.equal(result.items[0].suggested_qty, 144)
})

test('a fractional target still rounds to the next MOQ case', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 45, stock: 0, transit: 0, safety: 3, cycle: 7, moq: 12 }),
  ])
  const item = result.items[0]
  assert.equal(item.daily_avg, 1.5)
  assert.equal(item.raw_qty, 15)
  assert.equal(item.suggested_qty, 24)
})

test('in-transit stock counts against the target', async (t) => {
  const result = await suggestRows(t, [row({ sales: 300, stock: 0, transit: 40, safety: 0, cycle: 7, moq: 12 })])
  assert.equal(result.items[0].raw_qty, 30)
  assert.equal(result.items[0].suggested_qty, 36)
})

test('no suggestion when stock plus in-transit already covers the target', async (t) => {
  const result = await suggestRows(t, [row({ stock: 150, transit: 0 })])
  assert.equal(result.items[0].raw_qty, -50)
  assert.equal(result.items[0].suggested_qty, 0)
  assert.equal(result.items[0].replenish_needed, false)
  assert.equal(result.items[0].estimated_value_cents, 0)
  assert.equal(result.totals.order_lines, 0)
  assert.equal(result.totals.total_units, 0)
})

test('an exact-zero raw quantity yields no order', async (t) => {
  const result = await suggestRows(t, [row({ stock: 100, transit: 0 })])
  assert.equal(result.items[0].raw_qty, 0)
  assert.equal(result.items[0].suggested_qty, 0)
})

test('the sales window changes the daily average and the suggestion', async (t) => {
  const result = await suggestRows(t, [row({ sales: 45, stock: 0, transit: 0, safety: 3, cycle: 7, moq: 12 })], 15)
  const item = result.items[0]
  assert.equal(item.window_days, 15)
  assert.equal(item.daily_avg, 3)
  assert.equal(item.target_qty, 30)
  assert.equal(item.suggested_qty, 36)
})

test('integer arithmetic keeps 3 / 30 as exactly 1 unit', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 3, stock: 0, transit: 0, safety: 0, cycle: 10, moq: 1, price: 100 }),
  ])
  assert.equal(result.items[0].daily_avg, 0.1)
  assert.equal(result.items[0].raw_qty, 1)
  assert.equal(result.items[0].suggested_qty, 1)
})

test('zero sales with no stock keeps cover/turnover null and orders nothing', async (t) => {
  const result = await suggestRows(t, [row({ sales: 0, stock: 0, transit: 0 })])
  const item = result.items[0]
  assert.equal(item.cover_days, null)
  assert.equal(item.turnover_days, null)
  assert.equal(item.slow_moving, false)
  assert.equal(item.stockout_risk, false)
  assert.equal(item.suggested_qty, 0)
})

test('the tool report on the bundled sample matches the designed totals', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const result = await suggestFor(tools)
  assert.deepEqual(result.totals, {
    rows: 16,
    stores: 2,
    unique_skus: 8,
    order_lines: 11,
    total_units: 398,
    estimated_value_cents: 476_880,
    stockout_risks: 2,
    stockout_now: 0,
    slow_moving: 1,
  })
  assert.equal(result.window_days, 30)
  assert.equal(result.items.length, 16)
  assert.deepEqual(
    result.items.slice(0, 3).map((item) => [item.store, item.sku, item.suggested_qty, item.risk_rank]),
    [
      ['上海静安店', 'SKU-SN-001', 72, 1],
      ['上海静安店', 'SKU-DA-001', 60, 1],
      ['上海静安店', 'SKU-HH-001', 60, 2],
    ],
  )
})

test('the 20-day window on the sample doubles daily averages and raises the order', () => {
  const dataset = ingestReplenishCsv(
    `${'store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents\n'}上海店,SKU-1,商品,300,20,10,3,7,24,1000\n`,
  )
  const report = buildSuggestReport(dataset, normalizePolicy({ windowDays: 20 }))
  assert.equal(report.items[0].daily_avg, 15)
  assert.equal(report.items[0].suggested_qty, 120)
  assert.equal(report.window_days, 20)
})

test('the sample source hash is stable and appears in the report', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const first = await suggestFor(tools)
  const second = await suggestFor(tools)
  assert.match(first.source_sha256, /^[0-9a-f]{64}$/)
  assert.equal(first.source_sha256, second.source_sha256)
  assert.ok(first.items.every((item) => item.window_days === 30))
  assert.equal(first.source_sha256, (await suggestFor(toolMap(path.join(await makeTemp(t), 'store')))).source_sha256)
  assert.ok(samplePath.endsWith('store-replenish.csv'))
})
