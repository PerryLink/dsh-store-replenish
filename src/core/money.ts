import { ReplenishError } from './errors.js'

const NON_NEGATIVE_INTEGER = /^\d+$/

/**
 * Parse one integer column. Thousands separators, spaces and underscores are
 * ignored. Negative, fractional, empty and out-of-range values are
 * `E_REPL_QTY`, because every such column is a quantity, day count, MOQ or
 * price in integer cents.
 */
export function parseQuantity(
  value: string,
  label: string,
  options: { min?: number; max?: number } = {},
): number {
  const min = options.min ?? 0
  const max = options.max ?? 1_000_000_000
  if (typeof value !== 'string') {
    throw new ReplenishError('E_REPL_QTY', `${label}：${JSON.stringify(value)} 不是非负整数`)
  }
  const text = value.trim().replace(/[,\s_]/g, '')
  if (!NON_NEGATIVE_INTEGER.test(text)) {
    throw new ReplenishError('E_REPL_QTY', `${label}：${JSON.stringify(value)} 不是非负整数`)
  }
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed)) {
    throw new ReplenishError('E_REPL_QTY', `${label}：${JSON.stringify(value)} 超出安全整数范围`)
  }
  if (parsed < min || parsed > max) {
    throw new ReplenishError('E_REPL_QTY', `${label}：${parsed} 不在 ${min}–${max} 范围内`)
  }
  return parsed
}

/** Render integer cents as a two-decimal amount string, e.g. 92880 -> 928.80. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(Math.trunc(cents))
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** Render integer cents with thousands separators for human-facing summaries. */
export function formatMoney(cents: number): string {
  const [whole, fraction] = formatCents(cents).split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction}`
}

/** Round a finite number to `digits` decimal places without negative zero. */
export function roundNumber(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}
