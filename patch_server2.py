import re

with open('server.ts', 'r') as f:
    content = f.read()

# Add route for firebase-messaging-sw.js
route = """
  // Vite middleware for development
"""

new_route = """
  // Serve firebase-messaging-sw.js with env vars
  app.get('/firebase-messaging-sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "${process.env.VITE_FIREBASE_API_KEY}",
  authDomain: "${process.env.VITE_FIREBASE_AUTH_DOMAIN}",
  projectId: "${process.env.VITE_FIREBASE_PROJECT_ID}",
  storageBucket: "${process.env.VITE_FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${process.env.VITE_FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${process.env.VITE_FIREBASE_APP_ID}"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title || 'Thông báo';
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png',
    data: payload.data
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data && event.notification.data.actionUrl) {
    event.waitUntil(
      clients.openWindow(event.notification.data.actionUrl)
    );
  }
});
    `);
  });

  // Vite middleware for development
"""

content = content.replace(route, new_route)

with open('server.ts', 'w') as f:
    f.write(content)
