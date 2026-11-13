import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  makeTemp,
  planFor,
  row,
  samplePath,
  toolMap,
  writeReplenish,
} from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

async function planRows(t, rows, windowDays = 30) {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'plan.csv', rows)
  const tools = toolMap(path.join(dir, 'store'))
  return tools['replenish_plan'].execute({ path: file, window_days: windowDays }, exec)
}

test('the sample plan aggregates 6 Shanghai lines and 5 Chengdu lines', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const plan = await planFor(tools)
  assert.equal(plan.totals.stores, 2)
  assert.deepEqual(
    plan.stores.map((store) => [
      store.store,
      store.sku_count,
      store.order_lines,
      store.total_units,
      store.estimated_value_cents,
      store.stockout_risk_count,
      store.stockout_now_count,
      store.slow_moving_count,
      store.risk_level,
    ]),
    [
      ['上海静安店', 8, 6, 282, 290_820, 2, 0, 0, 'medium'],
      ['成都高新店', 8, 5, 116, 186_060, 0, 0, 1, 'low'],
    ],
  )
  assert.equal(plan.totals.order_lines, 11)
  assert.equal(plan.totals.total_units, 398)
  assert.equal(plan.totals.estimated_value_cents, 476_880)
  assert.equal(plan.totals.stockout_risks, 2)
  assert.equal(plan.totals.slow_moving, 1)
  assert.equal(plan.stores[0].items.length, 8)
  assert.equal(plan.stores[0].items.filter((item) => item.replenish_needed).length, 6)
})

test('stores are sorted by current stockout, then risk count, then amount, then name', async (t) => {
  const plan = await planRows(t, [
    row({ store: 'A 单-risk', sku: 'SKU-1', sales: 300, stock: 10, transit: 0, safety: 0, cycle: 7, moq: 1, price: 100 }),
    row({ store: 'B 双-risk', sku: 'SKU-2', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1, price: 100 }),
    row({ store: 'B 双-risk', sku: 'SKU-3', sales: 300, stock: 10, transit: 0, safety: 0, cycle: 7, moq: 1, price: 100 }),
    row({ store: 'C 无-risk', sku: 'SKU-4', sales: 300, stock: 80, transit: 0, safety: 5, cycle: 7, moq: 1, price: 100_000 }),
  ])
  assert.deepEqual(
    plan.stores.map((store) => [store.store, store.stockout_risk_count, store.estimated_value_cents]),
    [
      ['B 双-risk', 2, 13_000],
      ['A 单-risk', 1, 6_000],
      ['C 无-risk', 0, 4_000_000],
    ],
  )
  assert.deepEqual(
    plan.stores.map((store) => store.risk_level),
    ['high', 'medium', 'low'],
  )
  assert.equal(plan.totals.stockout_risks, 3)
  assert.equal(plan.totals.order_lines, 4)
})

test('a current stockout outranks a risk-only store even when it orders nothing', async (t) => {
  const plan = await planRows(t, [
    row({ store: 'A 有风险', sku: 'SKU-1', sales: 300, stock: 10, transit: 0, safety: 0, cycle: 7, moq: 1, price: 100 }),
    row({ store: 'Z 已断货', sku: 'SKU-2', sales: 300, stock: 0, transit: 100, safety: 0, cycle: 7, moq: 1, price: 100 }),
  ])
  assert.equal(plan.stores[0].store, 'Z 已断货')
  assert.equal(plan.stores[0].stockout_now_count, 1)
  assert.equal(plan.stores[0].stockout_risk_count, 0)
  assert.equal(plan.stores[0].risk_level, 'high')
  assert.equal(plan.stores[0].order_lines, 0)
  assert.equal(plan.stores[1].risk_level, 'medium')
})

test('store totals equal the sum of their item quantities and values', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const plan = await planFor(tools)
  for (const store of plan.stores) {
    assert.equal(store.sku_count, store.items.length)
    assert.equal(store.total_units, store.items.reduce((sum, item) => sum + item.suggested_qty, 0))
    assert.equal(
      store.estimated_value_cents,
      store.items.reduce((sum, item) => sum + item.estimated_value_cents, 0),
    )
    assert.equal(store.order_lines, store.items.filter((item) => item.replenish_needed).length)
    assert.equal(store.stockout_risk_count, store.items.filter((item) => item.stockout_risk).length)
    assert.equal(store.slow_moving_count, store.items.filter((item) => item.slow_moving).length)
  }
})

test('within a store, risk items come before ordinary order lines', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const plan = await planFor(tools)
  const shanghai = plan.stores[0]
  assert.deepEqual(
    shanghai.items.slice(0, 4).map((item) => [item.sku, item.risk_rank, item.suggested_qty]),
    [
      ['SKU-SN-001', 1, 72],
      ['SKU-DA-001', 1, 60],
      ['SKU-HH-001', 2, 60],
      ['SKU-SP-001', 2, 48],
    ],
  )
})

test('a 15-day window re-scales the sample plan', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const plan = await planFor(tools, { window_days: 15 })
  assert.equal(plan.window_days, 15)
  assert.equal(plan.totals.total_units, 1774)
  assert.equal(plan.totals.order_lines, 14)
  assert.equal(plan.stores[0].total_units, 1246)
  assert.equal(plan.stores[1].total_units, 528)
})

test('the plan keeps the sample source hash and window', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const suggest = await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  const plan = await planFor(tools)
  assert.equal(plan.source_sha256, suggest.source_sha256)
  assert.equal(plan.window_days, suggest.window_days)
  assert.equal(plan.totals.rows, 16)
  assert.equal(plan.totals.unique_skus, 8)
})
