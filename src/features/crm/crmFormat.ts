import type { CrmActivityOutcome, CrmActivityType, CrmAppointmentKind, CrmAppointmentStatus, CrmLostReason, CrmPlatform, CrmStage } from './crmTypes'

export const CRM_STAGES: CrmStage[] = ['new_inbox', 'qualified', 'consulting', 'trial_booked', 'trial_done', 'quote_sent', 'won', 'lost', 'nurture']

export const STAGE_LABELS: Record<CrmStage, string> = {
  new_inbox: 'Khách mới nhắn',
  qualified: 'Đủ thông tin',
  consulting: 'Đang tư vấn',
  trial_booked: 'Đã hẹn trải nghiệm',
  trial_done: 'Đã trải nghiệm',
  quote_sent: 'Đã gửi báo giá',
  won: 'Thắng',
  lost: 'Mất',
  nurture: 'Nuôi lại',
}

export const STAGE_TONES: Record<CrmStage, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'pink'> = {
  new_inbox: 'pink',
  qualified: 'info',
  consulting: 'info',
  trial_booked: 'warning',
  trial_done: 'warning',
  quote_sent: 'warning',
  won: 'success',
  lost: 'danger',
  nurture: 'neutral',
}

export const LOST_REASONS: Record<CrmLostReason, string> = {
  price: 'Giá chưa phù hợp',
  distance: 'Xa chi nhánh',
  schedule: 'Không hợp lịch',
  no_need: 'Hết nhu cầu',
  competitor: 'Chọn nơi khác',
  no_response: 'Không phản hồi',
  other: 'Lý do khác',
}

export const PLATFORM_LABELS: Record<CrmPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  zalo: 'Zalo OA',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Website',
  other: 'Kênh khác',
}

export const ACTIVITY_LABELS: Record<CrmActivityType | 'stage_change' | 'assignment', string> = {
  call: 'Cuộc gọi',
  zalo: 'Tin nhắn Zalo',
  meeting: 'Gặp / hẹn',
  note: 'Ghi chú',
  message: 'Tin nhắn',
  stage_change: 'Đổi giai đoạn',
  assignment: 'Phân công',
}

export const OUTCOME_LABELS: Record<CrmActivityOutcome, string> = {
  connected: 'Đã nói chuyện',
  no_answer: 'Không nghe máy',
  interested: 'Quan tâm',
  not_interested: 'Không quan tâm',
  callback: 'Hẹn gọi lại',
  booked: 'Đã đặt lịch',
  other: 'Khác',
}

export const APPOINTMENT_KIND_LABELS: Record<CrmAppointmentKind, string> = {
  trial: 'Tập thử',
  consult: 'Tư vấn',
  inbody: 'Đo InBody',
}

export const APPOINTMENT_STATUS_LABELS: Record<CrmAppointmentStatus, string> = {
  booked: 'Đã đặt',
  attended: 'Đã đến',
  no_show: 'Không đến',
  cancelled: 'Đã hủy',
}

const timeFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })

export function formatTime(value: string | null) {
  return value ? timeFormatter.format(new Date(value)) : ''
}

export function formatDateTime(value: string | null) {
  if (!value) return '—'
  // "09:55 · 09/11": the vi-VN locale would print "09:55 09-11".
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]))
  return `${parts.hour}:${parts.minute} · ${parts.day}/${parts.month}`
}

export function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : '—'
}

export function vietnamDayKey(value: string | null) {
  if (!value) return ''
  return new Date(new Date(value).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}

export function durationLabel(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}`
  return `${Math.floor(hours / 24)} ngày`
}

export function ago(value: string | null, now = Date.now()) {
  if (!value) return ''
  const elapsed = now - new Date(value).getTime()
  return elapsed < 60_000 ? 'vừa xong' : `${durationLabel(elapsed)} trước`
}

export function dueLabel(value: string | null, now = Date.now()) {
  if (!value) return 'Không hạn'
  const difference = new Date(value).getTime() - now
  if (Math.abs(difference) < 60_000) return 'Đến hạn ngay'
  return difference > 0 ? `Còn ${durationLabel(difference)}` : `Quá ${durationLabel(-difference)}`
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ''}` : parts[0]?.slice(0, 2) || '?').toUpperCase()
}

export function formatVnd(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(value))}đ`
}

export function localInputValue(date: Date) {
  const local = new Date(date.getTime() + 7 * 3_600_000)
  return local.toISOString().slice(0, 16)
}

// <input type="datetime-local"> values are Vietnam wall-clock times.
export function fromLocalInputValue(value: string) {
  return value ? new Date(`${value}:00+07:00`).toISOString() : ''
}

export function telHref(display: string) {
  return `tel:${display.replace(/\s/g, '')}`
}

export function zaloHref(display: string) {
  const digits = display.replace(/\D/g, '')
  return `https://zalo.me/${digits.startsWith('84') ? `0${digits.slice(2)}` : digits}`
}
