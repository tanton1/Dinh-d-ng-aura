const CACHE_VERSION = 'aura-shell-v2'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/aura-icon-192.png',
  '/icons/aura-icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { data: { message: event.data?.text() ?? '' } }
  }

  const notification = payload.notification ?? {}
  const data = payload.data ?? payload
  const title = notification.title || data.title || 'Aura Fitness & Nutrition'
  const body = notification.body || data.message || data.body || 'Bạn có thông báo mới từ Aura.'
  const actionUrl = data.actionUrl || data.url || '/home'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/aura-icon-192.png',
    badge: '/icons/aura-icon-192.png',
    data: { url: actionUrl },
    vibrate: [100, 50, 100],
    tag: data.tag || 'aura-notification',
    renotify: true,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestedPath = event.notification.data?.url || '/home'
  const targetUrl = new URL(requestedPath, self.location.origin)
  if (targetUrl.origin !== self.location.origin) targetUrl.href = new URL('/home', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const existingClient = windowClients.find((client) => client.url === targetUrl.href)
      if (existingClient && 'focus' in existingClient) return existingClient.focus()
      return self.clients.openWindow ? self.clients.openWindow(targetUrl.href) : undefined
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put('/', response.clone()))
          return response
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  const isStaticAsset = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || url.pathname === '/manifest.webmanifest'
  if (!isStaticAsset) return

  event.respondWith(
    caches.match(request).then((cached) => {
      const refreshed = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()))
        return response
      })
      return cached || refreshed
    }),
  )
})
