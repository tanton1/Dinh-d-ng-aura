import React, { useState, useEffect, useRef } from 'react'
import { Bell, Check, ChevronRight } from 'lucide-react'
import { subscribeToUserNotifications, markNotificationAsRead, markAllNotificationsAsRead, sendBrowserNativePushNotification } from '../services/notificationService'
import type { AppNotification } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useDailyFoodReminder } from '../hooks/useDailyFoodReminder'

interface NotificationCenterProps {
  className?: string
  showLabel?: boolean
  align?: 'left' | 'right'
  iconSize?: number
  style?: React.CSSProperties
}

export default function NotificationCenter({
  className = '',
  showLabel = false,
  align = 'right',
  iconSize = 20,
  style = {},
}: NotificationCenterProps) {
  const { user } = useAuth()
  const userId = user?.uid
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const isInitialLoadRef = useRef(true)
  const previousNotifIdsRef = useRef<Set<string>>(new Set())

  // Call the hook to check for daily food reminders
  useDailyFoodReminder(userId)
  
  useEffect(() => {
    if (!userId) return
    isInitialLoadRef.current = true
    previousNotifIdsRef.current = new Set()

    const unsubscribe = subscribeToUserNotifications(userId, (data) => {
      if (isInitialLoadRef.current) {
        // Initial snapshot: record all existing notification IDs
        previousNotifIdsRef.current = new Set(data.map(n => n.id))
        isInitialLoadRef.current = false
      } else {
        // Subsequent real-time snapshots: check for newly added unread notifications
        data.forEach(n => {
          if (!previousNotifIdsRef.current.has(n.id) && !n.read) {
            previousNotifIdsRef.current.add(n.id)
            // Trigger device-native Web Push Notification
            sendBrowserNativePushNotification(n.title, n.message, n.actionUrl)
          }
        })
      }
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
      const cleanUrl = notif.actionUrl.startsWith('/') ? notif.actionUrl.slice(1) : notif.actionUrl
      window.location.hash = cleanUrl
    }
  }

  const handleMarkAllAsRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (userId) markAllNotificationsAsRead(userId)
  }

  return (
    <div className={`notification-center ${className}`} ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button 
        className="icon-button notification-button" 
        aria-label="Thông báo"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: showLabel ? '8px 14px' : '8px',
          borderRadius: '10px',
          border: showLabel ? '1px solid rgba(226, 232, 240, 0.8)' : 'none',
          backgroundColor: showLabel ? '#ffffff' : 'transparent',
          color: '#334155',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: showLabel ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
          transition: 'all 0.15s ease',
          ...style
        }}
      >
        <Bell size={iconSize} />
        {showLabel && <span>Thông báo</span>}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: showLabel ? '2px' : '2px',
            right: showLabel ? '2px' : '2px',
            backgroundColor: '#ef4444',
            color: 'white',
            fontSize: '10px',
            fontWeight: 'bold',
            borderRadius: '10px',
            minWidth: '16px',
            height: '16px',
            padding: '0 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid white',
            boxShadow: '0 2px 5px rgba(239, 68, 68, 0.4)'
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: align === 'right' ? 0 : 'auto',
          left: align === 'left' ? 0 : 'auto',
          marginTop: '8px',
          width: '320px',
          maxWidth: 'calc(100vw - 28px)',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 20px 30px -10px rgba(0, 0, 0, 0.15), 0 10px 15px -5px rgba(0, 0, 0, 0.08)',
          border: '1px solid #e2e8f0',
          zIndex: 1000,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '420px'
        }}>
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={16} style={{ color: '#ec4899' }} />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Thông báo học viên</h3>
            </div>
            {unreadCount > 0 && (
              <button 
                onClick={handleMarkAllAsRead}
                style={{ 
                  background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer',
                  fontSize: '12px', color: '#ec4899', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                  borderRadius: '6px'
                }}
              >
                <Check size={14} /> Đánh dấu đã đọc
              </button>
            )}
          </div>
          
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                <Bell size={28} style={{ margin: '0 auto 10px', opacity: 0.25, color: '#94a3b8' }} />
                <p style={{ margin: 0, fontWeight: 500 }}>Bạn chưa có thông báo mới nào.</p>
                <small style={{ color: '#94a3b8', display: 'block', marginTop: '4px' }}>
                  Thông báo về nhắc nhở ăn uống, bài tập và khóa học sẽ xuất hiện ở đây.
                </small>
              </div>
            ) : (
              notifications.map((notif) => (
                <div 
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid #f1f5f9',
                    cursor: notif.actionUrl ? 'pointer' : 'default',
                    backgroundColor: notif.read ? '#ffffff' : 'rgba(236, 72, 153, 0.04)',
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
                      backgroundColor: notif.read ? 'transparent' : '#ec4899',
                      marginTop: '6px'
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: notif.read ? 600 : 700, color: '#0f172a' }}>
                      {notif.title}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#475569', lineHeight: 1.4 }}>
                      {notif.message}
                    </p>
                  </div>
                  {notif.actionUrl && (
                    <div style={{ flexShrink: 0, alignSelf: 'center', color: '#94a3b8' }}>
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
