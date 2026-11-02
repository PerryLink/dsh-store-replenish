import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCents, formatMoney, parseQuantity, roundNumber } from '../lib/core/money.js'
import { assertErrorCode } from './helpers/fixtures.mjs'

test('parseQuantity trims, strips separators and enforces bounds', () => {
  assert.equal(parseQuantity(' 1,234 ', 'x'), 1234)
  assert.equal(parseQuantity('1_000', 'x'), 1000)
  assert.equal(parseQuantity('0', 'x', { min: 0 }), 0)
  assert.equal(parseQuantity('10', 'x', { min: 1, max: 10 }), 10)
})

test('parseQuantity reports the label and the raw value on failure', () => {
  try {
    parseQuantity('-3', '第 4 行当前库存')
    assert.fail('expected a throw')
  } catch (error) {
    assertErrorCode(error, 'E_REPL_QTY')
    assert.match(error.message, /第 4 行当前库存/)
    assert.match(error.message, /-3/)
  }
  try {
    parseQuantity('12.5', '第 2 行销量')
    assert.fail('expected a throw')
  } catch (error) {
    assertErrorCode(error, 'E_REPL_QTY')
    assert.match(error.message, /12\.5/)
  }
})

test('parseQuantity rejects NaN-producing and unsafe values', () => {
  for (const value of ['NaN', 'Infinity', '0x10', '1,2.3', '--1']) {
    assert.throws(() => parseQuantity(value, 'x'), (error) => assertErrorCode(error, 'E_REPL_QTY'), value)
  }
  assert.throws(
    () => parseQuantity('9007199254740993', 'x'),
    (error) => assertErrorCode(error, 'E_REPL_QTY'),
  )
})

test('formatCents renders two decimals without floating point', () => {
  assert.equal(formatCents(0), '0.00')
  assert.equal(formatCents(5), '0.05')
  assert.equal(formatCents(92880), '928.80')
  assert.equal(formatCents(476880), '4768.80')
  assert.equal(formatCents(-105), '-1.05')
})

test('formatMoney adds thousands separators to the whole part only', () => {
  assert.equal(formatMoney(0), '0.00')
  assert.equal(formatMoney(476880), '4,768.80')
  assert.equal(formatMoney(100000000), '1,000,000.00')
  assert.equal(formatMoney(-123456789), '-1,234,567.89')
})

test('roundNumber controls decimals and never returns negative zero', () => {
  assert.equal(roundNumber(1.25, 1), 1.3)
  assert.equal(roundNumber(2.04, 2), 2.04)
  assert.equal(roundNumber(1.999, 2), 2)
  assert.equal(roundNumber(-0.001, 2), 0)
  assert.equal(Object.is(roundNumber(-0.001, 2), -0), false)
  assert.equal(roundNumber(Number.NaN, 2), 0)
  assert.equal(roundNumber(Number.POSITIVE_INFINITY, 2), 0)
})

test('rounding a daily average keeps display values stable', () => {
  assert.equal(roundNumber(100 / 30, 2), 3.33)
  assert.equal(roundNumber(20 / 3, 1), 6.7)
  assert.equal(roundNumber(10, 2), 10)
})
