const CACHE_PREFIX = 'aura-fit-'
const CACHE_VERSION = 'v8'
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE])
const BASE_URL = new URL('./', self.location.href)
const BASE_PATH = BASE_URL.pathname
const APP_SHELL = [
  BASE_URL.href,
  new URL('manifest.webmanifest', BASE_URL).href,
  new URL('icons/aura-icon.svg', BASE_URL).href,
]
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style'])

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isCacheableResponse(response) {
  if (!response.ok || !response.url) return false
  try {
    return isSameOrigin(new URL(response.url))
  } catch {
    return false
  }
}

async function fetchAndCache(cache, request) {
  const response = await fetch(request)
  if (!isCacheableResponse(response)) {
    throw new Error(`Không thể cache ${request.url || request}`)
  }
  await cache.put(request, response.clone())
  return response
}

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE)
  const rootRequest = new Request(BASE_URL.href, { cache: 'reload' })
  const rootResponse = await fetchAndCache(cache, rootRequest)
  const html = await rootResponse.clone().text()
  const builtAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value.includes('/assets/'))
    .map((value) => new URL(value, rootResponse.url).href)
  const shellResources = [...new Set([...APP_SHELL.slice(1), ...builtAssets])]

  await Promise.all(shellResources.map((path) => fetchAndCache(cache, new Request(path))))
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (isCacheableResponse(response)) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(BASE_URL.href, response.clone())
      return response
    }

    const fallback = await caches.match(BASE_URL.href)
    return fallback || response
  } catch {
    const fallback = await caches.match(BASE_URL.href)
    return fallback || new Response('Aura Fitness đang ngoại tuyến.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

function staleWhileRevalidate(event) {
  const networkResponse = fetch(event.request).then(async (response) => {
    if (isCacheableResponse(response)) {
      const cache = await caches.open(STATIC_CACHE)
      await cache.put(event.request, response.clone())
    }
    return response
  })

  event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined))
  return caches.match(event.request).then(async (cached) => {
    if (cached) return cached
    try {
      return await networkResponse
    } catch {
      return Response.error()
    }
  })
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (!isSameOrigin(url)) return

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request))
    return
  }

  if (STATIC_DESTINATIONS.has(event.request.destination)
      || url.pathname.startsWith(`${BASE_PATH}assets/`)
      || url.pathname.startsWith(`${BASE_PATH}icons/`)
      || url.pathname.startsWith(`${BASE_PATH}data/nutrition-`)
      || url.pathname === `${BASE_PATH}manifest.webmanifest`) {
    event.respondWith(staleWhileRevalidate(event))
  }
})
