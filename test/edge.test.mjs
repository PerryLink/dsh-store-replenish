import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv } from '../lib/core/csv.js'
import {
  HEADER,
  assertErrorCode,
  makeTemp,
  replenishCsv,
  row,
  samplePath,
  toolMap,
  writeReplenish,
  writeTextFile,
} from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

async function toolsWith(t) {
  return toolMap(path.join(await makeTemp(t), 'store'))
}

test('the same SKU in two stores produces two independent order lines', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'shared.csv', [
    row({ store: 'B 店', sku: 'SKU-X', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
    row({ store: 'A 店', sku: 'SKU-X', sales: 600, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  const plan = await tools['replenish_plan'].execute({ path: file }, exec)
  assert.deepEqual(plan.stores.map((store) => store.total_units), [140, 70])
  assert.equal(plan.totals.unique_skus, 1)
  assert.equal(plan.totals.order_lines, 2)
})

test('equal risk and quantity tie-break on SKU ascending', async (t) => {
  const tools = await toolsWith(t)
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'tie.csv', [
    row({ sku: 'SKU-B', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
    row({ sku: 'SKU-A', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  const suggest = await tools['replenish_suggest'].execute({ path: file }, exec)
  assert.deepEqual(suggest.items.map((item) => item.sku), ['SKU-A', 'SKU-B'])
})

test('equal store risk and amount tie-break on store name ascending', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'store-tie.csv', [
    row({ store: 'B 店', sku: 'SKU-2', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
    row({ store: 'A 店', sku: 'SKU-1', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  const plan = await tools['replenish_plan'].execute({ path: file }, exec)
  assert.deepEqual(plan.stores.map((store) => store.store), ['A 店', 'B 店'])
})

test('very large but safe quantities stay exact multiples of MOQ', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'large.csv', [
    row({
      sales: 1_000_000_000,
      stock: 0,
      transit: 0,
      safety: 3650,
      cycle: 3650,
      moq: 1_000_000,
      price: 1,
    }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  const result = await tools['replenish_suggest'].execute({ path: file, window_days: 1 }, exec)
  const item = result.items[0]
  assert.ok(Number.isSafeInteger(item.suggested_qty))
  assert.equal(item.suggested_qty % item.moq, 0)
  assert.ok(Number.isSafeInteger(item.estimated_value_cents))
})

test('a quantity times price that overflows safe integers is E_REPL_QTY', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'overflow.csv', [
    row({
      sales: 1_000_000_000,
      stock: 0,
      transit: 0,
      safety: 3650,
      cycle: 3650,
      moq: 1,
      price: 1_000_000_000,
    }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: file, window_days: 1 }, exec),
    (error) => assertErrorCode(error, 'E_REPL_QTY'),
  )
})

test('CRLF records and a BOM are accepted end to end', async (t) => {
  const dir = await makeTemp(t)
  const text = `\ufeff${HEADER}\r\n${row({ store: '上海店', sku: 'SKU-1' })}\r\n`
  const file = await writeTextFile(dir, 'crlf.csv', text)
  const tools = toolMap(path.join(dir, 'store'))
  const result = await tools['replenish_suggest'].execute({ path: file }, exec)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].store, '上海店')
  assert.equal(result.items[0].suggested_qty, 72)
})

test('all zero demand across stores yields an empty order and low risk', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'zero.csv', [
    row({ store: 'A 店', sku: 'SKU-1', sales: 0, stock: 0, transit: 0 }),
    row({ store: 'B 店', sku: 'SKU-2', sales: 0, stock: 0, transit: 0 }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  const plan = await tools['replenish_plan'].execute({ path: file }, exec)
  assert.equal(plan.totals.order_lines, 0)
  assert.equal(plan.totals.total_units, 0)
  assert.equal(plan.totals.stockout_risks, 0)
  assert.deepEqual(plan.stores.map((store) => store.risk_level), ['low', 'low'])
  await assert.rejects(
    () => tools['replenish_export'].execute({ path: file }, exec),
    (error) => assertErrorCode(error, 'E_REPL_EMPTY'),
  )
})

test('a 1-day window still computes an integer MOQ order', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'one-day.csv', [
    row({ sales: 5, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  const tools = toolMap(path.join(dir, 'store'))
  const result = await tools['replenish_suggest'].execute({ path: file, window_days: 1 }, exec)
  assert.equal(result.items[0].daily_avg, 5)
  assert.equal(result.items[0].suggested_qty, 35)
})

test('include_zero keeps stores in risk order and all SKUs inside each store', async (t) => {
  const tools = await toolsWith(t)
  const result = await tools['replenish_export'].execute(
    { path: samplePath, include_zero: true },
    exec,
  )
  const parsed = parseCsv(await readFile(result.path, 'utf8'))
  const stores = parsed.rows.slice(1).map((line) => line[0])
  assert.deepEqual(stores.slice(0, 8), Array(8).fill('上海静安店'))
  assert.deepEqual(stores.slice(8), Array(8).fill('成都高新店'))
  assert.equal(new Set(parsed.rows.slice(1).map((line) => line[1])).size, 8)
})

test('a row with only the name column missing still exports the SKU as the name', async (t) => {
  const dir = await makeTemp(t)
  const header = HEADER.replace(',name', '')
  const file = await writeReplenish(
    dir,
    'no-name.csv',
    ['测试门店,SKU-NO-NAME,300,0,0,0,7,1,100'],
    header,
  )
  const tools = toolMap(path.join(dir, 'store'))
  const result = await tools['replenish_export'].execute({ path: file }, exec)
  const parsed = parseCsv(await readFile(result.path, 'utf8'))
  assert.equal(parsed.rows[1][2], 'SKU-NO-NAME')
})

test('replenishCsv normalizes a canonical row to ten fields', () => {
  const lines = replenishCsv([row()]).trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[1].split(',').length, 10)
})
