export interface NutritionReadPolicy {
  day: boolean
  plan: boolean
  calendar: boolean
}

export function nutritionReadPolicy(section: string, editingDay = false): NutritionReadPolicy {
  return {
    day: editingDay || ['today', 'diary', 'classic-diary', 'assistant'].includes(section),
    plan: section === 'plan' || section === 'menu',
    calendar: section === 'diary',
  }
}

/** Active subscriptions only: the final consumer detaches the SDK listener. */
export function createSharedNutritionSubscriptions<T>() {
  const active = new Map<string, { listeners: Set<(value: T) => void>; stop: () => void; latest?: T }>()
  return (key: string, start: (emit: (value: T) => void) => () => void, receive: (value: T) => void) => {
    let entry = active.get(key)
    if (!entry) {
      entry = { listeners: new Set(), stop: () => {} }
      active.set(key, entry)
      const current = entry
      current.listeners.add(receive)
      try {
        current.stop = start((value) => {
          if (active.get(key) !== current) return
          current.latest = value
          for (const listener of current.listeners) listener(value)
        })
      } catch (error) { active.delete(key); throw error }
    } else {
      entry.listeners.add(receive)
      if (entry.latest !== undefined) receive(entry.latest)
    }
    const current = entry
    return () => {
      current.listeners.delete(receive)
      if (!current.listeners.size && active.get(key) === current) {
        active.delete(key)
        current.stop()
      }
    }
  }
}

export function localNutritionDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function nutritionDateAfter(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return localNutritionDate(new Date(year, month - 1, day + days, 12))
}
