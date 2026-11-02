import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  makeTemp,
  row,
  suggestFor,
  toolMap,
  writeReplenish,
} from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

async function suggestRows(t, rows, windowDays = 30) {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'flags.csv', rows)
  const tools = toolMap(path.join(dir, 'store'))
  return tools['replenish.suggest'].execute({ path: file, window_days: windowDays }, exec)
}

test('turnover of exactly 60 days is not slow-moving, 61 days is', async (t) => {
  const atBoundary = await suggestRows(t, [row({ sales: 30, stock: 60, transit: 0, safety: 0, cycle: 7, moq: 1 })])
  assert.equal(atBoundary.items[0].turnover_days, 60)
  assert.equal(atBoundary.items[0].slow_moving, false)

  const overBoundary = await suggestRows(t, [row({ sales: 30, stock: 61, transit: 0, safety: 0, cycle: 7, moq: 1 })])
  assert.equal(overBoundary.items[0].turnover_days, 61)
  assert.equal(overBoundary.items[0].slow_moving, true)
})

test('stock on hand with no sales has null turnover and is slow-moving', async (t) => {
  const result = await suggestRows(t, [row({ sales: 0, stock: 20, transit: 0 })])
  assert.equal(result.items[0].turnover_days, null)
  assert.equal(result.items[0].slow_moving, true)
})

test('zero stock with no sales is neither slow-moving nor a stockout', async (t) => {
  const result = await suggestRows(t, [row({ sales: 0, stock: 0, transit: 0 })])
  assert.equal(result.items[0].slow_moving, false)
  assert.equal(result.items[0].stockout_now, false)
  assert.equal(result.items[0].stockout_risk, false)
})

test('stockout risk is strict at stock + in-transit == cycle demand', async (t) => {
  const exact = await suggestRows(t, [
    row({ sales: 300, stock: 70, transit: 0, safety: 5, cycle: 7, moq: 1 }),
  ])
  assert.equal(exact.items[0].stockout_risk, false)
  assert.equal(exact.items[0].suggested_qty, 50)

  const short = await suggestRows(t, [
    row({ sales: 300, stock: 69, transit: 0, safety: 5, cycle: 7, moq: 1 }),
  ])
  assert.equal(short.items[0].stockout_risk, true)
  assert.equal(short.items[0].suggested_qty, 51)
})

test('in-transit stock can remove the stockout risk but not the stockout-now flag', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 300, stock: 0, transit: 70, safety: 0, cycle: 7, moq: 1 }),
  ])
  const item = result.items[0]
  assert.equal(item.stockout_now, true)
  assert.equal(item.stockout_risk, false)
  assert.equal(item.suggested_qty, 0)
})

test('zero stock with demand is both stockout now and a stockout risk', async (t) => {
  const result = await suggestRows(t, [
    row({ sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  assert.equal(result.items[0].stockout_now, true)
  assert.equal(result.items[0].stockout_risk, true)
  assert.equal(result.items[0].risk_rank, 0)
})

test('the bundled sample has exactly 2 stockout risks and 1 slow-moving SKU', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const result = await suggestFor(tools)
  const risky = result.items.filter((item) => item.stockout_risk).map((item) => `${item.store}/${item.sku}`)
  const slow = result.items.filter((item) => item.slow_moving).map((item) => `${item.store}/${item.sku}`)
  assert.deepEqual(risky.sort(), ['上海静安店/SKU-DA-001', '上海静安店/SKU-SN-001'])
  assert.deepEqual(slow, ['成都高新店/SKU-HH-002'])
  assert.equal(result.items.filter((item) => item.stockout_now).length, 0)
})

test('cover days counts in-transit and rounds to one decimal', async (t) => {
  const result = await suggestRows(t, [row({ sales: 300, stock: 20, transit: 10 })])
  assert.equal(result.items[0].cover_days, 3)
})

test('flags do not change the quantity formula', async (t) => {
  const result = await suggestRows(t, [row({ sales: 300, stock: 80, transit: 0, safety: 3, cycle: 7, moq: 24 })])
  assert.equal(result.items[0].slow_moving, false)
  assert.equal(result.items[0].stockout_risk, false)
  assert.equal(result.items[0].suggested_qty, 24)
})

test('risk rank orders stockout now before risk before ordinary order', async (t) => {
  const result = await suggestRows(t, [
    row({ sku: 'SKU-OK', sales: 300, stock: 80, transit: 0, safety: 5, cycle: 7, moq: 1 }),
    row({ sku: 'SKU-RISK', sales: 300, stock: 10, transit: 0, safety: 3, cycle: 7, moq: 1 }),
    row({ sku: 'SKU-NOW', sales: 300, stock: 0, transit: 0, safety: 3, cycle: 7, moq: 1 }),
  ])
  assert.deepEqual(
    result.items.map((item) => [item.sku, item.risk_rank]),
    [
      ['SKU-NOW', 0],
      ['SKU-RISK', 1],
      ['SKU-OK', 2],
    ],
  )
})
