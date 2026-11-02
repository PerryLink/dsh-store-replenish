import test from 'node:test'
import assert from 'node:assert/strict'
import { csvField, parseCsv, toCsv } from '../lib/core/csv.js'
import { assertErrorCode } from './helpers/fixtures.mjs'

test('parseCsv reads plain records and keeps 1-based physical line numbers', () => {
  const parsed = parseCsv('a,b\n1,2\n3,4\n')
  assert.deepEqual(parsed.rows, [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ])
  assert.deepEqual(parsed.lines, [1, 2, 3])
})

test('parseCsv handles quoted commas, doubled quotes and CRLF', () => {
  const parsed = parseCsv('store,note\r\n"上海, 静安店","他说 ""补货"" 了"\r\n')
  assert.deepEqual(parsed.rows[1], ['上海, 静安店', '他说 "补货" 了'])
})

test('parseCsv supports embedded newlines and counts the following line correctly', () => {
  const parsed = parseCsv('a,b\n"x\ny",z\nlast,row\n')
  assert.deepEqual(parsed.rows[1], ['x\ny', 'z'])
  assert.deepEqual(parsed.lines, [1, 2, 4])
  assert.deepEqual(parsed.rows[2], ['last', 'row'])
})

test('parseCsv strips a UTF-8 BOM and ignores blank lines', () => {
  const parsed = parseCsv('\ufeffa,b\n\n1,2\n\n')
  assert.deepEqual(parsed.rows, [
    ['a', 'b'],
    ['1', '2'],
  ])
  assert.deepEqual(parsed.lines, [1, 3])
})

test('parseCsv rejects unclosed quotes, trailing characters and NUL bytes as E_REPL_CSV_ROW', () => {
  for (const text of ['a,b\n"x,2\n', 'a,b\n"x"y,2\n', 'a,b\n1,2\0\n']) {
    assert.throws(() => parseCsv(text), (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'), JSON.stringify(text))
  }
})

test('parseCsv rejects a non-string payload', () => {
  assert.throws(() => parseCsv(42), (error) => assertErrorCode(error, 'E_REPL_CSV_ROW'))
})

test('csvField quotes only when needed and doubles embedded quotes', () => {
  assert.equal(csvField('plain'), 'plain')
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('a"b'), '"a""b"')
  assert.equal(csvField('a\nb'), '"a\nb"')
  assert.equal(csvField(''), '')
})

test('toCsv round-trips through parseCsv including CJK and commas', () => {
  const rows = [
    ['门店', 'SKU', '品名'],
    ['上海, 静安店', 'SKU-1', '苏打饼干 400g'],
    ['成都高新店', 'SKU-2', '他说 "补货"'],
  ]
  const parsed = parseCsv(toCsv(rows))
  assert.deepEqual(parsed.rows, rows)
  assert.ok(toCsv(rows).endsWith('\n'))
  assert.equal(toCsv([]), '')
})
