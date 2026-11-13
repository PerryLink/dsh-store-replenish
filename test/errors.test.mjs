import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { ReplenishError, replenishErrorMessage } from '../lib/core/errors.js'
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
const CODES = ['E_REPL_QTY', 'E_REPL_CSV_ROW', 'E_REPL_EMPTY', 'E_REPL_PATH_INVALID']

test('every stable code carries a human sentence, next action and optional detail', () => {
  for (const code of CODES) {
    const message = replenishErrorMessage(code, 'detail-x')
    assert.match(message, new RegExp(`（${code}）`))
    assert.match(message, /｜下一步：/)
    assert.match(message, /｜细节：detail-x/)
    assert.match(message, /^[^（]+（E_REPL_/)
  }
})

test('ReplenishError exposes code, name and the formatted message', () => {
  const error = new ReplenishError('E_REPL_QTY', 'moq=0')
  assert.equal(error.code, 'E_REPL_QTY')
  assert.equal(error.name, 'ReplenishError')
  assert.match(error.message, /E_REPL_QTY/)
  assert.match(error.message, /moq=0/)
  assert.ok(error instanceof Error)
})

test('each code has different human wording', () => {
  const texts = CODES.map((code) => replenishErrorMessage(code).split('（')[0])
  assert.equal(new Set(texts).size, CODES.length)
})

test('all four codes are reachable through the public tools', async (t) => {
  const dir = await makeTemp(t)
  const tools = toolMap(path.join(dir, 'store'))
  const suggest = (overrides = {}) => tools['replenish_suggest'].execute({ path: samplePath, ...overrides }, exec)

  const badQty = await writeReplenish(dir, 'bad-qty.csv', [row({ sales: -5 })])
  const missingColumn = await writeReplenish(
    dir,
    'missing-column.csv',
    [row()],
    HEADER.replace(',stock_qty', ''),
  )
  const headerOnly = await writeReplenish(dir, 'header.csv', [])

  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: badQty }, exec),
    (error) => assertErrorCode(error, 'E_REPL_QTY'),
  )
  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: missingColumn }, exec),
    (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'),
  )
  await assert.rejects(
    () => tools['replenish_plan'].execute({ path: headerOnly }, exec),
    (error) => assertErrorCode(error, 'E_REPL_EMPTY'),
  )
  await assert.rejects(
    () => tools['replenish_export'].execute({ path: samplePath, filename: '../x.csv' }, exec),
    (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'),
  )
  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: path.join(dir, 'missing.csv') }, exec),
    (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'),
  )
  assert.ok(suggest)
})

test('error messages name the offending physical CSV line where relevant', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'rows.csv', [row(), row({ sku: 'SKU-T-002', sales: -1 })])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: file }, exec),
    (error) => {
      assert.match(error.message, /第 3 行销量/)
      return true
    },
  )
})

test('a header-only CSV reports E_REPL_EMPTY rather than a row error', async (t) => {
  const dir = await makeTemp(t)
  const file = await writeReplenish(dir, 'header-only.csv', [])
  const tools = toolMap(path.join(dir, 'store'))
  await assert.rejects(
    () => tools['replenish_suggest'].execute({ path: file }, exec),
    (error) => {
      assertErrorCode(error, 'E_REPL_EMPTY')
      assert.match(error.message, /只有表头/)
      return true
    },
  )
  assert.ok(replenishCsv([]).startsWith(HEADER))
})
