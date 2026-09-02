export interface ProgressScoreInput {
  adherence: {
    mealLoggingRate: number // 0-100
    calorieTargetRate: number // 0-100
    proteinTargetRate: number // 0-100
    hydrationRate: number // 0-100
    dailyTaskRate: number // 0-100
  }
  nutrition: {
    calorieScore: number // 0-100
    proteinScore: number // 0-100
    fiberScore?: number // 0-100
    fruitVegetableScore?: number // 0-100
    mealDistributionScore?: number // 0-100
  }
  activity: {
    workoutCompletionScore: number // 0-100
    activeMinutesScore: number // 0-100
    trainingBalanceScore?: number // 0-100
    consistencyScore: number // 0-100
  }
  body: {
    weightTrendScore?: number // 0-100
    measurementTrendScore?: number // 0-100
    bodyCompositionScore?: number // 0-100
    progressPhotoScore?: number // 0-100
  }
  tracking: {
    mealTrackingRate: number // 0-100
    weightTrackingRate: number // 0-100
    workoutTrackingRate: number // 0-100
    hydrationTrackingRate: number // 0-100
    measurementTrackingRate?: number // 0-100
  }
}

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface ProgressScoreBreakdown {
  adherence: number
  nutrition: number
  activity: number
  bodyProgress: number
  tracking: number
}

export interface ProgressScoreResult {
  total: number
  breakdown: ProgressScoreBreakdown
  confidence: ConfidenceLevel
  dataCoverage: number
  statusTag: string
  classification: string
  isSettingUp?: boolean
  setupMessage?: string
}

export interface WeightedValue {
  value?: number
  weight: number
}

export function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function weightedAverage(items: WeightedValue[]): number {
  const validItems = items.filter(
    (item): item is { value: number; weight: number } =>
      typeof item.value === 'number' && Number.isFinite(item.value)
  )
  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight === 0) return 0
  const total = validItems.reduce(
    (sum, item) => sum + clampScore(item.value) * item.weight,
    0
  )
  return total / totalWeight
}

export function scoreTargetRange(
  actual: number,
  target: number,
  tolerance = 0.1
): number {
  if (target <= 0) return 0
  const ratio = actual / target
  const difference = Math.abs(1 - ratio)
  if (difference <= tolerance) return 100
  if (difference <= 0.15) return 85
  if (difference <= 0.2) return 65
  if (difference <= 0.3) return 40
  return 20
}

export function scoreMinimumTarget(actual: number, target: number): number {
  if (target <= 0) return 0
  const ratio = actual / target
  if (ratio >= 0.9 && ratio <= 1.25) return 100
  if (ratio >= 0.8) return 85
  if (ratio >= 0.7) return 70
  if (ratio >= 0.5) return 45
  return 20
}

export function scoreBodyTrend(
  actualWeeklyChange: number,
  targetWeeklyChange: number
): number {
  if (Math.abs(targetWeeklyChange) < 0.01) {
    const change = Math.abs(actualWeeklyChange)
    if (change <= 0.1) return 100
    if (change <= 0.2) return 85
    if (change <= 0.4) return 60
    return 30
  }
  const sameDirection =
    Math.sign(actualWeeklyChange) === Math.sign(targetWeeklyChange)
  if (!sameDirection) {
    return 25
  }
  const completionRatio =
    Math.abs(actualWeeklyChange) / Math.abs(targetWeeklyChange)
  if (completionRatio >= 0.75 && completionRatio <= 1.25) {
    return 100
  }
  if (completionRatio >= 0.5 && completionRatio <= 1.5) {
    return 80
  }
  if (completionRatio >= 0.25 && completionRatio <= 1.75) {
    return 55
  }
  return 35
}

export function calculateDataCoverage(params: {
  mealLoggedDays: number
  expectedMealDays: number
  weightEntries: number
  expectedWeightEntries: number
  workoutEntries: number
  expectedWorkoutEntries: number
}): number {
  const mealCoverage =
    params.expectedMealDays > 0
      ? params.mealLoggedDays / params.expectedMealDays
      : 0
  const weightCoverage =
    params.expectedWeightEntries > 0
      ? params.weightEntries / params.expectedWeightEntries
      : 0
  const workoutCoverage =
    params.expectedWorkoutEntries > 0
      ? params.workoutEntries / params.expectedWorkoutEntries
      : 0

  return Math.round(
    Math.min(
      1,
      mealCoverage * 0.5 + weightCoverage * 0.25 + workoutCoverage * 0.25
    ) * 100
  )
}

export function getConfidence(dataCoverage: number): ConfidenceLevel {
  if (dataCoverage >= 80) return 'high'
  if (dataCoverage >= 50) return 'medium'
  return 'low'
}

export function getClassificationText(score: number): {
  classification: string
  statusTag: string
} {
  if (score >= 90)
    return { classification: 'Xuất sắc', statusTag: 'Xuất sắc! 🌟' }
  if (score >= 80)
    return { classification: 'Đang đi đúng hướng', statusTag: 'Đang đi đúng hướng! 🎯' }
  if (score >= 70) return { classification: 'Khá tốt', statusTag: 'Khá tốt! 👍' }
  if (score >= 60)
    return { classification: 'Cần điều chỉnh nhẹ', statusTag: 'Cần điều chỉnh nhẹ 💡' }
  if (score >= 40)
    return { classification: 'Cần xem lại kế hoạch', statusTag: 'Cần xem lại kế hoạch 🔍' }
  return { classification: 'Chưa đủ mức tuân thủ', statusTag: 'Chưa đủ mức tuân thủ 📋' }
}

export function calculateProgressScore(
  input: ProgressScoreInput,
  daysOfData = 7
): ProgressScoreResult {
  if (daysOfData < 3) {
    return {
      total: 0,
      breakdown: {
        adherence: 0,
        nutrition: 0,
        activity: 0,
        bodyProgress: 0,
        tracking: 0,
      },
      confidence: 'low',
      dataCoverage: Math.round((daysOfData / 7) * 100),
      statusTag: 'Đang khởi tạo ⏳',
      classification: 'Chưa đủ dữ liệu',
      isSettingUp: true,
      setupMessage:
        'Đang thiết lập điểm tiến độ. Hãy ghi bữa ăn, cân nặng và vận động trong ít nhất 3 ngày.',
    }
  }

  const adherenceScore = weightedAverage([
    { value: input.adherence.mealLoggingRate, weight: 0.375 },
    { value: input.adherence.calorieTargetRate, weight: 0.25 },
    { value: input.adherence.proteinTargetRate, weight: 0.2 },
    { value: input.adherence.hydrationRate, weight: 0.1 },
    { value: input.adherence.dailyTaskRate, weight: 0.075 },
  ])

  const nutritionScore = weightedAverage([
    { value: input.nutrition.calorieScore, weight: 0.35 },
    { value: input.nutrition.proteinScore, weight: 0.3 },
    { value: input.nutrition.fiberScore, weight: 0.15 },
    { value: input.nutrition.fruitVegetableScore, weight: 0.1 },
    { value: input.nutrition.mealDistributionScore, weight: 0.1 },
  ])

  const activityScore = weightedAverage([
    { value: input.activity.workoutCompletionScore, weight: 0.5 },
    { value: input.activity.activeMinutesScore, weight: 0.25 },
    { value: input.activity.trainingBalanceScore, weight: 0.15 },
    { value: input.activity.consistencyScore, weight: 0.1 },
  ])

  const bodyProgressScore = weightedAverage([
    { value: input.body.weightTrendScore, weight: 0.45 },
    { value: input.body.measurementTrendScore, weight: 0.25 },
    { value: input.body.bodyCompositionScore, weight: 0.2 },
    { value: input.body.progressPhotoScore, weight: 0.1 },
  ])

  const trackingScore = weightedAverage([
    { value: input.tracking.mealTrackingRate, weight: 0.3 },
    { value: input.tracking.weightTrackingRate, weight: 0.25 },
    { value: input.tracking.workoutTrackingRate, weight: 0.2 },
    { value: input.tracking.hydrationTrackingRate, weight: 0.15 },
    { value: input.tracking.measurementTrackingRate, weight: 0.1 },
  ])

  const totalScore =
    adherenceScore * 0.4 +
    nutritionScore * 0.25 +
    activityScore * 0.15 +
    bodyProgressScore * 0.15 +
    trackingScore * 0.05

  const finalTotal = Math.round(clampScore(totalScore))
  // Coverage must reflect records that actually exist, not the selected
  // period length. The previous calculation returned high confidence for a
  // user with zero logs simply because the period was seven days long.
  const dataCoverage = Math.round(clampScore(
    input.adherence.mealLoggingRate * 0.5
      + input.tracking.weightTrackingRate * 0.25
      + input.tracking.workoutTrackingRate * 0.25,
  ))
  const confidence = getConfidence(dataCoverage)
  const { classification, statusTag } = getClassificationText(finalTotal)

  return {
    total: finalTotal,
    breakdown: {
      adherence: Math.round(adherenceScore),
      nutrition: Math.round(nutritionScore),
      activity: Math.round(activityScore),
      bodyProgress: Math.round(bodyProgressScore),
      tracking: Math.round(trackingScore),
    },
    confidence,
    dataCoverage,
    statusTag: daysOfData < 7 ? `${statusTag} (Tạm tính)` : statusTag,
    classification,
  }
}

// Default benchmark sample for user matching score 82
export const defaultProgressInputSample: ProgressScoreInput = {
  adherence: {
    mealLoggingRate: 86, // 6/7 days
    calorieTargetRate: 71, // 5/7 days
    proteinTargetRate: 86, // 6/7 days
    hydrationRate: 57, // 4/7 days
    dailyTaskRate: 85,
  },
  nutrition: {
    calorieScore: 85,
    proteinScore: 85,
    fiberScore: 75,
    fruitVegetableScore: 80,
    mealDistributionScore: 80,
  },
  activity: {
    workoutCompletionScore: 100, // 3/3 workouts
    activeMinutesScore: 85,
    trainingBalanceScore: 80,
    consistencyScore: 90,
  },
  body: {
    weightTrendScore: 68,
    measurementTrendScore: 70,
    bodyCompositionScore: 65,
    progressPhotoScore: 80,
  },
  tracking: {
    mealTrackingRate: 86,
    weightTrackingRate: 75,
    workoutTrackingRate: 100,
    hydrationTrackingRate: 57,
    measurementTrackingRate: 50,
  },
}
