import type {
  AdminUserRecord,
  AppNotification,
  FitnessGoalTarget,
  NotificationCategory,
} from '../../../types'

export type PushAdminTab = 'overview' | 'compose' | 'automation' | 'history'

export type PushAudienceKey =
  | 'all'
  | 'goal_lose_fat'
  | 'goal_gain_muscle'
  | 'goal_maintain'
  | 'goal_health'
  | 'academy'
  | 'pref_workout'
  | 'pref_nutrition'
  | 'pref_learning'
  | 'pref_coach'
  | 'individual'

export interface PushComposerDraft {
  audience: PushAudienceKey
  userId: string
  type: AppNotification['type']
  category: NotificationCategory
  title: string
  message: string
  actionUrl: string
}

export const DEFAULT_PUSH_DRAFT: PushComposerDraft = {
  audience: 'all',
  userId: '',
  type: 'REMINDER',
  category: 'nutrition',
  title: 'Nhắc bạn cập nhật nhật ký dinh dưỡng',
  message: 'Hãy cập nhật bữa ăn hôm nay để Aura theo dõi tiến trình và đưa ra gợi ý phù hợp hơn cho bạn.',
  actionUrl: '/nutrition',
}

export const PUSH_AUDIENCE_OPTIONS: Array<{
  value: PushAudienceKey
  label: string
  description: string
}> = [
  { value: 'all', label: 'Toàn bộ học viên', description: 'Tất cả tài khoản học viên đang hoạt động' },
  { value: 'goal_lose_fat', label: 'Mục tiêu giảm mỡ', description: 'Học viên đặt mục tiêu giảm cân hoặc giảm mỡ' },
  { value: 'goal_gain_muscle', label: 'Mục tiêu tăng cơ', description: 'Học viên đặt mục tiêu tăng cơ' },
  { value: 'goal_maintain', label: 'Mục tiêu duy trì', description: 'Học viên muốn duy trì vóc dáng' },
  { value: 'goal_health', label: 'Mục tiêu sức khỏe', description: 'Học viên ưu tiên sức khỏe tổng thể' },
  { value: 'academy', label: 'Học viên Academy', description: 'Các tài khoản có vai trò học viên' },
  { value: 'pref_nutrition', label: 'Quan tâm dinh dưỡng', description: 'Đang bật nhắc bữa ăn' },
  { value: 'pref_workout', label: 'Quan tâm vận động', description: 'Đang bật nhắc tập luyện' },
  { value: 'pref_learning', label: 'Quan tâm học tập', description: 'Đang bật cập nhật bài học' },
  { value: 'pref_coach', label: 'Nhận tin từ Coach', description: 'Đang bật tin nhắn Coach/PT' },
  { value: 'individual', label: 'Một học viên', description: 'Chọn chính xác một tài khoản' },
]

const GOAL_ALIASES: Record<Exclude<FitnessGoalTarget, 'all'>, string[]> = {
  'lose-fat': ['lose-fat', 'lose_fat', 'fat-loss', 'fat_loss', 'weight-loss', 'weight_loss', 'giảm mỡ', 'giảm cân'],
  'gain-muscle': ['gain-muscle', 'gain_muscle', 'muscle-gain', 'muscle_gain', 'tăng cơ'],
  maintain: ['maintain', 'maintenance', 'duy trì'],
  health: ['health', 'healthy', 'sức khỏe'],
}

function normalizedText(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('vi-VN')
}

function matchesGoal(user: AdminUserRecord, goal: Exclude<FitnessGoalTarget, 'all'>) {
  const values = [user.nutritionProfile?.goal, ...(user.goals ?? [])].map(normalizedText)
  return values.some((value) => GOAL_ALIASES[goal].includes(value))
}

export function isStudentUser(user: AdminUserRecord) {
  return user.role === 'student' && user.status !== 'disabled'
}

export function filterAudienceUsers(
  users: AdminUserRecord[],
  audience: PushAudienceKey,
  userId: string,
) {
  const students = users.filter(isStudentUser)
  switch (audience) {
    case 'individual':
      return students.filter((user) => user.uid === userId)
    case 'goal_lose_fat':
      return students.filter((user) => matchesGoal(user, 'lose-fat'))
    case 'goal_gain_muscle':
      return students.filter((user) => matchesGoal(user, 'gain-muscle'))
    case 'goal_maintain':
      return students.filter((user) => matchesGoal(user, 'maintain'))
    case 'goal_health':
      return students.filter((user) => matchesGoal(user, 'health'))
    case 'pref_workout':
      return students.filter((user) => user.notificationSettings?.enabled !== false && user.notificationSettings?.workoutReminders !== false)
    case 'pref_nutrition':
      return students.filter((user) => user.notificationSettings?.enabled !== false && user.notificationSettings?.mealReminders !== false)
    case 'pref_learning':
      return students.filter((user) => user.notificationSettings?.enabled !== false && user.notificationSettings?.learningUpdates !== false)
    case 'pref_coach':
      return students.filter((user) => user.notificationSettings?.enabled !== false && user.notificationSettings?.coachMessages !== false)
    case 'academy':
    case 'all':
    default:
      return students
  }
}

export function audienceLabel(value: PushAudienceKey) {
  return PUSH_AUDIENCE_OPTIONS.find((item) => item.value === value)?.label ?? 'Nhóm học viên'
}

export function categoryLabel(value?: NotificationCategory) {
  return ({
    workout: 'Vận động',
    nutrition: 'Dinh dưỡng',
    learning: 'Học tập',
    coach: 'Coach/PT',
    general: 'Chung',
  } as Record<NotificationCategory, string>)[value ?? 'general']
}

export function notificationTypeLabel(value: AppNotification['type']) {
  return ({
    REMINDER: 'Nhắc nhở',
    INFO: 'Thông tin',
    ALERT: 'Quan trọng',
    ANNOUNCEMENT: 'Thông báo',
    WORKOUT: 'Buổi tập',
    MOTIVATION: 'Động lực',
    PROMOTION: 'Ưu đãi',
  } as Record<AppNotification['type'], string>)[value]
}

export function formatPushTime(value: unknown, fallback = 'Chưa có dữ liệu') {
  const dateValue = value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate?: () => Date }).toDate?.()
    : value
  const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue ?? ''))
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('vi-VN')
}
