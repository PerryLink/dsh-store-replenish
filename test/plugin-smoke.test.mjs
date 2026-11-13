import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../lib/plugin/index.js'
import { createTools } from '../lib/plugin/tools.js'
import { samplePath } from './helpers/fixtures.mjs'

const baseDir = path.join(os.tmpdir(), 'dsh-store-replenish-smoke')
const exec = { callId: 'test' }

test('createTools exposes the three replenish_* tools with unique names', () => {
  const tools = createTools({ baseDir })
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['replenish_suggest', 'replenish_plan', 'replenish_export'],
  )
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 3)
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('replenish_'))
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.ok(tool.parameters.required.includes('path'))
  }
})

test('resolveBaseDir defaults to $DSH_HOME/dsh-store-replenish and honours the override', () => {
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home' }),
    path.join('/tmp/dsh-home', 'dsh-store-replenish'),
  )
  assert.equal(
    plugin.resolveBaseDir({ DSH_HOME: '/tmp/dsh-home', DSH_STORE_REPLENISH_HOME: '/tmp/replenish-home' }),
    '/tmp/replenish-home',
  )
  assert.equal(plugin.name, 'dsh-store-replenish')
  assert.deepEqual(plugin.inject, ['tools'])
})

test('apply() registers all three tools and writes the CSV under the override', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-store-replenish-apply-'))
  const previous = process.env.DSH_STORE_REPLENISH_HOME
  process.env.DSH_STORE_REPLENISH_HOME = dir
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_STORE_REPLENISH_HOME
    else process.env.DSH_STORE_REPLENISH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  })

  const registered = []
  await plugin.apply({ tools: { register(tool) { registered.push(tool) } } })
  assert.equal(registered.length, 3)

  const exporter = registered.find((tool) => tool.name === 'replenish_export')
  const result = await exporter.execute({ path: samplePath }, exec)
  assert.equal(result.rows, 11)
  assert.ok(result.path.startsWith(`${dir}${path.sep}exports${path.sep}`))
  assert.match(await readFile(result.path, 'utf8'), /^门店,SKU,品名/)
})

test('every tool render returns exactly one text block', async (t) => {
  const tools = Object.fromEntries(createTools({ baseDir }).map((tool) => [tool.name, tool]))
  const suggest = await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  const plan = await tools['replenish_plan'].execute({ path: samplePath }, exec)
  const exported = await tools['replenish_export'].execute({ path: samplePath }, exec)

  const renderedSuggest = tools['replenish_suggest'].output.render({ path: samplePath }, suggest)
  const renderedPlan = tools['replenish_plan'].output.render({ path: samplePath }, plan)
  const renderedExport = tools['replenish_export'].output.render({ path: samplePath }, exported)
  for (const rendered of [renderedSuggest, renderedPlan, renderedExport]) {
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0].type, 'text')
    assert.ok(rendered[0].text.length > 0)
  }
  assert.match(renderedSuggest[0].text, /replenishment suggestions \(30d\): 16 store-SKU row\(s\), 11 order line\(s\)/)
  assert.match(renderedPlan[0].text, /replenishment plan \(30d\): 2 store\(s\), 11 order line\(s\)/)
  assert.match(renderedExport[0].text, /replenishment CSV 11 row\(s\) ->/)
})

test('the three tools stay read-only except the exporter', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-store-replenish-readonly-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const tools = Object.fromEntries(createTools({ baseDir: dir }).map((tool) => [tool.name, tool]))
  await tools['replenish_suggest'].execute({ path: samplePath }, exec)
  await tools['replenish_plan'].execute({ path: samplePath }, exec)
  const entries = await readFile(path.join(dir, 'exports', 'replenish-30d.csv'), 'utf8').then(
    () => 'created',
    () => 'missing',
  )
  assert.equal(entries, 'missing')
  await tools['replenish_export'].execute({ path: samplePath }, exec)
  assert.match(await readFile(path.join(dir, 'exports', 'replenish-30d.csv'), 'utf8'), /^门店,SKU/)
})
