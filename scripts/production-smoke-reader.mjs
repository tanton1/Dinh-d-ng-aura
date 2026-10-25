const ACCESS_STATUSES = new Set([401, 403, 407])
const RETRYABLE_STATUSES = new Set([404, 408, 425, 429])

export class ProductionReadError extends Error {
  constructor(message, { code, status, retryAfterMs, retryable = false } = {}) {
    super(message)
    this.name = 'ProductionReadError'
    this.code = code
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.retryable = retryable
  }
}

export function parseRetryAfter(value, nowMs = Date.now()) {
  if (!value?.trim()) return null
  const text = value.trim()
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1_000, Number.MAX_SAFE_INTEGER)
  // HTTP dates, unlike arbitrary strings accepted by Date.parse, identify an
  // absolute retry time. Past dates allow the normal propagation delay.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return null
  const date = Date.parse(text)
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

export function createProductionReader({
  baseUrl,
  expectedRelease,
  maxAttempts = 10,
  retryDelayMs = 3_000,
  requestTimeoutMs = 30_000,
  snapshotBudgetMs = 120_000,
  maxWaitMs = 60_000,
  fetchImpl = fetch,
  now = Date.now,
  wait = duration => new Promise(resolve => setTimeout(resolve, duration)),
  onRetry = message => console.warn(message),
}) {
  boundedInteger(maxAttempts, 'maxAttempts', 1, 30)
  boundedInteger(retryDelayMs, 'retryDelayMs', 1, 60_000)
  boundedInteger(requestTimeoutMs, 'requestTimeoutMs', 1, 60_000)
  boundedInteger(snapshotBudgetMs, 'snapshotBudgetMs', 1, 180_000)
  boundedInteger(maxWaitMs, 'maxWaitMs', 1, 60_000)
  const origin = new URL(baseUrl)

  async function fetchText(path, snapshotKey = '', deadline = Infinity) {
    const remainingMs = Math.min(requestTimeoutMs, deadline - now())
    if (remainingMs <= 0) throw new ProductionReadError('Production snapshot time budget exhausted', { code: 'snapshot_timeout' })
    const url = new URL(path, origin)
    if (url.origin !== origin.origin) throw new ProductionReadError('Production asset must use the public origin', { code: 'foreign_asset' })
    if (snapshotKey) url.searchParams.set('aura-smoke', snapshotKey)
    const response = await fetchImpl(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.ceil(remainingMs)),
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    })
    const status = response.status
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now())
    const challenge = response.headers.get('x-vercel-mitigated')?.toLowerCase() === 'challenge'
    if (challenge || ACCESS_STATUSES.has(status)) {
      if (response.body) await response.body.cancel().catch(() => {})
      throw new ProductionReadError(`${path} is blocked by ${challenge ? 'a security checkpoint' : `HTTP ${status}`}; automated verification stopped`, {
        code: challenge ? 'security_checkpoint' : 'access_denied', status, retryAfterMs,
      })
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {})
      throw new ProductionReadError(`${path} returned HTTP ${status}`, {
        code: 'http_error', status, retryAfterMs,
        retryable: RETRYABLE_STATUSES.has(status) || status >= 500,
      })
    }
    const body = await response.text()
    if (/<title>\s*Vercel Security Checkpoint\s*<\/title>/i.test(body)) {
      throw new ProductionReadError(`${path} returned a security checkpoint instead of application content; automated verification stopped`, {
        code: 'security_checkpoint', status, retryAfterMs,
      })
    }
    return { response, body }
  }

  // Retry the entire snapshot because HTML and immutable assets can reach CDN
  // edges at different times. Access challenges are never propagation retries.
  async function readConsistentProductionSnapshot() {
    const deadline = now() + snapshotBudgetMs
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const snapshotKey = `${now()}-${attempt}`
      try {
        const home = await fetchText('/', snapshotKey, deadline)
        const assetPaths = [...home.body.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1])
        if (!assetPaths.length) throw new Error('No versioned assets found in production HTML')
        let entryBundle = ''
        const assets = []
        for (const assetPath of assetPaths.slice(0, 4)) {
          const asset = await fetchText(assetPath, snapshotKey, deadline)
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
          firebaseBootstrapBundle = (await fetchText(firebaseBootstrapPath, snapshotKey, deadline)).body
        }
        return { home, assets, entryBundle, firebaseBootstrapBundle, firebaseBootstrapPath, attempt }
      } catch (error) {
        if (error instanceof ProductionReadError && !error.retryable) throw error
        if (attempt === maxAttempts) throw error
        const transportError = error instanceof ProductionReadError || error?.name === 'TimeoutError' || error?.name === 'TypeError'
        const backoffMs = Math.min(maxWaitMs, retryDelayMs * (transportError ? 2 ** (attempt - 1) : 1))
        const delayMs = Math.max(backoffMs, error?.retryAfterMs ?? 0)
        if (delayMs > maxWaitMs || now() + delayMs >= deadline) {
          throw new ProductionReadError('Production verification deferred: required retry delay exceeds this run\'s time budget', {
            code: 'retry_deferred', status: error?.status, retryAfterMs: delayMs,
          })
        }
        onRetry(`Production snapshot ${attempt}/${maxAttempts} failed; retrying in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`)
        await wait(delayMs)
      }
    }
    throw new Error('Production snapshot did not become consistent')
  }

  return { fetchText, readConsistentProductionSnapshot }
}
