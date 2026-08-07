import re

with open('src/main.tsx', 'r') as f:
    content = f.read()

unregister = """if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let registration of registrations) {
        registration.unregister()
      }
    }).catch(() => undefined)
  })
}"""

register = """if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then((reg) => {
        console.log('FCM Service Worker registered:', reg.scope);
      })
      .catch((err) => {
        console.error('FCM Service Worker registration failed:', err);
      });
  });
}"""

content = content.replace(unregister, register)

with open('src/main.tsx', 'w') as f:
    f.write(content)
