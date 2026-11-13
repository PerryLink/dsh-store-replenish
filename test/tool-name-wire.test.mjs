import test from 'node:test'
import assert from 'node:assert/strict'
import { createTools } from '../lib/plugin/tools.js'

// The model wire format only accepts names matching ^[a-zA-Z0-9_-]+$.
// A dotted name (the 0.1.x style) is rejected by the provider with
// `Invalid 'tools[N].name'` and takes the whole tools array down with it,
// so the plugin registers but no request that carries the tools can succeed.
const WIRE_NAME = /^[a-zA-Z0-9_-]+$/

const EXPECTED = ['replenish_suggest', 'replenish_plan', 'replenish_export']

test('every registered tool name is a valid model wire name', () => {
  const tools = createTools({ baseDir: '/tmp/dsh-store-replenish-wire' })
  assert.equal(tools.length, EXPECTED.length)
  for (const tool of tools) {
    assert.match(tool.name, WIRE_NAME, `${tool.name} would be rejected by the provider`)
    assert.ok(!tool.name.includes('.'), `${tool.name} must not contain a dot`)
    assert.ok(tool.name.startsWith('replenish_'), `${tool.name} must keep the replenish_ namespace`)
  }
  const names = tools.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length, 'tool names must be unique')
  assert.deepEqual([...names].sort(), [...EXPECTED].sort())
})
