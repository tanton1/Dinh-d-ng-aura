'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const MAX_ATTEMPTS = 3

// The CLI writes JSON failures to stdout. Do not print that raw response: it
// can contain project configuration. Retry only this bounded, read-only list.
async function readInventory({ invoke, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), report = () => {} }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response
    try { response = await invoke() } catch { response = { status: null } }
    let payload
    try { payload = JSON.parse(response?.stdout || '') } catch { /* Incomplete CLI output is not a manifest. */ }
    const valid = response?.status === 0 && !response.error && !response.signal && payload?.status === 'success'
      && Array.isArray(payload.result)
      && payload.result.every(row => row && typeof row === 'object' && !Array.isArray(row)
        && typeof row.id === 'string' && row.id.length > 0 && typeof row.region === 'string' && row.region.length > 0)
    if (valid) return { payload, attempts: attempt }
    report({ event: 'firebase_function_inventory_read_failed', attempt, maximumAttempts: MAX_ATTEMPTS,
      exitCode: Number.isInteger(response?.status) ? response.status : null,
      reason: response?.error?.code === 'ETIMEDOUT' ? 'timeout' : response?.status !== 0 ? 'cli_failure' : 'invalid_manifest' })
    if (attempt < MAX_ATTEMPTS) await pause(1_000 * attempt)
  }
  throw new Error('Firebase function inventory unavailable after 3 read attempts. This step did not redeploy any function.')
}

async function collectInventory(file, options) {
  const result = await readInventory(options)
  // Preserve the previous manifest on a failed read or interrupted write.
  const pending = `${file}.pending-${process.pid}`
  await fs.writeFile(pending, JSON.stringify(result.payload) + '\n', { mode: 0o600 })
  await fs.rename(pending, file)
  return { attempts: result.attempts, functions: result.payload.result.length }
}

async function main() {
  const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const project = argument('project'), file = argument('file')
  if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project) || !file || !file.endsWith('.json')) throw new Error('Provide --project and a JSON --file for the function inventory.')
  const result = await collectInventory(path.resolve(file), {
    invoke: () => spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', 'firebase-tools@15.9.1', 'functions:list', '--project', project, '--json'], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
        // Windows needs a shell for npx.cmd. Arguments are fixed except the
        // validated project identifier; no path or arbitrary input is passed.
        shell: process.platform === 'win32', windowsHide: true,
      }),
    report: value => console.error(JSON.stringify(value)),
  })
  console.log(JSON.stringify({ event: 'firebase_function_inventory_read', ...result }))
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { readInventory, collectInventory }
