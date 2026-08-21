const baseUrl = (process.env.AURA_PROD_URL || 'https://dinh-duong-aura.vercel.app').replace(/\/$/, '')

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'follow' })
  const body = await response.text()
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return { response, body }
}

const checks = []
const home = await fetchText('/')
checks.push({ name: 'production home', ok: /<title>\s*Aura Fitness\s*<\/title>/i.test(home.body) })
checks.push({ name: 'production build is not demo', ok: !home.body.includes('VITE_FORCE_DEMO') })

const manifest = await fetchText('/manifest.webmanifest')
checks.push({ name: 'PWA manifest', ok: /Aura Fitness/i.test(manifest.body) })

const assetPaths = [...home.body.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1])
if (assetPaths.length === 0) throw new Error('No versioned assets found in production HTML')
let entryBundle = ''
for (const assetPath of assetPaths.slice(0, 4)) {
  const asset = await fetchText(assetPath)
  checks.push({ name: assetPath, ok: asset.body.length > 0 })
  if (/\/assets\/index-[^/]+\.js$/.test(assetPath)) entryBundle = asset.body
}

if (!entryBundle) throw new Error('Production entry bundle was not found')

checks.push({ name: 'no sensitive env placeholders', ok: !entryBundle.includes('[SENSITIVE]') })
checks.push({ name: 'Firebase project config', ok: entryBundle.includes('gen-lang-client-0815966909') })
checks.push({
  name: 'Firestore named database config',
  ok: entryBundle.includes('ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'),
})

const firebaseApiKeys = [...new Set(
  [...entryBundle.matchAll(/AIza[0-9A-Za-z_-]{20,}/g)].map((match) => match[0]),
)]
checks.push({ name: 'single Firebase web API key', ok: firebaseApiKeys.length === 1 })

if (firebaseApiKeys.length === 1) {
  const authProbe = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKeys[0])}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'aura-config-check.invalid@example.invalid',
        password: 'invalid-config-check',
        returnSecureToken: true,
      }),
    },
  )
  let authErrorCode = ''
  try {
    authErrorCode = (await authProbe.json())?.error?.message || ''
  } catch {
    authErrorCode = ''
  }
  checks.push({
    name: 'Firebase Auth API key accepted',
    ok: authProbe.status === 400 && authErrorCode === 'INVALID_LOGIN_CREDENTIALS',
  })
}

const expectedRelease = process.env.AURA_EXPECTED_RELEASE_SHA?.trim()
if (expectedRelease) {
  checks.push({ name: 'expected release SHA', ok: entryBundle.includes(expectedRelease) })
}

const failed = checks.filter((check) => !check.ok)
console.log(JSON.stringify({
  url: baseUrl,
  checkedAt: new Date().toISOString(),
  checks,
  ok: failed.length === 0,
}, null, 2))

if (failed.length > 0) process.exitCode = 1
