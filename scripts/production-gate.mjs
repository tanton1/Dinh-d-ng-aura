import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const envFile = new URL('.env', root)
const requiredClientKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_ID',
]

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([^#=]+)=(.*)\s*$/)
    return match ? [[match[1].trim(), match[2].trim().replace(/^['"]|['"]$/g, '')]] : []
  }))
}

let fileEnv = {}
try {
  fileEnv = parseEnv(await readFile(envFile, 'utf8'))
} catch {
  // Vercel/CI deployments can provide all values through process.env.
}

const env = { ...fileEnv, ...process.env }
const missing = requiredClientKeys.filter((key) => !env[key]?.trim())
const allowPending = process.argv.includes('--allow-pending-app-check')
const appCheckKey = env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim()

if (missing.length > 0) {
  throw new Error(`Production gate failed: missing ${missing.join(', ')}`)
}

if (!appCheckKey && !allowPending) {
  throw new Error(
    'Production gate failed: VITE_FIREBASE_APP_CHECK_SITE_KEY is missing. '
      + 'Register the web App Check provider before an enforcement deploy, '
      + 'or pass --allow-pending-app-check only for a compatibility rollout.',
  )
}

if (env.VITE_ENABLE_DEMO_OTP === 'true' || env.VITE_FORCE_DEMO === 'true') {
  throw new Error('Production gate failed: demo flags must be disabled.')
}

if (!allowPending && env.ENFORCE_APP_CHECK !== 'true') {
  throw new Error('Production gate failed: ENFORCE_APP_CHECK=true is required for the enforcement rollout.')
}

console.log(JSON.stringify({
  ok: true,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  databaseId: env.VITE_FIREBASE_DATABASE_ID,
  appCheck: appCheckKey ? 'configured' : 'pending-compatible-rollout',
  enforcement: env.ENFORCE_APP_CHECK === 'true',
  release: env.VITE_APP_RELEASE || 'unversioned',
}, null, 2))
