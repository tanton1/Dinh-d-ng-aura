import re

with open('src/services/fcmService.ts', 'r') as f:
    content = f.read()

content = content.replace('      const currentToken = await getToken(firebaseMessaging)',
'''      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
      const currentToken = await getToken(firebaseMessaging, vapidKey ? { vapidKey } : undefined)''')

with open('src/services/fcmService.ts', 'w') as f:
    f.write(content)
