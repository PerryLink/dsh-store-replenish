import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { parseQuantity } from '../lib/core/money.js'
import { ingestReplenishCsv, normalizePolicy } from '../lib/core/replenish.js'
import {
  HEADER,
  assertErrorCode,
  makeTemp,
  replenishCsv,
  row,
  samplePath,
  toolMap,
  writeReplenish,
} from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

async function rejectRow(t, overrides, label = '') {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'bad.csv', [row(overrides)])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () => tools['replenish.suggest'].execute({ path: file }, exec),
    (error) => assertErrorCode(error, 'E_REPL_QTY'),
    label || JSON.stringify(overrides),
  )
}

test('parseQuantity accepts non-negative integers and ignores grouping separators', () => {
  assert.equal(parseQuantity('0', 'x'), 0)
  assert.equal(parseQuantity('128', 'x'), 128)
  assert.equal(parseQuantity(' 1,200 ', 'x'), 1200)
  assert.equal(parseQuantity('1_000', 'x'), 1000)
  assert.equal(parseQuantity('30', 'x', { min: 1, max: 3650 }), 30)
})

test('parseQuantity rejects negative, fractional, empty and out-of-range values', () => {
  for (const value of ['-1', '-', '1.5', '1e3', 'abc', '', '  ']) {
    assert.throws(() => parseQuantity(value, 'x'), (error) => assertErrorCode(error, 'E_REPL_QTY'), value)
  }
  assert.throws(() => parseQuantity('0', 'x', { min: 1 }), (error) => assertErrorCode(error, 'E_REPL_QTY'))
  assert.throws(() => parseQuantity('3651', 'x', { max: 3650 }), (error) => assertErrorCode(error, 'E_REPL_QTY'))
  assert.throws(
    () => parseQuantity('99999999999999999999', 'x'),
    (error) => assertErrorCode(error, 'E_REPL_QTY'),
  )
})

test('negative sales, stock or in-transit quantities are E_REPL_QTY', async (t) => {
  await rejectRow(t, { sales: -1 }, 'negative sales')
  await rejectRow(t, { stock: -5 }, 'negative stock')
  await rejectRow(t, { transit: -2 }, 'negative in-transit')
  await rejectRow(t, { stock: '-0.5' }, 'fractional stock')
})

test('fractional or missing numeric cells are E_REPL_QTY and name the CSV line', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'fraction.csv', [row(), row({ sku: 'SKU-T-002', sales: '12.5' })])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () => tools['replenish.suggest'].execute({ path: file }, exec),
    (error) => {
      assertErrorCode(error, 'E_REPL_QTY')
      assert.match(error.message, /第 3 行销量/)
      assert.match(error.message, /12\.5/)
      return true
    },
  )
  await rejectRow(t, { sales: '' }, 'empty sales')
  await rejectRow(t, { safety: '5.5' }, 'fractional safety days')
  await rejectRow(t, { cycle: -7 }, 'negative cycle')
})

test('MOQ must be at least 1 and day counts stay within 3650', async (t) => {
  await rejectRow(t, { moq: 0 }, 'moq zero')
  await rejectRow(t, { moq: -24 }, 'moq negative')
  await rejectRow(t, { safety: 3651 }, 'safety too large')
  await rejectRow(t, { cycle: 3651 }, 'cycle too large')
})

test('unit price must be a non-negative integer number of cents', async (t) => {
  await rejectRow(t, { price: -1 }, 'negative price')
  await rejectRow(t, { price: '9.9' }, 'fractional price')
  await rejectRow(t, { price: '' }, 'empty price')
})

test('zero is valid for sales, stock, in-transit, safety days, cycle days and price', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'zero.csv', [row({ sales: 0, stock: 0, transit: 0, safety: 0, cycle: 0, price: 0 })])
  const tools = toolMap(path.join(dir, 'store'))
  const result = await tools['replenish.suggest'].execute({ path: file }, exec)
  assert.equal(result.items[0].suggested_qty, 0)
  assert.equal(result.items[0].daily_avg, 0)
  assert.equal(result.items[0].stockout_risk, false)
})

test('normalizePolicy defaults to 30 days and validates its window', () => {
  assert.equal(normalizePolicy().windowDays, 30)
  assert.equal(normalizePolicy({}).windowDays, 30)
  assert.equal(normalizePolicy({ windowDays: 1 }).windowDays, 1)
  assert.equal(normalizePolicy({ windowDays: 3650 }).windowDays, 3650)
  for (const windowDays of [0, -1, 1.5, 3651, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizePolicy({ windowDays }),
      (error) => assertErrorCode(error, 'E_REPL_QTY'),
      String(windowDays),
    )
  }
})

test('the tool rejects an invalid window_days before touching the CSV', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  for (const window_days of [0, 1.5, -30, 4000]) {
    await assert.rejects(
      () => tools['replenish.suggest'].execute({ path: samplePath, window_days }, exec),
      (error) => assertErrorCode(error, 'E_REPL_QTY'),
      String(window_days),
    )
  }
})

test('the header is validated before any row value', () => {
  assert.throws(
    () => ingestReplenishCsv('store,sku\nA,B\n'),
    (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'),
  )
  assert.equal(ingestReplenishCsv(replenishCsv([row()], HEADER)).rows, 1)
})
