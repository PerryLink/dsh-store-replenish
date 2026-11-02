import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ReplenishError } from './errors.js'

/** A single export filename component: no separators, no whitespace, max 120 chars. */
export const SAFE_EXPORT_FILENAME = /^[A-Za-z0-9._-]{1,120}$/

/**
 * Resolve a caller-supplied export filename inside the plugin's exports folder.
 * The filename must be one safe component and the resolved path must stay below
 * `realpath(baseDir)`, so neither traversal nor a symlink can redirect the write.
 */
export async function safeExportPath(baseDir: string, filename: string): Promise<string> {
  if (typeof filename !== 'string' || !SAFE_EXPORT_FILENAME.test(filename)) {
    throw new ReplenishError('E_REPL_PATH_INVALID', `导出文件名不安全：${JSON.stringify(filename)}`)
  }
  const base = path.resolve(baseDir)
  const candidate = path.resolve(base, filename)
  if (!candidate.startsWith(base + path.sep)) {
    throw new ReplenishError('E_REPL_PATH_INVALID', `导出路径越过了导出目录：${JSON.stringify(filename)}`)
  }
  await mkdir(base, { recursive: true })
  const realBase = await realpath(base)
  const realCandidate = path.resolve(realBase, filename)
  if (!realCandidate.startsWith(realBase + path.sep)) {
    throw new ReplenishError('E_REPL_PATH_INVALID', `realpath 之后导出路径越界：${JSON.stringify(filename)}`)
  }
  return realCandidate
}
