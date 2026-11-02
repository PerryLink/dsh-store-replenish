import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { packageRoot } from './helpers/fixtures.mjs'

const expectedPath = path.join(packageRoot, 'samples', 'quickstart', 'expected', 'result.json')

test('the bundled quickstart input is a real 2-store x 8-SKU CSV', async () => {
  const text = await readFile(
    path.join(packageRoot, 'samples', 'quickstart', 'input', 'store-replenish.csv'),
    'utf8',
  )
  assert.ok(
    text.startsWith(
      'store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents\n',
    ),
  )
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  assert.equal(lines.length, 17)
  assert.equal(new Set(lines.slice(1).map((line) => line.split(',')[0])).size, 2)
  assert.equal(new Set(lines.slice(1).map((line) => line.split(',')[1])).size, 8)
})

test('quickstart --check reproduces the committed golden result', () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /16 store-SKU rows, 11 order line\(s\), 398 unit\(s\), 4,768\.80/)
  assert.match(result.stdout, /上海静安店: 6 order line\(s\), 282 unit\(s\), 2,908\.20, 2 risk \(medium\)/)
  assert.match(result.stdout, /成都高新店: 5 order line\(s\), 116 unit\(s\), 1,860\.60, 0 risk \(low\)/)
  assert.match(result.stdout, /苏打饼干 400g: 72 unit\(s\), 928\.80 \[stockout risk\]/)
  assert.match(result.stdout, /slow-moving: 成都高新店 抑菌洗手液 500ml \(turnover 100 days, suggested 0\)/)
  assert.match(result.stdout, /golden samples\/quickstart\/expected\/result\.json matches/)
  assert.match(result.stdout, /quickstart ok/)
})

test('quickstart --json equals the committed golden file', async () => {
  const result = spawnSync(process.execPath, ['samples/quickstart/run.mjs', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.deepEqual(JSON.parse(result.stdout), expected)
  assert.equal(expected.policy.window_days, 30)
  assert.equal(expected.suggestions.totals.order_lines, 11)
  assert.equal(expected.plan.totals.total_units, 398)
  assert.equal(expected.exports.replenishment.rows, 11)
})

test('the golden plan and CSV preserve the documented Chinese columns', async () => {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.equal(expected.plan.stores[0].store, '上海静安店')
  assert.equal(expected.plan.stores[1].store, '成都高新店')
  assert.match(
    expected.exports.replenishment.text,
    /^门店,SKU,品名,当前库存,在途,日均销量,补货周期天数,安全天数,建议补货量,预估金额,缺货风险,滞销,周转天数\n/,
  )
  assert.match(expected.exports.replenishment.text, /上海静安店,SKU-SN-001,苏打饼干 400g,20,10,10\.00,7,3,72,928\.80,是,否,2\.0/)
  assert.equal(expected.exports.replenishment.path, 'exports/replenish-30d.csv')
  assert.equal(expected.exports.replenishment.include_zero, false)
})

test('the golden file is real JSON with all 16 items and no absolute temp paths', async () => {
  const text = await readFile(expectedPath, 'utf8')
  const expected = JSON.parse(text)
  assert.equal(expected.suggestions.items.length, 16)
  assert.equal(expected.plan.stores.length, 2)
  assert.equal(expected.suggestions.totals.stockout_risks, 2)
  assert.equal(expected.suggestions.totals.slow_moving, 1)
  assert.ok(!text.includes(osTmpPrefix()), 'golden must not leak the temporary directory')
  assert.ok(expected.exports.replenishment.path.startsWith('exports/'))
})

function osTmpPrefix() {
  return process.platform === 'win32' ? 'C:\\Users\\' : '/tmp/'
}
