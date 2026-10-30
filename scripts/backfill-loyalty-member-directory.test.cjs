'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { PROJECT, DATABASE, CONFIRM } = require('./backfill-loyalty-member-directory.cjs')
const script = path.join(__dirname, 'backfill-loyalty-member-directory.cjs')

test('member directory backfill is pinned to the named production database', () => {
  assert.equal(PROJECT, 'gen-lang-client-0815966909')
  assert.equal(DATABASE, 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7')
  assert.equal(CONFIRM, `projects/${PROJECT}/databases/${DATABASE}:rebuild-loyalty-member-directory`)
})

test('apply without exact database and source confirmation fails before network access', () => {
  const env = { ...process.env }; delete env.FIRESTORE_EMULATOR_HOST
  const result = spawnSync(process.execPath, [script, 'apply'], { env, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Exact database and source revision confirmation required/)
})

test('production backfill refuses an ambient emulator target', () => {
  const result = spawnSync(process.execPath, [script, 'dry-run'], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unset emulator variables/)
})
