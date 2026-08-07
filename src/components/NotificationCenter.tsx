import React, { useState, useEffect, useRef } from 'react'
import { Bell, Check, ChevronRight } from 'lucide-react'
import { subscribeToUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../services/notificationService'
import type { AppNotification } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useDailyFoodReminder } from '../hooks/useDailyFoodReminder'

export default function NotificationCenter() {
  const { user } = useAuth()
  const userId = user?.uid
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  // Call the hook to check for daily food reminders
  useDailyFoodReminder(userId)
  
  useEffect(() => {
    if (!userId) return
    const unsubscribe = subscribeToUserNotifications(userId, (data) => {
      setNotifications(data)
    })
    return () => unsubscribe()
  }, [userId])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  const handleNotificationClick = (notif: AppNotification) => {
    if (!userId) return
    if (!notif.read) {
      markNotificationAsRead(userId, notif.id)
    }
    if (notif.actionUrl) {
      setIsOpen(false)
      window.location.hash = notif.actionUrl.replace('/', '')
    }
  }

  const handleMarkAllAsRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (userId) markAllNotificationsAsRead(userId)
  }

  return (
    <div className="notification-center" ref={dropdownRef} style={{ position: 'relative' }}>
      <button 
        className="icon-button notification-button" 
        aria-label="Thông báo"
        onClick={() => setIsOpen(!isOpen)}
        style={{ position: 'relative' }}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            backgroundColor: '#ef4444',
            color: 'white',
            fontSize: '10px',
            fontWeight: 'bold',
            borderRadius: '50%',
            width: '16px',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid white'
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: '0',
          marginTop: '8px',
          width: '320px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e5e7eb',
          zIndex: 50,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '400px'
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f9fafb'
          }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#111827' }}>Thông báo</h3>
            {unreadCount > 0 && (
              <button 
                onClick={handleMarkAllAsRead}
                style={{ 
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: '12px', color: '#6366f1', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px'
                }}
              >
                <Check size={14} /> Đánh dấu đã đọc
              </button>
            )}
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
                <Bell size={24} style={{ margin: '0 auto 8px', opacity: 0.2 }} />
                Bạn chưa có thông báo nào.
              </div>
            ) : (
              notifications.map((notif) => (
                <div 
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  style={{
                    padding: '16px',
                    borderBottom: '1px solid #f3f4f6',
                    cursor: notif.actionUrl ? 'pointer' : 'default',
                    backgroundColor: notif.read ? '#ffffff' : '#eff6ff',
                    display: 'flex',
                    gap: '12px',
                    transition: 'background-color 0.15s ease'
                  }}
                >
                  <div style={{ flexShrink: 0, marginTop: '2px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: notif.read ? 'transparent' : '#3b82f6',
                      marginTop: '6px'
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: notif.read ? 500 : 600, color: '#1f2937' }}>
                      {notif.title}
                    </p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', lineHeight: 1.4 }}>
                      {notif.message}
                    </p>
                  </div>
                  {notif.actionUrl && (
                    <div style={{ flexShrink: 0, alignSelf: 'center', color: '#9ca3af' }}>
                      <ChevronRight size={16} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
