export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

type DateValue = Date | string | number | null | undefined
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VIETNAM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
})

function parseDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === '') return null
  // Calendar dates have no timezone. Validate before interpreting local midnight.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const check = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== value) return null
    return new Date(`${value}T00:00:00+07:00`)
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/** Convert an instant to the Aura business date, preserving date-only values. */
export function vietnamDateKey(value: DateValue): string {
  const date = parseDate(value)
  if (!date) return ''
  const parts = dateFormatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function vietnamToday(): string {
  return vietnamDateKey(new Date())
}

export function formatVietnamDate(value: DateValue): string {
  return vietnamDateKey(value).split('-').reverse().join('/')
}

export function formatVietnamDateTime(value: DateValue): string {
  const date = parseDate(value)
  return date ? dateTimeFormatter.format(date) : ''
}
