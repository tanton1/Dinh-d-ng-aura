import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const gitObjectId = /^[a-f0-9]{40}$/
const safePath = (value) => typeof value === 'string' && value.length > 0
  && !value.startsWith('/') && !value.includes('\\') && !value.includes(':')
  && value.split('/').every((part) => part && part !== '.' && part !== '..')

/** No deletion or Git mutation: validate a reviewed cleanup manifest only. */
export function validateRetiredEntries(root, entries, sourceCommit) {
  if (!Array.isArray(entries)) return ['Cleanup manifest entries must be an array.']
  const errors = []
  const paths = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') { errors.push('Invalid cleanup entry.'); continue }
    const file = entry.path ?? entry.legacyPath
    if (!safePath(file)) { errors.push('Invalid cleanup path.'); continue }
    if (paths.has(file)) errors.push(`Duplicate cleanup path: ${file}`)
    paths.add(file)
    if (!gitObjectId.test(entry.archiveBlob ?? '') || !gitObjectId.test(entry.archiveCommit ?? sourceCommit ?? '')) {
      errors.push(`Missing immutable recovery reference: ${file}`)
    }
    if (existsSync(join(root, file))) errors.push(`Retired file restored without review: ${file}`)
  }
  return errors
}

export function verifyRetiredSurfaces(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/legacy-surfaces-manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1) return ['Unsupported legacy surfaces manifest.']
  return validateRetiredEntries(root, manifest.entries, manifest.sourceCommit)
}
