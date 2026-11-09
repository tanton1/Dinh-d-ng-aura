import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bell, CalendarClock, CalendarDays, CheckCheck, Inbox, LoaderCircle, Settings2, Sparkles, WalletCards } from 'lucide-react'
import type { AppNotification, ViewId } from '../../types'
import {
  loadOlderNotifications,
  markNotificationsAsRead,
  subscribeToUnreadNotifications,
  subscribeToUserNotifications,
} from '../../services/notificationService'
import { listMyStudentPtSchedule, type StudentPtScheduleData } from '../../services/studentPtScheduleService'
import { useVietnamDay } from '../../hooks/useWorkspaceSync'
import {
  NOTIFICATION_TABS,
  addDayKey,
  dayKeyDistance,
  demoNotifications,
  formatDayKey,
  formatWeekRange,
  isNotificationTabId,
  mergeNotifications,
  nextWeekMondayKey,
  normalizeActionHash,
  notificationDate,
  notificationTabFor,
  notificationTabFromHash,
  notificationTabHash,
  pickDefaultTab,
  relativeTimeLabel,
  sortNotifications,
  unreadCountsByTab,
  type NotificationTabId,
} from '../../features/notifications/notificationTabs'
import './NotificationsPage.css'

const RECENT_PAGE_SIZE = 60
const OLDER_PAGE_SIZE = 50
const UNREAD_LIMIT = 200

const TAB_ICONS = {
  schedule: CalendarDays,
  payment: WalletCards,
  availability: CalendarClock,
  other: Sparkles,
} as const

interface ActionItem {
  id: string
  tab: NotificationTabId
  title: string
  detail: string
  cta: string
  href: string
  tone: 'urgent' | 'normal'
}

interface NotificationsPageProps {
  userId?: string
  onNavigate: (view: ViewId) => void
  isDemo?: boolean
}

function lastTabStorageKey(userId: string) {
  return `aura:notifications:last-tab:${userId}`
}

function readLastTab(userId: string): NotificationTabId | null {
  try {
    const value = window.localStorage.getItem(lastTabStorageKey(userId))
    return isNotificationTabId(value) ? value : null
  } catch {
    return null
  }
}

function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function hourLabel(hour: number | null) {
  return hour === null ? 'chưa rõ giờ' : `${String(hour).padStart(2, '0')}:00`
}

function paymentHash(contractId: string, installmentId: string) {
  return `#/schedule?tab=contract&pay=${encodeURIComponent(contractId)}~${encodeURIComponent(installmentId)}`
}

/**
 * "Cần làm ngay" comes from the live schedule, not from the inbox: a reminder
 * that was never sent or already read must not hide an overdue instalment.
 */
function buildActionItems(data: StudentPtScheduleData | null, todayKey: string, nextWeekId: string): ActionItem[] {
  if (!data?.linked || !data.student) return []
  const items: ActionItem[] = []
  for (const contract of data.contracts) {
    if (!['active', 'future'].includes(String(contract.status || '').toLowerCase())) continue
    for (const installment of contract.installments) {
      if (installment.status !== 'pending' || !installment.date || installment.date > todayKey) continue
      const overdueDays = dayKeyDistance(installment.date, todayKey)
      items.push({
        id: `pay:${contract.id}:${installment.id}`,
        tab: 'payment',
        tone: overdueDays > 0 ? 'urgent' : 'normal',
        title: overdueDays > 0 ? `Kỳ thanh toán quá hạn ${overdueDays} ngày` : 'Kỳ thanh toán đến hạn hôm nay',
        detail: `${contract.packageName} · ${formatVnd(installment.amount)} · hạn ${formatDayKey(installment.date)}`,
        cta: 'Thanh toán',
        href: paymentHash(contract.id, installment.id),
      })
    }
  }
  const availability = data.student.availability
  if (availability && availability.weekId === nextWeekId && !availability.locked && availability.source !== 'weekly') {
    items.push({
      id: `availability:${nextWeekId}`,
      tab: 'availability',
      tone: availability.source === 'none' ? 'urgent' : 'normal',
      title: `Lịch rảnh tuần ${formatWeekRange(nextWeekId)} chưa gửi`,
      detail: availability.source === 'inherited_weekly'
        ? 'Chưa gửi thì Aura dùng lịch bạn gửi gần nhất.'
        : availability.source === 'legacy_default'
          ? 'Aura đang dựa vào lịch mặc định cũ trong hồ sơ.'
          : 'Chưa có lịch rảnh nào, Aura sẽ không xếp được buổi.',
      cta: 'Gửi lịch rảnh',
      href: `#/student-availability?week=${nextWeekId}`,
    })
  }
  const todaySessions = data.sessions
    .filter((session) => session.date === todayKey && session.status === 'scheduled')
    .sort((left, right) => (left.hour ?? 99) - (right.hour ?? 99))
  if (todaySessions.length) {
    const first = todaySessions[0]
    items.push({
      id: `session:${todayKey}`,
      tab: 'schedule',
      tone: 'normal',
      title: todaySessions.length === 1 ? `Hôm nay bạn có buổi PT ${hourLabel(first.hour)}` : `Hôm nay bạn có ${todaySessions.length} buổi PT`,
      detail: todaySessions.map((session) => `${hourLabel(session.hour)} · ${session.trainerName}`).join(' · '),
      cta: 'Mở lịch',
      href: '#/schedule?tab=this-week',
    })
  }
  return items
    .sort((left, right) => Number(right.tone === 'urgent') - Number(left.tone === 'urgent'))
    .slice(0, 3)
}

function demoActionItems(todayKey: string): ActionItem[] {
  const nextWeekId = nextWeekMondayKey(todayKey)
  return [
    {
      id: 'demo-pay', tab: 'payment', tone: 'normal', title: 'Kỳ thanh toán đến hạn hôm nay',
      detail: `PT Personal 24 buổi · ${formatVnd(4_000_000)} · hạn ${formatDayKey(todayKey)}`, cta: 'Thanh toán',
      href: paymentHash('demo-contract', 'demo-payment-2'),
    },
    {
      id: 'demo-availability', tab: 'availability', tone: 'normal', title: `Lịch rảnh tuần ${formatWeekRange(nextWeekId)} chưa gửi`,
      detail: 'Chưa gửi thì Aura dùng lịch bạn gửi gần nhất.', cta: 'Gửi lịch rảnh', href: `#/student-availability?week=${nextWeekId}`,
    },
  ]
}

export default function NotificationsPage({ userId, onNavigate, isDemo = false }: NotificationsPageProps) {
  const day = useVietnamDay()
  const [tab, setTab] = useState<NotificationTabId>(() => notificationTabFromHash(window.location.hash) ?? (userId ? readLastTab(userId) : null) ?? 'schedule')
  const [recent, setRecent] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState<AppNotification[]>([])
  const [older, setOlder] = useState<AppNotification[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [ready, setReady] = useState(isDemo)
  const [error, setError] = useState('')
  const [marking, setMarking] = useState(false)
  const [localRead, setLocalRead] = useState<Set<string>>(() => new Set())
  const [actions, setActions] = useState<ActionItem[]>([])
  const [announcement, setAnnouncement] = useState('')
  // A deep link already chose the tab; otherwise the first unread snapshot picks it once.
  const defaultTabAppliedRef = useRef(Boolean(notificationTabFromHash(window.location.hash)))
  const announcedUnreadRef = useRef<number | null>(null)

  useEffect(() => {
    if (isDemo || !userId) return
    setReady(false)
    setOlder([])
    setExhausted(false)
    const stopRecent = subscribeToUserNotifications(userId, (items) => {
      setRecent(items)
      setReady(true)
      setError('')
    }, () => {
      setError('Chưa thể đồng bộ thông báo. Hãy thử lại sau.')
      setReady(true)
    }, RECENT_PAGE_SIZE)
    const stopUnread = subscribeToUnreadNotifications(userId, (items) => {
      setUnread(items)
      if (!defaultTabAppliedRef.current) {
        defaultTabAppliedRef.current = true
        setTab(pickDefaultTab({ hashTab: null, unread: unreadCountsByTab(items), lastTab: readLastTab(userId) }))
      }
    }, () => {}, UNREAD_LIMIT)
    return () => {
      stopRecent()
      stopUnread()
    }
  }, [isDemo, userId])

  // A push or an in-app link can change `?tab=` while this page is already
  // mounted; `changeTab` uses replaceState, so this never loops.
  useEffect(() => {
    const syncTabFromHash = () => {
      const next = notificationTabFromHash(window.location.hash)
      if (!next) return
      defaultTabAppliedRef.current = true
      setTab(next)
    }
    window.addEventListener('hashchange', syncTabFromHash)
    return () => window.removeEventListener('hashchange', syncTabFromHash)
  }, [])

  useEffect(() => {
    if (isDemo) {
      setActions(demoActionItems(day))
      return
    }
    if (!userId) return
    let cancelled = false
    const nextWeekId = nextWeekMondayKey(day)
    listMyStudentPtSchedule(day, addDayKey(day, 6), nextWeekId)
      .then((data) => { if (!cancelled) setActions(buildActionItems(data, day, nextWeekId)) })
      .catch(() => { if (!cancelled) setActions([]) })
    return () => { cancelled = true }
  }, [day, isDemo, userId])

  const all = useMemo(() => {
    const base = isDemo ? demoNotifications(new Date()) : mergeNotifications(recent, unread, older)
    const applied = localRead.size ? base.map((item) => (!item.read && localRead.has(item.id) ? { ...item, read: true } : item)) : base
    return sortNotifications(applied)
  }, [isDemo, localRead, older, recent, unread])
  const counts = useMemo(() => unreadCountsByTab(all), [all])
  const totalUnread = counts.schedule + counts.payment + counts.availability + counts.other
  const visible = useMemo(() => all.filter((item) => notificationTabFor(item) === tab), [all, tab])
  const now = new Date()
  const tabDefinition = NOTIFICATION_TABS.find((item) => item.id === tab) ?? NOTIFICATION_TABS[0]
  // An unread reminder that opens the same place already covers the task;
  // the pinned row only reappears once that reminder has been read.
  const unreadLinks = new Set(visible.filter((item) => !item.read && item.actionUrl).map((item) => normalizeActionHash(item.actionUrl!)))
  const tabActions = actions.filter((item) => item.tab === tab && !unreadLinks.has(normalizeActionHash(item.href)))
  const tabUnreadIds = visible.filter((item) => !item.read).map((item) => item.id)

  useEffect(() => {
    if (!ready) return
    if (announcedUnreadRef.current === null) {
      announcedUnreadRef.current = totalUnread
      return
    }
    if (announcedUnreadRef.current === totalUnread) return
    announcedUnreadRef.current = totalUnread
    setAnnouncement(totalUnread > 0 ? `Bạn có ${totalUnread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo')
  }, [ready, totalUnread])

  const changeTab = useCallback((next: NotificationTabId) => {
    setTab(next)
    defaultTabAppliedRef.current = true
    try {
      window.history.replaceState(null, '', notificationTabHash(next))
      if (userId) window.localStorage.setItem(lastTabStorageKey(userId), next)
    } catch { /* storage and history are optional conveniences */ }
  }, [userId])

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setLocalRead((current) => new Set([...current, ...ids]))
    if (isDemo || !userId) return
    try {
      await markNotificationsAsRead(userId, ids)
    } catch {
      setError('Chưa thể cập nhật trạng thái đã đọc. Hãy thử lại.')
    }
  }, [isDemo, userId])

  const markTabRead = async () => {
    setMarking(true)
    await markRead(tabUnreadIds)
    setMarking(false)
  }

  const openHash = (hash: string) => {
    window.location.hash = normalizeActionHash(hash)
  }

  const openNotification = (notification: AppNotification) => {
    if (!notification.read) void markRead([notification.id])
    if (notification.actionUrl) openHash(notification.actionUrl)
  }

  const loadMore = async () => {
    if (!userId || isDemo || loadingMore) return
    const loaded = sortNotifications(mergeNotifications(recent, older))
    const cursor = loaded.length ? loaded[loaded.length - 1].createdAt : null
    if (!cursor) {
      setExhausted(true)
      return
    }
    setLoadingMore(true)
    try {
      const page = await loadOlderNotifications(userId, cursor, OLDER_PAGE_SIZE)
      setOlder((current) => mergeNotifications(current, page.items))
      setExhausted(page.exhausted)
    } catch {
      setError('Chưa tải được thông báo cũ hơn. Hãy thử lại.')
    } finally {
      setLoadingMore(false)
    }
  }

  const canLoadMore = ready && !isDemo && !exhausted && recent.length >= RECENT_PAGE_SIZE

  if (!isDemo && !userId) {
    return (
      <main className="page notifications-page">
        <div className="notifications-sheet">
          <div className="notifications-empty" role="status">
            <Bell size={28} aria-hidden="true" />
            <span>Đăng nhập để xem thông báo</span>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page notifications-page">
      <div className="notifications-sheet">
        <header className="notifications-head">
          <h1>Thông báo</h1>
          <div className="notifications-head__actions">
            <button
              type="button"
              aria-label="Đánh dấu đã đọc"
              title="Đánh dấu đã đọc"
              onClick={() => void markTabRead()}
              disabled={marking || tabUnreadIds.length === 0}
            >
              {marking ? <LoaderCircle className="spin" size={22} aria-hidden="true" /> : <CheckCheck size={22} aria-hidden="true" />}
            </button>
            <button type="button" aria-label="Cài đặt nhắc nhở" title="Cài đặt nhắc nhở" onClick={() => onNavigate('profile')}>
              <Settings2 size={22} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="sr-only" role="status" aria-atomic="true">{announcement}</div>

        <nav className="notifications-tabs" role="tablist" aria-label="Loại thông báo">
          {NOTIFICATION_TABS.map((definition) => {
            const count = counts[definition.id]
            const selected = tab === definition.id
            return (
              <button
                key={definition.id}
                type="button"
                role="tab"
                id={`notifications-tab-${definition.id}`}
                aria-selected={selected}
                aria-controls={`notifications-panel-${definition.id}`}
                aria-label={count > 0 ? `${definition.label}, ${count > 9 ? 'hơn 9' : count} chưa đọc` : definition.label}
                className={selected ? 'is-active' : ''}
                onClick={() => changeTab(definition.id)}
              >
                <span>{definition.label}{count > 0 && <i aria-hidden="true" />}</span>
              </button>
            )
          })}
        </nav>

        <section id={`notifications-panel-${tab}`} role="tabpanel" aria-labelledby={`notifications-tab-${tab}`} className="notifications-list">
          {error && <p className="notifications-note is-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
          {!ready && <p className="notifications-note" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" />Đang tải…</p>}

          <ul>
            {tabActions.map((item) => {
              const Icon = TAB_ICONS[item.tab]
              return (
                <li key={item.id}>
                  <button type="button" className={`nf-row is-pinned is-${item.tone}`} onClick={() => openHash(item.href)}>
                    <span className={`nf-row__avatar is-${item.tab}`}><Icon size={20} aria-hidden="true" /></span>
                    <span className="nf-row__body"><strong>{item.title}</strong><p>{item.detail}</p></span>
                    <em className="nf-row__cta">{item.cta}</em>
                  </button>
                </li>
              )
            })}
            {visible.map((notification) => {
              const Icon = TAB_ICONS[notificationTabFor(notification)]
              const time = relativeTimeLabel(notificationDate(notification.createdAt), now)
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    className={`nf-row${notification.read ? '' : ' is-unread'}${notification.priority === 'high' ? ' is-high' : ''}`}
                    onClick={() => openNotification(notification)}
                    aria-label={`${notification.read ? '' : 'Chưa đọc. '}${notification.title}. ${notification.message}. ${time}`}
                  >
                    <span className={`nf-row__avatar is-${notificationTabFor(notification)}`}><Icon size={20} aria-hidden="true" /></span>
                    <span className="nf-row__body"><strong>{notification.title}</strong><p>{notification.message}</p></span>
                    <span className="nf-row__dot" aria-hidden="true" />
                    <time className="nf-row__time">{time}</time>
                  </button>
                </li>
              )
            })}
          </ul>

          {ready && visible.length === 0 && tabActions.length === 0 && (
            <div className="notifications-empty">
              <Inbox size={28} aria-hidden="true" />
              <span>{tabDefinition.emptyTitle}</span>
            </div>
          )}

          {canLoadMore && (
            <button type="button" className="notifications-load-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Đang tải…' : 'Xem thêm'}
            </button>
          )}
        </section>
      </div>
    </main>
  )
}
