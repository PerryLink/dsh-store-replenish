import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../../lib/plugin/tools.js'

export const HEADER =
  'store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents'
export const CHINESE_HEADER = '门店,SKU,品名,销量,当前库存,在途,安全天数,补货周期,起订量,单价分'
export const WINDOW_DAYS = 30
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const samplePath = path.join(packageRoot, 'samples', 'quickstart', 'input', 'store-replenish.csv')

/** A canonical sample row; override any field to build a focused fixture. */
export function row(overrides = {}) {
  const value = {
    store: '测试门店',
    sku: 'SKU-T-001',
    name: '测试商品',
    sales: 300,
    stock: 20,
    transit: 10,
    safety: 3,
    cycle: 7,
    moq: 24,
    price: 1000,
    ...overrides,
  }
  return [
    value.store,
    value.sku,
    value.name,
    value.sales,
    value.stock,
    value.transit,
    value.safety,
    value.cycle,
    value.moq,
    value.price,
  ].join(',')
}

export function replenishCsv(rows, header = HEADER) {
  return `${header}\n${rows.join('\n')}\n`
}

export async function makeTemp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-store-replenish-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

export async function writeTextFile(dir, name, content) {
  const file = path.join(dir, name)
  await writeFile(file, content)
  return file
}

export async function writeReplenish(dir, name, rows, header = HEADER) {
  return writeTextFile(dir, name, replenishCsv(rows, header))
}

export function toolMap(baseDir) {
  return Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
}

export const exec = { callId: 'test' }

export function assertErrorCode(error, code) {
  assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`)
  assert.match(error.message, new RegExp(`${code}`))
  assert.match(error.message, /下一步：/)
  return true
}

export async function suggestFor(tools, overrides = {}) {
  return tools['replenish_suggest'].execute(
    { path: samplePath, window_days: WINDOW_DAYS, ...overrides },
    exec,
  )
}

export async function planFor(tools, overrides = {}) {
  return tools['replenish_plan'].execute(
    { path: samplePath, window_days: WINDOW_DAYS, ...overrides },
    exec,
  )
}
