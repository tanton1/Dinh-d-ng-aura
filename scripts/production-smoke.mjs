import { createProductionReader } from './production-smoke-reader.mjs'

async function main() {
  const baseUrl = (process.env.AURA_PROD_URL || 'https://aurafitness-jet.vercel.app').replace(/\/$/, '')
  const expectedRelease = process.env.AURA_EXPECTED_RELEASE_SHA?.trim()
  const { fetchText, readConsistentProductionSnapshot } = createProductionReader({
    baseUrl,
    expectedRelease,
    maxAttempts: Number(process.env.AURA_SMOKE_ATTEMPTS || 10),
    retryDelayMs: Math.max(250, Number(process.env.AURA_SMOKE_RETRY_DELAY_MS || 3_000)),
  })

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
        signal: AbortSignal.timeout(30_000),
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
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error?.code || 'verification_failed',
      message: error instanceof Error ? error.message : String(error),
      ...(error?.status ? { status: error.status } : {}),
      ...(error?.retryAfterMs != null ? { retryAfterMs: error.retryAfterMs } : {}),
    },
  }))
  process.exitCode = 1
})
