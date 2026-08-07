self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Handle incoming Web Push Notifications in background
self.addEventListener('push', (event) => {
  let data = { title: 'Aura Fitness & Nutrition', message: 'Bạn có thông báo mới từ hệ thống!', actionUrl: '/' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.message = event.data.text();
    }
  }

  const options = {
    body: data.message || data.body || 'Kiểm tra ngay nhật ký dinh dưỡng và tập luyện của bạn.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: data.actionUrl || data.url || '/' },
    vibrate: [100, 50, 100],
    tag: data.tag || 'aura-push-notification',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Aura Fitness & Nutrition', options)
  );
});

// Handle Notification Click Action
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass through all requests
});
