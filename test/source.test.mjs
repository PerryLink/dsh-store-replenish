import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_SOURCE_BYTES, readReplenishSource } from '../lib/core/source.js'
import { assertErrorCode, makeTemp } from './helpers/fixtures.mjs'

test('readReplenishSource reads a normal UTF-8 file unchanged', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'ok.csv')
  await writeFile(file, 'store,sku\n上海店,SKU-1\n')
  assert.equal(await readReplenishSource(file), 'store,sku\n上海店,SKU-1\n')
})

test('a missing path, an empty path and a directory are E_REPL_PATH_INVALID', async (t) => {
  const dir = await makeTemp(t)
  await assert.rejects(
    () => readReplenishSource(path.join(dir, 'missing.csv')),
    (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'),
  )
  await assert.rejects(() => readReplenishSource('   '), (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'))
  await mkdir(path.join(dir, 'folder'))
  await assert.rejects(
    () => readReplenishSource(path.join(dir, 'folder')),
    (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'),
  )
})

test('a non-string path is E_REPL_PATH_INVALID', async () => {
  await assert.rejects(() => readReplenishSource(undefined), (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'))
  await assert.rejects(() => readReplenishSource(42), (error) => assertErrorCode(error, 'E_REPL_PATH_INVALID'))
})

test('an empty file is E_REPL_EMPTY', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'empty.csv')
  await writeFile(file, '')
  await assert.rejects(() => readReplenishSource(file), (error) => assertErrorCode(error, 'E_REPL_EMPTY'))
})

test('a file above the 20 MB limit is E_REPL_CSV_ROW', async (t) => {
  const dir = await makeTemp(t)
  const file = path.join(dir, 'big.csv')
  const handle = await open(file, 'w')
  await handle.truncate(MAX_SOURCE_BYTES + 1)
  await handle.close()
  await assert.rejects(
    () => readReplenishSource(file),
    (error) => {
      assertErrorCode(error, 'E_REPL_CSV_ROW')
      assert.match(error.message, /20 MB/)
      return true
    },
  )
})
