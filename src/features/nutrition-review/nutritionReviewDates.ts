export type ReviewPeriod = 'day' | 'week'

export function reviewToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shiftReviewDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function reviewDateRange(date: string, period: ReviewPeriod) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const startDate = period === 'week' ? shiftReviewDate(date, -((weekday + 6) % 7)) : date
  return { startDate, endDate: period === 'week' ? shiftReviewDate(startDate, 6) : startDate }
}

export function reviewDateLabel(date: string) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}
