import { readFile, stat } from 'node:fs/promises'
import { ReplenishError } from './errors.js'

/** Local CSV limit: a store-SKU replenishment export should be far below this. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024

/**
 * Read the user-named CSV. A missing path, a directory, or an unreadable file is
 * `E_REPL_PATH_INVALID`; an empty file is `E_REPL_EMPTY`; an oversized file is
 * `E_REPL_CSV_ROW`.
 */
export async function readReplenishSource(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new ReplenishError('E_REPL_PATH_INVALID', 'path 为空')
  }
  const target = filePath.trim()
  let info
  try {
    info = await stat(target)
  } catch {
    throw new ReplenishError('E_REPL_PATH_INVALID', `找不到 ${JSON.stringify(target)}，或当前用户读不到`)
  }
  if (!info.isFile()) throw new ReplenishError('E_REPL_PATH_INVALID', `${JSON.stringify(target)} 不是文件`)
  if (info.size === 0) throw new ReplenishError('E_REPL_EMPTY', 'CSV 是空文件')
  if (info.size > MAX_SOURCE_BYTES) {
    throw new ReplenishError(
      'E_REPL_CSV_ROW',
      `CSV 有 ${info.size} 字节，超过 20 MB 上限；请按门店或品类拆文件`,
    )
  }
  try {
    return await readFile(target, 'utf8')
  } catch {
    throw new ReplenishError('E_REPL_PATH_INVALID', `读不了 ${JSON.stringify(target)}；确认权限后重试`)
  }
}
