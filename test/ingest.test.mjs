import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  CHINESE_HEADER,
  HEADER,
  assertErrorCode,
  replenishCsv,
  row,
  samplePath,
} from './helpers/fixtures.mjs'
import { ingestReplenishCsv } from '../lib/core/replenish.js'

test('the bundled sample is a real 2-store x 8-SKU table', async () => {
  const text = await readFile(samplePath, 'utf8')
  const dataset = ingestReplenishCsv(text)
  assert.equal(dataset.rows, 16)
  assert.equal(dataset.stores.length, 2)
  assert.deepEqual(dataset.stores, ['上海静安店', '成都高新店'])
  assert.equal(dataset.uniqueSkus.length, 8)
  assert.equal(dataset.sourceSha256, createHash('sha256').update(text).digest('hex'))
  assert.ok(text.startsWith(`${HEADER}\n`))
})

test('the canonical header and Chinese aliases parse the same number of rows', () => {
  const canonical = ingestReplenishCsv(replenishCsv([row()], HEADER))
  const chinese = ingestReplenishCsv(replenishCsv([row()], CHINESE_HEADER))
  assert.equal(canonical.rows, 1)
  assert.equal(chinese.rows, 1)
  assert.equal(chinese.skus[0].salesQty, 300)
  assert.equal(chinese.skus[0].unitPriceCents, 1000)
})

test('a missing required column is E_REPL_CSV_ROW and names it', () => {
  const header = HEADER.replace(',stock_qty', '')
  assert.throws(
    () => ingestReplenishCsv(`a,b\n1,2\n`),
    (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'),
  )
  assert.throws(
    () => ingestReplenishCsv(replenishCsv([], header)),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /当前库存/)
      return true
    },
  )
})

test('a duplicated recognized header column is E_REPL_CSV_ROW', () => {
  const header = `${HEADER},store`
  assert.throws(
    () => ingestReplenishCsv(`store,sku,store\nA,B,C\n`),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /表头里 门店 出现了两次/)
      return true
    },
  )
  assert.throws(
    () => ingestReplenishCsv(replenishCsv([], header)),
    (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'),
  )
})

test('an unknown extra column is ignored', () => {
  const header = `${HEADER},备注`
  const dataset = ingestReplenishCsv(replenishCsv([`${row()},随便写`], header))
  assert.equal(dataset.rows, 1)
  assert.equal(dataset.skus[0].name, '测试商品')
})

test('the optional name column falls back to the SKU code', () => {
  const header = HEADER.replace(',name', '')
  const dataset = ingestReplenishCsv(
    replenishCsv(['测试门店,SKU-X,300,20,10,3,7,24,1000'], header),
  )
  assert.equal(dataset.skus[0].name, 'SKU-X')
})

test('empty store, empty SKU and duplicate store-SKU pairs are E_REPL_CSV_ROW', () => {
  assert.throws(
    () => ingestReplenishCsv(replenishCsv([row({ store: '' })])),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /门店为空/)
      return true
    },
  )
  assert.throws(
    () => ingestReplenishCsv(replenishCsv([row({ sku: '  ' })])),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /SKU 为空/)
      return true
    },
  )
  assert.throws(
    () => ingestReplenishCsv(replenishCsv([row(), row()])),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /第 3 行门店 测试门店 的 SKU SKU-T-001 重复/)
      return true
    },
  )
})

test('the same SKU may appear in two different stores', () => {
  const dataset = ingestReplenishCsv(
    replenishCsv([row({ store: 'A' }), row({ store: 'B' })]),
  )
  assert.equal(dataset.rows, 2)
  assert.deepEqual(dataset.stores, ['A', 'B'])
  assert.deepEqual(dataset.uniqueSkus, ['SKU-T-001'])
})

test('a row with the wrong number of columns is E_REPL_CSV_ROW', () => {
  const text = replenishCsv(['测试门店,SKU-T-001,测试商品,300,20,10,3,7,24'])
  assert.throws(
    () => ingestReplenishCsv(text),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /列/)
      return true
    },
  )
})

test('empty input and header-only input are E_REPL_EMPTY', () => {
  assert.throws(() => ingestReplenishCsv(''), (error) => assertErrorCode(error, 'E_REPL_EMPTY'))
  assert.throws(
    () => ingestReplenishCsv(`${HEADER}\n`),
    (error) => assertErrorCode(error, 'E_REPL_EMPTY'),
  )
  assert.throws(() => ingestReplenishCsv('\n\n'), (error) => assertErrorCode(error, 'E_REPL_EMPTY'))
})

test('a UTF-8 BOM before the header is accepted', () => {
  const dataset = ingestReplenishCsv(`\ufeff${replenishCsv([row()])}`)
  assert.equal(dataset.rows, 1)
  assert.equal(dataset.skus[0].store, '测试门店')
})
