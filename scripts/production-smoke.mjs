const baseUrl = (process.env.AURA_PROD_URL || 'https://dinh-duong-aura.vercel.app').replace(/\/$/, '')
const expectedRelease = process.env.AURA_EXPECTED_RELEASE_SHA?.trim()
const maximumSnapshotAttempts = Math.max(1, Number(process.env.AURA_SMOKE_ATTEMPTS || 10))
const snapshotRetryDelayMs = Math.max(250, Number(process.env.AURA_SMOKE_RETRY_DELAY_MS || 3_000))

async function fetchText(path, snapshotKey = '') {
  const url = new URL(path, `${baseUrl}/`)
  if (snapshotKey) url.searchParams.set('aura-smoke', snapshotKey)
  const response = await fetch(url, {
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return { response, body }
}

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

// Vercel updates the public alias and its CDN edges independently. Immediately
// after promotion one edge can briefly return old HTML while another already
// serves the new immutable assets. Retry the whole snapshot so HTML and assets
// always come from the same promoted release.
async function readConsistentProductionSnapshot() {
  let lastError
  for (let attempt = 1; attempt <= maximumSnapshotAttempts; attempt += 1) {
    const snapshotKey = `${Date.now()}-${attempt}`
    try {
      const home = await fetchText('/', snapshotKey)
      const assetPaths = [...home.body.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1])
      if (assetPaths.length === 0) throw new Error('No versioned assets found in production HTML')

      let entryBundle = ''
      const assets = []
      for (const assetPath of assetPaths.slice(0, 4)) {
        const asset = await fetchText(assetPath, snapshotKey)
        assets.push({ path: assetPath, body: asset.body })
        if (/\/assets\/index-[^/]+\.js$/.test(assetPath)) entryBundle = asset.body
      }
      if (!entryBundle) throw new Error('Production entry bundle was not found')
      if (expectedRelease && !entryBundle.includes(expectedRelease)) {
        throw new Error(`Public alias has not promoted release ${expectedRelease.slice(0, 12)} yet`)
      }

      let firebaseBootstrapBundle = ''
      let firebaseBootstrapPath = ''
      const firebaseBootstrapFile = entryBundle.match(/(?:\.\/|assets\/)(firebaseFirestore-[A-Za-z0-9_-]+\.js)/)?.[1]
      if (firebaseBootstrapFile) {
        firebaseBootstrapPath = `/assets/${firebaseBootstrapFile}`
        firebaseBootstrapBundle = (await fetchText(firebaseBootstrapPath, snapshotKey)).body
      }
      return { home, assets, entryBundle, firebaseBootstrapBundle, firebaseBootstrapPath, attempt }
    } catch (error) {
      lastError = error
      if (attempt === maximumSnapshotAttempts) break
      console.warn(`Production snapshot ${attempt}/${maximumSnapshotAttempts} is not consistent yet: ${error instanceof Error ? error.message : String(error)}`)
      await wait(snapshotRetryDelayMs)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Production snapshot did not become consistent')
}

const checks = []
const snapshot = await readConsistentProductionSnapshot()
const { home, entryBundle, firebaseBootstrapBundle, firebaseBootstrapPath } = snapshot
checks.push({ name: 'production home', ok: /<title>\s*Aura Fitness\s*<\/title>/i.test(home.body) })
checks.push({ name: 'production build is not demo', ok: !home.body.includes('VITE_FORCE_DEMO') })

const manifest = await fetchText('/manifest.webmanifest', `manifest-${Date.now()}`)
checks.push({ name: 'PWA manifest', ok: /Aura Fitness/i.test(manifest.body) })

for (const asset of snapshot.assets) checks.push({ name: asset.path, ok: asset.body.length > 0 })

// Firebase initialization is intentionally lazy-loaded to keep the public
// shell fast. Validate the split Firestore bootstrap chunk as well as the
// entry bundle instead of reporting a false production configuration error.
if (firebaseBootstrapPath) checks.push({ name: firebaseBootstrapPath, ok: firebaseBootstrapBundle.length > 0 })
const configurationBundles = `${entryBundle}\n${firebaseBootstrapBundle}`

checks.push({ name: 'no sensitive env placeholders', ok: !configurationBundles.includes('[SENSITIVE]') })
checks.push({ name: 'Firebase project config', ok: configurationBundles.includes('gen-lang-client-0815966909') })
checks.push({
  name: 'Firestore named database config',
  ok: configurationBundles.includes('ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'),
})

const firebaseApiKeys = [...new Set(
  [...configurationBundles.matchAll(/AIza[0-9A-Za-z_-]{20,}/g)].map((match) => match[0]),
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

if (expectedRelease) {
  checks.push({ name: 'expected release SHA', ok: entryBundle.includes(expectedRelease) })
}

const failed = checks.filter((check) => !check.ok)
console.log(JSON.stringify({
  url: baseUrl,
  checkedAt: new Date().toISOString(),
  snapshotAttempts: snapshot.attempt,
  checks,
  ok: failed.length === 0,
}, null, 2))

if (failed.length > 0) process.exitCode = 1
