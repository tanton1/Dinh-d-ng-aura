import { useEffect, useRef } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebase'
import { createNotification } from '../services/notificationService'

export function useDailyFoodReminder(userId?: string) {
  const checked = useRef(false)

  useEffect(() => {
    if (!userId || !firestoreDb || checked.current) return
    
    async function checkMealLogs() {
      if (!userId || !firestoreDb) return
      checked.current = true
      
      try {
        const today = new Date()
        const yyyy = today.getFullYear()
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const dd = String(today.getDate()).padStart(2, '0')
        const todayStr = `${yyyy}-${mm}-${dd}`
        
        // 1. Check if reminder was already sent today
        const notifQ = query(
            collection(firestoreDb, 'users', userId, 'notifications'),
            where('type', '==', 'REMINDER'),
            where('dateString', '==', todayStr)
        )
        const notifSnap = await getDocs(notifQ)
        if (!notifSnap.empty) {
            return // Already sent today
        }
        
        // 2. Query mealLogs to check if user has uploaded anything today
        const mealsRef = collection(firestoreDb, 'users', userId, 'mealLogs')
        const mealsSnap = await getDocs(mealsRef)
        const meals = mealsSnap.docs.map(d => d.data())
        
        const hasMealToday = meals.some(m => {
            const mDate = m.date || m.mealDate || m.dateString
            if (mDate && typeof mDate === 'string' && mDate.startsWith(todayStr)) return true
            // Fallback to createdAt check
            if (m.createdAt && typeof m.createdAt.toDate === 'function') {
                const dateObj = m.createdAt.toDate()
                if (dateObj.toISOString().startsWith(todayStr)) return true
            }
            return false
        })

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
        console.error("Error checking daily food reminder", err)
      }
    }
    
    checkMealLogs()
  }, [userId])
}
