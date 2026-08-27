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

export type MealImageShape = 'square' | 'portrait'

export function mealImageShape(width: number, height: number): MealImageShape {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'square'
  }
  return height / width >= 1.2 ? 'portrait' : 'square'
}
