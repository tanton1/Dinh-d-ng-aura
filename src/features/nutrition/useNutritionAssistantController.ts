import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { MealLog, NutritionActivityLog, NutritionFoodCatalogItem, NutritionProfileDraft } from './types'
import { loadNutritionCatalog } from './catalog'
import { normalizeNutritionSearch as normalizeSearch, resolveNutritionAssistantIntent } from './routing'
import type { AuraAssistantImageAttachment, AuraAssistantMessage } from '../../pages/student/NutritionWorkspace'

interface NutritionAssistantContext {
  resetKey: string
  profileDraft: NutritionProfileDraft
  selectedDateLabel: string
  loggedMeals: MealLog[]
  selectedDayActivities: NutritionActivityLog[]
  calorieGoal: number
  proteinGoal: number
  carbGoal: number
  fatGoal: number
  waterGoal: number
  caloriesConsumed: number
  proteinConsumed: number
  carbsConsumed: number
  fatConsumed: number
  fiberConsumed: number
  sugarConsumed: number
  sodiumConsumed: number
  water: number
  activityMinutes: number
  activityCalories: number
  fiberDataComplete: boolean
  sugarDataComplete: boolean
  sodiumDataComplete: boolean
  nutritionTargetsConfigured: boolean
  catalogSnapshot: NutritionFoodCatalogItem[]
  setCatalogSnapshot: Dispatch<SetStateAction<NutritionFoodCatalogItem[]>>
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function canLogCatalogFood(food: NutritionFoodCatalogItem): food is NutritionFoodCatalogItem & {
  calories: number
  protein: number
  carbs: number
  fat: number
} {
  return food.calories !== null && food.protein !== null && food.carbs !== null && food.fat !== null
}

export function useNutritionAssistantController({
  resetKey,
  profileDraft,
  selectedDateLabel,
  loggedMeals,
  selectedDayActivities,
  calorieGoal,
  proteinGoal,
  carbGoal,
  fatGoal,
  waterGoal,
  caloriesConsumed,
  proteinConsumed,
  carbsConsumed,
  fatConsumed,
  fiberConsumed,
  sugarConsumed,
  sodiumConsumed,
  water,
  activityMinutes,
  activityCalories,
  fiberDataComplete,
  sugarDataComplete,
  sodiumDataComplete,
  nutritionTargetsConfigured,
  catalogSnapshot,
  setCatalogSnapshot,
}: NutritionAssistantContext) {
  const [assistantMessages, setAssistantMessages] = useState<AuraAssistantMessage[]>([])
  const [assistantLoading, setAssistantLoading] = useState(false)
  const assistantImageUrlsRef = useRef(new Set<string>())

  useEffect(() => () => {
    assistantImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    assistantImageUrlsRef.current.clear()
  }, [])

  useEffect(() => {
    setAssistantMessages([])
    setAssistantLoading(false)
  }, [resetKey])

  const nutritionTargets = { configured: nutritionTargetsConfigured }
const submitAssistantQuestion = async (question: string, attachment?: AuraAssistantImageAttachment) => {
    const imagePreviewUrl = attachment ? URL.createObjectURL(attachment.file) : undefined
    if (imagePreviewUrl) assistantImageUrlsRef.current.add(imagePreviewUrl)
    const userMessage: AuraAssistantMessage = {
      id: `aura-user-${Date.now()}`,
      role: 'user',
      content: question,
      imagePreviewUrl,
      imageKind: attachment?.kind,
    }
    setAssistantMessages((current) => [...current, userMessage])
    setAssistantLoading(true)
    try {
      if (attachment) {
        const { askAiCoachDetailed, uploadAiCoachPhoto } = await import('../../services/nutritionService')
        const uploaded = await uploadAiCoachPhoto(attachment.file, attachment.kind)
        const response = await askAiCoachDetailed(question, 'nutrition-assistant', uploaded)
        setAssistantMessages((current) => [...current, {
          id: `aura-assistant-${Date.now()}`,
          role: 'assistant',
          content: response.text,
          evidence: response.dataUsed.length
            ? response.dataUsed
            : ['Ảnh chỉ dùng cho câu trả lời hiện tại và đã được xoá sau phân tích'],
          confidenceLabel: response.imageProcessed ? 'AI đã phân tích ảnh' : 'AI chưa đọc được ảnh',
        }])
        return
      }
      const intent = resolveNutritionAssistantIntent(question)
      const caloriesRemaining = calorieGoal - caloriesConsumed
      const proteinRemaining = proteinGoal - proteinConsumed
      const waterRemaining = waterGoal - water
      let content = ''
      let evidence: string[] = []
      let confidenceLabel = 'Căn cứ từ dữ liệu ngày đã chọn'

      const answerMacro = (label: string, consumed: number, goal: number) => {
        if (!nutritionTargets.configured || goal <= 0) {
          confidenceLabel = 'Hồ sơ dinh dưỡng chưa đủ dữ liệu'
          return `Aura chưa thể tính mục tiêu ${label.toLocaleLowerCase('vi-VN')} vì hồ sơ còn thiếu tuổi, chiều cao, cân nặng, giới tính sinh học hoặc mục tiêu. Hãy hoàn thiện hồ sơ trước; các bữa đã ghi vẫn được giữ nguyên.`
        }
        if (!loggedMeals.length) {
          confidenceLabel = 'Chưa đủ nhật ký bữa ăn'
          return `Mình chưa thể kết luận lượng ${label.toLocaleLowerCase('vi-VN')} còn thiếu vì ${selectedDateLabel.toLocaleLowerCase('vi-VN')} chưa có bữa ăn nào được ghi. Mục tiêu tham chiếu hiện tại là ${formatNumber(goal)}g; hãy ghi bữa đầu tiên để Aura tính phần còn lại.`
        }
        const difference = goal - consumed
        if (difference > 0) return `Bạn đã ghi khoảng ${formatNumber(consumed)}g ${label.toLocaleLowerCase('vi-VN')} và còn thiếu khoảng ${formatNumber(difference)}g so với mục tiêu ${formatNumber(goal)}g của ngày.`
        if (difference < 0) return `Bạn đã ghi khoảng ${formatNumber(consumed)}g ${label.toLocaleLowerCase('vi-VN')}, cao hơn mục tiêu tham chiếu ${formatNumber(Math.abs(difference))}g. Không cần cố bổ sung thêm chỉ để đạt một con số.`
        return `Bạn đang ở đúng mức mục tiêu ${formatNumber(goal)}g ${label.toLocaleLowerCase('vi-VN')} theo các bữa đã ghi.`
      }

      const answerQualityMetric = (label: string, value: number, goal: number, unit: string, complete: boolean, inverse: boolean) => {
        if (!complete) {
          confidenceLabel = 'Thiếu dữ liệu thành phần từ một hoặc nhiều món'
          return `Mình chưa thể đánh giá ${label.toLocaleLowerCase('vi-VN')} vì ít nhất một món trong nhật ký chưa có chỉ số này. Aura giữ trạng thái “chưa đủ dữ liệu” thay vì xem phần thiếu là 0.`
        }
        const difference = goal - value
        if (inverse) {
          return difference >= 0
            ? `Bạn đã ghi ${formatNumber(value)}${unit} ${label.toLocaleLowerCase('vi-VN')}, còn khoảng ${formatNumber(difference)}${unit} trước giới hạn tham chiếu ${formatNumber(goal)}${unit}.`
            : `Bạn đã vượt giới hạn tham chiếu ${label.toLocaleLowerCase('vi-VN')} khoảng ${formatNumber(Math.abs(difference))}${unit}. Hãy ưu tiên các lựa chọn ít ${label.toLocaleLowerCase('vi-VN')} hơn trong phần còn lại của ngày.`
        }
        return difference > 0
          ? `Bạn đã ghi ${formatNumber(value)}${unit} ${label.toLocaleLowerCase('vi-VN')} và còn thiếu khoảng ${formatNumber(difference)}${unit} so với mục tiêu ${formatNumber(goal)}${unit}.`
          : `Bạn đã đạt mục tiêu ${label.toLocaleLowerCase('vi-VN')} tham chiếu của ngày với ${formatNumber(value)}${unit}.`
      }

      if (intent === 'hydration') {
        content = !nutritionTargets.configured || waterGoal <= 0
          ? 'Aura chưa thể tính mục tiêu nước vì hồ sơ dinh dưỡng chưa đủ dữ liệu. Hãy hoàn thiện hồ sơ; lượng nước đã ghi vẫn được giữ nguyên.'
          : waterRemaining > 0
          ? `Bạn còn thiếu khoảng ${formatNumber(waterRemaining)} ml nước so với mục tiêu tham chiếu. Chia thành vài lần nhỏ trong phần còn lại của ngày sẽ dễ thực hiện hơn.`
          : 'Bạn đã đạt mục tiêu nước tham chiếu của ngày. Tiếp tục uống theo cảm giác khát và điều kiện vận động.'
        evidence = [`Nước đã ghi ${formatNumber(water)} / ${formatNumber(waterGoal)} ml`]
      } else if (intent === 'protein') {
        content = answerMacro('Đạm', proteinConsumed, proteinGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(proteinGoal)}g đạm`]
      } else if (intent === 'carbs') {
        content = answerMacro('Carb', carbsConsumed, carbGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(carbGoal)}g carb`]
      } else if (intent === 'fat') {
        content = answerMacro('Chất béo', fatConsumed, fatGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(fatGoal)}g chất béo`]
      } else if (intent === 'fiber') {
        content = answerQualityMetric('Chất xơ', fiberConsumed, 25, 'g', fiberDataComplete, false)
        evidence = [`${loggedMeals.length} bữa đã ghi`, fiberDataComplete ? 'Tất cả bữa đã ghi có dữ liệu chất xơ' : 'Có món thiếu dữ liệu chất xơ']
      } else if (intent === 'sugar') {
        content = answerQualityMetric('Đường', sugarConsumed, 50, 'g', sugarDataComplete, true)
        evidence = [`${loggedMeals.length} bữa đã ghi`, sugarDataComplete ? 'Tất cả bữa đã ghi có dữ liệu đường' : 'Có món thiếu dữ liệu đường']
      } else if (intent === 'sodium') {
        content = answerQualityMetric('Natri', sodiumConsumed, 2300, 'mg', sodiumDataComplete, true)
        evidence = [`${loggedMeals.length} bữa đã ghi`, sodiumDataComplete ? 'Tất cả bữa đã ghi có dữ liệu natri' : 'Có món thiếu dữ liệu natri']
      } else if (intent === 'energy') {
        content = !nutritionTargets.configured || calorieGoal <= 0
          ? 'Aura chưa thể tính mục tiêu năng lượng vì hồ sơ còn thiếu dữ liệu cơ thể hoặc mục tiêu. Hãy hoàn thiện hồ sơ trước; nhật ký bữa ăn hiện tại vẫn được giữ nguyên.'
          : !loggedMeals.length
          ? `Mục tiêu năng lượng tham chiếu của bạn là ${formatNumber(calorieGoal)} kcal. Ngày này chưa có bữa ăn được ghi nên Aura chưa thể đánh giá mức còn lại một cách có ý nghĩa.`
          : caloriesRemaining >= 0
            ? `Bạn đã ghi ${formatNumber(caloriesConsumed)} kcal và còn khoảng ${formatNumber(caloriesRemaining)} kcal so với mục tiêu ${formatNumber(calorieGoal)} kcal.`
            : `Bạn đã ghi ${formatNumber(caloriesConsumed)} kcal, cao hơn mục tiêu tham chiếu khoảng ${formatNumber(Math.abs(caloriesRemaining))} kcal. Không cần nhịn bù; hãy quay về nhịp ăn bình thường ở bữa tiếp theo.`
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(calorieGoal)} kcal`]
      } else if (intent === 'workout') {
        const normalizedQuestion = normalizeSearch(question)
        content = !nutritionTargets.configured
          ? 'Bạn vẫn có thể ghi vận động, nhưng Aura chưa thể cá nhân hóa bữa trước hoặc sau tập cho đến khi hồ sơ dinh dưỡng có đủ tuổi, chiều cao, cân nặng, giới tính sinh học và mục tiêu.'
          : normalizedQuestion.includes('truoc tap')
          ? 'Trước tập, ưu tiên một khẩu phần dễ tiêu có carb và một ít đạm; lượng cụ thể còn phụ thuộc thời gian đến buổi tập và khẩu phần bạn đã ăn.'
          : normalizedQuestion.includes('sau tap')
            ? `Sau tập, hãy ưu tiên bữa có đạm và carb. Theo nhật ký ngày này, bạn ${proteinRemaining > 0 ? `còn khoảng ${formatNumber(proteinRemaining)}g đạm` : 'đã đạt mục tiêu đạm tham chiếu'}.`
            : selectedDayActivities.length
              ? `Bạn đã ghi ${activityMinutes} phút vận động, ước tính ${formatNumber(activityCalories)} kcal. Aura theo dõi phần này riêng và không tự cộng toàn bộ vào ngân sách ăn.`
              : 'Ngày này chưa có buổi tập được ghi. Bạn có thể thêm thời gian và cường độ để Aura đặt gợi ý bữa ăn đúng ngữ cảnh hơn.'
        evidence = [`${selectedDayActivities.length} buổi tập · ${activityMinutes} phút`, `Kcal vận động được theo dõi riêng`]
      } else if (intent === 'allergy') {
        content = profileDraft.allergies.trim()
          ? `Hồ sơ đang ghi cần tránh: ${profileDraft.allergies}. Tuy nhiên tên món và dữ liệu dinh dưỡng không đủ để xác nhận món an toàn dị ứng; bạn vẫn cần kiểm tra nguyên liệu và cách chế biến trực tiếp.`
          : 'Hồ sơ chưa có thực phẩm cần tránh. Nếu bạn có dị ứng, hãy cập nhật hồ sơ trước khi dùng gợi ý món; Aura không thể xác nhận an toàn dị ứng chỉ từ tên món.'
        evidence = [profileDraft.allergies.trim() ? `Hồ sơ: tránh ${profileDraft.allergies}` : 'Hồ sơ chưa ghi dị ứng']
        confidenceLabel = 'Không thay thế xác nhận thành phần trực tiếp'
      } else if (intent === 'next-meal') {
        if (!nutritionTargets.configured) {
          content = 'Aura chưa thể xếp hạng bữa tiếp theo theo phần dinh dưỡng còn thiếu vì hồ sơ chưa có mục tiêu hợp lệ. Hãy hoàn thiện hồ sơ; sau đó Aura sẽ dùng chính các bữa đã ghi để gợi ý.'
          evidence = ['Mục tiêu dinh dưỡng chưa được thiết lập']
          confidenceLabel = 'Cần hoàn thiện hồ sơ'
        } else if (!loggedMeals.length) {
          content = 'Ngày này chưa có bữa ăn được ghi, nên mình chưa thể chọn “bữa tiếp theo” theo phần dinh dưỡng còn thiếu. Hãy quét hoặc chọn bữa đầu tiên; Aura sẽ không tự lưu khi bạn chưa xác nhận.'
          evidence = ['Chưa có bữa ăn trong ngày đã chọn']
          confidenceLabel = 'Cần thêm một bữa để cá nhân hóa'
        } else {
          let availableCatalog = catalogSnapshot
          if (!availableCatalog.length) {
            try {
              availableCatalog = await loadNutritionCatalog()
              setCatalogSnapshot(availableCatalog)
            } catch {
              availableCatalog = []
            }
          }
          const hasAllergyConstraint = Boolean(profileDraft.allergies.trim())
          const canNameCandidates = caloriesRemaining > 0 && !hasAllergyConstraint
          const targetCalories = Math.min(650, Math.max(40, caloriesRemaining))
          const calorieCeiling = Math.min(750, targetCalories + Math.min(60, Math.max(15, targetCalories * .12)))
          const rankedCandidates = canNameCandidates ? availableCatalog
            .filter((item) => item.kind === 'dish' && canLogCatalogFood(item) && item.calories > 0 && item.calories <= calorieCeiling)
            .sort((left, right) => {
              const leftEnergy = Math.abs((left.calories ?? 0) - targetCalories) / targetCalories
              const rightEnergy = Math.abs((right.calories ?? 0) - targetCalories) / targetCalories
              const leftProteinBoost = proteinRemaining > 12 ? Math.min(1, (left.protein ?? 0) / Math.max(1, proteinRemaining)) * .18 : 0
              const rightProteinBoost = proteinRemaining > 12 ? Math.min(1, (right.protein ?? 0) / Math.max(1, proteinRemaining)) * .18 : 0
              return (leftEnergy - leftProteinBoost) - (rightEnergy - rightProteinBoost)
            }) : []
          const candidateNames = new Set<string>()
          const candidates = rankedCandidates
            .filter((item) => {
              const key = normalizeSearch(item.name)
              if (candidateNames.has(key)) return false
              candidateNames.add(key)
              return true
            })
            .slice(0, 3)
          const focus = proteinRemaining > 12 ? `ưu tiên đạm vì còn thiếu khoảng ${formatNumber(proteinRemaining)}g` : carbsConsumed < carbGoal * .65 ? 'bổ sung carb vừa phải cùng rau và đạm' : 'giữ khẩu phần cân bằng và dễ duy trì'
          const candidateCopy = hasAllergyConstraint
            ? ' Hồ sơ có thực phẩm cần tránh, nên Aura chưa nêu tên món khi Catalog chưa xác nhận đầy đủ thành phần.'
            : candidates.length
              ? ` Trong Catalog, các lựa chọn gần ngân sách hiện tại gồm ${candidates.map((item) => `${item.name} (${formatNumber(item.calories ?? 0)} kcal theo khẩu phần nguồn)`).join(', ')}.`
              : caloriesRemaining > 0
                ? ' Chưa có khẩu phần nguồn nào nằm gần ngưỡng kcal này; hãy mở Catalog và giảm khẩu phần thực tế trước khi ghi.'
                : ''
          content = caloriesRemaining <= 0
            ? `Bạn đã chạm ngân sách năng lượng tham chiếu. Nếu vẫn đói, hãy chọn một bữa nhẹ, ưu tiên rau và đạm, không cần nhịn bù.${candidateCopy}`
            : `Bữa tiếp theo nên ${focus}; bạn còn khoảng ${formatNumber(caloriesRemaining)} kcal.${candidateCopy}`
          const candidateEvidence = candidates.length
            ? `${candidates.length} món được xếp hạng từ Catalog`
            : hasAllergyConstraint
              ? 'Không xếp hạng tên món khi chưa xác nhận thành phần dị ứng'
              : caloriesRemaining <= 0
                ? 'Không đề xuất thêm món khi đã chạm ngân sách tham chiếu'
              : availableCatalog.length ? 'Không có khẩu phần nguồn phù hợp ngưỡng kcal còn lại' : 'Chưa tải được Catalog dinh dưỡng'
          evidence = [`${loggedMeals.length} bữa đã ghi`, `${formatNumber(Math.max(0, caloriesRemaining))} kcal và ${formatNumber(Math.max(0, proteinRemaining))}g đạm còn lại`, candidateEvidence]
          confidenceLabel = candidates.length ? 'Gợi ý theo dữ liệu đã ghi và khẩu phần nguồn' : hasAllergyConstraint ? 'An toàn dị ứng cần kiểm tra thành phần trực tiếp' : 'Gợi ý theo mục tiêu; cần kiểm tra khẩu phần thực tế'
        }
      } else if (intent === 'getting-started') {
        content = 'Bắt đầu bằng một thao tác: quét ảnh hoặc chọn món trong Catalog, kiểm tra khẩu phần rồi xác nhận bữa và thời gian. Sau một đến hai bữa, Aura có thể trả lời phần còn thiếu cụ thể hơn.'
        evidence = [`${loggedMeals.length} bữa đã ghi trong ngày đã chọn`]
      } else {
        const { askAiCoach } = await import('../../services/nutritionService')
        content = await askAiCoach(question, profileDraft)
        evidence = ['Aura AI dùng apikey.fun; OpenRouter chỉ chạy dự phòng khi nhà cung cấp chính lỗi']
        confidenceLabel = 'AI Generated'
      }
      setAssistantMessages((current) => [...current, {
        id: `aura-assistant-${Date.now()}`,
        role: 'assistant',
        content,
        evidence,
        confidenceLabel,
      }])
    } catch {
      setAssistantMessages((current) => [...current, {
        id: `aura-assistant-error-${Date.now()}`,
        role: 'assistant',
        content: 'Aura chưa thể đối chiếu dữ liệu lúc này. Bạn có thể thử lại hoặc mở Nhật ký để kiểm tra trực tiếp các chỉ số đã ghi.',
        evidence: ['Không có dữ liệu nào được tự suy đoán trong lần trả lời này'],
        confidenceLabel: 'Chưa thể phân tích',
      }])
    } finally {
      setAssistantLoading(false)
    }
  }


  return { assistantMessages, assistantLoading, submitAssistantQuestion }
}
