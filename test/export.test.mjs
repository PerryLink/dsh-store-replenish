import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv } from '../lib/core/csv.js'
import { REPLENISH_EXPORT_HEADER, defaultExportFilename } from '../lib/core/export.js'
import {
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
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function setup(t) {
  const dir = await makeTemp(t)
  const baseDir = path.join(dir, 'store')
  return { dir, baseDir, tools: toolMap(baseDir) }
}

test('the default export writes 11 order lines with the fixed 13-column header', async (t) => {
  const { baseDir, tools } = await setup(t)
  const result = await tools['replenish.export'].execute({ path: samplePath, window_days: 30 }, exec)
  assert.equal(result.filename, 'replenish-30d.csv')
  assert.equal(defaultExportFilename(30), 'replenish-30d.csv')
  assert.equal(result.rows, 11)
  assert.equal(result.stores, 2)
  assert.equal(result.order_lines, 11)
  assert.equal(result.total_units, 398)
  assert.equal(result.estimated_value_cents, 476_880)
  assert.equal(result.stockout_risk_rows, 2)
  assert.equal(result.slow_moving_rows, 0)
  assert.equal(result.include_zero, false)
  assert.ok(result.path.startsWith(`${baseDir}${path.sep}exports${path.sep}`), result.path)

  const text = await readFile(result.path, 'utf8')
  assert.equal(result.sha256, sha256(text))
  assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'))
  const parsed = parseCsv(text)
  assert.deepEqual(parsed.rows[0], [...REPLENISH_EXPORT_HEADER])
  assert.equal(parsed.rows.length, 12)
  assert.deepEqual(parsed.rows[1], [
    '上海静安店',
    'SKU-SN-001',
    '苏打饼干 400g',
    '20',
    '10',
    '10.00',
    '7',
    '3',
    '72',
    '928.80',
    '是',
    '否',
    '2.0',
  ])
  assert.deepEqual(parsed.rows.at(-1), [
    '成都高新店',
    'SKU-PT-001',
    '成猫粮 2kg',
    '8',
    '8',
    '2.00',
    '7',
    '3',
    '10',
    '690.00',
    '否',
    '否',
    '4.0',
  ])
})

test('include_zero=true exports all 16 SKUs and exposes the slow-moving row', async (t) => {
  const { tools } = await setup(t)
  const result = await tools['replenish.export'].execute(
    { path: samplePath, window_days: 30, include_zero: true },
    exec,
  )
  assert.equal(result.rows, 16)
  assert.equal(result.order_lines, 11)
  assert.equal(result.slow_moving_rows, 1)
  assert.equal(result.total_units, 398)
  const parsed = parseCsv(await readFile(result.path, 'utf8'))
  assert.equal(parsed.rows.length, 17)
  const slow = parsed.rows.find((line) => line[1] === 'SKU-HH-002' && line[0] === '成都高新店')
  assert.deepEqual(slow, [
    '成都高新店',
    'SKU-HH-002',
    '抑菌洗手液 500ml',
    '20',
    '0',
    '0.20',
    '10',
    '5',
    '0',
    '0.00',
    '否',
    '是',
    '100.0',
  ])
})

test('a custom filename is honoured and the returned hash matches the file', async (t) => {
  const { baseDir, tools } = await setup(t)
  const result = await tools['replenish.export'].execute(
    { path: samplePath, window_days: 30, filename: 'my-order.csv' },
    exec,
  )
  assert.equal(result.filename, 'my-order.csv')
  assert.equal(path.basename(result.path), 'my-order.csv')
  assert.ok(result.path.startsWith(baseDir))
  assert.equal(result.sha256, sha256(await readFile(result.path, 'utf8')))
})

test('the export rejects traversal, absolute paths and unsafe names', async (t) => {
  const { tools } = await setup(t)
  for (const filename of ['../evil.csv', '../../evil.csv', '/tmp/evil.csv', 'a/b.csv', 'with space.csv', '补货单.csv']) {
    await assert.rejects(
      () => tools['replenish.export'].execute({ path: samplePath, filename }, exec),
      (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'),
      filename,
    )
  }
})

test('a second export to the same file overwrites it deterministically', async (t) => {
  const { tools } = await setup(t)
  const first = await tools['replenish.export'].execute({ path: samplePath }, exec)
  const second = await tools['replenish.export'].execute({ path: samplePath }, exec)
  assert.equal(first.path, second.path)
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.bytes, second.bytes)
})

test('a 15-day window uses a 15d filename and more order lines', async (t) => {
  const { tools } = await setup(t)
  const result = await tools['replenish.export'].execute({ path: samplePath, window_days: 15 }, exec)
  assert.equal(result.filename, 'replenish-15d.csv')
  assert.equal(result.rows, 14)
  assert.equal(result.total_units, 1774)
})

test('an all-covered dataset is E_REPL_EMPTY unless include_zero=true', async (t) => {
  const { dir, tools } = await setup(t)
  const file = await writeReplenish(dir, 'covered.csv', [
    row({ sales: 300, stock: 500, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  await assert.rejects(
    () => tools['replenish.export'].execute({ path: file }, exec),
    (error) => assertErrorCode(error, 'E_REPL_EMPTY'),
  )
  const result = await tools['replenish.export'].execute({ path: file, include_zero: true }, exec)
  assert.equal(result.rows, 1)
  assert.equal(result.order_lines, 0)
  assert.equal(result.total_units, 0)
  assert.equal(result.include_zero, true)
})

test('store and product names with commas are RFC 4180 quoted', async (t) => {
  const { dir, tools } = await setup(t)
  const file = await writeTextFile(
    dir,
    'comma.csv',
    'store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents\n' +
      '"上海, 静安店",SKU-1,"苏打饼干, 400g",300,0,0,0,7,1,1000\n',
  )
  const result = await tools['replenish.export'].execute({ path: file, filename: 'comma.csv' }, exec)
  const parsed = parseCsv(await readFile(result.path, 'utf8'))
  assert.equal(parsed.rows[1][0], '上海, 静安店')
  assert.equal(parsed.rows[1][2], '苏打饼干, 400g')
  assert.match(await readFile(result.path, 'utf8'), /"上海, 静安店"/)
})

test('replenishmentCsv refuses an empty order without include_zero', async () => {
  const { replenishmentCsv } = await import('../lib/core/export.js')
  const emptyPlan = {
    window_days: 30,
    source_sha256: 'x',
    totals: {
      rows: 0,
      stores: 0,
      unique_skus: 0,
      order_lines: 0,
      total_units: 0,
      estimated_value_cents: 0,
      stockout_risks: 0,
      stockout_now: 0,
      slow_moving: 0,
    },
    stores: [],
  }
  assert.throws(() => replenishmentCsv(emptyPlan), (error) => assertErrorCode(error, 'E_REPL_EMPTY'))
  assert.throws(() => replenishmentCsv(emptyPlan, true), (error) => assertErrorCode(error, 'E_REPL_EMPTY'))
})

test('the CSV body is deterministic across two identical runs', async (t) => {
  const { dir, tools } = await setup(t)
  const file = await writeReplenish(dir, 'stable.csv', [
    row({ store: 'B 店', sku: 'SKU-2', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
    row({ store: 'A 店', sku: 'SKU-1', sales: 300, stock: 0, transit: 0, safety: 0, cycle: 7, moq: 1 }),
  ])
  const first = await tools['replenish.export'].execute({ path: file, filename: 'stable.csv' }, exec)
  const second = await tools['replenish.export'].execute({ path: file, filename: 'stable.csv' }, exec)
  assert.equal(first.sha256, second.sha256)
  const parsed = parseCsv(await readFile(first.path, 'utf8'))
  assert.deepEqual(parsed.rows.slice(1).map((line) => line[0]), ['A 店', 'B 店'])
})
