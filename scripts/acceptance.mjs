#!/usr/bin/env node
/**
 * Acceptance checks over the public synthetic 2-store x 8-SKU table. Writes
 * ACCEPTANCE.csv and evidence/<run_id>/result.json. No network, no store data.
 *
 *   node scripts/acceptance.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/core/csv.js'
import { createTools } from '../lib/plugin/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sample = path.join(root, 'samples', 'quickstart', 'input', 'store-replenish.csv')
const sampleHeader =
  'store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents'
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const errors = []
const WINDOW_DAYS = 30

async function errorCode(promise) {
  try {
    await promise
    return 'NO_ERROR'
  } catch (error) {
    return error?.code ?? error?.name ?? 'UNKNOWN'
  }
}

function metric(reqId, name, threshold, actual, pass) {
  return { req_id: reqId, metric: name, threshold, actual, pass }
}

async function main() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-store-replenish-acceptance-'))
  const baseDir = path.join(tempDir, 'store')
  try {
    const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'acceptance' }
    const call = (name, args) => tools[name].execute(args, exec)

    const suggest = await call('replenish.suggest', { path: sample, window_days: WINDOW_DAYS })
    const plan = await call('replenish.plan', { path: sample, window_days: WINDOW_DAYS })
    const exported = await call('replenish.export', { path: sample, window_days: WINDOW_DAYS })
    const withZero = await call('replenish.export', {
      path: sample,
      window_days: WINDOW_DAYS,
      include_zero: true,
      filename: 'acceptance-all.csv',
    })
    const shorter = await call('replenish.plan', { path: sample, window_days: 15 })

    const find = (store, sku) =>
      suggest.items.find((item) => item.store === store && item.sku === sku)
    const risky = suggest.items
      .filter((item) => item.stockout_risk)
      .map((item) => `${item.store}/${item.sku}`)
      .sort()
    const slow = suggest.items
      .filter((item) => item.slow_moving)
      .map((item) => `${item.store}/${item.sku}`)
    const stockoutNow = suggest.items.filter((item) => item.stockout_now).length

    const exportText = readFileSync(exported.path, 'utf8')
    const exportParsed = parseCsv(exportText)
    const exportHeaderOk =
      exportParsed.rows[0]?.join(',') ===
      '门店,SKU,品名,当前库存,在途,日均销量,补货周期天数,安全天数,建议补货量,预估金额,缺货风险,滞销,周转天数'
    const exportHashOk = exported.sha256 === sha256(exportText)
    const firstRow = exportParsed.rows[1] ?? []
    const firstRowExpected = [
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
    ]

    const totalsActual = `rows=${suggest.totals.rows} stores=${suggest.totals.stores} unique_skus=${suggest.totals.unique_skus} order_lines=${suggest.totals.order_lines} units=${suggest.totals.total_units} value=${suggest.totals.estimated_value_cents} risk=${suggest.totals.stockout_risks} slow=${suggest.totals.slow_moving}`

    const badQtyFile = path.join(tempDir, 'bad-qty.csv')
    writeFileSync(badQtyFile, `${sampleHeader}\n测试店,SKU-1,商品,-5,0,0,0,7,1,100\n`)
    const missingColumnFile = path.join(tempDir, 'missing-column.csv')
    writeFileSync(
      missingColumnFile,
      'store,sku,name,sales_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents\n测试店,SKU-1,商品,300,0,0,7,1,100\n',
    )
    const emptyFile = path.join(tempDir, 'empty.csv')
    writeFileSync(emptyFile, `${sampleHeader}\n`)
    const coveredFile = path.join(tempDir, 'covered.csv')
    writeFileSync(coveredFile, `${sampleHeader}\n测试店,SKU-1,商品,300,500,0,0,7,1,100\n`)

    const badQtyCode = await errorCode(call('replenish.suggest', { path: badQtyFile }))
    const missingColumnCode = await errorCode(call('replenish.suggest', { path: missingColumnFile }))
    const emptyCode = await errorCode(call('replenish.plan', { path: emptyFile }))
    const pathCode = await errorCode(
      call('replenish.export', { path: sample, filename: '../evil.csv' }),
    )
    const coveredCode = await errorCode(call('replenish.export', { path: coveredFile }))
    const coveredAll = await call('replenish.export', {
      path: coveredFile,
      include_zero: true,
      filename: 'acceptance-covered.csv',
    })

    const metrics = [
      metric(
        'AC-R01',
        'suggest totals',
        'rows=16 stores=2 unique_skus=8 order_lines=11 units=398 value=476880 risk=2 slow=1',
        totalsActual,
        totalsActual ===
          'rows=16 stores=2 unique_skus=8 order_lines=11 units=398 value=476880 risk=2 slow=1',
      ),
      metric(
        'AC-R02',
        'MOQ rounding',
        '苏打=72 牛奶=60 乌龙=30 坚果=12',
        `苏打=${find('上海静安店', 'SKU-SN-001')?.suggested_qty} 牛奶=${find('上海静安店', 'SKU-DA-001')?.suggested_qty} 乌龙=${find('上海静安店', 'SKU-SP-002')?.suggested_qty} 坚果=${find('上海静安店', 'SKU-SN-002')?.suggested_qty}`,
        find('上海静安店', 'SKU-SN-001')?.suggested_qty === 72 &&
          find('上海静安店', 'SKU-DA-001')?.suggested_qty === 60 &&
          find('上海静安店', 'SKU-SP-002')?.suggested_qty === 30 &&
          find('上海静安店', 'SKU-SN-002')?.suggested_qty === 12,
      ),
      metric(
        'AC-R03',
        'stockout and slow flags',
        'risk=上海静安店/SKU-DA-001|上海静安店/SKU-SN-001 slow=成都高新店/SKU-HH-002 now=0',
        `risk=${risky.join('|')} slow=${slow.join('|')} now=${stockoutNow}`,
        risky.join('|') === '上海静安店/SKU-DA-001|上海静安店/SKU-SN-001' &&
          slow.join('|') === '成都高新店/SKU-HH-002' &&
          stockoutNow === 0,
      ),
      metric(
        'AC-R04',
        'store aggregation',
        '上海=8/6/282/290820/2/medium 成都=8/5/116/186060/0/low',
        plan.stores
          .map(
            (store) =>
              `${store.store.slice(0, 2)}=${store.sku_count}/${store.order_lines}/${store.total_units}/${store.estimated_value_cents}/${store.stockout_risk_count}/${store.risk_level}`,
          )
          .join(' '),
        plan.stores.length === 2 &&
          plan.stores[0].store === '上海静安店' &&
          plan.stores[0].sku_count === 8 &&
          plan.stores[0].order_lines === 6 &&
          plan.stores[0].total_units === 282 &&
          plan.stores[0].estimated_value_cents === 290_820 &&
          plan.stores[0].stockout_risk_count === 2 &&
          plan.stores[0].risk_level === 'medium' &&
          plan.stores[1].store === '成都高新店' &&
          plan.stores[1].sku_count === 8 &&
          plan.stores[1].order_lines === 5 &&
          plan.stores[1].total_units === 116 &&
          plan.stores[1].estimated_value_cents === 186_060 &&
          plan.stores[1].stockout_risk_count === 0 &&
          plan.stores[1].risk_level === 'low',
      ),
      metric(
        'AC-R05',
        'store risk order',
        'order=上海静安店/成都高新店',
        `order=${plan.stores.map((store) => store.store).join('/')}`,
        plan.stores.map((store) => store.store).join('/') === '上海静安店/成都高新店',
      ),
      metric(
        'AC-R06',
        'plan equals suggest totals',
        'totals=same source=same',
        `totals=${JSON.stringify(plan.totals) === JSON.stringify(suggest.totals) ? 'same' : 'diff'} source=${plan.source_sha256 === suggest.source_sha256 ? 'same' : 'diff'}`,
        JSON.stringify(plan.totals) === JSON.stringify(suggest.totals) &&
          plan.source_sha256 === suggest.source_sha256,
      ),
      metric(
        'AC-R07',
        'replenishment CSV',
        'rows=11 lines=12 stores=2 units=398 value=476880 header=ok hash=ok',
        `rows=${exported.rows} lines=${exportParsed.rows.length} stores=${exported.stores} units=${exported.total_units} value=${exported.estimated_value_cents} header=${exportHeaderOk ? 'ok' : 'bad'} hash=${exportHashOk ? 'ok' : 'bad'}`,
        exported.rows === 11 &&
          exportParsed.rows.length === 12 &&
          exported.stores === 2 &&
          exported.total_units === 398 &&
          exported.estimated_value_cents === 476_880 &&
          exportHeaderOk &&
          exportHashOk,
      ),
      metric(
        'AC-R08',
        'include zero',
        'rows=16 slow=1',
        `rows=${withZero.rows} slow=${withZero.slow_moving_rows}`,
        withZero.rows === 16 && withZero.slow_moving_rows === 1 && withZero.order_lines === 11,
      ),
      metric(
        'AC-R09',
        '15-day window',
        'order_lines=14 units=1774 risk=13',
        `order_lines=${shorter.totals.order_lines} units=${shorter.totals.total_units} risk=${shorter.totals.stockout_risks}`,
        shorter.totals.order_lines === 14 &&
          shorter.totals.total_units === 1774 &&
          shorter.totals.stockout_risks === 13,
      ),
      metric('AC-R10', 'bad quantity', 'E_REPL_QTY', badQtyCode, badQtyCode === 'E_REPL_QTY'),
      metric(
        'AC-R11',
        'missing column',
        'E_REPL_CSV_ROW',
        missingColumnCode,
        missingColumnCode === 'E_REPL_CSV_ROW',
      ),
      metric('AC-R12', 'empty table', 'E_REPL_EMPTY', emptyCode, emptyCode === 'E_REPL_EMPTY'),
      metric(
        'AC-R13',
        'export path safety',
        'E_REPL_PATH_INVALID',
        pathCode,
        pathCode === 'E_REPL_PATH_INVALID',
      ),
      metric(
        'AC-R14',
        'no order to export',
        'E_REPL_EMPTY then rows=1',
        `${coveredCode} then rows=${coveredAll.rows}`,
        coveredCode === 'E_REPL_EMPTY' && coveredAll.rows === 1 && coveredAll.order_lines === 0,
      ),
      metric(
        'AC-R15',
        'first CSV row',
        firstRowExpected.join('|'),
        firstRow.join('|'),
        firstRow.join('|') === firstRowExpected.join('|'),
      ),
    ]

    let quickstartPass = true
    try {
      execFileSync(process.execPath, ['samples/quickstart/run.mjs', '--check'], { cwd: root, stdio: 'ignore' })
    } catch {
      quickstartPass = false
    }
    const quickstartHash = sha256(readFileSync(path.join(root, 'samples', 'quickstart', 'expected', 'result.json')))
    const quickstart = {
      req_id: 'PS1-QS01',
      metric: 'quickstart golden',
      threshold: '1/1',
      actual: quickstartPass ? '1' : '0',
      pass: quickstartPass,
      evidence_sha256: quickstartHash,
    }

    const failures = metrics.filter((item) => !item.pass)
    for (const failure of failures) errors.push(`${failure.req_id} ${failure.metric}: ${failure.actual}`)
    if (!quickstartPass) errors.push('PS1-QS01 quickstart golden failed')

    const runId = `store-replenish-${Date.now()}`
    const evidence = {
      run_id: runId,
      scope: 'STORE-REPLENISH-S1',
      status: failures.length === 0 && quickstartPass ? 'pass' : 'fail',
      counted: false,
      note: 'synthetic 2-store x 8-SKU table only; no store, product or sales data',
      metrics,
      pass: failures.length === 0 && quickstartPass,
    }
    const evidenceDir = path.join(root, 'evidence', runId)
    mkdirSync(evidenceDir, { recursive: true })
    const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`
    writeFileSync(path.join(evidenceDir, 'result.json'), evidenceJson)
    const evidenceHash = sha256(evidenceJson)

    const rows = [
      ...metrics.map(
        (item) =>
          `${item.req_id},${item.metric},${item.threshold},${item.actual},scripts/acceptance.mjs,${evidenceHash},${item.pass},public/synthetic,false`,
      ),
      `${quickstart.req_id},${quickstart.metric},${quickstart.threshold},${quickstart.actual},samples/quickstart/run.mjs,${quickstart.evidence_sha256},${quickstart.pass},synthetic/quickstart,true`,
    ]
    writeFileSync(
      path.join(root, 'ACCEPTANCE.csv'),
      `req_id,metric,threshold,actual,script,evidence_sha256,pass,source,counted\n${rows.join('\n')}\n`,
    )

    if (errors.length > 0) {
      for (const error of errors) console.error(`acceptance: ${error}`)
      process.exit(1)
    }
    console.log(`acceptance ok: ${metrics.length + 1} checks`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

await main()
