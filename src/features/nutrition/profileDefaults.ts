import { Activity, Dumbbell, TrendingDown, type LucideIcon } from 'lucide-react'
import type { NutritionGoal, NutritionProfileDraft } from './types'

export const GOAL_LABELS: Record<string, string> = {
  'lose-fat': 'Giảm mỡ bền vững',
  'gain-muscle': 'Tăng cơ & phục hồi',
  maintain: 'Duy trì thể trạng',
  fat_loss: 'Giảm mỡ bền vững',
  muscle_gain: 'Tăng cơ & phục hồi',
  maintenance: 'Duy trì thể trạng',
  health: 'Cải thiện sức khỏe',
}

export const GOAL_OPTIONS: Array<{ value: NutritionGoal; title: string; description: string; icon: LucideIcon }> = [
  { value: 'lose-fat', title: 'Giảm mỡ', description: 'Thâm hụt vừa phải, ưu tiên no lâu', icon: TrendingDown },
  { value: 'gain-muscle', title: 'Tăng cơ', description: 'Đủ đạm và năng lượng để phục hồi', icon: Dumbbell },
  { value: 'maintain', title: 'Duy trì', description: 'Cân bằng thể chất và hiệu suất', icon: Activity },
]

export const DEFAULT_PROFILE: NutritionProfileDraft = {
  goal: 'lose-fat',
  age: 28,
  biologicalSex: 'female',
  heightCm: 162,
  weightKg: 58,
  targetWeightDeltaKg: -4,
  targetTimeframeMonths: 3,
  targetSpeedPace: 'standard',
  activityLevel: 'moderate',
  trainingSessions: 4,
  eatingStyle: 'Không giới hạn',
  allergies: '',
  mealsPerDay: 3,
  dislikes: '',
  budget: 'medium',
  prepTime: 'medium',
  favoriteCuisine: 'Đa dạng',
  reminders: {
    water: false,
    breakfast: false,
    lunch: false,
    dinner: false,
  },
}
