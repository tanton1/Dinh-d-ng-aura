import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const skippedExtensions = new Set([
  '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.ttf', '.webp', '.woff', '.woff2', '.zip',
])

const tokenPatterns = [
  { label: 'GitHub personal access token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { label: 'OpenRouter API key', pattern: /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
]

const sensitiveAssignment = /^\s*(APIKEY_FUN_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY|DELIVERY_OTP_SECRET|FIREBASE_SERVICE_ACCOUNT_KEY)\s*=\s*(.+?)\s*$/i
const safeExampleValue = /^(?:$|your[_-]|change[_-]?me|replace[_-]|placeholder|example|test|<.*>|\$\{.*\})/i
const findings = []

for (const file of trackedFiles) {
  const extension = file.includes('.') ? file.slice(file.lastIndexOf('.')).toLowerCase() : ''
  if (skippedExtensions.has(extension)) continue

  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (source.includes('\u0000')) continue

  for (const { label, pattern } of tokenPatterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      findings.push({ file, line, label })
    }
  }

  source.split(/\r?\n/).forEach((lineText, index) => {
    const match = lineText.match(sensitiveAssignment)
    if (!match) return
    const value = match[2].trim().replace(/^['"]|['"]$/g, '')
    if (!safeExampleValue.test(value)) findings.push({ file, line: index + 1, label: `${match[1]} assignment` })
  })
}

if (findings.length) {
  console.error('Secret scan failed. Revoke exposed credentials and remove them from Git history before release.')
  findings.forEach(({ file, line, label }) => console.error(`- ${file}:${line} (${label})`))
  process.exit(1)
}

console.log(`✓ Secret scan: ${trackedFiles.length} tracked files checked; no credential patterns found.`)
