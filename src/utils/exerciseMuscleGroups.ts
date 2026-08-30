import type { ExerciseCatalogItem } from '../types'

export const EXERCISE_MUSCLE_GROUPS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'glutes', label: 'Mông' },
  { id: 'quadriceps', label: 'Đùi trước' },
  { id: 'hamstrings', label: 'Đùi sau' },
  { id: 'inner_outer_thigh', label: 'Đùi trong & ngoài' },
  { id: 'back', label: 'Lưng & xô' },
  { id: 'shoulders', label: 'Vai' },
  { id: 'chest_arms', label: 'Ngực & tay' },
  { id: 'core', label: 'Core' },
  { id: 'calves', label: 'Bắp chân' },
] as const

export type ExerciseMuscleGroupId = typeof EXERCISE_MUSCLE_GROUPS[number]['id']

const groupTerms: Record<Exclude<ExerciseMuscleGroupId, 'all'>, string[]> = {
  glutes: ['mong', 'glute'],
  quadriceps: ['dui truoc', 'quadricep', 'quad'],
  hamstrings: ['dui sau', 'hamstring'],
  inner_outer_thigh: ['dui trong', 'dui ngoai', 'co khep', 'co dang hong', 'adductor', 'abductor'],
  back: ['lung', 'co xo', 'latissimus', 'lat'],
  shoulders: ['vai', 'deltoid', 'co xoay vai'],
  chest_arms: ['nguc', 'tay truoc', 'tay sau', 'bicep', 'tricep'],
  core: ['core', 'bung', 'co xien', 'oblique'],
  calves: ['bap chan', 'calf', 'soleus'],
}

function normalized(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
}

function classificationText(item: ExerciseCatalogItem) {
  return normalized([...item.targetMuscles, ...item.secondaryMuscles, ...item.bodyParts].join(' | '))
}

export function exerciseMatchesMuscleGroup(item: ExerciseCatalogItem, groupId: ExerciseMuscleGroupId) {
  if (groupId === 'all') return true
  const text = classificationText(item)
  return groupTerms[groupId].some((term) => text.includes(normalized(term)))
}

export function exerciseMuscleGroupOptions(items: ExerciseCatalogItem[]) {
  return EXERCISE_MUSCLE_GROUPS.map((group) => ({
    ...group,
    count: group.id === 'all' ? items.length : items.filter((item) => exerciseMatchesMuscleGroup(item, group.id)).length,
  })).filter((group) => group.id === 'all' || group.count > 0)
}
