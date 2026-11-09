import type { AppNotification } from '../../types'

/**
 * Pure helpers for the notification pages: which tab an inbox item belongs to
 * for each audience (learner, staff at work, admin), unread badges, default
 * tab choice and labels. Kept free of React and Firebase so the rules can be
 * unit tested.
 */

export type NotificationAudience = 'learner' | 'staff' | 'admin'
export type LearnerTabId = 'schedule' | 'payment' | 'availability' | 'other'
export type StaffTabId = 'teaching' | 'requests' | 'members' | 'finance' | 'other'
export type NotificationTabId = LearnerTabId | StaffTabId

export interface NotificationTabDefinition {
  id: NotificationTabId
  label: string
  emptyTitle: string
}

export const NOTIFICATION_TABS: NotificationTabDefinition[] = [
  { id: 'schedule', label: 'Lịch tập', emptyTitle: 'Chưa có thông báo lịch tập' },
  { id: 'payment', label: 'Thanh toán', emptyTitle: 'Chưa có thông báo thanh toán' },
  { id: 'availability', label: 'Lịch rảnh', emptyTitle: 'Chưa có nhắc nhở lịch rảnh' },
  { id: 'other', label: 'Khác', emptyTitle: 'Chưa có thông báo khác' },
]

const STAFF_TABS: NotificationTabDefinition[] = [
  { id: 'teaching', label: 'Lịch dạy', emptyTitle: 'Chưa có thông báo lịch dạy' },
  { id: 'requests', label: 'Yêu cầu', emptyTitle: 'Chưa có yêu cầu mới' },
  { id: 'members', label: 'Học viên', emptyTitle: 'Chưa có thông báo học viên' },
  { id: 'other', label: 'Khác', emptyTitle: 'Chưa có thông báo khác' },
]

const ADMIN_TABS: NotificationTabDefinition[] = [
  { id: 'requests', label: 'Yêu cầu', emptyTitle: 'Không có yêu cầu chờ duyệt' },
  { id: 'finance', label: 'Tài chính', emptyTitle: 'Chưa có thông báo tài chính' },
  { id: 'members', label: 'Học viên', emptyTitle: 'Chưa có thông báo học viên' },
  { id: 'teaching', label: 'Vận hành', emptyTitle: 'Chưa có thông báo vận hành' },
  { id: 'other', label: 'Khác', emptyTitle: 'Chưa có thông báo khác' },
]

const TAB_PRIORITY: Record<NotificationAudience, NotificationTabId[]> = {
  learner: ['payment', 'schedule', 'availability', 'other'],
  staff: ['requests', 'teaching', 'members', 'other'],
  admin: ['requests', 'finance', 'teaching', 'members', 'other'],
}

const PAGE_VIEWS: Record<NotificationAudience, string> = {
  learner: 'notifications',
  staff: 'staff-notifications',
  admin: 'admin-inbox',
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DAY_MS = 86_400_000

export function notificationTabsFor(audience: NotificationAudience = 'learner'): NotificationTabDefinition[] {
  if (audience === 'admin') return ADMIN_TABS
  if (audience === 'staff') return STAFF_TABS
  return NOTIFICATION_TABS
}

export function isNotificationTabId(value: unknown, audience: NotificationAudience = 'learner'): value is NotificationTabId {
  return typeof value === 'string' && notificationTabsFor(audience).some((tab) => tab.id === value)
}

function learnerTabFor(notification: Pick<AppNotification, 'category' | 'type' | 'kind'>): LearnerTabId {
  const category = String(notification.category || '').toLowerCase()
  if (category === 'workout') return 'schedule'
  if (category === 'payment') return 'payment'
  if (category === 'availability') return 'availability'
  if (category) return 'other'
  const kind = String(notification.kind || '')
  if (kind.startsWith('availability')) return 'availability'
  if (kind.startsWith('session') || kind.startsWith('schedule')) return 'schedule'
  const type = String(notification.type || '').toUpperCase()
  if (type === 'WORKOUT') return 'schedule'
  if (type === 'PAYMENT') return 'payment'
  return 'other'
}

function staffTabFor(notification: Pick<AppNotification, 'category' | 'type' | 'kind'>): StaffTabId {
  const kind = String(notification.kind || '')
  const type = String(notification.type || '').toLowerCase()
  const category = String(notification.category || '').toLowerCase()
  if (['staff_request_pending', 'staff_request_fyi', 'staff_pause_request'].includes(kind)) return 'requests'
  if (kind === 'staff_claim_pending' || category === 'payment') return 'finance'
  if (type === 'renewal_reminder' || type === 'crm' || ['loyalty', 'nutrition', 'coach'].includes(category)) return 'members'
  if (category === 'workout' || category === 'operations' || kind.startsWith('staff_') || kind === 'pt_attendance_confirmation' || type === 'pt_schedule') return 'teaching'
  return 'other'
}

/** Category and kind decide the tab; staff without a finance tab see finance items under Khác. */
export function notificationTabFor(notification: Pick<AppNotification, 'category' | 'type' | 'kind'>, audience: NotificationAudience = 'learner'): NotificationTabId {
  if (audience === 'learner') return learnerTabFor(notification)
  const tab = staffTabFor(notification)
  return isNotificationTabId(tab, audience) ? tab : 'other'
}

export function notificationTabFromHash(hash: string, audience: NotificationAudience = 'learner'): NotificationTabId | null {
  const value = new URLSearchParams(hash.split('?')[1] ?? '').get('tab')
  return isNotificationTabId(value, audience) ? value : null
}

export function notificationTabHash(tab: NotificationTabId, audience: NotificationAudience = 'learner') {
  return `#/${PAGE_VIEWS[audience]}?tab=${tab}`
}

export type UnreadByTab = Partial<Record<NotificationTabId, number>>

export function unreadCountsByTab(notifications: Iterable<AppNotification>, audience: NotificationAudience = 'learner'): UnreadByTab {
  const counts: UnreadByTab = Object.fromEntries(notificationTabsFor(audience).map((tab) => [tab.id, 0]))
  for (const notification of notifications) {
    if (notification.read) continue
    const tab = notificationTabFor(notification, audience)
    counts[tab] = (counts[tab] ?? 0) + 1
  }
  return counts
}

/** A deep link wins; otherwise the most pressing tab with unread items; otherwise the last one opened. */
export function pickDefaultTab({ hashTab, unread, lastTab, audience = 'learner' }: { hashTab: NotificationTabId | null; unread: UnreadByTab; lastTab: NotificationTabId | null; audience?: NotificationAudience }): NotificationTabId {
  if (hashTab) return hashTab
  const priority = TAB_PRIORITY[audience]
  return priority.find((tab) => (unread[tab] ?? 0) > 0) ?? (lastTab && isNotificationTabId(lastTab, audience) ? lastTab : notificationTabsFor(audience)[0].id)
}

export function notificationDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number }
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate()
      return Number.isNaN(date.getTime()) ? null : date
    }
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000)
    return null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: VIETNAM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

export function vietnamDayKey(date: Date) {
  return dayKeyFormatter.format(date)
}

export function addDayKey(key: string, days: number) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function dayKeyDistance(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS)
}

/** Monday of the week after the one containing `todayKey`. */
export function nextWeekMondayKey(todayKey: string) {
  const weekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay()
  return addDayKey(todayKey, ((8 - weekday) % 7) || 7)
}

export function formatDayKey(key: string) {
  const [, month, day] = key.split('-')
  return `${day}/${month}`
}

export function formatWeekRange(weekId: string) {
  const end = addDayKey(weekId, 6)
  const [, startMonth, startDay] = weekId.split('-')
  const [, endMonth, endDay] = end.split('-')
  return startMonth === endMonth ? `${startDay}–${endDay}/${endMonth}` : `${startDay}/${startMonth}–${endDay}/${endMonth}`
}

/** Short age label in the style of a messaging inbox: "5 phút", "2 giờ", "Hôm qua", "3 ngày", then the date. */
export function relativeTimeLabel(date: Date | null, now: Date) {
  if (!date) return 'Vừa xong'
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) return 'Vừa xong'
  if (minutes < 60) return `${minutes} phút`
  const days = dayKeyDistance(vietnamDayKey(date), vietnamDayKey(now))
  if (days <= 0) return `${Math.floor(minutes / 60)} giờ`
  if (days === 1) return 'Hôm qua'
  if (days < 7) return `${days} ngày`
  return formatDayKey(vietnamDayKey(date))
}

/** Inbox items store hash routes in a few historical spellings; normalise to `#/view?...`. */
export function normalizeActionHash(actionUrl: string) {
  if (actionUrl.startsWith('/#/')) return actionUrl.slice(1)
  if (actionUrl.startsWith('#/')) return actionUrl
  return `#${actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`}`
}

export function sortNotifications(items: AppNotification[]) {
  return [...items].sort((left, right) => {
    const leftTime = notificationDate(left.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY
    const rightTime = notificationDate(right.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY
    return rightTime - leftTime || left.id.localeCompare(right.id)
  })
}

/** First occurrence wins, so pass the freshest live snapshot first. */
export function mergeNotifications(...lists: AppNotification[][]) {
  const seen = new Map<string, AppNotification>()
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) seen.set(item.id, item)
    }
  }
  return [...seen.values()]
}

export function demoNotifications(now: Date, audience: NotificationAudience = 'learner'): AppNotification[] {
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
  const nextWeek = nextWeekMondayKey(vietnamDayKey(now))
  if (audience === 'staff') {
    return [
      {
        id: 'demo-staff-d1', userId: 'demo', read: false, type: 'REMINDER', category: 'operations', kind: 'staff_teaching_d1',
        title: 'Mai bạn có 6 ca dạy', message: '07:00–20:00 · 5 học viên.', actionUrl: '#/staff-schedule', createdAt: minutesAgo(30),
      },
      {
        id: 'demo-staff-request', userId: 'demo', read: false, type: 'INFO', category: 'operations', kind: 'staff_request_fyi',
        title: 'An Nguyễn xin đổi buổi', message: 'T4 18:00 → T5 19:00. Admin đang duyệt yêu cầu.', actionUrl: '#/staff-schedule', createdAt: minutesAgo(3 * 60),
      },
      {
        id: 'demo-staff-week', userId: 'demo', read: true, type: 'INFO', category: 'operations', kind: 'staff_schedule_published',
        title: `Lịch dạy tuần ${formatWeekRange(nextWeek)} đã phát hành`, message: '18 ca · T2 (4), T3 (3), T4 (4), T6 (4), T7 (3).', actionUrl: '#/staff-schedule', createdAt: minutesAgo(26 * 60),
      },
      {
        id: 'demo-staff-renewal', userId: 'demo', read: true, type: 'renewal_reminder', category: 'operations',
        title: 'Hồ sơ tái ký cần xử lý', message: 'Bình Trần · PT 24 buổi · đến hạn hôm nay', actionUrl: '#/staff-renewals', createdAt: minutesAgo(2 * 24 * 60),
      },
    ] as AppNotification[]
  }
  if (audience === 'admin') {
    return [
      {
        id: 'demo-admin-request', userId: 'demo', read: false, type: 'INFO', category: 'operations', kind: 'staff_request_pending', priority: 'high',
        title: 'Học viên xin đổi buổi', message: 'An Nguyễn · T4 12/11 18:00 → T5 13/11 19:00 · PT Minh', actionUrl: '#/admin-training-history?focus=requests', createdAt: minutesAgo(15),
      },
      {
        id: 'demo-admin-pause', userId: 'demo', read: false, type: 'INFO', category: 'operations', kind: 'staff_pause_request',
        title: 'Yêu cầu bảo lưu mới', message: 'Chi Lê · 16/11–15/12 (30 ngày)', actionUrl: '#/admin-training-history?focus=requests', createdAt: minutesAgo(90),
      },
      {
        id: 'demo-admin-claim', userId: 'demo', read: false, type: 'PAYMENT', category: 'payment', kind: 'staff_claim_pending',
        title: 'Báo chuyển khoản mới', message: 'Dũng Phạm · 4.000.000đ · kỳ 2 · PT 24 buổi', actionUrl: '#/admin-finance', createdAt: minutesAgo(5 * 60),
      },
      {
        id: 'demo-admin-feedback', userId: 'demo', read: true, type: 'ALERT', category: 'operations', kind: 'staff_feedback_review',
        title: 'Phản hồi cần xem · 2/5', message: 'PT Minh · buổi T3 11/11 18:00 · Thái độ', actionUrl: '#/admin-trainer-quality', createdAt: minutesAgo(26 * 60),
      },
    ] as AppNotification[]
  }
  return [
    {
      id: 'demo-session-d1', userId: 'demo', read: false, type: 'REMINDER', category: 'workout', kind: 'session_d1',
      title: 'Mai bạn có buổi PT 18:00', message: 'T3 · PT Minh. Cần đổi hoặc hủy, hãy gửi yêu cầu trước 06:00 ngày mai.',
      actionUrl: '#/schedule?tab=this-week', ctaLabel: 'Mở lịch', createdAt: minutesAgo(40),
    },
    {
      id: 'demo-installment-due', userId: 'demo', read: false, type: 'PAYMENT', category: 'payment', kind: 'installment_due', priority: 'high',
      title: 'Kỳ thanh toán đến hạn hôm nay', message: 'PT Personal 24 buổi · 4.000.000đ · hạn hôm nay. Quét mã QR trong app để thanh toán trong 1 phút.',
      actionUrl: '#/schedule?tab=contract&pay=demo-contract~demo-payment-2', ctaLabel: 'Thanh toán', createdAt: minutesAgo(6 * 60),
    },
    {
      id: 'demo-availability-remind', userId: 'demo', read: false, type: 'REMINDER', category: 'availability', kind: 'availability_remind',
      title: 'Còn 18 giờ để gửi lịch rảnh', message: `Tuần ${formatWeekRange(nextWeek)}: chưa gửi thì Aura dùng lịch bạn gửi gần nhất (6 khung).`,
      actionUrl: `#/student-availability?week=${nextWeek}`, ctaLabel: 'Gửi lịch rảnh', createdAt: minutesAgo(26 * 60),
    },
    {
      id: 'demo-request-approved', userId: 'demo', read: true, type: 'INFO', category: 'workout',
      title: 'Lịch đổi ca đã được xác nhận', message: 'Buổi T5 19:00 đã được dời sang T6 18:00 · PT Minh.',
      actionUrl: '#/schedule?tab=this-week', createdAt: minutesAgo(3 * 24 * 60),
    },
    {
      id: 'demo-kudos', userId: 'demo', read: true, type: 'MOTIVATION', category: 'loyalty',
      title: 'PT vừa gửi bạn một lời khen', message: 'Buổi hôm nay bạn giữ form squat rất tốt. Tiếp tục nhé!',
      actionUrl: '#/aura-club', createdAt: minutesAgo(9 * 24 * 60),
    },
  ]
}
