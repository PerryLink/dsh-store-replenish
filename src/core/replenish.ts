import { createHash } from 'node:crypto'
import { parseCsv } from './csv.js'
import { ReplenishError } from './errors.js'
import { parseQuantity, roundNumber } from './money.js'

/** Default sales window: the CSV holds cumulative sales for this many days. */
export const DEFAULT_WINDOW_DAYS = 30
/** Upper bound for the window and for day-count columns. */
export const MAX_WINDOW_DAYS = 3650
/** Above this many days of stock on hand an SKU is flagged slow-moving. */
export const SLOW_MOVING_TURNOVER_DAYS = 60

export type HeaderKey =
  | 'store'
  | 'sku'
  | 'name'
  | 'sales_qty'
  | 'stock_qty'
  | 'in_transit'
  | 'safety_days'
  | 'cycle_days'
  | 'moq'
  | 'unit_price_cents'

export const HEADER_LABELS: Record<HeaderKey, string> = {
  store: '门店',
  sku: 'SKU',
  name: '品名',
  sales_qty: '销量',
  stock_qty: '当前库存',
  in_transit: '在途',
  safety_days: '安全天数',
  cycle_days: '补货周期天数',
  moq: '起订量',
  unit_price_cents: '单价分',
}

const HEADER_ORDER: HeaderKey[] = [
  'store',
  'sku',
  'name',
  'sales_qty',
  'stock_qty',
  'in_transit',
  'safety_days',
  'cycle_days',
  'moq',
  'unit_price_cents',
]

/** `name` is the only optional column: without it the SKU code is used. */
const REQUIRED_KEYS: HeaderKey[] = HEADER_ORDER.filter((key) => key !== 'name')

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  store: ['store', 'store_code', 'storecode', 'shop', '门店', '门店编码', '门店名称'],
  sku: ['sku', 'sku_code', 'skucode', 'item', 'item_code', '商品编码', '商品代码', '货号'],
  name: ['name', 'product_name', 'productname', 'product', '品名', '商品名称', '商品名'],
  sales_qty: ['sales_qty', 'salesqty', 'sales', 'qty_sold', 'recent_sales', '销量', '销量件', '近30天销量', '近期销量', '销售数量'],
  stock_qty: ['stock_qty', 'stockqty', 'stock', 'on_hand', 'inventory', '当前库存', '当前库存件', '库存', '库存件', '现有库存'],
  in_transit: ['in_transit', 'intransit', 'in_transit_qty', 'transit', '在途', '在途件', '在途库存', '在途数量'],
  safety_days: ['safety_days', 'safetydays', 'safety_stock_days', 'safety', '安全库存天数', '安全天数', '安全库存天', '安全库存'],
  cycle_days: ['cycle_days', 'cycledays', 'lead_time_days', 'leadtime', 'cycle', '补货周期天数', '补货周期天', '补货周期', '补货间隔天数'],
  moq: ['moq', 'min_order_qty', 'minorderqty', 'minimum_order_quantity', '起订量', '起订量件', '最小起订量', '起订件数'],
  unit_price_cents: ['unit_price_cents', 'unitpricecents', 'price_cents', 'unit_price', 'price', '单价分', '单价', '商品单价'],
}

/** Case/space/underscore/paren-insensitive header key, e.g. `当前库存(件)` -> `当前库存件`. */
function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-（）()]/g, '')
}

const ALIAS_TO_KEY = new Map<string, HeaderKey>()
for (const key of HEADER_ORDER) {
  for (const alias of HEADER_ALIASES[key]) ALIAS_TO_KEY.set(normalizeHeader(alias), key)
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** One validated store-SKU row. `line` is the 1-based physical CSV line. */
export interface ReplenishSku {
  store: string
  sku: string
  name: string
  salesQty: number
  stockQty: number
  inTransit: number
  safetyDays: number
  cycleDays: number
  moq: number
  unitPriceCents: number
  line: number
}

export interface ReplenishDataset {
  skus: ReplenishSku[]
  rows: number
  stores: string[]
  uniqueSkus: string[]
  sourceSha256: string
}

/**
 * Validate and normalize a store-SKU sales/inventory CSV. Header aliases are
 * accepted; a store-SKU pair may appear only once. Every numeric cell is a
 * non-negative integer (MOQ at least 1), otherwise `E_REPL_QTY`.
 */
export function ingestReplenishCsv(text: string): ReplenishDataset {
  const parsed = parseCsv(text)
  if (parsed.rows.length === 0) throw new ReplenishError('E_REPL_EMPTY', 'CSV 是空的，没有表头')

  const header = parsed.rows[0]!
  const positions = new Map<HeaderKey, number>()
  for (let index = 0; index < header.length; index += 1) {
    const key = ALIAS_TO_KEY.get(normalizeHeader(header[index]!))
    if (!key) continue
    if (positions.has(key)) {
      throw new ReplenishError('E_REPL_CSV_ROW', `表头里 ${HEADER_LABELS[key]} 出现了两次`)
    }
    positions.set(key, index)
  }
  const missing = REQUIRED_KEYS.filter((key) => !positions.has(key))
  if (missing.length > 0) {
    throw new ReplenishError(
      'E_REPL_CSV_ROW',
      `表头缺少：${missing.map((key) => HEADER_LABELS[key]).join('、')}`,
    )
  }
  if (parsed.rows.length === 1) throw new ReplenishError('E_REPL_EMPTY', '只有表头，没有数据行')

  const skus: ReplenishSku[] = []
  const seen = new Set<string>()

  for (let index = 1; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index]!
    const line = parsed.lines[index]!
    if (row.length !== header.length) {
      throw new ReplenishError(
        'E_REPL_CSV_ROW',
        `第 ${line} 行有 ${row.length} 列，表头有 ${header.length} 列`,
      )
    }
    const value = (key: HeaderKey): string => row[positions.get(key)!]!

    const store = value('store').trim()
    if (store === '') throw new ReplenishError('E_REPL_CSV_ROW', `第 ${line} 行门店为空`)
    const sku = value('sku').trim()
    if (sku === '') throw new ReplenishError('E_REPL_CSV_ROW', `第 ${line} 行 SKU 为空`)
    const key = `${store}\u0000${sku}`
    if (seen.has(key)) {
      throw new ReplenishError('E_REPL_CSV_ROW', `第 ${line} 行门店 ${store} 的 SKU ${sku} 重复`)
    }
    seen.add(key)

    const name = positions.has('name') ? value('name').trim() || sku : sku
    const salesQty = parseQuantity(value('sales_qty'), `第 ${line} 行${HEADER_LABELS.sales_qty}`)
    const stockQty = parseQuantity(value('stock_qty'), `第 ${line} 行${HEADER_LABELS.stock_qty}`)
    const inTransit = parseQuantity(value('in_transit'), `第 ${line} 行${HEADER_LABELS.in_transit}`)
    const safetyDays = parseQuantity(value('safety_days'), `第 ${line} 行${HEADER_LABELS.safety_days}`, {
      max: MAX_WINDOW_DAYS,
    })
    const cycleDays = parseQuantity(value('cycle_days'), `第 ${line} 行${HEADER_LABELS.cycle_days}`, {
      max: MAX_WINDOW_DAYS,
    })
    const moq = parseQuantity(value('moq'), `第 ${line} 行${HEADER_LABELS.moq}`, { min: 1, max: 1_000_000 })
    const unitPriceCents = parseQuantity(
      value('unit_price_cents'),
      `第 ${line} 行${HEADER_LABELS.unit_price_cents}`,
    )

    skus.push({
      store,
      sku,
      name,
      salesQty,
      stockQty,
      inTransit,
      safetyDays,
      cycleDays,
      moq,
      unitPriceCents,
      line,
    })
  }

  const stores = [...new Set(skus.map((entry) => entry.store))].sort(compareText)
  const uniqueSkus = [...new Set(skus.map((entry) => entry.sku))].sort(compareText)
  return {
    skus,
    rows: skus.length,
    stores,
    uniqueSkus,
    sourceSha256: createHash('sha256').update(text).digest('hex'),
  }
}

export interface ReplenishPolicyInput {
  /** Days of cumulative sales held in the `sales_qty` column. Default 30. */
  windowDays?: number
}

export interface ReplenishPolicy {
  windowDays: number
}

/** Normalize the sales window; a negative or fractional value is `E_REPL_QTY`. */
export function normalizePolicy(input: ReplenishPolicyInput = {}): ReplenishPolicy {
  const value = input.windowDays ?? DEFAULT_WINDOW_DAYS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_WINDOW_DAYS) {
    throw new ReplenishError(
      'E_REPL_QTY',
      `统计窗口 window_days 必须是 1–${MAX_WINDOW_DAYS} 的整数，收到 ${JSON.stringify(value)}`,
    )
  }
  return { windowDays: value }
}

export interface ReplenishItem {
  store: string
  sku: string
  name: string
  window_days: number
  sales_qty: number
  stock_qty: number
  in_transit: number
  safety_days: number
  cycle_days: number
  moq: number
  unit_price_cents: number
  daily_avg: number
  cover_days: number | null
  turnover_days: number | null
  target_qty: number
  raw_qty: number
  suggested_qty: number
  estimated_value_cents: number
  replenish_needed: boolean
  slow_moving: boolean
  stockout_risk: boolean
  stockout_now: boolean
  risk_rank: number
}

/**
 * Turn one store-SKU row into a suggestion.
 *
 * daily average = sales_qty / window_days
 * target        = daily average × (cycle_days + safety_days)
 * raw           = target − stock_qty − in_transit
 * suggested     = ceil(raw / moq) × moq, or 0 when raw <= 0
 *
 * The MOQ rounding uses integer arithmetic so an exact multiple is never pushed
 * to the next case by floating-point drift. `stockout_risk` means stock plus
 * in-transit cannot cover demand until the next replenishment arrives
 * (`available < daily average × cycle_days`). `slow_moving` means stock on hand
 * would last more than 60 days at the current run rate.
 */
export function analyseSku(entry: ReplenishSku, windowDays: number): ReplenishItem {
  const dailyAvgExact = entry.salesQty / windowDays
  const turnoverExact = dailyAvgExact > 0 ? entry.stockQty / dailyAvgExact : null
  const slowMoving = entry.stockQty > 0 && (turnoverExact === null || turnoverExact > SLOW_MOVING_TURNOVER_DAYS)
  const stockoutNow = dailyAvgExact > 0 && entry.stockQty === 0
  const stockoutRisk =
    dailyAvgExact > 0 &&
    (entry.stockQty + entry.inTransit) * windowDays < entry.salesQty * entry.cycleDays

  const numerator =
    entry.salesQty * (entry.cycleDays + entry.safetyDays) -
    (entry.stockQty + entry.inTransit) * windowDays
  const denominator = windowDays * entry.moq
  const suggestedQty = numerator <= 0 ? 0 : Math.ceil(numerator / denominator) * entry.moq
  const estimatedValueCents = suggestedQty * entry.unitPriceCents
  if (!Number.isSafeInteger(estimatedValueCents)) {
    throw new ReplenishError(
      'E_REPL_QTY',
      `第 ${entry.line} 行建议补货 ${suggestedQty} × 单价 ${entry.unitPriceCents} 分超出安全整数范围`,
    )
  }

  const item: ReplenishItem = {
    store: entry.store,
    sku: entry.sku,
    name: entry.name,
    window_days: windowDays,
    sales_qty: entry.salesQty,
    stock_qty: entry.stockQty,
    in_transit: entry.inTransit,
    safety_days: entry.safetyDays,
    cycle_days: entry.cycleDays,
    moq: entry.moq,
    unit_price_cents: entry.unitPriceCents,
    daily_avg: roundNumber(dailyAvgExact, 2),
    cover_days:
      dailyAvgExact > 0 ? roundNumber((entry.stockQty + entry.inTransit) / dailyAvgExact, 1) : null,
    turnover_days: turnoverExact === null ? null : roundNumber(turnoverExact, 1),
    target_qty: roundNumber(dailyAvgExact * (entry.cycleDays + entry.safetyDays), 2),
    raw_qty: roundNumber(
      dailyAvgExact * (entry.cycleDays + entry.safetyDays) - entry.stockQty - entry.inTransit,
      2,
    ),
    suggested_qty: suggestedQty,
    estimated_value_cents: estimatedValueCents,
    replenish_needed: suggestedQty > 0,
    slow_moving: slowMoving,
    stockout_risk: stockoutRisk,
    stockout_now: stockoutNow,
    risk_rank: 4,
  }
  item.risk_rank = stockoutNow ? 0 : stockoutRisk ? 1 : item.replenish_needed ? 2 : slowMoving ? 3 : 4
  return item
}

/** Ordering used by both tools: store, then stockout/slow flags, then quantity. */
export function compareItems(left: ReplenishItem, right: ReplenishItem): number {
  return (
    compareText(left.store, right.store) ||
    left.risk_rank - right.risk_rank ||
    right.suggested_qty - left.suggested_qty ||
    compareText(left.sku, right.sku)
  )
}

export interface ReplenishTotals {
  rows: number
  stores: number
  unique_skus: number
  order_lines: number
  total_units: number
  estimated_value_cents: number
  stockout_risks: number
  stockout_now: number
  slow_moving: number
}

export interface SuggestReport {
  window_days: number
  source_sha256: string
  totals: ReplenishTotals
  items: ReplenishItem[]
}

function totalsFor(items: ReplenishItem[], storeCount: number, uniqueSkuCount: number): ReplenishTotals {
  return {
    rows: items.length,
    stores: storeCount,
    unique_skus: uniqueSkuCount,
    order_lines: items.filter((item) => item.replenish_needed).length,
    total_units: items.reduce((sum, item) => sum + item.suggested_qty, 0),
    estimated_value_cents: items.reduce((sum, item) => sum + item.estimated_value_cents, 0),
    stockout_risks: items.filter((item) => item.stockout_risk).length,
    stockout_now: items.filter((item) => item.stockout_now).length,
    slow_moving: items.filter((item) => item.slow_moving).length,
  }
}

/** Build the flat per-SKU suggestion report. `items` is stable and sorted. */
export function buildSuggestReport(dataset: ReplenishDataset, policy: ReplenishPolicy): SuggestReport {
  const items = dataset.skus
    .map((entry) => analyseSku(entry, policy.windowDays))
    .sort(compareItems)
  return {
    window_days: policy.windowDays,
    source_sha256: dataset.sourceSha256,
    totals: totalsFor(items, dataset.stores.length, dataset.uniqueSkus.length),
    items,
  }
}

export type RiskLevel = 'high' | 'medium' | 'low'

export interface StorePlan {
  store: string
  sku_count: number
  order_lines: number
  total_units: number
  estimated_value_cents: number
  stockout_risk_count: number
  stockout_now_count: number
  slow_moving_count: number
  risk_level: RiskLevel
  items: ReplenishItem[]
}

export interface PlanReport {
  window_days: number
  source_sha256: string
  totals: ReplenishTotals
  stores: StorePlan[]
}

/**
 * Aggregate suggestions into one replenishment order per store. Stores with
 * stockouts rank first, then stores with more stockout risks, then larger
 * estimated value, then name. Within a store the safest-to-order items keep the
 * same risk-first ordering as `replenish.suggest`.
 */
export function buildPlanReport(report: SuggestReport): PlanReport {
  const byStore = new Map<string, ReplenishItem[]>()
  for (const item of report.items) {
    const bucket = byStore.get(item.store)
    if (bucket) bucket.push(item)
    else byStore.set(item.store, [item])
  }

  const stores: StorePlan[] = [...byStore.entries()].map(([store, items]) => {
    const stockoutNowCount = items.filter((item) => item.stockout_now).length
    const stockoutRiskCount = items.filter((item) => item.stockout_risk).length
    return {
      store,
      sku_count: items.length,
      order_lines: items.filter((item) => item.replenish_needed).length,
      total_units: items.reduce((sum, item) => sum + item.suggested_qty, 0),
      estimated_value_cents: items.reduce((sum, item) => sum + item.estimated_value_cents, 0),
      stockout_risk_count: stockoutRiskCount,
      stockout_now_count: stockoutNowCount,
      slow_moving_count: items.filter((item) => item.slow_moving).length,
      risk_level: stockoutNowCount > 0 ? 'high' : stockoutRiskCount > 0 ? 'medium' : 'low',
      items,
    }
  })

  stores.sort(
    (left, right) =>
      right.stockout_now_count - left.stockout_now_count ||
      right.stockout_risk_count - left.stockout_risk_count ||
      right.estimated_value_cents - left.estimated_value_cents ||
      compareText(left.store, right.store),
  )

  return {
    window_days: report.window_days,
    source_sha256: report.source_sha256,
    totals: report.totals,
    stores,
  }
}
