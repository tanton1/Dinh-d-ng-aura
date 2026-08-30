import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebaseFirestore'
import { createNotification } from '../services/notificationService'

export function useDailyFoodReminder(userId?: string) {
  const checkedUserDay = useRef('')

  useEffect(() => {
    if (!userId || !firestoreDb) return
    
    async function checkMealLogs() {
      if (!userId || !firestoreDb) return
      try {
        const today = new Date()
        const yyyy = today.getFullYear()
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const dd = String(today.getDate()).padStart(2, '0')
        const todayStr = `${yyyy}-${mm}-${dd}`
        const userDayKey = `${userId}:${todayStr}`
        if (checkedUserDay.current === userDayKey) return
        checkedUserDay.current = userDayKey
        
        // 1. Check if reminder was already sent today
        const notifQ = query(
            collection(firestoreDb, 'users', userId, 'notifications'),
            where('type', '==', 'REMINDER'),
            where('dateString', '==', todayStr),
            limit(1),
        )
        const notifSnap = await getDocs(notifQ)
        if (!notifSnap.empty) {
            return // Already sent today
        }
        
        // 2. Query mealLogs to check if user has uploaded anything today
        const mealsRef = collection(firestoreDb, 'users', userId, 'mealLogs')
        let hasMealToday = false
        for (const dateField of ['date', 'mealDate', 'dateString']) {
          const snapshot = await getDocs(query(mealsRef, where(dateField, '==', todayStr), limit(1)))
          if (!snapshot.empty) {
            hasMealToday = true
            break
          }
        }

        if (!hasMealToday) {
          const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
          const createdToday = await getDocs(query(
            mealsRef,
            where('createdAt', '>=', new Date(today.getFullYear(), today.getMonth(), today.getDate())),
            where('createdAt', '<', tomorrow),
            limit(1),
          ))
          hasMealToday = !createdToday.empty
        }

        if (!hasMealToday) {
            // For testing: wait till evening (e.g., 6 PM). Or just trigger it for demo purposes if none is logged.
            // A production app would usually use a backend cron. We will enforce >= 12:00 for demo to be likely seen.
            const currentHour = today.getHours()
            // In demo, we'll just fire it if it's past 12 PM or if user specifically asked to see it right now.
            // Let's use 12 PM so they get reminded in the afternoon/evening.
            if (currentHour >= 12) {
              await createNotification(userId, {
                title: 'Nhắc nhở cập nhật nhật ký ăn uống 🥗',
                message: 'Hôm nay bạn chưa tải lên hình ảnh bữa ăn nào. Hãy cập nhật ngay để theo dõi tiến trình dinh dưỡng nhé!',
                type: 'REMINDER',
                dateString: todayStr,
                actionUrl: '/nutrition'
              })
            }
        }
      } catch (err) {
        console.warn("Could not check daily food reminder (Firestore quota or network limit):", err)
      }
    }
    
    checkMealLogs()
  }, [userId])
}
