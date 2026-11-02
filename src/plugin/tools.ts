import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildPlanReport,
  buildSuggestReport,
  ingestReplenishCsv,
  normalizePolicy,
  type PlanReport,
  type SuggestReport,
} from '../core/replenish.js'
import {
  defaultExportFilename,
  writeReplenishExport,
  type ReplenishExportResult,
} from '../core/export.js'
import { formatMoney } from '../core/money.js'
import { readReplenishSource } from '../core/source.js'

export interface ToolDeps {
  /** Local write root; the plugin uses `$DSH_HOME/dsh-store-replenish`. */
  baseDir: string
}

const text = (value: string) => [{ type: 'text' as const, text: value }]

const policyParameters = {
  path: { type: 'string' as const, required: true as const },
  window_days: { type: 'number' as const },
}

interface PolicyArgs {
  path: string
  window_days?: number
}

const itemSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    store: { type: 'string' as const, required: true },
    sku: { type: 'string' as const, required: true },
    name: { type: 'string' as const, required: true },
    window_days: { type: 'number' as const, required: true },
    sales_qty: { type: 'number' as const, required: true },
    stock_qty: { type: 'number' as const, required: true },
    in_transit: { type: 'number' as const, required: true },
    safety_days: { type: 'number' as const, required: true },
    cycle_days: { type: 'number' as const, required: true },
    moq: { type: 'number' as const, required: true },
    unit_price_cents: { type: 'number' as const, required: true },
    daily_avg: { type: 'number' as const, required: true },
    cover_days: {
      oneOf: [{ type: 'number' as const }, { type: 'null' as const }],
      required: true,
    },
    turnover_days: {
      oneOf: [{ type: 'number' as const }, { type: 'null' as const }],
      required: true,
    },
    target_qty: { type: 'number' as const, required: true },
    raw_qty: { type: 'number' as const, required: true },
    suggested_qty: { type: 'number' as const, required: true },
    estimated_value_cents: { type: 'number' as const, required: true },
    replenish_needed: { type: 'boolean' as const, required: true },
    slow_moving: { type: 'boolean' as const, required: true },
    stockout_risk: { type: 'boolean' as const, required: true },
    stockout_now: { type: 'boolean' as const, required: true },
    risk_rank: { type: 'number' as const, required: true },
  },
} as const

const totalsSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: true,
  properties: {
    rows: { type: 'number' as const, required: true },
    stores: { type: 'number' as const, required: true },
    unique_skus: { type: 'number' as const, required: true },
    order_lines: { type: 'number' as const, required: true },
    total_units: { type: 'number' as const, required: true },
    estimated_value_cents: { type: 'number' as const, required: true },
    stockout_risks: { type: 'number' as const, required: true },
    stockout_now: { type: 'number' as const, required: true },
    slow_moving: { type: 'number' as const, required: true },
  },
} as const

const suggestSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    window_days: { type: 'number' as const, required: true },
    source_sha256: { type: 'string' as const, required: true },
    totals: totalsSchema,
    items: { type: 'array' as const, required: true, items: itemSchema },
  },
} as const

const storeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    store: { type: 'string' as const, required: true },
    sku_count: { type: 'number' as const, required: true },
    order_lines: { type: 'number' as const, required: true },
    total_units: { type: 'number' as const, required: true },
    estimated_value_cents: { type: 'number' as const, required: true },
    stockout_risk_count: { type: 'number' as const, required: true },
    stockout_now_count: { type: 'number' as const, required: true },
    slow_moving_count: { type: 'number' as const, required: true },
    risk_level: { type: 'string' as const, required: true, enum: ['high', 'medium', 'low'] },
    items: { type: 'array' as const, required: true, items: itemSchema },
  },
} as const

const planSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    window_days: { type: 'number' as const, required: true },
    source_sha256: { type: 'string' as const, required: true },
    totals: totalsSchema,
    stores: { type: 'array' as const, required: true, items: storeSchema },
  },
} as const

const exportSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    path: { type: 'string' as const, required: true },
    filename: { type: 'string' as const, required: true },
    sha256: { type: 'string' as const, required: true },
    bytes: { type: 'number' as const, required: true },
    rows: { type: 'number' as const, required: true },
    stores: { type: 'number' as const, required: true },
    order_lines: { type: 'number' as const, required: true },
    total_units: { type: 'number' as const, required: true },
    estimated_value_cents: { type: 'number' as const, required: true },
    stockout_risk_rows: { type: 'number' as const, required: true },
    slow_moving_rows: { type: 'number' as const, required: true },
    include_zero: { type: 'boolean' as const, required: true },
  },
} as const

async function loadSuggest(args: PolicyArgs): Promise<SuggestReport> {
  const text = await readReplenishSource(args.path)
  const dataset = ingestReplenishCsv(text)
  const policy = normalizePolicy({ windowDays: args.window_days })
  return buildSuggestReport(dataset, policy)
}

async function loadPlan(args: PolicyArgs): Promise<PlanReport> {
  return buildPlanReport(await loadSuggest(args))
}

export function createTools(deps: ToolDeps) {
  const suggest = defineTool({
    name: 'replenish.suggest',
    description:
      'Suggest a replenishment quantity per store-SKU from a local CSV (store, sku, name, sales_qty, stock_qty, in_transit, safety_days, cycle_days, moq, unit_price_cents). Formula: ceil((daily average × (cycle_days + safety_days) − stock − in-transit) / moq) × moq, or 0 when stock already covers the target. Flags slow-moving SKUs (turnover > 60 days) and stockout risk (stock + in-transit cannot cover one replenishment cycle). Read-only.',
    parameters: policyParameters,
    output: {
      schema: suggestSchema,
      render: (_args, value: SuggestReport) =>
        text(
          `replenishment suggestions (${value.window_days}d): ${value.totals.rows} store-SKU row(s), ${value.totals.order_lines} order line(s), ${value.totals.total_units} unit(s), ${formatMoney(value.totals.estimated_value_cents)}; ${value.totals.stockout_risks} stockout risk(s), ${value.totals.slow_moving} slow-moving`,
        ),
    },
    async execute(args) {
      return loadSuggest(args)
    },
  })

  const plan = defineTool({
    name: 'replenish.plan',
    description:
      'Aggregate replenishment suggestions into one order per store: SKU count, order lines, total units and estimated amount, with stores ranked by stockout risk (current stockout, then stockout-risk count, then amount). Returns each store with its per-SKU items. Read-only.',
    parameters: policyParameters,
    output: {
      schema: planSchema,
      render: (_args, value: PlanReport) =>
        text(
          `replenishment plan (${value.window_days}d): ${value.totals.stores} store(s), ${value.totals.order_lines} order line(s), ${value.totals.total_units} unit(s), ${formatMoney(value.totals.estimated_value_cents)}; first ${value.stores[0]?.store ?? '(none)'}`,
        ),
    },
    async execute(args) {
      return loadPlan(args)
    },
  })

  const exportTool = defineTool({
    name: 'replenish.export',
    description:
      'Write the replenishment order as CSV under $DSH_HOME/dsh-store-replenish/exports with columns 门店/SKU/品名/当前库存/在途/日均销量/补货周期天数/安全天数/建议补货量/预估金额/缺货风险/滞销/周转天数. Only SKUs with a positive suggested quantity are written unless include_zero=true. Stores follow the stockout-risk order. Returns path, sha256, bytes and row counts.',
    parameters: {
      ...policyParameters,
      filename: { type: 'string' as const },
      include_zero: { type: 'boolean' as const },
    },
    output: {
      schema: exportSchema,
      render: (_args, value: ReplenishExportResult) =>
        text(`replenishment CSV ${value.rows} row(s) -> ${value.path} (sha256 ${value.sha256.slice(0, 12)}...)`),
    },
    async execute(args) {
      const planReport = await loadPlan(args)
      const filename = args.filename ?? defaultExportFilename(planReport.window_days)
      return writeReplenishExport(
        planReport,
        path.join(deps.baseDir, 'exports'),
        filename,
        args.include_zero ?? false,
      )
    },
  })

  return [suggest, plan, exportTool]
}
