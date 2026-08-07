import re

with open('server.ts', 'r') as f:
    content = f.read()

# Replace the beginning of NODE_ENV check to inject our cron and sw route
target = '  if (process.env.NODE_ENV !== "production") {'

injection = """  // Serve firebase-messaging-sw.js with env vars
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

  // Notification Cron Job
  setInterval(async () => {
    try {
      const db = admin.firestore();
      const now = new Date();
      // Only run roughly on the minute mark (we run every minute but to avoid multiple sends we can mark them)
      const currentHour = String(now.getHours()).padStart(2, '0');
      const currentMinute = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHour}:${currentMinute}`;
      
      const usersSnap = await db.collection('users')
         .where('mealReminderTime', '==', currentTimeStr)
         .get();
         
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      for (const doc of usersSnap.docs) {
         const user = doc.data();
         if (!user.fcmTokens || user.fcmTokens.length === 0) continue;
         
         // Check if already sent today
         const notifId = `meal_reminder_${today}`;
         const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc(notifId);
         const notifSnap = await notifRef.get();
         if (notifSnap.exists) continue; // Already sent today
         
         // Check if meal uploaded today
         // Simplified check: if they have a meal log today
         const mealsSnap = await db.collection('users').doc(doc.id).collection('mealLogs')
            .where('dateString', '==', today)
            .limit(1)
            .get();
            
         if (!mealsSnap.empty) continue; // Already uploaded
         
         // Create notification record
         await notifRef.set({
           id: notifId,
           userId: doc.id,
           title: 'Nhắc nhở cập nhật bữa ăn 🥗',
           message: 'Đã đến giờ cập nhật nhật ký ăn uống của bạn. Đừng quên nhé!',
           type: 'REMINDER',
           read: false,
           actionUrl: '/nutrition',
           dateString: today,
           createdAt: admin.firestore.FieldValue.serverTimestamp()
         });
         
         // Send FCM Push
         const message = {
           notification: {
             title: 'Nhắc nhở cập nhật bữa ăn 🥗',
             body: 'Đã đến giờ cập nhật nhật ký ăn uống của bạn. Đừng quên nhé!'
           },
           data: {
             actionUrl: '/nutrition'
           },
           tokens: user.fcmTokens
         };
         
         try {
           const response = await admin.messaging().sendEachForMulticast(message);
           console.log(`Sent FCM to ${doc.id}, successes: ${response.successCount}, failures: ${response.failureCount}`);
         } catch (fcmErr) {
           console.error(`FCM send error for ${doc.id}:`, fcmErr);
         }
      }
    } catch (e) {
      console.error("Cron error:", e);
    }
  }, 60 * 1000); // Check every minute

  if (process.env.NODE_ENV !== "production") {"""

content = content.replace(target, injection)

with open('server.ts', 'w') as f:
    f.write(content)
