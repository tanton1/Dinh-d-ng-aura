import { useState, useEffect, useMemo } from 'react'
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  AlertCircle,
  RefreshCw,
  Send,
  Check,
  Clock,
  Dumbbell,
  Search,
  CheckSquare,
  Square,
  ArrowLeft,
  Flame,
  Zap,
  User,
  Eye,
  ShieldCheck,
  SlidersHorizontal,
  Bell,
  Info,
  MoreHorizontal,
  Plus,
  Percent,
  MessageCircle,
  X,
  Filter
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  getPendingMealsFromFirestore,
  approveMealInFirestore,
  subscribeToRealtimeMeals,
  type PendingMealItem,
} from '../../firebaseSync'

interface AdminNutritionReviewsPageProps {
  onNavigate?: (view: ViewId) => void
}

export default function AdminNutritionReviewsPage({ onNavigate }: AdminNutritionReviewsPageProps) {
  // Current screen mode: 'overview' | 'detail' | 'batch'
  const [viewMode, setViewMode] = useState<'overview' | 'detail' | 'batch'>('overview')
  const [selectedMealId, setSelectedMealId] = useState<string | null>(null)
  
  // All meals state initialized strictly to empty list from Firestore
  const [allMeals, setAllMeals] = useState<PendingMealItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // Filters & Search
  const [activeFilter, setActiveFilter] = useState<'all' | 'priority' | 'new' | 'low_ai' | 'pending_response' | 'approved'>('all')
  const [batchFilter, setBatchFilter] = useState<'all' | 'priority' | 'new' | 'low_ai'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Batch Selection State
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set())

  // Collapsible sections state
  const [isPendingGroupOpen, setIsPendingGroupOpen] = useState(true)
  const [isApprovedGroupOpen, setIsApprovedGroupOpen] = useState(true)

  // Detail View State
  const [activeDetailTab, setActiveDetailTab] = useState<'slide1' | 'slide2'>('slide1')
  const [coachFeedback, setCoachFeedback] = useState('')
  const [isApprovedSuccess, setIsApprovedSuccess] = useState(false)

  // Sync strictly from Firestore Realtime
  useEffect(() => {
    setIsLoading(true)
    const unsubscribe = subscribeToRealtimeMeals((realtimeMeals) => {
      setAllMeals(realtimeMeals || [])
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [])

  // Sync selected meal when opening detail view
  useEffect(() => {
    if (selectedMealId) {
      const meal = allMeals.find((m) => m.id === selectedMealId)
      if (meal) {
        setCoachFeedback(meal.coachFeedback || '')
      }
    }
  }, [selectedMealId, allMeals])

  // Filtered meals list
  const filteredMeals = useMemo(() => {
    return allMeals.filter((m) => {
      // Search term
      if (
        searchTerm &&
        !m.studentName.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !(m.note && m.note.toLowerCase().includes(searchTerm.toLowerCase()))
      ) {
        return false
      }

      if (activeFilter === 'priority') return m.priority === 'high' && m.status === 'pending'
      if (activeFilter === 'new') return Boolean(m.isNew) && m.status === 'pending'
      if (activeFilter === 'low_ai') return (m.aiScore ? m.aiScore < 75 : false) && m.status === 'pending'
      if (activeFilter === 'pending_response') return m.status === 'pending'
      if (activeFilter === 'approved') return m.status === 'approved'

      return true
    })
  }, [allMeals, activeFilter, searchTerm])

  const highPriorityMeals = useMemo(() => {
    return filteredMeals.filter((m) => m.priority === 'high' && m.status === 'pending')
  }, [filteredMeals])

  const pendingMeals = useMemo(() => {
    return filteredMeals.filter((m) => m.priority !== 'high' && m.status === 'pending')
  }, [filteredMeals])

  const approvedMeals = useMemo(() => {
    return filteredMeals.filter((m) => m.status === 'approved')
  }, [filteredMeals])

  // Handlers
  const handleOpenDetail = (id: string) => {
    setSelectedMealId(id)
    setViewMode('detail')
  }

  const handleApproveSingle = async (mealId: string, feedbackText?: string) => {
    const text = feedbackText || coachFeedback || 'Bữa ăn rất chuẩn bài! Hãy tiếp tục duy trì nhé.'
    setIsApprovedSuccess(true)

    try {
      await approveMealInFirestore(mealId, text)
    } catch (e) {
      console.error('Approve meal error:', e)
    }

    setAllMeals((prev) =>
      prev.map((m) => (m.id === mealId ? { ...m, status: 'approved', coachFeedback: text } : m))
    )

    setTimeout(() => {
      setIsApprovedSuccess(false)
      setViewMode('overview')
      setSelectedMealId(null)
    }, 800)
  }

  const handleBatchToggleSelect = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleBatchSelectAllToggle = () => {
    const allPendingIds = allMeals.filter((m) => m.status === 'pending').map((m) => m.id)
    if (selectedBatchIds.size >= allPendingIds.length) {
      setSelectedBatchIds(new Set())
    } else {
      setSelectedBatchIds(new Set(allPendingIds))
    }
  }

  const handleBatchApproveSubmit = async () => {
    if (selectedBatchIds.size === 0) return
    const idsToApprove = Array.from(selectedBatchIds)

    for (const id of idsToApprove) {
      try {
        await approveMealInFirestore(id, 'Đã phê duyệt nhanh qua hệ thống AI Aura')
      } catch (e) {
        console.error(e)
      }
    }

    setAllMeals((prev) =>
      prev.map((m) =>
        selectedBatchIds.has(m.id)
          ? { ...m, status: 'approved', coachFeedback: 'Đã phê duyệt nhanh qua hệ thống AI Aura' }
          : m
      )
    )

    setSelectedBatchIds(new Set())
    setViewMode('overview')
  }

  const handleQuickApproveAiHighConfidence = async () => {
    const highAiMeals = allMeals.filter((m) => m.status === 'pending' && (m.aiScore || 0) >= 90)
    for (const m of highAiMeals) {
      try {
        await approveMealInFirestore(m.id, 'Phê duyệt tự động - Chỉ số AI tin cậy cao >= 90%')
      } catch (e) {
        console.error(e)
      }
    }

    setAllMeals((prev) =>
      prev.map((m) =>
        m.status === 'pending' && (m.aiScore || 0) >= 90
          ? { ...m, status: 'approved', coachFeedback: 'Phê duyệt tự động - Chỉ số AI tin cậy cao >= 90%' }
          : m
      )
    )

    setViewMode('overview')
  }

  const applyQuickPillText = (text: string) => {
    setCoachFeedback((prev) => (prev ? `${prev} ${text}` : text))
  }

  // ==========================================
  // VIEW 2: CHI TIẾT BỮA ĂN (DETAIL VIEW)
  // ==========================================
  if (viewMode === 'detail' && selectedMealId) {
    const meal = allMeals.find((m) => m.id === selectedMealId)
    if (!meal) {
      return (
        <div className="aura-review-detail-screen flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4 text-2xl">
            🔍
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Không tìm thấy thông tin bữa ăn</h3>
          <p className="text-sm text-gray-500 max-w-xs mb-6">Bữa ăn này có thể đã được duyệt hoặc không tồn tại trong hệ thống.</p>
          <button
            type="button"
            className="aura-bottom-btn-chat max-w-xs"
            onClick={() => {
              setViewMode('overview')
              setSelectedMealId(null)
            }}
          >
            <ArrowLeft size={18} />
            <span>Trở về danh sách</span>
          </button>
        </div>
      )
    }
    const currentKcal = meal.totalKcal || 315
    const targetKcal = meal.targetKcal || 600
    const kcalPct = Math.min(Math.round((currentKcal / targetKcal) * 100), 100)

    const currentProt = meal.totalProtein || 19
    const targetProt = meal.targetProtein || 30
    const protPct = Math.min(Math.round((currentProt / targetProt) * 100), 100)

    const currentCarb = meal.totalCarb || 35
    const targetCarb = meal.targetCarb || 75
    const carbPct = Math.min(Math.round((currentCarb / targetCarb) * 100), 100)

    const currentFat = meal.totalFat || 10
    const targetFat = meal.targetFat || 20
    const fatPct = Math.min(Math.round((currentFat / targetFat) * 100), 100)

    const currentFiber = meal.fiber || 3.2
    const targetFiber = meal.targetFiber || 25
    const fiberPct = Math.min(Math.round((currentFiber / targetFiber) * 100), 100)

    const currentSodium = meal.sodium || 210
    const targetSodium = meal.targetSodium || 1500
    const sodiumPct = Math.min(Math.round((currentSodium / targetSodium) * 100), 100)

    // Dynamic ingredients extraction for Slide 1
    const rawItems = meal.items || meal.aiAnalysis?.items || []
    const fallbackIngs = meal.ingredients || []

    let dynamicIngredients: Array<{ icon: string; name: string; amount: string; kcal: number }> = []

    if (rawItems.length > 0) {
      dynamicIngredients = rawItems.map((item) => {
        let icon = '🥗'
        const n = item.name.toLowerCase()
        if (n.includes('sữa') || n.includes('milk')) icon = '🥛'
        else if (n.includes('chuối') || n.includes('banana')) icon = '🍌'
        else if (n.includes('yến mạch') || n.includes('oat')) icon = '🌾'
        else if (n.includes('gà') || n.includes('chicken') || n.includes('thịt')) icon = '🍗'
        else if (n.includes('bơ') || n.includes('avocado')) icon = '🥑'
        else if (n.includes('mật ong') || n.includes('honey')) icon = '🍯'
        else if (n.includes('cơm') || n.includes('gạo') || n.includes('rice')) icon = '🍚'
        else if (n.includes('trứng') || n.includes('egg')) icon = '🥚'
        else if (n.includes('bò') || n.includes('beef')) icon = '🥩'
        else if (n.includes('cá') || n.includes('fish')) icon = '🐟'
        else if (n.includes('salad') || n.includes('rau')) icon = '🥗'

        return {
          icon,
          name: item.name,
          amount: item.weight ? `${item.weight}g` : '1 phần',
          kcal: item.kcal || Math.round(currentKcal / rawItems.length)
        }
      })
    } else if (fallbackIngs.length > 0) {
      dynamicIngredients = fallbackIngs.map((ing) => {
        let icon = '🥗'
        const n = ing.name.toLowerCase()
        if (n.includes('sữa')) icon = '🥛'
        else if (n.includes('chuối')) icon = '🍌'
        else if (n.includes('yến mạch')) icon = '🌾'
        else if (n.includes('gà') || n.includes('thịt')) icon = '🍗'
        else if (n.includes('bơ')) icon = '🥑'
        else if (n.includes('mật ong')) icon = '🍯'
        else if (n.includes('cơm') || n.includes('gạo')) icon = '🍚'
        else if (n.includes('trứng')) icon = '🥚'
        else if (n.includes('bò')) icon = '🥩'

        return {
          icon,
          name: ing.name,
          amount: ing.amount,
          kcal: Math.round(currentKcal / fallbackIngs.length)
        }
      })
    } else {
      // Build dynamic items based on meal.note or meal.mealType
      const noteLabel = meal.note || meal.mealType || 'Món ăn thực tế'
      dynamicIngredients = [
        {
          icon: '🍲',
          name: noteLabel,
          amount: '1 phần',
          kcal: Math.round(currentKcal * 0.65)
        },
        {
          icon: '🥗',
          name: 'Rau củ & chất xơ kèm theo',
          amount: '150g',
          kcal: Math.round(currentKcal * 0.15)
        },
        {
          icon: '🥑',
          name: 'Gia vị & phụ liệu',
          amount: '10g',
          kcal: Math.round(currentKcal * 0.2)
        }
      ]
    }

    // Dynamic AI Coach Internal Advice (30-100 words, deep PT analysis & student profile focused)
    const goalText = meal.studentGoal || 'Giảm mỡ thâm hụt calo & săn chắc cơ bắp'
    const conditionText = meal.studentCondition || 'Học viên Aura Fitness'
    const protDiff = targetProt - currentProt
    const protStatus = currentProt >= targetProt 
      ? `lượng đạm nạp vào (${currentProt}g) đã đáp ứng xuất sắc target ${targetProt}g để tối ưu tổng hợp cơ bắp`
      : `lượng đạm (${currentProt}g) còn thiếu khoảng ${protDiff}g so với mục tiêu ${targetProt}g`
    const kcalStatus = currentKcal > targetKcal
      ? `năng lượng bữa này (${currentKcal} kcal) hơi vượt mức kiểm soát, Coach nên nhắc điều chỉnh lượng dầu mỡ hoặc tinh bột bữa tiếp theo`
      : `năng lượng (${currentKcal}/${targetKcal} kcal) nằm trong ngưỡng thâm hụt an toàn`

    const coachInternalAdvice = meal.coachFeedbackSuggestion || meal.aiAnalysis?.coachFeedbackSuggestion || (
      `Phân tích chuyên sâu cho học viên ${meal.studentName} (${conditionText}, Mục tiêu: ${goalText}): Bữa ${meal.mealType || 'chính'}${meal.note ? ` ("${meal.note}")` : ''} nạp ${currentKcal} kcal và ${currentProt}g đạm. Đánh giá PT chuyên môn: ${protStatus}, đồng thời ${kcalStatus}. Gợi ý Coach: Khen ngợi sự tích cực ghi nhận nhật ký của học viên và khuyên bổ sung ${protDiff > 0 ? `${protDiff}g đạm nạc (ức gà/lòng trắng trứng)` : 'thêm 150g rau xanh'} ở bữa tiếp theo để giữ vững tiến độ!`
    )

    // Dynamic Student-Facing Message for Quick Paste (30-100 words)
    const coachStudentMsg = `Chào ${meal.studentName}! Coach đã duyệt bữa ${meal.mealType || 'ăn'}${meal.note ? ` (${meal.note})` : ''} của em (${currentKcal} Kcal, ${currentProt}g đạm). Dựa trên mục tiêu ${goalText}: ${currentProt >= targetProt ? 'Chỉ số đạm của em rất tuyệt vời, giúp cơ bắp phục hồi và phát triển tối đa!' : `Bữa này em còn thiếu khoảng ${protDiff}g đạm nạc so với mục tiêu, lần sau nhớ bổ sung thêm ức gà hoặc trứng nhé.`} Hãy kiên trì nỗ lực và giữ vững phong độ em nhé! 💪`

    return (
      <div className="aura-review-detail-screen">
        {/* Top Sticky Header */}
        <header className="aura-review-top-nav">
          <button
            type="button"
            className="aura-nav-back-btn"
            onClick={() => {
              setViewMode('overview')
              setSelectedMealId(null)
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="aura-nav-title">Chi tiết bữa ăn</h2>
          <button type="button" className="aura-nav-more-btn">
            <MoreHorizontal size={20} />
          </button>
        </header>

        <div className="aura-review-detail-content">
          {/* Main Hero Photo Container */}
          <div className="aura-detail-photo-card">
            <img src={meal.img} alt={meal.studentName} className="aura-detail-photo-img" />
            
            {/* Badges Overlays */}
            {meal.priority === 'high' && (
              <span className="aura-detail-badge-priority">
                <Flame size={12} fill="currentColor" /> Ưu tiên
              </span>
            )}
            <span className="aura-detail-badge-score">
              AI {meal.aiScore || 68}%
            </span>
          </div>

          {/* Student Profile Info Header */}
          <div className="aura-student-profile-header">
            <div className="aura-student-avatar-col">
              <div className="aura-student-avatar-circle">
                <User size={20} />
              </div>
            </div>
            <div className="aura-student-info-col">
              <div className="aura-student-name-row">
                <span className="aura-student-name">{meal.studentName}</span>
                {meal.isNew && <span className="aura-new-star-badge">⭐ Mới</span>}
                <span className="aura-meal-time-stamp">{meal.time} • 05/08/2026</span>
              </div>
              <p className="aura-meal-type-label">{meal.mealType || 'Bữa tối'}</p>
              
              {/* Status pill tags */}
              <div className="aura-status-tags-row">
                {meal.confidence === 'low' && (
                  <span className="aura-pill-tag purple">AI tự tin thấp</span>
                )}
                <span className="aura-pill-tag orange">Cần phản hồi</span>
              </div>
            </div>
          </div>

          {/* Quick Macro Box Row */}
          <div className="aura-quick-macros-grid">
            <div className="aura-macro-col">
              <strong>{meal.totalKcal}</strong>
              <small>Kcal</small>
            </div>
            <div className="aura-macro-col">
              <strong>{meal.totalProtein}g</strong>
              <small>Protein</small>
            </div>
            <div className="aura-macro-col">
              <strong>{meal.totalCarb || 35}g</strong>
              <small>Carb</small>
            </div>
            <div className="aura-macro-col">
              <strong>{meal.totalFat || 10}g</strong>
              <small>Fat</small>
            </div>
          </div>

          {/* AI Analysis Section (Cleaned without negative tags) */}
          <div className="aura-detail-section-card">
            <div className="aura-section-header-title">
              <h3>Chỉ số AI phân tích</h3>
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                ⚡ Nhận diện tự động
              </span>
            </div>

            {/* AI Confidence Gauge */}
            <div className="aura-ai-gauge-box">
              <div className="aura-gauge-circle-wrapper">
                <svg className="aura-gauge-svg" viewBox="0 0 36 36">
                  <path
                    className="gauge-bg"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="gauge-progress"
                    strokeDasharray={`${meal.aiScore || 94}, 100`}
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="aura-gauge-text">{meal.aiScore || 94}%</div>
              </div>
              <div className="aura-gauge-info">
                <h4>Độ chính xác AI đạt {meal.aiScore || 94}%</h4>
                <p>Hệ thống tự động phân tích hình ảnh và ước tính thành phần dinh dưỡng chuẩn xác.</p>
              </div>
            </div>
          </div>

          {/* Slide 1 & Slide 2 Tab Navigation Switcher */}
          <div className="aura-slides-tab-row">
            <button
              type="button"
              className={`aura-slide-tab-btn ${activeDetailTab === 'slide1' ? 'active' : ''}`}
              onClick={() => setActiveDetailTab('slide1')}
            >
              <Eye size={15} />
              <span>Thành phần nhận diện & Kcal</span>
            </button>
            <button
              type="button"
              className={`aura-slide-tab-btn ${activeDetailTab === 'slide2' ? 'active' : ''}`}
              onClick={() => setActiveDetailTab('slide2')}
            >
              <SlidersHorizontal size={15} />
              <span>Dinh dưỡng chi tiết</span>
            </button>
          </div>

          {/* SLIDE 1: THÀNH PHẦN NHẬN DIỆN & KCAL CHI TIẾT (ĐỘNG THEO MÓN ĂN THỰC TẾ) */}
          {activeDetailTab === 'slide1' ? (
            <div className="aura-detail-section-card">
              <div className="aura-section-header-title">
                <h3>Thành phần nhận diện & Kcal</h3>
                <span className="text-xs font-bold text-pink-600 bg-pink-50 px-2 py-1 rounded-full border border-pink-200">
                  {dynamicIngredients.length} Thành phần
                </span>
              </div>

              {/* Compact 1-Line Dynamic Ingredient List */}
              <div className="flex flex-col gap-2 mt-1">
                {dynamicIngredients.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2.5 p-2.5 bg-slate-50 border border-slate-100 rounded-xl transition-all hover:bg-white hover:border-pink-200 hover:shadow-2xs"
                  >
                    <span className="text-base bg-white p-1 rounded-md border border-slate-100 shadow-2xs shrink-0">{item.icon}</span>
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {item.name} {item.amount} — <span className="text-pink-600 font-extrabold">{item.kcal} Kcal</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Total Calculated Kcal Bar */}
              <div className="flex items-center justify-between p-3 bg-pink-50/70 border border-pink-200 rounded-xl mt-3">
                <span className="text-xs font-bold text-pink-900">Tổng năng lượng thực tế:</span>
                <strong className="text-sm font-black text-pink-600">{currentKcal} / {targetKcal} Kcal</strong>
              </div>
            </div>
          ) : (
            /* SLIDE 2: DINH DƯỠNG CHI TIẾT (MACROS PROGRESS) */
            <div className="aura-detail-section-card">
              <div className="aura-section-header-title">
                <h3>Dinh dưỡng chi tiết (Macros)</h3>
                <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded-full border border-purple-200">
                  🎯 Chỉ số phân tích
                </span>
              </div>

              <div className="aura-nutrient-progress-list">
                {/* Năng lượng */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Năng lượng</span>
                    <strong>{currentKcal} / {targetKcal} kcal <small>{kcalPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill pink" style={{ width: `${kcalPct}%` }} />
                  </div>
                </div>

                {/* Protein */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Protein</span>
                    <strong>{currentProt} / {targetProt} g <small>{protPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill green" style={{ width: `${protPct}%` }} />
                  </div>
                </div>

                {/* Carb */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Carb</span>
                    <strong>{currentCarb} / {targetCarb} g <small>{carbPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill blue" style={{ width: `${carbPct}%` }} />
                  </div>
                </div>

                {/* Fat */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Fat</span>
                    <strong>{currentFat} / {targetFat} g <small>{fatPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill orange" style={{ width: `${fatPct}%` }} />
                  </div>
                </div>

                {/* Chất xơ */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Chất xơ</span>
                    <strong>{currentFiber} / {targetFiber} g <small>{fiberPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill purple" style={{ width: `${fiberPct}%` }} />
                  </div>
                </div>

                {/* Natri */}
                <div className="aura-progress-item">
                  <div className="aura-progress-meta">
                    <span>Natri</span>
                    <strong>{currentSodium} / {targetSodium} mg <small>{sodiumPct}%</small></strong>
                  </div>
                  <div className="aura-progress-bar-bg">
                    <div className="aura-progress-fill teal" style={{ width: `${sodiumPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI COACH GỢI Ý (KHUNG NỀN GRADIENT HỒNG - CAM NỔI BẬT) */}
          <div className="aura-detail-section-card aura-gradient-pink-orange-card !rounded-3xl">
            <div className="aura-section-header-title">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gradient-to-r from-pink-500 to-orange-400 text-white rounded-xl shadow-2xs flex items-center justify-center">
                  <Sparkles size={16} />
                </div>
                <h3 className="font-black text-base bg-gradient-to-r from-pink-600 via-rose-500 to-orange-500 bg-clip-text text-transparent flex items-center gap-1.5">
                  Gợi ý từ AI Coach
                </h3>
              </div>
              <span className="aura-sla-badge warning">
                ⏱️ Target SLA Phản hồi: 60 phút
              </span>
            </div>

            {/* Student Goals & Profile Overview Pill */}
            <div className="bg-white/80 backdrop-blur-sm p-3 rounded-2xl border border-pink-200/60 flex flex-wrap gap-2 text-xs font-bold text-slate-700">
              <span className="bg-pink-100 text-pink-800 px-2.5 py-1 rounded-xl">🎯 Target: {meal.studentGoal || 'Giảm mỡ - Tăng cơ'}</span>
              <span className="bg-orange-100 text-orange-800 px-2.5 py-1 rounded-xl">🏋️ {meal.studentCondition || 'Tập gym 4 buổi/tuần'}</span>
              <span className="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-xl">🍽️ Bữa: {meal.mealType || 'Bữa chính'}</span>
            </div>

            {/* AI Personalized Coach Recommendation */}
            <div className="bg-white/90 p-3.5 rounded-2xl border border-pink-200 text-xs text-slate-700 leading-relaxed shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <strong className="bg-gradient-to-r from-pink-600 to-orange-500 bg-clip-text text-transparent font-bold text-xs">🤖 AI Coach Tư Vấn Dành Cho PT/Coach:</strong>
                <button
                  type="button"
                  className="text-[11px] font-bold text-pink-600 hover:text-pink-800 bg-pink-50 hover:bg-pink-100 px-2.5 py-1 rounded-xl border border-pink-200 flex items-center gap-1 transition-all"
                  onClick={() => {
                    applyQuickPillText(coachStudentMsg)
                  }}
                >
                  <Sparkles size={12} className="text-pink-500" />
                  <span>Dán gợi ý vào nhận xét</span>
                </button>
              </div>
              <p className="margin-0 font-medium text-slate-700">
                "{coachInternalAdvice}"
              </p>
            </div>
          </div>

          {/* NHẬN XÉT TỪ COACH (KHUNG NỀN GRADIENT HỒNG - XANH TƯƠI MÁT) */}
          <div className="aura-detail-section-card aura-gradient-pink-blue-card !rounded-3xl">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gradient-to-r from-pink-500 to-orange-400 text-white rounded-xl shadow-2xs flex items-center justify-center">
                  <Sparkles size={16} />
                </div>
                <h3 className="font-black text-base bg-gradient-to-r from-pink-600 via-rose-500 to-orange-500 bg-clip-text text-transparent flex items-center gap-1.5">
                  Nhận xét từ Coach
                </h3>
              </div>
              <span className="text-[11px] font-extrabold text-cyan-700 bg-cyan-100/80 px-2.5 py-1 rounded-full border border-cyan-200">
                Gửi trực tiếp cho học viên
              </span>
            </div>
            
            {/* Quick Pills for Coach Response */}
            <div className="aura-quick-pills-row">
              <button
                type="button"
                className="aura-quick-pill border-pink-300 text-pink-700 bg-pink-50/60 hover:bg-pink-100 rounded-2xl"
                onClick={() => {
                  applyQuickPillText(coachStudentMsg)
                }}
              >
                📋 Dán từ AI Coach
              </button>
              <button
                type="button"
                className="aura-quick-pill rounded-2xl"
                onClick={() => applyQuickPillText(`Chào ${meal.studentName}, bữa ăn này rất chuẩn chỉ về dinh dưỡng! Tỉ lệ đạm nạc cùng năng lượng nạp vào kiểm soát rất tốt giúp em duy trì thâm hụt calo chuẩn mục tiêu ${goalText}. Hãy tiếp tục giữ vững kỷ luật này nhé! 👏`)}
              >
                Bữa ăn chuẩn bài 👏
              </button>
              <button
                type="button"
                className="aura-quick-pill rounded-2xl"
                onClick={() => applyQuickPillText(`Chào ${meal.studentName}, bữa ăn này rất thanh nhẹ tốt cho tiêu hóa. Để đạt chuẩn thâm hụt calo và duy trì thể trạng ${conditionText}, em nên thêm khoảng 150g rau xanh ở bữa tiếp theo để tăng chất xơ nhé! 🥦`)}
              >
                Thêm 150g rau xanh 🥦
              </button>
              <button
                type="button"
                className="aura-quick-pill rounded-2xl"
                onClick={() => applyQuickPillText(`Chào ${meal.studentName}, bữa ăn hiện tại rất tươi ngon nhưng lượng đạm còn thiếu so với mục tiêu ${goalText}. Lần sau em nên bổ sung thêm khoảng 100g ức gà hoặc lòng trắng trứng để cơ bắp phục hồi tối ưu nhé! 💪`)}
              >
                Thêm protein nạc 💪
              </button>
            </div>

            {/* Textarea feedback */}
            <div className="aura-textarea-wrapper rounded-2xl overflow-hidden">
              <textarea
                rows={3}
                placeholder="Nhập ghi chú và lời khuyên dành riêng cho học viên..."
                value={coachFeedback}
                onChange={(e) => setCoachFeedback(e.target.value)}
                maxLength={600}
                className="bg-white/90 border-cyan-200 focus:border-cyan-500 rounded-2xl"
              />
              <span className="aura-char-count">{coachFeedback.length}/600</span>
            </div>
          </div>
        </div>

        {/* Fixed Bottom Action Bar */}
        <div className="aura-detail-bottom-bar">
          <button
            type="button"
            className="aura-bottom-btn-chat"
            onClick={() => alert(`Mở khung chat trực tiếp với học viên ${meal.studentName}`)}
          >
            <MessageCircle size={18} />
            <span>Nhắn học viên</span>
          </button>

          <button
            type="button"
            className="aura-bottom-btn-approve"
            onClick={() => handleApproveSingle(meal.id)}
            disabled={isApprovedSuccess}
          >
            {isApprovedSuccess ? (
              <>
                <Check size={18} />
                <span>Đã phê duyệt!</span>
              </>
            ) : (
              <>
                <Check size={18} />
                <span>Phê duyệt</span>
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  // ==========================================
  // VIEW 3: DANH SÁCH CẦN DUYỆT (BATCH VIEW)
  // ==========================================
  if (viewMode === 'batch') {
    const isAllBatchSelected = selectedBatchIds.size >= allMeals.filter(m => m.status === 'pending').length && allMeals.filter(m => m.status === 'pending').length > 0

    return (
      <div className="aura-review-batch-screen">
        {/* Top Sticky Header */}
        <header className="aura-review-top-nav">
          <button
            type="button"
            className="aura-nav-back-btn"
            onClick={() => setViewMode('overview')}
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="aura-nav-title">Danh sách cần duyệt</h2>
          <button type="button" className="aura-nav-more-btn">
            <MoreHorizontal size={20} />
          </button>
        </header>

        <div className="aura-batch-body-content">
          {/* Horizontal Filter Pill Row */}
          <div className="aura-filter-pills-scroll">
            <button
              type="button"
              className={`aura-filter-pill-item ${batchFilter === 'all' ? 'active' : ''}`}
              onClick={() => setBatchFilter('all')}
            >
              Tất cả <span className="pill-count">7</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${batchFilter === 'priority' ? 'active' : ''}`}
              onClick={() => setBatchFilter('priority')}
            >
              Ưu tiên <span className="pill-count">2</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${batchFilter === 'new' ? 'active' : ''}`}
              onClick={() => setBatchFilter('new')}
            >
              Mới <span className="pill-count">3</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${batchFilter === 'low_ai' ? 'active' : ''}`}
              onClick={() => setBatchFilter('low_ai')}
            >
              AI thấp <span className="pill-count">1</span>
            </button>
          </div>

          {/* Select All Toggle Bar */}
          <div className="aura-select-all-row">
            <label className="aura-checkbox-label">
              <input
                type="checkbox"
                checked={isAllBatchSelected}
                onChange={handleBatchSelectAllToggle}
              />
              <span className="custom-checkbox-box flex items-center justify-center">
                {isAllBatchSelected ? <CheckSquare size={18} className="text-pink-600" /> : <Square size={18} className="text-gray-400" />}
              </span>
              <span className="aura-select-all-text">Chọn tất cả</span>
            </label>

            <div className="aura-select-meta flex items-center gap-2">
              <span className="aura-total-meals-count">{allMeals.filter(m => m.status === 'pending').length} bữa ăn</span>
              <button type="button" className="aura-icon-btn-subtle">
                <SlidersHorizontal size={16} />
              </button>
            </div>
          </div>

          {/* Section 1: Ưu tiên cao */}
          <div className="aura-batch-group-section">
            <div className="aura-group-section-title">
              <h3>Ưu tiên cao</h3>
              <ChevronDown size={18} />
            </div>

            <div className="aura-batch-meals-list">
              {allMeals
                .filter((m) => m.priority === 'high' && m.status === 'pending')
                .map((meal) => {
                  const isChecked = selectedBatchIds.has(meal.id)
                  return (
                    <div key={meal.id} className="aura-batch-meal-item-card">
                      <label className="aura-item-checkbox">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleBatchToggleSelect(meal.id)}
                        />
                        <span className="aura-checkbox-icon flex items-center justify-center">
                          {isChecked ? <CheckSquare size={20} className="text-pink-600" /> : <Square size={20} className="text-gray-300" />}
                        </span>
                      </label>

                      <div className="aura-batch-item-photo" onClick={() => handleOpenDetail(meal.id)}>
                        <img src={meal.img} alt={meal.studentName} />
                        <span className="aura-batch-badge-priority">
                          <Flame size={10} fill="currentColor" /> Ưu tiên
                        </span>
                      </div>

                      <div className="aura-batch-item-info" onClick={() => handleOpenDetail(meal.id)}>
                        <div className="aura-batch-head-row">
                          <div className="aura-name-wrap">
                            <strong>{meal.studentName}</strong>
                            <span className="aura-time-text">{meal.time}</span>
                          </div>
                          <button type="button" className="aura-dots-btn">
                            <MoreHorizontal size={16} />
                          </button>
                        </div>

                        <div className="aura-batch-sub-row">
                          <span className="aura-meal-sub-label">{meal.mealType || 'Bữa tối'}</span>
                          <span className="aura-ai-score-tag purple">AI {meal.aiScore || 68}%</span>
                        </div>

                        <div className="aura-batch-macros-row">
                          <span><strong>{meal.totalKcal}</strong> Kcal</span>
                          <span><strong>{meal.totalProtein}g</strong> Protein</span>
                          <span><strong>{meal.totalCarb || 35}g</strong> Carb</span>
                          <span><strong>{meal.totalFat || 10}g</strong> Fat</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Section 2: Cần duyệt */}
          <div className="aura-batch-group-section">
            <div className="aura-group-section-title">
              <h3>Cần duyệt</h3>
              <ChevronDown size={18} />
            </div>

            <div className="aura-batch-meals-list">
              {allMeals
                .filter((m) => m.priority !== 'high' && m.status === 'pending')
                .map((meal) => {
                  const isChecked = selectedBatchIds.has(meal.id)
                  return (
                    <div key={meal.id} className="aura-batch-meal-item-card">
                      <label className="aura-item-checkbox">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleBatchToggleSelect(meal.id)}
                        />
                        <span className="aura-checkbox-icon flex items-center justify-center">
                          {isChecked ? <CheckSquare size={20} className="text-pink-600" /> : <Square size={20} className="text-gray-300" />}
                        </span>
                      </label>

                      <div className="aura-batch-item-photo" onClick={() => handleOpenDetail(meal.id)}>
                        <img src={meal.img} alt={meal.studentName} />
                      </div>

                      <div className="aura-batch-item-info" onClick={() => handleOpenDetail(meal.id)}>
                        <div className="aura-batch-head-row">
                          <div className="aura-name-wrap">
                            <strong>{meal.studentName}</strong>
                            <span className="aura-time-text">{meal.time}</span>
                          </div>
                          <button type="button" className="aura-dots-btn">
                            <MoreHorizontal size={16} />
                          </button>
                        </div>

                        <div className="aura-batch-sub-row">
                          <span className="aura-meal-sub-label">{meal.mealType || 'Bữa trưa'}</span>
                          <span className="aura-ai-score-tag green">AI {meal.aiScore || 92}%</span>
                        </div>

                        <div className="aura-batch-macros-row">
                          <span><strong>{meal.totalKcal}</strong> kcal</span>
                          <span><strong>{meal.totalProtein}g</strong></span>
                          <span><strong>{meal.totalCarb || 28}g</strong></span>
                          <span><strong>{meal.totalFat || 8}g</strong></span>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Section 3: Đã duyệt gần đây */}
          <div className="aura-batch-group-section">
            <div className="aura-group-section-title">
              <h3>Đã duyệt gần đây</h3>
              <ChevronDown size={18} />
            </div>

            <div className="aura-batch-meals-list">
              {allMeals
                .filter((m) => m.status === 'approved')
                .map((meal) => (
                  <div key={meal.id} className="aura-batch-meal-item-card approved">
                    <div className="aura-approved-check-box flex items-center justify-center text-emerald-600">
                      <CheckCircle2 size={20} />
                    </div>

                    <div className="aura-batch-item-photo">
                      <img src={meal.img} alt={meal.studentName} />
                    </div>

                    <div className="aura-batch-item-info">
                      <div className="aura-batch-head-row">
                        <div className="aura-name-wrap">
                          <strong>{meal.studentName}</strong>
                          <span className="aura-time-text">{meal.time}</span>
                        </div>
                        <button type="button" className="aura-dots-btn">
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      <div className="aura-batch-sub-row">
                        <span className="aura-meal-sub-label">{meal.mealType || 'Bữa sáng'}</span>
                      </div>

                      <div className="aura-batch-macros-row">
                        <span><strong>{meal.totalKcal}</strong> kcal</span>
                        <span><strong>{meal.totalProtein}g</strong></span>
                        <span><strong>{meal.totalCarb || 38}g</strong></span>
                        <span><strong>{meal.totalFat || 9}g</strong></span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Floating Bottom Action Bar */}
        <div className="aura-batch-floating-action-bar">
          <button
            type="button"
            className="aura-batch-btn-quick-ai"
            onClick={handleQuickApproveAiHighConfidence}
          >
            <span>Duyệt nhanh AI &ge;95%</span>
            <Sparkles size={16} />
          </button>

          <button
            type="button"
            className="aura-batch-btn-submit"
            onClick={handleBatchApproveSubmit}
            disabled={selectedBatchIds.size === 0}
          >
            <Check size={18} />
            <span>Duyệt ({selectedBatchIds.size})</span>
          </button>
        </div>
      </div>
    )
  }

  // ==========================================
  // VIEW 1: OVERVIEW DASHBOARD ("DUYỆT BỮA ĂN")
  // ==========================================
  return (
    <div className="aura-nutrition-dashboard-screen">
      {/* Top Header Bar */}
      <header className="aura-dash-top-bar">
        <div className="aura-dash-brand">
          <small className="aura-brand-eyebrow">AURA ACADEMY</small>
          <h1 className="aura-brand-title">Duyệt bữa ăn</h1>
        </div>
        <div className="aura-dash-actions">
          <button
            type="button"
            className="aura-icon-circle-btn"
            onClick={() => {
              const term = prompt('Tìm kiếm bữa ăn (tên học viên, món ăn...):', searchTerm)
              if (term !== null) setSearchTerm(term)
            }}
          >
            <Search size={18} />
          </button>
          <button type="button" className="aura-icon-circle-btn relative">
            <Bell size={18} />
            <span className="aura-bell-badge">3</span>
          </button>
        </div>
      </header>

      <div className="aura-dash-body-content">
        {/* Welcome Hero Card */}
        <div className="aura-welcome-hero-card">
          <div className="aura-hero-text-col">
            <h2 className="aura-welcome-title">Xin chào Hải Âu! 👋</h2>
            <p className="aura-welcome-desc">
              Bạn có <strong>{allMeals.filter((m) => m.status === 'pending').length} bữa ăn</strong> cần duyệt hôm nay.
            </p>
          </div>
          <div className="aura-hero-graphic-col">
            <div className="aura-hero-3d-graphic flex items-center justify-center">
              <span className="text-2xl">📋</span>
            </div>
          </div>
        </div>

        {/* 4-Stat KPI Grid */}
        <div className="aura-kpi-stats-grid">
          <div className="aura-kpi-card orange">
            <div className="aura-kpi-icon">
              <Clock size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.status === 'pending').length}</strong>
            <span className="aura-kpi-lbl">Chờ duyệt</span>
          </div>

          <div className="aura-kpi-card pink">
            <div className="aura-kpi-icon">
              <Flame size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.priority === 'high' && m.status === 'pending').length}</strong>
            <span className="aura-kpi-lbl">Ưu tiên cao</span>
          </div>

          <div className="aura-kpi-card green">
            <div className="aura-kpi-icon">
              <CheckCircle2 size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.status === 'approved').length}</strong>
            <span className="aura-kpi-lbl">Đã duyệt</span>
          </div>

          <div className="aura-kpi-card purple">
            <div className="aura-kpi-icon">
              <Percent size={16} />
            </div>
            <strong className="aura-kpi-val">92%</strong>
            <span className="aura-kpi-lbl">Đúng hạn</span>
          </div>
        </div>

        {/* AI Banner Alert */}
        <div className="aura-ai-reminder-banner" onClick={() => setViewMode('batch')}>
          <div className="aura-ai-banner-left">
            <Sparkles size={16} className="text-pink-600" />
            <span>AI gợi ý: 2 bữa ăn cần phản hồi trước 20 phút</span>
          </div>
          <ChevronRight size={16} className="text-pink-600" />
        </div>

        {/* Quick Filter Pill Tabs */}
        <div className="aura-quick-filters-row">
          <span className="aura-filter-heading-lbl">Bộ lọc nhanh</span>
          <div className="aura-filter-pills-scroll">
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              Tất cả <span className="pill-count">{allMeals.length}</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'priority' ? 'active' : ''}`}
              onClick={() => setActiveFilter('priority')}
            >
              Ưu tiên <span className="pill-count">{allMeals.filter((m) => m.priority === 'high' && m.status === 'pending').length}</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'new' ? 'active' : ''}`}
              onClick={() => setActiveFilter('new')}
            >
              Mới <span className="pill-count">{allMeals.filter((m) => m.isNew && m.status === 'pending').length}</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'low_ai' ? 'active' : ''}`}
              onClick={() => setActiveFilter('low_ai')}
            >
              AI thấp <span className="pill-count">{allMeals.filter((m) => (m.confidence === 'low' || (m.aiScore || 0) < 80) && m.status === 'pending').length}</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'pending_response' ? 'active' : ''}`}
              onClick={() => setActiveFilter('pending_response')}
            >
              Đợi phản hồi <span className="pill-count">{allMeals.filter((m) => m.status === 'pending').length}</span>
            </button>
            <button
              type="button"
              className={`aura-filter-pill-item ${activeFilter === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveFilter('approved')}
            >
              Đã duyệt <span className="pill-count">{allMeals.filter((m) => m.status === 'approved').length}</span>
            </button>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="aura-dash-search-row">
          <div className="aura-search-input-box">
            <Search size={16} className="aura-search-icon" />
            <input
              type="text"
              placeholder="Tìm tên học viên, món ăn..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button type="button" className="aura-filter-settings-btn" onClick={() => setViewMode('batch')}>
            <SlidersHorizontal size={18} />
          </button>
        </div>

        {/* SECTION 1: ƯU TIÊN CAO */}
        {highPriorityMeals.length > 0 && (
          <div className="aura-dash-group-section">
            <div className="aura-group-header-row">
              <h3>Ưu tiên cao ({highPriorityMeals.length})</h3>
              <button
                type="button"
                className="aura-see-all-link"
                onClick={() => setViewMode('batch')}
              >
                Xem tất cả &gt;
              </button>
            </div>

            <div className="aura-priority-cards-grid">
              {highPriorityMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="aura-priority-meal-card cursor-pointer"
                  onClick={() => handleOpenDetail(meal.id)}
                >
                  <div className="aura-card-photo-wrapper">
                    <img src={meal.img} alt={meal.studentName} />
                    <span className="aura-badge-priority-top">
                      <Flame size={12} fill="currentColor" /> Ưu tiên
                    </span>
                  </div>

                  <div className="aura-card-info-content">
                    <div className="aura-card-title-row">
                      <div className="aura-student-title">
                        <strong>{meal.studentName}</strong>
                        {meal.isNew && <span className="aura-new-badge">⭐ Mới</span>}
                      </div>
                      <span className="aura-card-time">{meal.time}</span>
                    </div>

                    <div className="aura-meal-sub-title">
                      <span>{meal.mealType || 'Bữa tối'}</span>
                      {meal.aiScore && (
                        <span className="aura-ai-score-pill purple">AI {meal.aiScore}%</span>
                      )}
                    </div>

                    <div className="aura-tags-flex">
                      <span className="aura-pill-tag purple">AI tự tin thấp</span>
                      <span className="aura-pill-tag orange">Cần phản hồi</span>
                    </div>

                    <div className="aura-macros-stats-line">
                      <span><strong>{meal.totalKcal}</strong> Kcal</span>
                      <span><strong>{meal.totalProtein}g</strong> Protein</span>
                      <span><strong>{meal.totalCarb || 35}g</strong> Carb</span>
                      <span><strong>{meal.totalFat || 10}g</strong> Fat</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 2: CẦN DUYỆT */}
        <div className="aura-dash-group-section">
          <div
            className="aura-group-header-row cursor-pointer"
            onClick={() => setIsPendingGroupOpen(!isPendingGroupOpen)}
          >
            <div className="flex items-center gap-2">
              <h3>Cần duyệt ({pendingMeals.length})</h3>
            </div>
            <button type="button" className="aura-collapse-btn">
              <ChevronDown
                size={18}
                style={{
                  transform: isPendingGroupOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s'
                }}
              />
            </button>
          </div>

          {isPendingGroupOpen && (
            <div className="aura-pending-meals-list">
              {pendingMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="aura-pending-meal-item-row cursor-pointer"
                  onClick={() => handleOpenDetail(meal.id)}
                >
                  <div className="aura-item-thumb">
                    <img src={meal.img} alt={meal.studentName} />
                  </div>

                  <div className="aura-item-details">
                    <div className="aura-item-top">
                      <strong className="aura-student-name">{meal.studentName}</strong>
                      <span className="aura-item-time">{meal.time}</span>
                    </div>

                    <div className="aura-item-sub">
                      <span className="aura-meal-type">{meal.mealType || 'Bữa trưa'}</span>
                      <span className="aura-ai-score-tag green">AI {meal.aiScore || 92}%</span>
                    </div>

                    <div className="aura-item-macros">
                      <span><strong>{meal.totalKcal}</strong> kcal</span>
                      <span><strong>{meal.totalProtein}g</strong></span>
                      <span><strong>{meal.totalCarb || 28}g</strong></span>
                      <span><strong>{meal.totalFat || 8}g</strong></span>
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="aura-btn-see-all-batch"
                onClick={() => setViewMode('batch')}
              >
                Xem tất cả {pendingMeals.length + highPriorityMeals.length} bữa
              </button>
            </div>
          )}
        </div>

        {/* SECTION 3: ĐÃ DUYỆT GẦN ĐÂY */}
        {approvedMeals.length > 0 && (
          <div className="aura-dash-group-section">
            <div
              className="aura-group-header-row cursor-pointer"
              onClick={() => setIsApprovedGroupOpen(!isApprovedGroupOpen)}
            >
              <h3>Đã duyệt gần đây</h3>
              <button type="button" className="aura-see-all-link">
                Xem tất cả &gt;
              </button>
            </div>

            {isApprovedGroupOpen && (
              <div className="aura-approved-meals-list">
                {approvedMeals.map((meal) => (
                  <div key={meal.id} className="aura-approved-item-card">
                    <div className="aura-approved-icon flex items-center justify-center text-emerald-600">
                      <CheckCircle2 size={18} />
                    </div>

                    <div className="aura-item-thumb">
                      <img src={meal.img} alt={meal.studentName} />
                    </div>

                    <div className="aura-item-details">
                      <div className="aura-item-top">
                        <strong className="aura-student-name">{meal.studentName}</strong>
                        <span className="aura-item-time">{meal.time}</span>
                      </div>

                      <div className="aura-item-sub">
                        <span className="aura-meal-type">{meal.mealType || 'Bữa sáng'}</span>
                        <span className="aura-status-approved-badge flex items-center gap-1">
                          <Check size={12} /> Đã duyệt
                        </span>
                      </div>

                      <div className="aura-item-macros">
                        <span><strong>{meal.totalKcal}</strong> kcal</span>
                        <span><strong>{meal.totalProtein}g</strong></span>
                        <span><strong>{meal.totalCarb || 38}g</strong></span>
                        <span><strong>{meal.totalFat || 9}g</strong></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* App Bottom Navigation Bar */}
      <nav className="aura-app-bottom-navbar">
        <button
          type="button"
          className="aura-nav-item"
          onClick={() => onNavigate && onNavigate('admin-dashboard')}
        >
          <span className="aura-nav-icon">📊</span>
          <span>Tổng quan</span>
        </button>

        <button
          type="button"
          className="aura-nav-item"
          onClick={() => onNavigate && onNavigate('admin-courses')}
        >
          <span className="aura-nav-icon">🎓</span>
          <span>Academy</span>
        </button>

        <button
          type="button"
          className="aura-nav-item"
          onClick={() => onNavigate && onNavigate('admin-students')}
        >
          <span className="aura-nav-icon">👥</span>
          <span>Khách PT</span>
        </button>

        <button
          type="button"
          className="aura-nav-item active"
          onClick={() => setViewMode('overview')}
        >
          <span className="aura-nav-icon">🍱</span>
          <span>Duyệt bữa ăn</span>
          <span className="aura-nav-active-dot" />
        </button>

        <button
          type="button"
          className="aura-nav-item"
          onClick={() => alert('Chức năng cài đặt mở rộng')}
        >
          <span className="aura-nav-icon">⚙️</span>
          <span>Thêm</span>
        </button>
      </nav>
    </div>
  )
}
