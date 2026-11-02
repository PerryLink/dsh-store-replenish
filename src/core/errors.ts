/** Stable, user-facing failure codes for dsh-store-replenish. */
export type ReplenishErrorCode =
  | 'E_REPL_QTY'
  | 'E_REPL_CSV_ROW'
  | 'E_REPL_EMPTY'
  | 'E_REPL_PATH_INVALID'

interface HumanMessage {
  text: string
  next: string
}

const REPLENISH_HUMAN: Record<ReplenishErrorCode, HumanMessage> = {
  E_REPL_QTY: {
    text: '数量、天数、起订量或单价不是非负整数，或起订量为 0',
    next: '把销量/库存/在途/安全天数/补货周期/起订量/单价都填成整数，起订量至少 1',
  },
  E_REPL_CSV_ROW: {
    text: '补货 CSV 有一行读不了：表头、列数或门店-SKU 不合规',
    next: '对照表头检查这一行：门店、SKU、品名、销量、当前库存、在途、安全天数、补货周期、起订量、单价分',
  },
  E_REPL_EMPTY: {
    text: '没有可用的补货数据：表是空的，或没有需要补货的 SKU',
    next: '确认 CSV 有数据行；只想看全部 SKU 时传 include_zero=true',
  },
  E_REPL_PATH_INVALID: {
    text: '文件路径或导出文件名不可用',
    next: '传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名',
  },
}

/** `one plain sentence（E_REPL_XXX）｜下一步：one action｜细节：detail` — what the end user sees. */
export function replenishErrorMessage(code: ReplenishErrorCode, detail?: string): string {
  const human = REPLENISH_HUMAN[code]
  return `${human.text}（${code}）｜下一步：${human.next}${detail ? `｜细节：${detail}` : ''}`
}

export class ReplenishError extends Error {
  readonly code: ReplenishErrorCode

  constructor(code: ReplenishErrorCode, detail?: string) {
    super(replenishErrorMessage(code, detail))
    this.name = 'ReplenishError'
    this.code = code
  }
}
