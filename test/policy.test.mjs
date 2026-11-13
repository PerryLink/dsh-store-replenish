import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS, normalizePolicy } from '../lib/core/replenish.js'
import { assertErrorCode, makeTemp, samplePath, toolMap } from './helpers/fixtures.mjs'

const exec = { callId: 'test' }

test('policy defaults and bounds are documented constants', () => {
  assert.equal(DEFAULT_WINDOW_DAYS, 30)
  assert.equal(MAX_WINDOW_DAYS, 3650)
  assert.deepEqual(normalizePolicy(), { windowDays: 30 })
  assert.deepEqual(normalizePolicy({ windowDays: undefined }), { windowDays: 30 })
  assert.deepEqual(normalizePolicy({ windowDays: 7 }), { windowDays: 7 })
})

test('every tool applies the requested window consistently', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const suggest = await tools['replenish_suggest'].execute({ path: samplePath, window_days: 15 }, exec)
  const plan = await tools['replenish_plan'].execute({ path: samplePath, window_days: 15 }, exec)
  const exported = await tools['replenish_export'].execute({ path: samplePath, window_days: 15 }, exec)
  assert.equal(suggest.window_days, 15)
  assert.equal(plan.window_days, 15)
  assert.equal(exported.filename, 'replenish-15d.csv')
  assert.ok(suggest.items.every((item) => item.window_days === 15))
})

test('plan totals are exactly the suggestion totals', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const suggest = await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  const plan = await tools['replenish_plan'].execute({ path: samplePath }, exec)
  assert.deepEqual(plan.totals, suggest.totals)
  assert.equal(plan.source_sha256, suggest.source_sha256)
})

test('an invalid window is rejected by suggest, plan and export', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  for (const name of ['replenish_suggest', 'replenish_plan', 'replenish_export']) {
    await assert.rejects(
      () => tools[name].execute({ path: samplePath, window_days: 0 }, exec),
      (error) => assertErrorCode(error, 'E_REPL_QTY'),
      name,
    )
  }
})

test('omitting window_days uses the 30-day default everywhere', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const suggest = await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  const exported = await tools['replenish_export'].execute({ path: samplePath }, exec)
  assert.equal(suggest.window_days, 30)
  assert.equal(exported.filename, 'replenish-30d.csv')
  assert.equal(exported.total_units, 398)
})

test('a shorter window raises risk counts because one cycle covers more demand', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const month = await tools['replenish_plan'].execute({ path: samplePath }, exec)
  const half = await tools['replenish_plan'].execute({ path: samplePath, window_days: 15 }, exec)
  assert.equal(month.totals.stockout_risks, 2)
  assert.equal(half.totals.stockout_risks, 13)
  assert.ok(half.totals.total_units > month.totals.total_units)
})

test('a shorter window raises the run rate and can clear slow-moving flags', async (t) => {
  const tools = toolMap(path.join(await makeTemp(t), 'store'))
  const month = await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  const half = await tools['replenish_suggest'].execute({ path: samplePath, window_days: 15 }, exec)
  assert.equal(month.totals.slow_moving, 1)
  assert.equal(half.totals.slow_moving, 0)
  assert.ok(half.totals.total_units > month.totals.total_units)
})
