import re

with open('server.ts', 'r') as f:
    content = f.read()

import_statement = '''import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";

// Initialize Firebase Admin if Service Account is available or using default credentials
try {
  admin.initializeApp();
} catch (e) {
  console.warn("Firebase Admin init failed (might not have credentials):", e);
}
'''
content = content.replace(
'''import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";''', import_statement)

cron_setup = '''
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {'''

new_cron_setup = '''
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
           const response = await admin.messaging().sendMulticast(message);
           console.log(`Sent FCM to ${doc.id}, successes: ${response.successCount}, failures: ${response.failureCount}`);
         } catch (fcmErr) {
           console.error(`FCM send error for ${doc.id}:`, fcmErr);
         }
      }
    } catch (e) {
      console.error("Cron error:", e);
    }
  }, 60 * 1000); // Check every minute

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {'''
content = content.replace(cron_setup, new_cron_setup)

with open('server.ts', 'w') as f:
    f.write(content)
