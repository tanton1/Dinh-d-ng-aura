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
for (const assetPath of assetPaths.slice(0, 4)) {
  const asset = await fetchText(assetPath)
  checks.push({ name: assetPath, ok: asset.body.length > 0 })
}

const failed = checks.filter((check) => !check.ok)
console.log(JSON.stringify({
  url: baseUrl,
  checkedAt: new Date().toISOString(),
  checks,
  ok: failed.length === 0,
}, null, 2))

if (failed.length > 0) process.exitCode = 1
