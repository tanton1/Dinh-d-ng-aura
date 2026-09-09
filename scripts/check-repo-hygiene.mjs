import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const forbidden = /^(fix|patch|rewrite|update)[^/]*\.(?:c?js|mjs|ts|tsx|py)$/i

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const base = git(['merge-base', 'HEAD', 'origin/main'])
// Hygiene policy applies to newly-added files. Existing migration tools may be
// hardened in place until their strangler replacement is ready.
const added = base
  ? git(['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`]).split(/\r?\n/).filter(Boolean)
  : []
const newForbidden = added.filter((file) => !file.includes('/') && forbidden.test(file))

if (newForbidden.length) {
  console.error(`Root-level patch scripts are not allowed in new changes: ${newForbidden.join(', ')}`)
  process.exitCode = 1
}

const migrationFiles = added.filter((file) => /(^|[\\/])migration/i.test(file) && !file.startsWith('scripts/migrations/'))
if (migrationFiles.length) {
  console.error(`Migration files must live under scripts/migrations: ${migrationFiles.join(', ')}`)
  process.exitCode = 1
}

const manifestPath = join(root, 'scripts/archive-manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entries = new Map((Array.isArray(manifest.entries) ? manifest.entries : []).map((entry) => [entry.legacyPath, entry]))
  const trackedLegacy = git(['ls-files']).split(/\r?\n/).filter((file) => file && !file.includes('/') && forbidden.test(file))
  const invalid = trackedLegacy.filter((file) => {
    const entry = entries.get(file)
    if (!entry || !existsSync(join(root, file))) return true
    const digest = createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
    return entry.sha256 !== digest || !entry.lastCommit || !entry.status
  })
  if (invalid.length) {
    console.error(`Legacy archive manifest is missing or stale for: ${invalid.join(', ')}`)
    process.exitCode = 1
  }
} else {
  console.error('scripts/archive-manifest.json is required.')
  process.exitCode = 1
}

if (process.env.CI && !existsSync(join(root, 'docs/product/CURRENT_STATE.md'))) {
  console.error('docs/product/CURRENT_STATE.md is required in CI.')
  process.exitCode = 1
}

if (!process.exitCode) console.log('Repository hygiene check passed.')
