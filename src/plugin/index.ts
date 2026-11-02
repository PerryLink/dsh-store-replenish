import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createTools } from './tools.js'

export const name = 'dsh-store-replenish'
export const inject = ['tools']

/** Local write root: `$DSH_STORE_REPLENISH_HOME`, else `$DSH_HOME/dsh-store-replenish`. */
export function resolveBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DSH_STORE_REPLENISH_HOME?.trim()
  if (override) return override
  const dshHome = env.DSH_HOME?.trim()
  return path.join(dshHome || process.cwd(), 'dsh-store-replenish')
}

export async function apply(ctx: Context): Promise<void> {
  for (const tool of createTools({ baseDir: resolveBaseDir() })) ctx.tools.register(tool)
}
