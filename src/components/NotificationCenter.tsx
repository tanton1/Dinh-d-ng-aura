import React, { useState, useEffect, useRef } from 'react'
import { Bell, Check, ChevronRight } from 'lucide-react'
import { subscribeToUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../services/notificationService'
import { subscribeToForegroundPush } from '../services/fcmService'
import type { AppNotification } from '../types'
import { useAuth } from '../contexts/AuthContext'

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
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [foregroundPushVersion, setForegroundPushVersion] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const isInitialLoadRef = useRef(true)
  const previousNotifIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const handlePushReady = () => setForegroundPushVersion((version) => version + 1)
    window.addEventListener('aura:fcm-ready', handlePushReady)
    return () => window.removeEventListener('aura:fcm-ready', handlePushReady)
  }, [])

  useEffect(() => {
    if (!userId) {
      setNotifications([])
      setNotificationError(null)
      previousNotifIdsRef.current.clear()
      return
    }
    isInitialLoadRef.current = true
    previousNotifIdsRef.current.clear()
    previousNotifIdsRef.current = new Set()

    const unsubscribe = subscribeToUserNotifications(userId, (data) => {
      setNotificationError(null)
      if (isInitialLoadRef.current) {
        // Initial snapshot: record all existing notification IDs
        previousNotifIdsRef.current = new Set(data.map(n => n.id))
        isInitialLoadRef.current = false
      } else {
        // Subsequent real-time snapshots: check for newly added unread notifications
        data.forEach(n => {
          if (!previousNotifIdsRef.current.has(n.id) && !n.read) {
            previousNotifIdsRef.current.add(n.id)
          }
        })
      }
      setNotifications(data)
    }, () => {
      setNotificationError('Chưa thể đồng bộ thông báo. Hãy thử lại sau.')
    })
    return () => unsubscribe()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void subscribeToForegroundPush((payload) => {
      if (cancelled) return
      const key = payload.notificationId || `${payload.title}:${payload.message}`
      if (previousNotifIdsRef.current.has(`push:${key}`)) return
      previousNotifIdsRef.current.add(`push:${key}`)

      // FCM handles background notifications in sw.js. This path is only for
      // an already-open tab, so it shows one foreground banner without
      // duplicating the Firestore notification-center update.
      try {
        if (typeof window !== 'undefined' && Notification.permission === 'granted') {
          const banner = new Notification(payload.title, {
            body: payload.message,
            icon: '/icons/aura-icon-192.png',
            badge: '/icons/aura-icon-192.png',
            data: { url: payload.actionUrl || '/home' },
          })
          banner.onclick = () => {
            const actionUrl = payload.actionUrl || '/home'
            window.location.hash = actionUrl.startsWith('/#/')
              ? actionUrl.slice(1)
              : actionUrl.startsWith('#/')
                ? actionUrl
                : `#${actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`}`
            window.focus()
            banner.close()
          }
        }
      } catch {
        // The in-app bell remains available when native foreground banners
        // are blocked by the browser.
      }
    }).then((cleanup) => {
      if (cancelled) cleanup()
      else unsubscribe = cleanup
    }).catch(() => {})

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [userId, foregroundPushVersion])

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

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!userId) return
    if (!notif.read) {
      try {
        await markNotificationAsRead(userId, notif.id)
      } catch {
        setNotificationError('Chưa thể cập nhật trạng thái thông báo.')
        return
      }
    }
    if (notif.actionUrl) {
      setIsOpen(false)
      const actionUrl = notif.actionUrl
      window.location.hash = actionUrl.startsWith('/#/')
        ? actionUrl.slice(1)
        : actionUrl.startsWith('#/')
          ? actionUrl
          : `#${actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`}`
    }
  }

  const handleMarkAllAsRead = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!userId) return
    try {
      await markAllNotificationsAsRead(userId)
      setNotificationError(null)
    } catch {
      setNotificationError('Chưa thể đánh dấu tất cả thông báo đã đọc.')
    }
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
          {notificationError && <div role="alert" style={{ padding: '8px 16px', color: '#b42318', background: '#fff1f2', fontSize: '12px', fontWeight: 600 }}>{notificationError}</div>}
          
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
                <button
                  type="button"
                  key={notif.id}
                  onClick={() => void handleNotificationClick(notif)}
                  disabled={!notif.actionUrl}
                  style={{
                    padding: '14px 16px',
                    width: '100%',
                    borderBottom: '1px solid #f1f5f9',
                    borderTop: 0,
                    borderLeft: 0,
                    borderRight: 0,
                    textAlign: 'left',
                    font: 'inherit',
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
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
