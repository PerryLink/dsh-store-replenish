#!/usr/bin/env node
/**
 * Release gate: metadata lint + public acceptance checks. Every ACCEPTANCE.csv
 * row must have pass=true.
 *
 *   node scripts/gate.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

try {
  execFileSync(process.execPath, ['scripts/lint.mjs'], { stdio: 'inherit' })
  execFileSync(process.execPath, ['scripts/acceptance.mjs'], { stdio: 'inherit' })
} catch {
  process.exit(1)
}

const lines = readFileSync('ACCEPTANCE.csv', 'utf8').trim().split('\n')
const header = lines[0]?.split(',') ?? []
if (!header.includes('evidence_sha256') || !header.includes('pass')) {
  console.error('gate: ACCEPTANCE.csv header is missing evidence_sha256/pass')
  process.exit(1)
}
const passIndex = header.indexOf('pass')
const rows = lines.slice(1).filter((line) => line.trim() !== '')
const failing = rows.filter((line) => line.split(',')[passIndex] !== 'true')
if (failing.length > 0) {
  for (const row of failing) console.error(`gate: ${row}`)
  process.exit(1)
}
console.log(`gate ok: ${rows.length} acceptance rows`)
