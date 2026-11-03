// Keeps brand colors in styles-aura-tokens.css. A stylesheet may not reintroduce a
// raw value that already has a token, or one of the retired brand pink variants.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tokenFile = 'styles-aura-tokens.css'

const tokenized = {
  '#14805e': '--aura-success',
  '#386bc1': '--aura-info',
  '#a65a16': '--aura-warning',
  '#ec2c76': '--aura-brand-pink',
  '#ff7a45': '--aura-brand-orange',
  '#f7f4f6': '--aura-canvas',
  '#ece8ec': '--aura-line',
  '#5f5961': '--aura-muted',
  '#19161a': '--aura-ink',
  '#fbf9fa': '--aura-surface-soft',
  '#fff0f6': '--aura-pink-soft',
}
const retiredPinks = ['#f62f82', '#ff2d91', '#ec4899', '#f52c82', '#f53082', '#f42482', '#ff3f7d', '#d90068', '#db2777']

function stylesheets(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return stylesheets(path)
    return entry.name.endsWith('.css') && entry.name !== tokenFile ? [path] : []
  })
}

const problems = []
for (const file of stylesheets(join(root, 'src'))) {
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    // Token definitions and image data are exempt.
    if (/^\s*--aura-/.test(line) || /url\(/i.test(line)) return
    for (const match of line.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      const hex = match[0].toLowerCase()
      if (tokenized[hex]) problems.push(`${relative(root, file)}:${index + 1} use var(${tokenized[hex]}) instead of ${hex}`)
      else if (retiredPinks.includes(hex)) problems.push(`${relative(root, file)}:${index + 1} ${hex} is a retired pink; use var(--aura-brand-pink) or var(--aura-pink-text) for text`)
    }
  })
}

if (problems.length) {
  console.error(`CSS color check failed (${problems.length}):\n${problems.join('\n')}`)
  process.exit(1)
}
console.log('CSS color check passed')
