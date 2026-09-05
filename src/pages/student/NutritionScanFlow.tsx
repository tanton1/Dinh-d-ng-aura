import React, { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ArrowLeft, Camera, Check, CircleAlert, Flame, History, ImagePlus, Info,
  Minus, Plus, RefreshCw, Salad, Scale, ScanLine, ShieldCheck, Sparkles,
  Trash2, TriangleAlert, Utensils, X, Zap, Calendar, Clock,
} from 'lucide-react'
import NutritionScanClarifications from './NutritionScanClarifications'
import { compressBase64Image } from '../../services/firebaseService'
import type {
  AiFoodItem, NutritionClarificationResponse, NutritionMealDraft,
  NutritionPageProps, PersistedScanReview,
} from '../../features/nutrition/types'
import {
  getFoodAnalysisErrorMessage, getUsableFoodAnalysisText, normalizeAnalysis,
  nutritionConfidenceLabel, perGramNutrition,
} from '../../features/nutrition/analysis'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'

const INITIAL_ANALYSIS: AiFoodItem[] = [
  { id: 'rice', name: 'Cơm gạo lứt đỏ', grams: 180, calories: 216, protein: 4.5, carbs: 45.0, fat: 1.6, confidence: 'high' },
  { id: 'chicken', name: 'Ức gà áp chảo', grams: 125, calories: 206, protein: 38.8, carbs: 0, fat: 4.5, confidence: 'high' },
  { id: 'vegetables', name: 'Rau củ luộc', grams: 110, calories: 54, protein: 2.6, carbs: 10.3, fat: 0.4, confidence: 'medium' },
  { id: 'sauce', name: 'Sốt / dầu chế biến', grams: 12, calories: 78, protein: 0.2, carbs: 2.5, fat: 7.4, confidence: 'low' },
]

function normalizeSearch(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function nutritionAdjustmentFromText(value = '') {
  const text = normalizeSearch(value)
  let calories = 0
  let protein = 0
  let carbs = 0
  let fat = 0
  let recognized = false
  if (/\b(them )?(1 )?(qua )?trung\b/.test(text)) { calories += 70; protein += 6; fat += 5; recognized = true }
  if (/\b(bo|khong an|loai)( phan)? da\b/.test(text)) { calories -= 60; fat -= 7; recognized = true }
  if (/\bthem( mot| 1)? (chen|bat|phan)? ?com\b/.test(text)) { calories += 90; carbs += 20; recognized = true }
  if (/\bthem( mot| 1)? (phan )?(thit|uc ga)\b/.test(text)) { calories += 100; protein += 18; recognized = true }
  return { calories, protein, carbs, fat, recognized }
}

function dataUrlToImageFile(dataUrl: string, originalName: string) {
  const [header, payload = ''] = dataUrl.split(',', 2)
  const mimeType = header.match(/^data:([^;]+)/)?.[1] ?? 'image/jpeg'
  const bytes = Uint8Array.from(window.atob(payload), (character) => character.charCodeAt(0))
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const baseName = originalName.replace(/\.[^.]+$/, '') || 'aura-meal'
  return new File([bytes], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() })
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value))
}

const LEGACY_SCAN_REVIEW_SESSION_KEY = 'aura:nutrition:scan-review:v1'
const SCAN_REVIEW_SESSION_PREFIX = 'aura:nutrition:scan-review:v2'
function scanReviewSessionKey(ownerId: string) {
  return `${SCAN_REVIEW_SESSION_PREFIX}:${encodeURIComponent(ownerId)}`
}
function clearPendingScanReview(ownerId: string) {
  try {
    window.sessionStorage.removeItem(scanReviewSessionKey(ownerId))
    window.sessionStorage.removeItem(LEGACY_SCAN_REVIEW_SESSION_KEY)
  } catch { /* Session cleanup must not block the flow. */ }
}
function loadPendingScanReview(ownerId: string): PersistedScanReview | null {
  const storageKey = scanReviewSessionKey(ownerId)
  try {
    window.sessionStorage.removeItem(LEGACY_SCAN_REVIEW_SESSION_KEY)
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as unknown
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    const valid = record && record.ownerId === ownerId && Array.isArray(record.items) && record.items.length > 0
      && (record.resultMode === 'live' || record.resultMode === 'demo')
      && /^\d{4}-\d{2}-\d{2}$/.test(String(record.mealDate ?? ''))
      && ['breakfast', 'lunch', 'dinner', 'snack'].includes(String(record.mealType ?? ''))
    if (!valid) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }
    return value as PersistedScanReview
  } catch {
    try { window.sessionStorage.removeItem(storageKey) } catch { /* Ignore unavailable storage. */ }
    return null
  }
}

const FoodScanModal = React.memo(function FoodScanModal({ initialDate, storageOwnerId, allowDemo = false, onClose, onSave, onAnalyzeImage, presentation = 'modal' }: { initialDate: string; storageOwnerId: string; allowDemo?: boolean; onClose: () => void; onSave: (meal: NutritionMealDraft) => void; onAnalyzeImage?: NutritionPageProps['onAnalyzeImage']; presentation?: 'modal' | 'page' }) {
  const reviewStorageKey = scanReviewSessionKey(storageOwnerId)
  const [restoredReview] = useState(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    return step === 'review' ? loadPendingScanReview(storageOwnerId) : null
  })
  const [stage, setStage] = useState<'upload' | 'analyzing' | 'result' | 'error'>(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    if (step === 'review') return restoredReview ? 'result' : 'error'
    return 'upload'
  })
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [fileName, setFileName] = useState(restoredReview?.fileName ?? '')
  const [uploadError, setUploadError] = useState('')
  const [mealType, setMealType] = useState<NutritionMealDraft['mealType']>(() => restoredReview?.mealType ?? (() => {
    const hour = new Date().getHours()
    if (hour < 10) return 'breakfast'
    if (hour < 14) return 'lunch'
    if (hour < 17) return 'snack'
    return 'dinner'
  })())
  const [mealDate, setMealDate] = useState(restoredReview?.mealDate ?? initialDate)
  const [mealTime, setMealTime] = useState(restoredReview?.mealTime ?? new Date().toTimeString().slice(0, 5))
  const [items, setItems] = useState<AiFoodItem[]>(restoredReview?.items ?? INITIAL_ANALYSIS)
  const [resultMode, setResultMode] = useState<'live' | 'demo'>(restoredReview?.resultMode ?? 'demo')
  const [resultNotice, setResultNotice] = useState(restoredReview?.resultNotice ?? '')
  const [serverRange, setServerRange] = useState<{ low: number; high: number } | null>(restoredReview?.serverRange ?? null)
  const [baselineCalories, setBaselineCalories] = useState(restoredReview?.baselineCalories ?? 0)
  const [dishName, setDishName] = useState(restoredReview?.dishName || 'Bữa ăn dinh dưỡng')
  const [analysisConfidence, setAnalysisConfidence] = useState<number | null>(restoredReview?.analysisConfidence ?? null)
  const [analysisQuestions, setAnalysisQuestions] = useState<string[]>(restoredReview?.analysisQuestions ?? [])
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>(restoredReview?.analysisWarnings ?? [])
  const [analysisModel, setAnalysisModel] = useState<string | null>(restoredReview?.analysisModel ?? null)
  const [quantityCookingAnalysis, setQuantityCookingAnalysis] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.quantityCookingAnalysis))
  const [portionCalorieRationale, setPortionCalorieRationale] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.portionCalorieRationale))
  const [cookingNote, setCookingNote] = useState(restoredReview?.cookingNote ?? '')
  const [portionNote, setPortionNote] = useState(restoredReview?.portionNote ?? '')
  const [goalAlignmentAssessment, setGoalAlignmentAssessment] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.goalAlignmentAssessment))
  const [calorieOptimizationTip, setCalorieOptimizationTip] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.calorieOptimizationTip))
  const [macroBalanceAssessment, setMacroBalanceAssessment] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.macroBalanceAssessment))
  const [coachFeedbackSuggestion, setCoachFeedbackSuggestion] = useState<string>(() => getUsableFoodAnalysisText(restoredReview?.coachFeedbackSuggestion))
  const [showDetailedAnalysis, setShowDetailedAnalysis] = useState<boolean>(false)
  const [activeSlide, setActiveSlide] = useState<'ingredients' | 'nutrition'>('ingredients')
  const [confirmedItemIds, setConfirmedItemIds] = useState<Set<string>>(() => new Set(restoredReview?.confirmedItemIds ?? []))
  const [questionResponses, setQuestionResponses] = useState<Record<string, NutritionClarificationResponse>>(restoredReview?.questionResponses ?? {})
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, { optionId: string; calorieDelta: number; proteinDelta: number; carbsDelta: number; fatDelta: number; customText?: string }>>(() => Object.fromEntries(
    Object.entries(restoredReview?.clarificationAdjustments ?? {}).map(([question, customText]) => [question, {
      optionId: 'adjust', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, customText,
    }]),
  ))
  const [hasAnalysisResult, setHasAnalysisResult] = useState(Boolean(restoredReview))
  const [analysisError, setAnalysisError] = useState(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    return step === 'review' && !restoredReview ? 'Kết quả phân tích của phiên trước không còn trong tab này. Hãy chọn lại ảnh để phân tích; Aura chưa lưu món vào nhật ký.' : ''
  })
  const [lastFile, setLastFile] = useState<File | null>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputId = useId()
  const cameraInputId = useId()
  const analyzeTimerRef = useRef<number | null>(null)
  const dialogRef = useAccessibleDialog(onClose)

  const totals = useMemo(() => items.reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [items])

  const questionDeltas = useMemo(() => {
    return Object.values(dynamicAnswers).reduce((sum, res) => {
      if (!res) return sum
      const custom = nutritionAdjustmentFromText(res.customText)

      return {
        calories: sum.calories + (res.calorieDelta ?? 0) + custom.calories,
        protein: sum.protein + (res.proteinDelta ?? 0) + custom.protein,
        carbs: sum.carbs + (res.carbsDelta ?? 0) + custom.carbs,
        fat: sum.fat + (res.fatDelta ?? 0) + custom.fat,
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
  }, [dynamicAnswers])

  const adjustedTotals = useMemo(() => {
    const totalGrams = items.reduce((sum, i) => sum + (parseFloat(i.grams.toString()) || 0), 0)
    const fiberComplete = items.length > 0 && items.every((item) => typeof item.fiber === 'number' && Number.isFinite(item.fiber))
    const sugarComplete = items.length > 0 && items.every((item) => typeof item.sugar === 'number' && Number.isFinite(item.sugar))
    const sodiumComplete = items.length > 0 && items.every((item) => typeof item.sodium === 'number' && Number.isFinite(item.sodium))
    const fiber = fiberComplete
      ? items.reduce((sum, item) => sum + (item.fiber ?? 0), 0)
      : Math.max(1, (totalGrams / 100) * 1.8)
    const sugar = sugarComplete
      ? items.reduce((sum, item) => sum + (item.sugar ?? 0), 0)
      : Math.max(1, totals.carbs * 0.12)
    const sodium = sodiumComplete
      ? items.reduce((sum, item) => sum + (item.sodium ?? 0), 0)
      : Math.max(120, totalGrams * 1.25)

    return {
      calories: Math.max(10, Math.round(totals.calories + questionDeltas.calories)),
      protein: Math.max(0, Math.round((totals.protein + questionDeltas.protein) * 10) / 10),
      carbs: Math.max(0, Math.round((totals.carbs + questionDeltas.carbs) * 10) / 10),
      fat: Math.max(0, Math.round((totals.fat + questionDeltas.fat) * 10) / 10),
      fiber: Math.round(fiber * 10) / 10,
      sugar: Math.round(sugar * 10) / 10,
      sodium: Math.round(sodium),
      micronutrientComplete: { fiber: fiberComplete, sugar: sugarComplete, sodium: sodiumComplete },
    }
  }, [totals, questionDeltas, items])

  const mealHealthAssessment = useMemo(() => {
    const c = adjustedTotals.calories
    const p = adjustedTotals.protein
    const f = adjustedTotals.fat
    const carbs = adjustedTotals.carbs

    if (c <= 0) {
      return {
        score: 0,
        badge: 'Chưa có thực phẩm',
        description: 'Vui lòng nhập thành phần để Aura đánh giá dinh dưỡng.',
        proteinPct: 0,
        fatPct: 0,
        carbsPct: 0,
      }
    }

    const pCal = p * 4
    const fCal = f * 9
    const cCal = carbs * 4
    const totalMacroCal = pCal + fCal + cCal || c

    const proteinPct = Math.round((pCal / totalMacroCal) * 100)
    const fatPct = Math.round((fCal / totalMacroCal) * 100)
    const carbsPct = Math.round((cCal / totalMacroCal) * 100)

    let score = 7.2

    if (p >= 35) score += 1.6
    else if (p >= 25) score += 1.2
    else if (p >= 15) score += 0.6
    else if (p < 10) score -= 0.8

    if (fatPct > 45) score -= 1.2
    else if (fatPct > 35) score -= 0.6
    else if (fatPct >= 15 && fatPct <= 30) score += 0.5

    if (c > 850) score -= 0.9
    else if (c >= 400 && c <= 700) score += 0.4

    const finalScore = Math.round(Math.min(10, Math.max(3.0, score)) * 10) / 10

    const badge = finalScore >= 8.8
      ? 'Rất lành mạnh 🥗'
      : finalScore >= 7.5
        ? 'Cân bằng tốt 👍'
        : finalScore >= 6.0
          ? 'Cần chú ý calo/mỡ ⚖️'
          : 'Mật độ calo & béo cao ⚠️'

    let description = ''
    if (finalScore >= 8.8) {
      description = `Bữa ăn đạt ${p}g đạm (${proteinPct}% calo), lượng chất béo ${f}g (${fatPct}% calo) đạt chuẩn tối ưu cho cơ bắp & sức khỏe xuất sắc!`
    } else if (finalScore >= 7.5) {
      description = `Cân đối dinh dưỡng: ${p}g đạm (${proteinPct}%), ${carbs}g tinh bột (${carbsPct}%), ${f}g chất béo (${fatPct}%). Đáp ứng tốt nhu cầu tập luyện.`
    } else if (finalScore >= 6.0) {
      description = `Khẩu phần đạt ${c} kcal. Tỷ lệ chất béo chiếm ${fatPct}% calo. Khuyên tăng đạm hoặc bổ sung rau xanh ở bữa tiếp theo.`
    } else {
      description = `Năng lượng khá cao (${c} kcal) với ${fatPct}% calo từ chất béo. Khuyên kết hợp đi bộ nhẹ và uống đủ nước sau bữa ăn.`
    }

    return { score: finalScore, badge, description, proteinPct, fatPct, carbsPct }
  }, [adjustedTotals])

  const unresolvedItems = items.filter((item) => (item.confidence === 'low' || item.calculationSource !== 'database') && !confirmedItemIds.has(item.id))
  const unresolvedQuestions = analysisQuestions.filter((question) => {
    const response = questionResponses[question]
    if (!response || response === 'unknown') return true
    if (response !== 'adjust') return false
    return !nutritionAdjustmentFromText(dynamicAnswers[question]?.customText).recognized
  })
  const adjustedRange = useMemo(() => {
    const baseRange = !serverRange || baselineCalories <= 0
      ? { low: adjustedTotals.calories * .88, high: adjustedTotals.calories * 1.12 }
      : {
          low: serverRange.low * (adjustedTotals.calories / baselineCalories),
          high: serverRange.high * (adjustedTotals.calories / baselineCalories),
        }
    const uncertaintyRatio = Math.min(.28, unresolvedQuestions.length * .08 + unresolvedItems.length * .04)
    return {
      low: Math.max(0, Math.round(baseRange.low * (1 - uncertaintyRatio))),
      high: Math.round(baseRange.high * (1 + uncertaintyRatio)),
    }
  }, [adjustedTotals.calories, baselineCalories, serverRange, unresolvedItems.length, unresolvedQuestions.length])

  const allItemsFromCatalog = items.length > 0 && items.every((item) => item.calculationSource === 'database')
  const userConfirmedEstimate = !allItemsFromCatalog && unresolvedItems.length === 0 && unresolvedQuestions.length === 0
  const primaryNutrientSource = allItemsFromCatalog ? 'catalog' as const : userConfirmedEstimate ? 'user-confirmed' as const : 'ai-estimate' as const
  const finalConfidence = unresolvedItems.length > 0 || unresolvedQuestions.length > 0
    ? 'needs-review' as const
    : allItemsFromCatalog
      ? 'verified' as const
      : 'estimated' as const
  const finalNutrition = {
    calories: adjustedTotals.calories,
    protein: adjustedTotals.protein,
    carbs: adjustedTotals.carbs,
    fat: adjustedTotals.fat,
    fiber: adjustedTotals.fiber,
    sugar: adjustedTotals.sugar,
    sodium: adjustedTotals.sodium,
    nutrientSources: {
      calories: primaryNutrientSource,
      protein: primaryNutrientSource,
      carbs: primaryNutrientSource,
      fat: primaryNutrientSource,
      fiber: adjustedTotals.micronutrientComplete.fiber ? primaryNutrientSource : 'ai-estimate' as const,
      sugar: adjustedTotals.micronutrientComplete.sugar ? primaryNutrientSource : 'ai-estimate' as const,
      sodium: adjustedTotals.micronutrientComplete.sodium ? primaryNutrientSource : 'ai-estimate' as const,
    },
    confidence: finalConfidence,
    unresolvedQuestions,
  }
  const canSaveMeal = adjustedTotals.calories > 0
    && items.some((item) => item.name.trim().length > 0 && item.calories > 0)
    && Boolean(mealDate && mealTime)
    && (resultMode === 'live' || allowDemo)

  useEffect(() => () => {
    if (analyzeTimerRef.current) window.clearTimeout(analyzeTimerRef.current)
  }, [])

  useEffect(() => {
    if (presentation !== 'page') return
    const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    query.set('section', 'scan')
    if (stage === 'result') query.set('step', 'review')
    else if (stage === 'error') query.set('step', 'error')
    else query.delete('step')
    const nextHash = `#/nutrition?${query.toString()}`
    if (window.location.hash === nextHash) return
    if (stage === 'result') window.history.pushState(window.history.state, '', nextHash)
    else window.history.replaceState(window.history.state, '', nextHash)
  }, [presentation, stage])

  useEffect(() => {
    if (presentation !== 'page') return
    const syncStageFromRoute = () => {
      const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
      if (step === 'review') {
        if (hasAnalysisResult) setStage('result')
        else {
          setAnalysisError('Kết quả phân tích không còn trong phiên này. Hãy chọn lại ảnh; Aura chưa lưu món vào nhật ký.')
          setStage('error')
        }
      } else if (step === 'error') setStage('error')
      else setStage('upload')
    }
    window.addEventListener('popstate', syncStageFromRoute)
    window.addEventListener('hashchange', syncStageFromRoute)
    return () => {
      window.removeEventListener('popstate', syncStageFromRoute)
      window.removeEventListener('hashchange', syncStageFromRoute)
    }
  }, [hasAnalysisResult, presentation])

  useEffect(() => {
    if (stage !== 'result' || !hasAnalysisResult) return
    const review: PersistedScanReview = {
      ownerId: storageOwnerId,
      dishName,
      items,
      resultMode,
      resultNotice,
      serverRange,
      baselineCalories,
      analysisConfidence,
      analysisQuestions,
      analysisWarnings,
      analysisModel,
      confirmedItemIds: [...confirmedItemIds],
      questionResponses,
      clarificationAdjustments: Object.fromEntries(Object.entries(dynamicAnswers)
        .filter(([, answer]) => Boolean(answer.customText?.trim()))
        .map(([question, answer]) => [question, answer.customText?.trim() ?? ''])),
      cookingNote,
      portionNote,
      mealType,
      mealDate,
      mealTime,
      fileName,
      quantityCookingAnalysis,
      portionCalorieRationale,
      goalAlignmentAssessment,
      calorieOptimizationTip,
      macroBalanceAssessment,
      coachFeedbackSuggestion,
    }
    try {
      window.sessionStorage.setItem(reviewStorageKey, JSON.stringify(review))
    } catch {
      // A review remains usable in memory even when session storage is unavailable.
    }
  }, [analysisConfidence, analysisModel, analysisQuestions, analysisWarnings, baselineCalories, calorieOptimizationTip, confirmedItemIds, cookingNote, dishName, dynamicAnswers, fileName, goalAlignmentAssessment, hasAnalysisResult, items, macroBalanceAssessment, mealDate, mealTime, mealType, portionCalorieRationale, portionNote, questionResponses, quantityCookingAnalysis, resultMode, resultNotice, reviewStorageKey, serverRange, stage, storageOwnerId, coachFeedbackSuggestion])

  const startDemoAnalysis = (notice = 'Đây là dữ liệu minh họa để bạn trải nghiệm luồng chỉnh sửa. Chưa có kết quả từ mô hình AI.') => {
    setResultMode('demo')
    setResultNotice(notice)
    setServerRange(null)
    setBaselineCalories(INITIAL_ANALYSIS.reduce((sum, item) => sum + item.calories, 0))
    setDishName('Bữa ăn dinh dưỡng')
    setAnalysisConfidence(null)
    setAnalysisQuestions(['Bạn có dùng hết phần sốt hoặc dầu trong đĩa không?'])
    setQuestionResponses({})
    setDynamicAnswers({})
    setAnalysisWarnings([])
    setAnalysisModel(null)
    setQuantityCookingAnalysis('Khẩu phần minh họa gồm cơm, ức gà áp chảo, rau củ luộc và một lượng nhỏ sốt hoặc dầu chế biến.')
    setPortionCalorieRationale('Đây là dữ liệu minh họa theo khẩu phần mẫu; không phải suy luận từ ảnh đã tải.')
    setCookingNote('')
    setPortionNote('')
    setGoalAlignmentAssessment('Dữ liệu minh họa chưa sử dụng hồ sơ và mục tiêu thực tế của bạn.')
    setCalorieOptimizationTip('Hãy phân tích ảnh thật để nhận một điều chỉnh khẩu phần phù hợp với mục tiêu calo của bạn.')
    setMacroBalanceAssessment('Khẩu phần minh họa có đủ ba nhóm macro; cần kết quả ảnh thật để đánh giá lượng đạm, carb, béo và chất xơ chính xác hơn.')
    setCoachFeedbackSuggestion('')
    setConfirmedItemIds(new Set())
    setItems(INITIAL_ANALYSIS.map((item) => ({ ...item, perGram: perGramNutrition(item) })))
    setHasAnalysisResult(true)
    setStage('analyzing')
    if (analyzeTimerRef.current) window.clearTimeout(analyzeTimerRef.current)
    analyzeTimerRef.current = window.setTimeout(() => setStage('result'), 1450)
  }

  const runImageAnalysis = async (file: File, notes = '') => {
    setLastFile(file)
    setAnalysisError('')
    setHasAnalysisResult(false)
    if (!onAnalyzeImage) {
      setAnalysisError('Tính năng AI chưa sẵn sàng trong phiên này. Hãy đăng nhập lại hoặc thử lại sau; ảnh của bạn chưa được phân tích.')
      setStage('error')
      return
    }
    setStage('analyzing')
    try {
      const response = await onAnalyzeImage(file, { mealType, notes: notes || undefined })
      const normalized = normalizeAnalysis(response)
      if (response.analysis) {
        setQuantityCookingAnalysis(getUsableFoodAnalysisText(response.analysis.quantityAndCookingAnalysis))
        setPortionCalorieRationale(getUsableFoodAnalysisText(response.analysis.portionAndCalorieRationale))
        setGoalAlignmentAssessment(getUsableFoodAnalysisText(response.analysis.goalAlignmentAssessment))
        setCalorieOptimizationTip(getUsableFoodAnalysisText(response.analysis.calorieOptimizationTip))
        setMacroBalanceAssessment(getUsableFoodAnalysisText(response.analysis.macroBalanceAssessment))
        setCoachFeedbackSuggestion(getUsableFoodAnalysisText(response.analysis.coachFeedbackSuggestion))
      }
      if (!normalized) {
        setAnalysisError(response.analysis?.isFood === false
          ? 'Aura chưa nhận ra món ăn trong ảnh này. Hãy chụp trọn phần ăn ở nơi đủ sáng hoặc ghi món thủ công.'
          : response.notices?.[0] ?? 'AI chưa trả về kết quả hợp lệ. Aura không thay thế bằng dữ liệu giả; vui lòng thử lại với ảnh rõ hơn.')
        setStage('error')
        return
      } else {
        setResultMode(response.mode === 'demo' ? 'demo' : 'live')
        setResultNotice(response.mode === 'demo' ? 'Nhà cung cấp trả về chế độ minh họa. Hãy kiểm tra kỹ trước khi lưu.' : '')
        setServerRange(normalized.range)
        setBaselineCalories(normalized.items.reduce((sum, item) => sum + item.calories, 0))
        setDishName(normalized.dishName || 'Bữa ăn dinh dưỡng')
        setItems(normalized.items)
        setAnalysisConfidence(normalized.confidence)
        setAnalysisQuestions(normalized.questions)
        setQuestionResponses({})
        setDynamicAnswers({})
        setAnalysisWarnings([
          ...normalized.warnings,
          ...normalized.notices,
          ...(response.imageRetained ? ['Aura chưa xác nhận đã dọn xong ảnh tạm. Ảnh sẽ tiếp tục được xử lý theo chính sách vòng đời lưu trữ.'] : []),
        ])
        setAnalysisModel(normalized.model)
        setConfirmedItemIds(new Set(normalized.items.filter((item) => item.confidence !== 'low' && item.calculationSource === 'database').map((item) => item.id)))
        setHasAnalysisResult(true)
      }
      setStage('result')
    } catch (error) {
      setAnalysisError(getFoodAnalysisErrorMessage(error))
      setStage('error')
    }
  }

  const handleFile = (file?: File) => {
    if (!file) return
    setUploadError('')
    setHasAnalysisResult(false)
    setCookingNote('')
    setPortionNote('')
    clearPendingScanReview(storageOwnerId)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
      setUploadError('Vui lòng chọn tệp ảnh JPEG, PNG hoặc WebP.')
      setStage('upload')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('Ảnh lớn hơn 8 MB. Hãy chọn ảnh nhẹ hơn.')
      setStage('upload')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const rawUrl = String(reader.result ?? '')
        const compressedUrl = await compressBase64Image(rawUrl, 600, 0.68)
        setPreviewUrl(compressedUrl)
        setFileName(file.name)
        const analysisFile = compressedUrl !== rawUrl ? dataUrlToImageFile(compressedUrl, file.name) : file
        void runImageAnalysis(analysisFile)
      } catch (error) {
        setStage('upload')
        setUploadError(getFoodAnalysisErrorMessage(error))
      }
    }
    reader.onerror = () => {
      setStage('upload')
      setUploadError('Không thể đọc tệp ảnh này. Vui lòng chọn một ảnh khác.')
    }
    reader.onabort = () => {
      setStage('upload')
      setUploadError('Việc đọc ảnh đã bị gián đoạn. Vui lòng thử lại.')
    }
    reader.readAsDataURL(file)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    handleFile(file)
  }

  const reanalyzeWithClarifications = () => {
    if (!lastFile || !onAnalyzeImage) return
    const corrections = analysisQuestions.flatMap((question) => {
      if (questionResponses[question] !== 'adjust') return []
      const answer = dynamicAnswers[question]?.customText?.trim()
      return answer ? [`${question.slice(0, 70)}: ${answer.slice(0, 120)}`] : []
    })
    const noteParts = [
      corrections.length > 0 ? `Điều chỉnh đã xác nhận: ${corrections.join('; ')}` : '',
      cookingNote.trim() ? `Cách chế biến khách ghi chú: ${cookingNote.trim()}` : '',
      portionNote.trim() ? `Khẩu phần khách ghi chú: ${portionNote.trim()}` : '',
    ].filter(Boolean)
    if (noteParts.length === 0) return
    const notes = noteParts.join(' | ').slice(0, 300)
    void runImageAnalysis(lastFile, notes)
  }

  const updateItem = (id: string, field: keyof Pick<AiFoodItem, 'name' | 'grams' | 'calories'>, value: string) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item
      if (field === 'name') return { ...item, name: value, calculationSource: 'manual' }
      const nextValue = Math.max(0, Number(value))
      const perGram = item.perGram ?? perGramNutrition(item)
      if (field === 'grams') {
        return {
          ...item,
          grams: nextValue,
          calories: Math.round(perGram.calories * nextValue * 10) / 10,
          protein: Math.round(perGram.protein * nextValue * 10) / 10,
          carbs: Math.round(perGram.carbs * nextValue * 10) / 10,
          fat: Math.round(perGram.fat * nextValue * 10) / 10,
          fiber: Math.round(perGram.fiber * nextValue * 10) / 10,
          sugar: Math.round(perGram.sugar * nextValue * 10) / 10,
          sodium: Math.round(perGram.sodium * nextValue),
          perGram,
          calculationSource: item.calculationSource === 'database' ? 'database' : item.calculationSource === 'mixed' ? 'mixed' : 'manual',
        }
      }
      const nextPerGram = { ...perGram, calories: item.grams > 0 ? nextValue / item.grams : 0 }
      return { ...item, calories: nextValue, perGram: nextPerGram, calculationSource: 'manual' }
    }))
    setConfirmedItemIds((current) => new Set(current).add(id))
  }

  const addItem = () => {
    setItems((current) => [...current, {
      id: `custom-${Date.now()}`,
      name: 'Thành phần mới',
      grams: 50,
      calories: 50,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 'low',
      calculationSource: 'manual',
      perGram: { calories: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
    }])
  }

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  const saveMeal = (submitForReview = false) => {
    if (!canSaveMeal) return
    clearPendingScanReview(storageOwnerId)
    onSave({
      dishName: dishName.trim() || 'Bữa ăn dinh dưỡng',
      name: items.map((item) => item.name.trim()).filter(Boolean).slice(0, 2).join(', '),
      mealType,
      mealDate,
      mealTime,
      image: previewUrl || undefined,
      calories: Math.round(adjustedTotals.calories),
      protein: Math.round(adjustedTotals.protein),
      carbs: Math.round(adjustedTotals.carbs),
      fat: Math.round(adjustedTotals.fat),
      finalNutrition,
      clarifications: analysisQuestions.map((question) => ({
        question,
        response: questionResponses[question] ?? 'unknown',
        adjustmentNote: dynamicAnswers[question]?.customText?.trim() || undefined,
      })),
      calorieRange: adjustedRange,
      items,
      source: resultMode === 'live' ? 'ai-scan' : 'demo',
      submitForReview,
      cookingNote: cookingNote.trim() || undefined,
      portionNote: portionNote.trim() || undefined,
      quantityCookingAnalysis,
      portionCalorieRationale,
      goalAlignmentAssessment,
      calorieOptimizationTip,
      macroBalanceAssessment,
      coachFeedbackSuggestion
    })
  }

  return (
    <div className={presentation === 'page' ? 'nutrition-route-page nutrition-route-page--scan' : 'nutrition-modal-backdrop'} role="presentation" onMouseDown={(event) => presentation === 'modal' && event.target === event.currentTarget && onClose()}>
      <section ref={presentation === 'modal' ? dialogRef : undefined} className={`nutrition-scan-modal ${presentation === 'page' ? 'nutrition-scan-modal--page' : ''} ${stage === 'result' ? 'nutrition-scan-modal--result' : ''}`} role={presentation === 'modal' ? 'dialog' : 'region'} aria-modal={presentation === 'modal' ? true : undefined} aria-labelledby="nutrition-scan-title" data-testid="nutrition-scan-modal">
        {stage !== 'result' && (
          <header className={`nutrition-scan-modal__header`}>
            <div>
              <span className="nutrition-ai-mark"><Sparkles size={15} /> Aura Vision</span>
              <h2 id="nutrition-scan-title">Phân tích món ăn</h2>
            </div>
            <button type="button" className="nutrition-close-button" onClick={onClose} aria-label={presentation === 'page' ? 'Quay lại trang dinh dưỡng' : 'Đóng'}>
              {presentation === 'page' ? <ArrowLeft size={20} /> : <X size={20} />}
            </button>
          </header>
        )}

        <input ref={galleryInputRef} id={galleryInputId} className="nutrition-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" data-testid="nutrition-file-input" onChange={handleInputChange} />
        <input ref={cameraInputRef} id={cameraInputId} className="nutrition-visually-hidden" type="file" accept="image/jpeg,image/png" capture="environment" tabIndex={-1} aria-hidden="true" data-testid="nutrition-camera-input" onChange={handleInputChange} />

        {stage === 'upload' && (
          <div className="nutrition-upload-step">
            <label
              htmlFor={galleryInputId}
              className="nutrition-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files[0]) }}
              aria-describedby="nutrition-upload-requirements"
            >
              <div className="nutrition-dropzone__icon">
                <ScanLine size={28} />
              </div>
              <strong>Quét món ăn bằng AI</strong>
              <small>Phân tích calo & dinh dưỡng tức thì</small>
              <em id="nutrition-upload-requirements">Hỗ trợ JPEG, PNG, WebP · Dưới 8MB</em>
            </label>
            <div className="nutrition-upload-actions">
              <label htmlFor={galleryInputId} tabIndex={0} role="button" data-dialog-autofocus onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); galleryInputRef.current?.click() } }}>
                <ImagePlus size={20} />
                <span><strong>Tải ảnh lên</strong><small>Thư viện ảnh</small></span>
              </label>
              <label htmlFor={cameraInputId} tabIndex={0} role="button" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); cameraInputRef.current?.click() } }}>
                <Camera size={20} />
                <span><strong>Chụp ảnh mới</strong><small>Mở camera sau</small></span>
              </label>
            </div>
            {uploadError && <p className="nutrition-upload-error" role="alert"><CircleAlert size={15} /> {uploadError}</p>}
            <div className="nutrition-photo-tips">
              <div><Camera size={18} /><span><strong>Ảnh rõ và đủ sáng</strong><small>Chụp trọn đĩa ở góc 45°</small></span></div>
              <div><Scale size={18} /><span><strong>Có vật tham chiếu</strong><small>Muỗng hoặc kích thước bát</small></span></div>
              <div><Utensils size={18} /><span><strong>Tách phần ăn</strong><small>Tránh chụp cả mâm chung</small></span></div>
            </div>
            <p className="nutrition-upload-privacy"><Info size={15} /> Ảnh được xử lý bảo mật qua hệ thống Aura AI để nhận diện món. Aura tự động xóa ảnh tạm sau khi phân tích; kết quả chỉ được lưu khi bạn xác nhận.</p>
            {allowDemo && (
              <button type="button" className="nutrition-demo-scan" onClick={() => startDemoAnalysis()} data-testid="nutrition-demo-scan">
                <ScanLine size={17} /> Xem kết quả phân tích mẫu
              </button>
            )}
          </div>
        )}

        {stage === 'analyzing' && (
          <div className="nutrition-analyzing" aria-live="polite" data-testid="nutrition-scan-analyzing">
            <div className="nutrition-scan-preview">
              {previewUrl && <img src={previewUrl} alt="Đang phân tích" />}
              <span className="nutrition-scan-line" />
              <i><Sparkles size={20} /></i>
            </div>
            <div className="nutrition-loading-spinner" />
            <p><strong>Aura Vision đang phân tích...</strong><small>Đang nhận diện nguyên liệu, calo và dinh dưỡng</small></p>
          </div>
        )}

        {stage === 'error' && (
          <div className="nutrition-scan-error" role="alert" data-testid="nutrition-scan-error">
            <div className="nutrition-scan-error__visual">
              {previewUrl ? <img src={previewUrl} alt="Ảnh món ăn chưa phân tích thành công" /> : <CircleAlert size={38} />}
            </div>
            <span><CircleAlert size={22} /></span>
            <h3>Không thể phân tích ảnh này</h3>
            <p>{analysisError || 'Rất tiếc, AI không thể nhận diện được món ăn trong ảnh. Bạn có thể thử chụp lại ảnh rõ nét hơn hoặc nhập thủ công.'}</p>
            <div className="nutrition-scan-error__actions">
              {lastFile && (
                <button type="button" className="nutrition-primary-button" onClick={() => void runImageAnalysis(lastFile)} data-testid="nutrition-retry-scan">
                  <RefreshCw size={16} /> Thử lại ảnh này
                </button>
              )}
              <label htmlFor={cameraInputId} className="nutrition-secondary-button cursor-pointer">
                <Camera size={16} /> Chụp lại ảnh khác
              </label>
              <label htmlFor={galleryInputId} className="nutrition-secondary-button cursor-pointer">
                <ImagePlus size={16} /> Chọn từ thư viện
              </label>
            </div>
            {allowDemo && (
              <button type="button" className="nutrition-demo-scan mt-3" onClick={() => startDemoAnalysis('Bạn đã chủ động mở bản minh họa. Các số liệu này không được tạo từ ảnh vừa tải và cần được chỉnh sửa trước khi lưu.')}>
                <Info size={16} /> Xem bản minh họa thay thế
              </button>
            )}
          </div>
        )}

        {stage === 'result' && (
          <div className="nutrition-scan-result fdet-container" data-testid="nutrition-scan-result">
            {/* 1. Hero Image Header (fdet-hero) - Soft rounded corners */}
            <div className="nutrition-scan-result__hero fdet-hero">
              {previewUrl ? (
                <img src={previewUrl} alt={dishName || "Món ăn"} className="nutrition-scan-result__hero-image fdet-hero-img" />
              ) : (
                <div className="nutrition-scan-result__hero-placeholder">
                  <Salad size={52} />
                </div>
              )}

              {/* Hero Overlaid Controls */}
              <div className="nutrition-scan-result__hero-overlay fdet-hero-overlay">
                <button type="button" className="nutrition-scan-result__icon-button" onClick={onClose} title="Quay lại" aria-label="Quay lại trang dinh dưỡng">
                  <ArrowLeft size={20} />
                </button>

                <div className="nutrition-scan-result__hero-actions">
                  <div className="nutrition-scan-result__vision-badge">
                    <Sparkles size={14} />
                    <span>{resultMode === 'live' ? 'Aura Vision AI' : 'Bản Minh Họa'}</span>
                  </div>

                  {previewUrl && (
                    <button
                      type="button"
                      className="nutrition-scan-result__icon-button"
                      onClick={() => {
                        const link = document.createElement('a')
                        link.href = previewUrl
                        link.download = `scan-${Date.now()}.jpg`
                        link.click()
                      }}
                      title="Tải ảnh đã quét"
                      aria-label="Tải ảnh đã quét"
                    >
                      <History size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Main Sheet Card (fdet-sheet) */}
            <div className="nutrition-scan-result__sheet fdet-sheet">
              {/* Meta Row: AI Confidence & Meal Time Badge */}
              <div className="nutrition-scan-result__meta fdet-meta-row">
                <span className="nutrition-scan-result__confidence">
                  <Check size={13} />
                  <span>
                    {resultMode === 'live'
                      ? analysisConfidence === null
                        ? 'AI nhận diện · Ước tính từ ảnh'
                        : `AI nhận diện · Độ tin cậy ${Math.round(analysisConfidence * 100)}%`
                      : 'Món ăn mẫu'}
                  </span>
                </span>
                <span className="nutrition-scan-result__time fdet-time-badge">{mealTime}</span>
              </div>

              {/* Title & Calories Header (fdet-title-cal-row) */}
              <div className="nutrition-scan-result__summary fdet-title-cal-row">
                <div className="nutrition-scan-result__title-column fdet-title-col">
                  <textarea
                    rows={2}
                    value={dishName}
                    onChange={(e) => setDishName(e.target.value)}
                    className="nutrition-scan-result__dish-name"
                    placeholder="Nhập tên món ăn..."
                  />
                  <p className="nutrition-scan-result__energy-range">
                    Mức năng lượng ước tính: <strong>{formatNumber(adjustedRange.low)} – {formatNumber(adjustedRange.high)} kcal</strong>
                  </p>
                </div>

                {/* Main Calorie Badge: Number and kcal on the same line */}
                <div 
                  className="nutrition-scan-result__calories fdet-calories-col"
                >
                  <span className="nutrition-scan-result__calorie-label">
                    <Zap size={12} /> NĂNG LƯỢNG
                  </span>
                  <div className="nutrition-scan-result__calorie-value">
                    <strong>
                      {formatNumber(adjustedTotals.calories)}
                    </strong>
                    <span>kcal</span>
                  </div>
                </div>
              </div>

              {/* 3. BẢNG MACRONUTRIENTS (fdet-macros-grid) - 4 Cards */}
              <div className="nutrition-scan-result__macro-grid">
                {/* Chất đạm */}
                <div className="nutrition-scan-result__macro nutrition-scan-result__macro--protein">
                  <div className="nutrition-scan-result__macro-head">
                    <div className="nutrition-scan-result__macro-label">
                      <span>🥩</span>
                      <strong>Chất đạm</strong>
                    </div>
                    <span className="nutrition-scan-result__macro-percent">
                      {Math.round((adjustedTotals.protein * 4 / Math.max(1, adjustedTotals.calories)) * 100)}%
                    </span>
                  </div>
                  <strong className="nutrition-scan-result__macro-value">{adjustedTotals.protein} g</strong>
                </div>

                {/* Bột đường */}
                <div className="nutrition-scan-result__macro nutrition-scan-result__macro--carbs">
                  <div className="nutrition-scan-result__macro-head">
                    <div className="nutrition-scan-result__macro-label">
                      <span>🌾</span>
                      <strong>Bột đường</strong>
                    </div>
                    <span className="nutrition-scan-result__macro-percent">
                      {Math.round((adjustedTotals.carbs * 4 / Math.max(1, adjustedTotals.calories)) * 100)}%
                    </span>
                  </div>
                  <strong className="nutrition-scan-result__macro-value">{adjustedTotals.carbs} g</strong>
                </div>

                {/* Chất béo */}
                <div className="nutrition-scan-result__macro nutrition-scan-result__macro--fat">
                  <div className="nutrition-scan-result__macro-head">
                    <div className="nutrition-scan-result__macro-label">
                      <span>💧</span>
                      <strong>Chất béo</strong>
                    </div>
                    <span className="nutrition-scan-result__macro-percent">
                      {Math.round((adjustedTotals.fat * 9 / Math.max(1, adjustedTotals.calories)) * 100)}%
                    </span>
                  </div>
                  <strong className="nutrition-scan-result__macro-value">{adjustedTotals.fat} g</strong>
                </div>

                {/* Chất xơ */}
                <div className="nutrition-scan-result__macro nutrition-scan-result__macro--fiber">
                  <div className="nutrition-scan-result__macro-head">
                    <div className="nutrition-scan-result__macro-label">
                      <span>🥦</span>
                      <strong>Chất xơ</strong>
                    </div>
                    <span className="nutrition-scan-result__macro-percent">
                      {adjustedTotals.micronutrientComplete.fiber ? 'Có dữ liệu' : 'Ước tính'}
                    </span>
                  </div>
                  <strong className="nutrition-scan-result__macro-value">{adjustedTotals.fiber ?? 7.9} g</strong>
                </div>
              </div>

              {(analysisQuestions.length > 0 || hasAnalysisResult) && (
                <React.Suspense fallback={<div className="nutrition-scan-clarifications" role="status">Đang mở phần xác nhận khẩu phần…</div>}>
                  <NutritionScanClarifications
                    questions={analysisQuestions}
                    responses={questionResponses}
                    adjustments={Object.fromEntries(Object.entries(dynamicAnswers).map(([question, answer]) => [question, answer.customText ?? '']))}
                    cookingNote={cookingNote}
                    portionNote={portionNote}
                    unresolvedCount={unresolvedQuestions.length}
                    canReanalyze={Boolean(lastFile && onAnalyzeImage)}
                    resolveAdjustment={nutritionAdjustmentFromText}
                    onResponse={(question, response) => {
                      setQuestionResponses((current) => ({ ...current, [question]: response }))
                      setDynamicAnswers((current) => {
                        if (response === 'adjust') return { ...current, [question]: current[question] ?? { optionId: 'adjust', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, customText: '' } }
                        const next = { ...current }
                        delete next[question]
                        return next
                      })
                    }}
                    onAdjustment={(question, value) => setDynamicAnswers((current) => ({
                      ...current,
                      [question]: { optionId: 'adjust', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, customText: value },
                    }))}
                    onCookingNoteChange={setCookingNote}
                    onPortionNoteChange={setPortionNote}
                    onReanalyze={reanalyzeWithClarifications}
                  />
                </React.Suspense>
              )}

              {/* THÀNH PHẦN NHẬN DIỆN (Được nới khoảng cách thêm so với khung trên) */}
              <div className="nutrition-scan-result__ingredients-wrap">
                <div className="nutrition-scan-result__ingredients fdet-section">
                  <div className="nutrition-scan-result__section-header fdet-section-header">
                    <div>
                      <h2 className="fdet-section-title">Thành phần nhận diện</h2>
                      <span className="nutrition-scan-result__section-description">{items.length} thành phần · Nhấn để chỉnh sửa gram</span>
                    </div>
                    <button
                      type="button"
                      onClick={addItem}
                      className="nutrition-scan-result__add-button"
                    >
                      <Plus size={14} />
                      <span>Thêm</span>
                    </button>
                  </div>

                  <div className="nutrition-scan-result__ingredient-list">
                    {items.map((item) => (
                      <div 
                        key={item.id} 
                        className="nutrition-scan-result__ingredient"
                      >
                        {/* Row 1: Name and Compact Gram Stepper shifted slightly left */}
                        <div className="nutrition-scan-result__ingredient-main">
                          <textarea
                            value={item.name}
                            onChange={(event) => {
                              event.target.style.height = 'auto';
                              event.target.style.height = event.target.scrollHeight + 'px';
                              updateItem(item.id, 'name', event.target.value);
                            }}
                            className="nutrition-scan-result__ingredient-name"
                            placeholder="Tên thành phần..."
                            rows={1}
                          />
                          
                          {/* Compact Stepper Control - Extended width (108px) sang trái để hiển thị rõ gram */}
                          <div 
                            className="nutrition-scan-result__gram-stepper"
                          >
                            <button
                              type="button"
                              onClick={() => updateItem(item.id, 'grams', String(Math.max(0, (parseInt(item.grams.toString()) || 0) - 10)))}
                              className="nutrition-scan-result__step-button"
                              title="Giảm 10g"
                              style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
                            >
                              <Minus size={11} />
                            </button>
                            
                            <div className="nutrition-scan-result__gram-value">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={item.grams}
                                onChange={(event) => {
                                  const val = event.target.value.replace(/[^0-9]/g, '');
                                  updateItem(item.id, 'grams', val);
                                }}
                                className="nutrition-scan-result__gram-input"
                              />
                              <span>g</span>
                            </div>
                            
                            <button
                              type="button"
                              onClick={() => updateItem(item.id, 'grams', String((parseInt(item.grams.toString()) || 0) + 10))}
                              className="nutrition-scan-result__step-button nutrition-scan-result__step-button--plus"
                              title="Tăng 10g"
                              style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Row 2: Confidence Bar and Trash Button */}
                        <div className="nutrition-scan-result__ingredient-meta">
                          <div className="nutrition-scan-result__confidence-row">
                            <span>Nguồn nhận diện:</span>
                            <strong>{nutritionConfidenceLabel(item)}</strong>
                            {item.confidenceValue !== undefined && Number.isFinite(item.confidenceValue) ? (
                              <div className="nutrition-scan-result__confidence-track" aria-hidden="true">
                                <div style={{ width: `${Math.round(Math.max(0, Math.min(1, item.confidenceValue)) * 100)}%` }} />
                              </div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="nutrition-scan-result__delete-button"
                            aria-label={`Xóa ${item.name}`}
                            title="Xóa thành phần"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 5. BẢNG ĐÁNH GIÁ ĐIỂM CHẤT LƯỢNG MÓN ĂN */}
              <div className="nutrition-scan-result__health-card">
                <div className="nutrition-scan-result__health-content">
                  <div className="nutrition-scan-result__health-score">
                    <strong>{mealHealthAssessment.score}</strong>
                  </div>
                  <div className="nutrition-scan-result__health-copy">
                    <div className="nutrition-scan-result__health-heading">
                      <span>
                        {mealHealthAssessment.badge}
                      </span>
                      <strong>Điểm dinh dưỡng</strong>
                    </div>
                    <p>{mealHealthAssessment.description}</p>
                  </div>
                </div>
              </div>

              {/* 6. PHÂN TÍCH DINH DƯỠNG TỪ AURA AI */}
              <div className="nutrition-scan-result__ai-card">
                <div className="nutrition-scan-result__ai-content">
                  <div className="nutrition-scan-result__ai-header">
                    <div className="nutrition-scan-result__ai-title">
                      <div className="nutrition-scan-result__ai-icon">
                        <Sparkles size={15} />
                      </div>
                      <div>
                        <strong>Phân tích từ Aura AI</strong>
                        <span>Ước tính dinh dưỡng cá nhân hóa</span>
                      </div>
                    </div>
                    <span className="nutrition-scan-result__ai-badge">AI</span>
                  </div>

                  {/* Main Recommendation Text */}
                  <div className="nutrition-scan-result__ai-highlight">
                    <p>
                      <strong>🎯 Mức độ phù hợp với mục tiêu</strong>
                      {goalAlignmentAssessment || (
                        'Kết quả cũ chưa có đánh giá riêng theo mục tiêu. Hãy phân tích lại ảnh để Aura đối chiếu với hồ sơ hiện tại.'
                      )}
                    </p>
                  </div>

                  {/* Smart Action Tips Grid */}
                  <div className="nutrition-scan-result__ai-tips">
                    <div className="nutrition-scan-result__ai-tip">
                      <div className="nutrition-scan-result__ai-tip-icon nutrition-scan-result__ai-tip-icon--calories">
                        <Flame size={14} />
                      </div>
                      <div>
                        <strong>Mẹo tối ưu calo</strong>
                        {calorieOptimizationTip || 'Kết quả cũ chưa có mẹo calo riêng cho món ăn này. Hãy phân tích lại ảnh để nhận điều chỉnh khẩu phần cụ thể.'}
                      </div>
                    </div>

                    <div className="nutrition-scan-result__ai-tip">
                      <div className="nutrition-scan-result__ai-tip-icon nutrition-scan-result__ai-tip-icon--macro">
                        <Scale size={14} />
                      </div>
                      <div>
                        <strong>Cân bằng Macro</strong>
                        {macroBalanceAssessment || 'Kết quả cũ chưa có đánh giá riêng về đạm, carb, chất béo và chất xơ. Hãy phân tích lại ảnh để cập nhật.'}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Analysis Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowDetailedAnalysis(!showDetailedAnalysis)}
                    className="nutrition-scan-result__analysis-toggle"
                    aria-expanded={showDetailedAnalysis}
                  >
                    <span>
                      <Utensils size={13} />
                      <span>Phân tích chế biến & Bóc tách định lượng</span>
                    </span>
                    <strong>
                      {showDetailedAnalysis ? 'Ẩn chi tiết ▲' : 'Xem chi tiết ▼'}
                    </strong>
                  </button>

                  {showDetailedAnalysis && (
                    <div className="nutrition-scan-result__analysis-details">
                      <div className="nutrition-scan-result__analysis-detail">
                        <div className="nutrition-scan-result__analysis-detail-title nutrition-scan-result__analysis-detail-title--cooking">
                          <Utensils size={13} />
                          <span>Phương pháp chế biến & Định lượng</span>
                        </div>
                        <p>
                          {quantityCookingAnalysis || 'Kết quả này chưa có mô tả riêng về định lượng và phương pháp chế biến.'}
                        </p>
                      </div>

                      <div className="nutrition-scan-result__analysis-detail">
                        <div className="nutrition-scan-result__analysis-detail-title nutrition-scan-result__analysis-detail-title--portion">
                          <Scale size={13} />
                          <span>Cơ sở dự đoán Khối lượng & Kcal</span>
                        </div>
                        <p>
                          {portionCalorieRationale || 'Kết quả này chưa có giải thích riêng về căn cứ ước tính khối lượng và calo.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 7. SELECTORS BỮA ĂN, NGÀY, THỜI GIAN - Side by side on 1 single row */}
              <div className="nutrition-scan-result__meal-fields">
                <div className="nutrition-scan-result__meal-fields-heading">
                  <i />
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wider">Thời Gian & Phân Loại Bữa Ăn</span>
                </div>
                <div className="nutrition-scan-result__meal-fields-grid">
                  <label>
                    <span className="flex items-center gap-1 truncate"><Utensils size={11} className="text-pink-500 shrink-0" /> Bữa ăn</span>
                    <select
                      value={mealType}
                      onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])}
                      className="h-9 px-1.5 sm:px-2 rounded-xl text-[10px] sm:text-[11px] font-normal text-slate-800 outline-none cursor-pointer shadow-2xs w-full transition-all bg-white focus:border-pink-400 focus:ring-2 focus:ring-pink-500/10 truncate"
                      style={{ border: '1px solid #fbcfe8' }}
                    >
                      <option value="breakfast">Bữa sáng</option>
                      <option value="lunch">Bữa trưa</option>
                      <option value="dinner">Bữa tối</option>
                      <option value="snack">Bữa phụ</option>
                    </select>
                  </label>

                  <label>
                    <span className="flex items-center gap-1 truncate"><Calendar size={11} className="text-rose-500 shrink-0" /> Ngày</span>
                    <input
                      type="date"
                      value={mealDate}
                      onChange={(event) => setMealDate(event.target.value)}
                      className="h-9 px-1 sm:px-1.5 rounded-xl text-[10px] sm:text-[11px] font-normal text-slate-800 outline-none cursor-pointer shadow-2xs w-full transition-all bg-white border border-pink-100 focus:border-pink-400 focus:ring-2 focus:ring-pink-500/10"
                    />
                  </label>

                  <label>
                    <span className="flex items-center gap-1 truncate"><Clock size={11} className="text-orange-500 shrink-0" /> Thời gian</span>
                    <input
                      type="time"
                      value={mealTime}
                      onChange={(event) => setMealTime(event.target.value)}
                      className="h-9 px-1 sm:px-1.5 rounded-xl text-[10px] sm:text-[11px] font-normal text-slate-800 outline-none cursor-pointer shadow-2xs w-full transition-all bg-white border border-pink-100 focus:border-pink-400 focus:ring-2 focus:ring-pink-500/10"
                    />
                  </label>
                </div>
              </div>

              {/* Assumptions & Evidence Note */}
              {(analysisWarnings.length > 0 || items.some((item) => item.assumptions?.length)) && (
                <details className="nutrition-analysis-evidence nutrition-scan-result__evidence">
                  <summary className="cursor-pointer font-bold text-slate-700 flex items-center gap-1.5">
                    <Info size={14} /> Cách Aura tính toán và giả định
                  </summary>
                  <div className="mt-2 space-y-1 pl-2">
                    {analysisWarnings.map((warning, index) => (
                      <p key={`warning-${index}`} className="flex items-center gap-1 text-slate-600">
                        <CircleAlert size={13} className="text-amber-500 shrink-0" /> {warning}
                      </p>
                    ))}
                    {items.flatMap((item) => (item.assumptions ?? []).map((assumption) => `${item.name}: ${assumption}`)).map((assumption, index) => (
                      <p key={`assumption-${index}`} className="flex items-center gap-1 text-slate-600">
                        <Info size={13} className="text-blue-500 shrink-0" /> {assumption}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              {/* ACTION BUTTONS: Saved directly without outer frame */}
              <div className={`nutrition-scan-result__save-quality is-${finalConfidence}`} role="status">
                {finalConfidence === 'verified' ? <ShieldCheck size={15} /> : finalConfidence === 'estimated' ? <Info size={15} /> : <TriangleAlert size={15} />}
                <span>{finalConfidence === 'verified'
                  ? 'Dữ liệu đã đối chiếu Catalog.'
                  : finalConfidence === 'estimated'
                    ? 'Khẩu phần đã được bạn xác nhận; giá trị vẫn là ước tính dinh dưỡng.'
                    : 'Kết quả còn giả định chưa xác nhận và sẽ được lưu ở trạng thái cần kiểm tra.'}</span>
              </div>
              <div className="nutrition-scan-result__actions">
                <button
                  type="button"
                  className="nutrition-scan-result__action nutrition-scan-result__action--save"
                  onClick={() => saveMeal(false)}
                  disabled={!canSaveMeal}
                >
                  <Check size={18} className="shrink-0" />
                  <span className="truncate">Lưu vào nhật ký</span>
                </button>

                <button
                  type="button"
                  className="nutrition-scan-result__action nutrition-scan-result__action--review"
                  onClick={() => saveMeal(true)}
                  disabled={!canSaveMeal}
                >
                  <Sparkles size={18} className="shrink-0" />
                  <span className="truncate">Gửi thông tin cho Coach</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {stage !== 'result' && fileName && <small className="nutrition-file-name">{fileName}</small>}
      </section>
    </div>
  )
})

export default FoodScanModal
