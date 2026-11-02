import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeExportPath } from '../lib/core/safe-path.js'
import { assertErrorCode } from './helpers/fixtures.mjs'

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-store-replenish-path-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const pathError = (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID')

test('a normal export filename resolves inside the base directory and is writable', async (t) => {
  const dir = await tempDir(t)
  const file = await safeExportPath(dir, 'replenish-30d.csv')
  assert.equal(file, path.join(await realpath(dir), 'replenish-30d.csv'))
  await writeFile(file, 'store,sku\nA,1\n')
  assert.equal(await readFile(file, 'utf8'), 'store,sku\nA,1\n')
})

test('parent traversal and separators are rejected', async (t) => {
  const dir = await tempDir(t)
  for (const filename of ['../evil.csv', '..\\evil.csv', 'a/b.csv', '/etc/passwd', '', 'with space.csv', '补货单.csv']) {
    await assert.rejects(() => safeExportPath(dir, filename), pathError, filename)
  }
})

test('dot-only filenames are rejected by the resolved-prefix check', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, '.'), pathError)
  await assert.rejects(() => safeExportPath(dir, '..'), pathError)
})

test('a symlinked export directory is re-anchored on its realpath', async (t) => {
  const dir = await tempDir(t)
  const real = path.join(dir, 'real')
  const link = path.join(dir, 'link')
  await mkdir(real)
  await symlink(real, link, 'dir')
  const file = await safeExportPath(link, 'ok.csv')
  assert.ok(file.startsWith(`${await realpath(real)}${path.sep}`), file)
})

test('the filename regex accepts only safe single components', async (t) => {
  const dir = await tempDir(t)
  await assert.rejects(() => safeExportPath(dir, `${'a'.repeat(121)}.csv`), pathError)
  const file = await safeExportPath(dir, 'A-Z_0-9.ok.csv')
  assert.equal(path.basename(file), 'A-Z_0-9.ok.csv')
})

test('a non-string filename is E_REPL_PATH_INVALID', async (t) => {
  const dir = await tempDir(t)
  for (const filename of [undefined, null, 42, {}]) {
    await assert.rejects(() => safeExportPath(dir, filename), pathError, String(filename))
  }
})
