export function durationLabel(value: number) {
  const minutes = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
  if (minutes < 60) return `${minutes} phút`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return `${hours} giờ${remainingMinutes ? ` ${remainingMinutes} phút` : ''}`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days} ngày${remainingHours ? ` ${remainingHours} giờ` : ''}`
}
