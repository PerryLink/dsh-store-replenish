import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toCsv } from './csv.js'
import { ReplenishError } from './errors.js'
import { formatCents } from './money.js'
import type { PlanReport, ReplenishItem, StorePlan } from './replenish.js'
import { safeExportPath } from './safe-path.js'

/** Fixed replenishment-order columns; the order is part of the public contract. */
export const REPLENISH_EXPORT_HEADER = [
  '门店',
  'SKU',
  '品名',
  '当前库存',
  '在途',
  '日均销量',
  '补货周期天数',
  '安全天数',
  '建议补货量',
  '预估金额',
  '缺货风险',
  '滞销',
  '周转天数',
] as const

export interface ReplenishExportResult {
  path: string
  filename: string
  sha256: string
  bytes: number
  rows: number
  stores: number
  order_lines: number
  total_units: number
  estimated_value_cents: number
  stockout_risk_rows: number
  slow_moving_rows: number
  include_zero: boolean
}

function formatFlag(value: boolean): string {
  return value ? '是' : '否'
}

function formatTurnover(item: ReplenishItem): string {
  return item.turnover_days === null ? '∞' : item.turnover_days.toFixed(1)
}

function itemRow(item: ReplenishItem): string[] {
  return [
    item.store,
    item.sku,
    item.name,
    String(item.stock_qty),
    String(item.in_transit),
    item.daily_avg.toFixed(2),
    String(item.cycle_days),
    String(item.safety_days),
    String(item.suggested_qty),
    formatCents(item.estimated_value_cents),
    formatFlag(item.stockout_risk),
    formatFlag(item.slow_moving),
    formatTurnover(item),
  ]
}

function exportedItems(store: StorePlan, includeZero: boolean): ReplenishItem[] {
  return includeZero ? store.items : store.items.filter((item) => item.replenish_needed)
}

/**
 * Build the replenishment-order CSV. Only SKUs with a positive suggested
 * quantity are exported by default; `includeZero=true` appends every remaining
 * SKU so a reviewer can see why nothing was ordered. Stores keep the plan's
 * stockout-risk order, and each store's rows keep its risk-first item order.
 */
export function replenishmentCsv(plan: PlanReport, includeZero = false): string {
  const rows: string[][] = [[...REPLENISH_EXPORT_HEADER]]
  for (const store of plan.stores) {
    for (const item of exportedItems(store, includeZero)) rows.push(itemRow(item))
  }
  if (rows.length === 1) {
    throw new ReplenishError('E_REPL_EMPTY', '没有需要补货的 SKU；要导出全部 SKU 请传 include_zero=true')
  }
  return toCsv(rows)
}

/** Write the replenishment-order CSV under `exportsDir` and return its metadata. */
export async function writeReplenishExport(
  plan: PlanReport,
  exportsDir: string,
  filename: string,
  includeZero = false,
): Promise<ReplenishExportResult> {
  const csv = replenishmentCsv(plan, includeZero)
  let filePath: string
  try {
    filePath = await safeExportPath(exportsDir, filename)
  } catch (error) {
    if (error instanceof ReplenishError) throw error
    throw new ReplenishError('E_REPL_PATH_INVALID', String(error))
  }
  try {
    await writeFile(filePath, csv, 'utf8')
  } catch (error) {
    throw new ReplenishError('E_REPL_PATH_INVALID', `写补货单失败：${String(error)}`)
  }

  const items = plan.stores.flatMap((store) => exportedItems(store, includeZero))
  const stores = new Set(items.map((item) => item.store)).size
  return {
    path: filePath,
    filename,
    sha256: createHash('sha256').update(csv).digest('hex'),
    bytes: Buffer.byteLength(csv, 'utf8'),
    rows: items.length,
    stores,
    order_lines: items.filter((item) => item.replenish_needed).length,
    total_units: items.reduce((sum, item) => sum + item.suggested_qty, 0),
    estimated_value_cents: items.reduce((sum, item) => sum + item.estimated_value_cents, 0),
    stockout_risk_rows: items.filter((item) => item.stockout_risk).length,
    slow_moving_rows: items.filter((item) => item.slow_moving).length,
    include_zero: includeZero,
  }
}

/** Default safe filename for a replenishment export. */
export function defaultExportFilename(windowDays: number): string {
  return `replenish-${windowDays}d.csv`
}

/** Expose the resolved export path helper to tests without duplicating rules. */
export function exportPathFor(exportsDir: string, filename: string): string {
  return path.join(exportsDir, filename)
}
