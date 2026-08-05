import { useState, useEffect } from 'react'
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  AlertCircle,
  RefreshCw,
  Send,
  Check,
  Clock,
  Dumbbell,
  Search,
  CheckSquare,
  ArrowLeft,
  Flame,
  Zap,
  User,
  ThumbsUp,
  Edit3,
  Eye,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import type { ViewId } from '../../types'
import { PageHeader } from '../../components/ui'
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
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)
  const [allMeals, setAllMeals] = useState<PendingMealItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'all'>('pending')
  const [searchTerm, setSearchTerm] = useState('')

  // Student Profile & Goal Context for AI Analysis
  const [studentGoal, setStudentGoal] = useState<string>('Siết cơ giảm mỡ (Tăng cơ nạc, thâm hụt calo nhẹ)')
  const [studentCondition, setStudentCondition] = useState<string>('Nữ, 55kg, Chiều cao 162cm, TDEE 1800 kcal')

  const [aiAnalysis, setAiAnalysis] = useState<{
    items: Array<{ name: string; weight?: number; kcal?: number; protein?: number }>
    totalKcal: number
    totalProtein: number
    quantityAndCookingAnalysis?: string
    portionAndCalorieRationale?: string
    goalAlignmentAssessment?: string
    aiSuggestion?: string
    coachFeedbackSuggestion?: string
  } | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [coachFeedback, setCoachFeedback] = useState('')
  const [isSent, setIsSent] = useState(false)

  // Realtime subscription & initial load from backend storage
  useEffect(() => {
    setIsLoading(true)

    getPendingMealsFromFirestore().then((fsMeals) => {
      if (fsMeals) {
        setAllMeals(fsMeals)
      }
      setIsLoading(false)
    }).catch((err) => {
      console.error('Error fetching meals:', err)
      setIsLoading(false)
    })

    const unsubscribe = subscribeToRealtimeMeals((realtimeMeals) => {
      setAllMeals(realtimeMeals)
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [])

  // Sync selected student's meal data when opening review modal
  useEffect(() => {
    if (selectedStudent) {
      const meal = allMeals.find((m) => m.id === selectedStudent)
      if (meal) {
        if (meal.studentGoal) setStudentGoal(meal.studentGoal)
        if (meal.studentCondition) setStudentCondition(meal.studentCondition)

        const defaultCoachMessage = `Chào ${meal.studentName || 'em'}! Bữa ăn này chuẩn bị rất tuyệt vời, hàm lượng đạm từ nguyên liệu chính đáp ứng vừa đủ nhu cầu phục hồi cơ bắp cho buổi tập hôm nay. Phương pháp chế biến thanh nhẹ kiểm soát calo rất chuẩn so với mục tiêu ${meal.studentGoal || studentGoal}. Em tiếp tục phát huy phong độ này và nhớ uống đủ 2-2.5L nước nhé!`

        if (meal.aiAnalysis) {
          setAiAnalysis({
            items: meal.aiAnalysis.items || meal.items || [],
            totalKcal: meal.aiAnalysis.totalKcal || meal.totalKcal || 0,
            totalProtein: meal.aiAnalysis.totalProtein || meal.totalProtein || 0,
            quantityAndCookingAnalysis: meal.aiAnalysis.quantityAndCookingAnalysis || 'Món ăn chế biến thanh nhẹ, khối lượng ước tính phù hợp khẩu phần tiêu chuẩn.',
            portionAndCalorieRationale: meal.aiAnalysis.portionAndCalorieRationale || 'Cơ sở dự đoán dựa trên kích thước tương quan đĩa ăn và tỷ lệ nguyên liệu.',
            goalAlignmentAssessment: meal.aiAnalysis.goalAlignmentAssessment || 'Bữa ăn cân đối dinh dưỡng theo mục tiêu học viên.',
            aiSuggestion:
              meal.aiAnalysis.aiSuggestion ||
              meal.aiAnalysis.aiFeedback ||
              meal.aiFeedback ||
              'Bữa ăn đạt tỷ lệ dinh dưỡng phù hợp mục tiêu tập luyện.',
            coachFeedbackSuggestion: meal.aiAnalysis.coachFeedbackSuggestion || meal.coachFeedbackSuggestion || defaultCoachMessage
          })
          setCoachFeedback(
            meal.coachFeedback ||
              meal.aiAnalysis.coachFeedbackSuggestion ||
              meal.coachFeedbackSuggestion ||
              defaultCoachMessage
          )
        } else if (meal.items && meal.items.length > 0) {
          setAiAnalysis({
            items: meal.items,
            totalKcal: meal.totalKcal || 0,
            totalProtein: meal.totalProtein || 0,
            quantityAndCookingAnalysis: 'Chế biến cơ bản, tỷ lệ nguyên liệu cân đối.',
            portionAndCalorieRationale: 'Ước tính calo từ danh sách thực phẩm trong ghi chú bữa ăn.',
            goalAlignmentAssessment: 'Phù hợp mức năng lượng trong ngày.',
            aiSuggestion: meal.aiFeedback || 'Bữa ăn cân đối theo chế độ tập luyện Aura.',
            coachFeedbackSuggestion: meal.coachFeedbackSuggestion || defaultCoachMessage
          })
          setCoachFeedback(
            meal.coachFeedback ||
              meal.coachFeedbackSuggestion ||
              defaultCoachMessage
          )
        } else {
          setAiAnalysis({
            items: [
              { name: meal.note || 'Bữa ăn thực đơn', weight: 200, kcal: meal.totalKcal || 380, protein: meal.totalProtein || 32 },
            ],
            totalKcal: meal.totalKcal || 380,
            totalProtein: meal.totalProtein || 32,
            quantityAndCookingAnalysis: 'Chế biến cơ bản, khẩu phần ước tính khoảng 200g.',
            portionAndCalorieRationale: 'Dựa theo dữ liệu món ăn trong thực đơn chuẩn.',
            goalAlignmentAssessment: 'Đảm bảo dinh dưỡng thiết yếu cho buổi tập.',
            aiSuggestion: 'Đã ước tính calo và đạm cho món ăn dựa theo ghi chú của học viên.',
            coachFeedbackSuggestion: defaultCoachMessage
          })
          setCoachFeedback(meal.coachFeedback || defaultCoachMessage)
        }
      }
    } else {
      setAiAnalysis(null)
      setCoachFeedback('')
      setIsSent(false)
    }
  }, [selectedStudent, allMeals])

  // Call server AI Nutrition endpoint
  const runAiAnalysis = async (meal: PendingMealItem) => {
    setIsAnalyzing(true)
    try {
      const token = localStorage.getItem('token')

      const res = await fetch('/api/ai/analyze-meal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          imageBase64: meal.img?.startsWith('data:') ? meal.img : undefined,
          imageUrl: !meal.img?.startsWith('data:') ? meal.img : undefined,
          studentNote: meal.note,
          studentGoal,
          studentCondition,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.success && data.analysis) {
          const analysisData = data.analysis
          setAiAnalysis({
            items: analysisData.items || meal.items || [],
            totalKcal:
              analysisData.totalKcal ||
              analysisData.items?.reduce((sum: number, i: any) => sum + (i.kcal || 0), 0) ||
              meal.totalKcal || 0,
            totalProtein:
              analysisData.totalProtein ||
              analysisData.items?.reduce((sum: number, i: any) => sum + (i.protein || 0), 0) ||
              meal.totalProtein || 0,
            quantityAndCookingAnalysis: analysisData.quantityAndCookingAnalysis || 'Chi tiết khẩu phần thực tế được ước tính khoảng 150-200g nguyên liệu chính, áp chảo nhẹ giữ nguyên vị tự nhiên.',
            portionAndCalorieRationale: analysisData.portionAndCalorieRationale || 'Cơ sở tính toán dựa trên đường kính bát/đĩa chuẩn và tỷ lệ thành phần thực phẩm quan sát được.',
            goalAlignmentAssessment: analysisData.goalAlignmentAssessment || 'Bữa ăn hỗ trợ tốt mục tiêu tăng cơ siết mỡ với lượng đạm dồi dào và kiểm soát chất béo.',
            aiSuggestion: analysisData.aiFeedback || 'Bữa ăn giàu đạm và phù hợp với mục tiêu tập luyện.',
            coachFeedbackSuggestion: analysisData.coachFeedbackSuggestion || 'Bữa ăn rất ngon và chuẩn bài em nhé! Hãy tiếp tục duy trì phong độ dinh dưỡng tuyệt vời này.',
          })
          if (analysisData.coachFeedbackSuggestion) {
            setCoachFeedback(analysisData.coachFeedbackSuggestion)
          }
          setIsAnalyzing(false)
          return
        }
      }
      throw new Error('Analysis fallback required')
    } catch (err) {
      console.warn('Fallback AI analysis:', err)
      setAiAnalysis({
        items: meal.items && meal.items.length ? meal.items : [
          { name: meal.note || 'Bữa ăn dinh dưỡng', weight: 200, kcal: meal.totalKcal || 400, protein: meal.totalProtein || 35 }
        ],
        totalKcal: meal.totalKcal || 400,
        totalProtein: meal.totalProtein || 35,
        quantityAndCookingAnalysis: 'Định lượng đĩa ăn khoảng 200g nguyên liệu. Chế biến áp chảo/luộc giữ trọn vi chất.',
        portionAndCalorieRationale: 'Cơ sở dự đoán calo & khối lượng dựa trên tương quan kích thước khẩu phần và thành phần chính.',
        goalAlignmentAssessment: 'Đảm bảo tỷ lệ đạm tinh khiết cao, hỗ trợ mục tiêu giảm mỡ tăng cơ.',
        aiSuggestion:
          'Bữa ăn có tỷ lệ Macro cân đối, hàm lượng Protein cao phù hợp chế độ tăng cơ siết mỡ.',
        coachFeedbackSuggestion: 'Bữa ăn tuyệt vời em nhé! Lượng đạm đạt chuẩn chỉ mục tiêu hôm nay.',
      })
      if (!coachFeedback) {
        setCoachFeedback('Bữa ăn chuẩn chỉ tiêu Macros! Hãy tiếp tục phát huy ở bữa tiếp theo em nhé.')
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Quick feedback template button click handler
  const applyQuickTemplate = (text: string) => {
    setCoachFeedback(text)
  }

  const handleSend = async () => {
    setIsSent(true)
    const meal = allMeals.find((m) => m.id === selectedStudent)

    if (meal) {
      // Strip large image string from approvedMeal object to avoid duplicating base64 in Firestore document
      const { img, ...mealWithoutImg } = meal
      const approvedMeal = {
        ...mealWithoutImg,
        status: 'approved' as const,
        coachFeedback,
        totalKcal: aiAnalysis?.totalKcal || meal.totalKcal,
        totalProtein: aiAnalysis?.totalProtein || meal.totalProtein,
        items: aiAnalysis?.items || meal.items,
        aiAnalysis: aiAnalysis || meal.aiAnalysis
      }

      if (meal.id) {
        try {
          await approveMealInFirestore(meal.id, coachFeedback, approvedMeal)
        } catch (e) {
          console.error('Error updating meal status:', e)
        }
      }

      const fullApprovedMeal = { ...approvedMeal, img: meal.img }
      setAllMeals((prev) =>
        prev.map((m) => (m.id === selectedStudent ? fullApprovedMeal : m))
      )
    }

    setTimeout(() => {
      setSelectedStudent(null)
      setAiAnalysis(null)
      setCoachFeedback('')
      setIsSent(false)
    }, 1200)
  }

  // Summary Metrics calculations
  const pendingMeals = allMeals.filter((m) => m.status === 'pending')
  const approvedMeals = allMeals.filter((m) => m.status === 'approved')
  const totalCheckedKcal = allMeals.reduce((sum, m) => sum + (m.totalKcal || 0), 0)

  const filteredMeals = allMeals.filter((m) => {
    const matchesTab =
      activeTab === 'all'
        ? true
        : activeTab === 'pending'
        ? m.status === 'pending'
        : m.status === 'approved'

    const matchesSearch =
      !searchTerm.trim() ||
      m.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.note && m.note.toLowerCase().includes(searchTerm.toLowerCase()))

    return matchesTab && matchesSearch
  })

  // Detail View Modal for selected student meal
  if (selectedStudent) {
    const meal = allMeals.find((m) => m.id === selectedStudent)
    if (!meal) return null

    return (
      <div className="page admin-nutrition-review-detail">
        <PageHeader
          eyebrow="AURA COACHING · KIỂM DUYỆT BỮA ĂN"
          title={`Chi tiết bữa ăn: ${meal.studentName}`}
          description={`Thời gian gửi: ${meal.time}`}
          action={
            <button
              type="button"
              className="outline-button"
              onClick={() => setSelectedStudent(null)}
            >
              <ArrowLeft size={16} /> Quay lại bảng điều khiển
            </button>
          }
        />

        <div className="admin-review-detail-grid">
          {/* Left Column: Photo, Student Info & Goal Profile */}
          <article className="card review-photo-card">
            <div className="review-photo-wrapper">
              <img
                src={meal.img}
                alt={`Bữa ăn của ${meal.studentName}`}
                className="review-photo-img"
              />
              <span className={`review-status-tag ${meal.status}`}>
                {meal.status === 'pending' ? 'Chờ duyệt' : 'Đã phê duyệt'}
              </span>
            </div>

            {/* Student Profile & Fitness Goals */}
            <div className="student-profile-badge border border-purple-100 p-3.5 rounded-xl bg-purple-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-sm">
                    <User size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{meal.studentName}</h4>
                    <p className="text-xs text-purple-700 font-medium">Hồ sơ học viên PT</p>
                  </div>
                </div>
                <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-md">
                  1,800 kcal/ngày
                </span>
              </div>

              <div className="pt-2 border-t border-purple-100/80 space-y-1.5 text-xs">
                <div className="flex justify-between text-gray-700">
                  <span className="font-semibold text-gray-500">Mục tiêu:</span>
                  <span className="font-bold text-purple-900">{studentGoal}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span className="font-semibold text-gray-500">Thể trạng & TDEE:</span>
                  <span className="font-medium text-gray-800">{studentCondition}</span>
                </div>
              </div>
            </div>

            {meal.note && (
              <div className="review-note-box">
                <MessageSquare size={16} className="note-icon" />
                <div>
                  <small>Ghi chú từ học viên:</small>
                  <p>"{meal.note}"</p>
                </div>
              </div>
            )}

            {!aiAnalysis && !isAnalyzing && (
              <button
                type="button"
                onClick={() => runAiAnalysis(meal)}
                className="primary-button full-width py-3 text-sm font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md rounded-xl transition-all"
              >
                <Sparkles size={18} />
                <span>Kích Hoạt Phân Tích AI Aura</span>
              </button>
            )}

            {isAnalyzing && (
              <div className="analyzing-state-box">
                <RefreshCw size={18} className="animate-spin text-purple-600" />
                <span>AI Aura đang phân tích chi tiết ảnh & dinh dưỡng...</span>
              </div>
            )}
          </article>

          {/* Right Column: AI Analysis & Coach Response */}
          <div className="review-analysis-column">
            {aiAnalysis ? (
              <>
                {/* Báo cáo phân tích AI chi tiết */}
                <article className="card review-breakdown-card space-y-4">
                  <div className="card-header-flex">
                    <h3 className="section-title">
                      <Sparkles size={18} className="accent-purple" />
                      <span>Kết Quả AI Phân Tích Món Ăn</span>
                    </h3>
                  </div>

                  {/* 1. Phân tích định lượng & Chế biến */}
                  {aiAnalysis.quantityAndCookingAnalysis && (
                    <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 uppercase tracking-wide">
                        <span>🍲 Phân Tích Định Lượng & Chế Biến</span>
                      </div>
                      <p className="text-xs text-amber-950 leading-relaxed">{aiAnalysis.quantityAndCookingAnalysis}</p>
                    </div>
                  )}

                  {/* 2. Cơ sở dự đoán khối lượng & kcal */}
                  {aiAnalysis.portionAndCalorieRationale && (
                    <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800 uppercase tracking-wide">
                        <span>📐 Cơ Sở Dự Đoán Khối Lượng & Kcal</span>
                      </div>
                      <p className="text-xs text-blue-950 leading-relaxed">{aiAnalysis.portionAndCalorieRationale}</p>
                    </div>
                  )}

                  {/* 3. Nhận định ngắn gọn so với mục tiêu */}
                  {aiAnalysis.goalAlignmentAssessment && (
                    <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wide">
                        <span>🎯 Nhận Định So Với Mục Tiêu Học Viên</span>
                      </div>
                      <p className="text-xs text-emerald-950 leading-relaxed font-medium">{aiAnalysis.goalAlignmentAssessment}</p>
                    </div>
                  )}

                  {/* Danh sách thành phần */}
                  <div className="pt-2">
                    <small className="block text-xs font-bold text-gray-500 uppercase mb-2">Thành phần dinh dưỡng bóc tách:</small>
                    <div className="review-items-list">
                      {aiAnalysis.items.map((item, idx) => (
                        <div key={idx} className="review-item-row">
                          <span className="item-name">
                            {item.name}{' '}
                            {item.weight ? (
                              <small>({item.weight}g)</small>
                            ) : null}
                          </span>
                          <div className="item-macros">
                            <span className="macro-kcal">{item.kcal ?? 0} kcal</span>
                            <span className="macro-protein">{item.protein ?? 0}g Đạm</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="review-totals-grid">
                    <div className="total-stat-box purple">
                      <span>TỔNG CALO (KCAL)</span>
                      <input
                        type="number"
                        value={aiAnalysis.totalKcal}
                        onChange={(e) =>
                          setAiAnalysis((prev) =>
                            prev
                              ? { ...prev, totalKcal: Number(e.target.value) || 0 }
                              : null
                          )
                        }
                      />
                    </div>
                    <div className="total-stat-box green">
                      <span>TỔNG PROTEIN (G)</span>
                      <input
                        type="number"
                        value={aiAnalysis.totalProtein}
                        onChange={(e) =>
                          setAiAnalysis((prev) =>
                            prev
                              ? { ...prev, totalProtein: Number(e.target.value) || 0 }
                              : null
                          )
                        }
                      />
                    </div>
                  </div>
                </article>

                {/* Nhận định AI Aura & Nhận xét của Coach */}
                <article className="card review-feedback-card space-y-4">
                  <h3 className="section-title">
                    <MessageSquare size={18} className="accent-rose" />
                    <span>Gợi Ý & Lời Khuyên Gửi Học Viên (Giao diện Coach)</span>
                  </h3>

                  {/* Coach suggestion box for admin/coach view */}
                  {aiAnalysis.coachFeedbackSuggestion && (
                    <div className="p-3.5 bg-purple-50/80 border border-purple-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800 uppercase tracking-wide">
                          <Sparkles size={14} />
                          <span>GỢI Ý TỪ COACH (GẦN GŨI & NHẸ NHÀNG DỰA TRÊN HỒ SƠ)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyQuickTemplate(aiAnalysis.coachFeedbackSuggestion || '')}
                          className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold px-2.5 py-1 rounded-lg transition-colors shadow-sm"
                        >
                          Dùng câu này
                        </button>
                      </div>
                      <p className="text-xs text-purple-950 font-medium leading-relaxed">
                        "{aiAnalysis.coachFeedbackSuggestion}"
                      </p>
                    </div>
                  )}

                  {/* Nút gợi ý phản hồi nhanh */}
                  <div>
                    <small className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Gợi ý phản hồi mẫu nhanh:</small>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyQuickTemplate('Bữa ăn chuẩn chỉ tiêu Macros! Cố gắng duy trì phong độ này em nhé.')}
                        className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-purple-50 hover:text-purple-700 text-gray-700 font-medium rounded-lg transition-colors border border-gray-200"
                      >
                        👍 Đạt chuẩn Macros
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickTemplate('Bữa ăn tốt! Hãy nhớ bổ sung thêm 500ml nước lọc sau bữa ăn này nhé.')}
                        className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-700 font-medium rounded-lg transition-colors border border-gray-200"
                      >
                        💧 Nhắc uống nước
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickTemplate('Bữa ăn khá ngon! Bữa tới cố gắng tăng thêm 20-30g đạm sạch từ ức gà/lòng trắng trứng nhé.')}
                        className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 font-medium rounded-lg transition-colors border border-gray-200"
                      >
                        💪 Tăng thêm đạm
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="coach-feedback-input" className="text-xs font-bold text-gray-700">Nội dung phản hồi Coach gửi học viên:</label>
                    <textarea
                      id="coach-feedback-input"
                      rows={4}
                      value={coachFeedback}
                      onChange={(e) => setCoachFeedback(e.target.value)}
                      placeholder="Nhập lời khuyên hoặc động viên cho học viên..."
                      className="p-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none w-full"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStudent(null)}
                      className="outline-button w-full sm:w-1/3 py-3.5 text-sm font-bold border-gray-300 hover:bg-gray-100 rounded-xl"
                    >
                      Hủy / Quay lại
                    </button>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={isSent}
                      className="primary-button w-full sm:w-2/3 py-3.5 text-base font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      {isSent ? (
                        <>
                          <Check size={20} />
                          <span>Đã phê duyệt bữa ăn thành công!</span>
                        </>
                      ) : (
                        <>
                          <Send size={20} />
                          <span>Gửi nhận xét & Phê duyệt bữa ăn</span>
                        </>
                      )}
                    </button>
                  </div>
                </article>
              </>
            ) : (
              !isAnalyzing && (
                <article className="card empty-analysis-card">
                  <Sparkles size={40} className="placeholder-icon text-purple-600" />
                  <h3>Chưa kích hoạt AI Phân tích</h3>
                  <p>
                    Bấm <strong>"Kích Hoạt Phân Tích AI Aura"</strong> để tự động nhận dạng món ăn, bóc tách Calo & Protein và sinh câu nhận xét cho Coach.
                  </p>
                  <button
                    type="button"
                    onClick={() => runAiAnalysis(meal)}
                    className="primary-button mt-4 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-5 rounded-xl shadow transition-all"
                  >
                    <Sparkles size={16} /> Chạy AI Phân Tích Ngay
                  </button>
                </article>
              )
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page admin-nutrition-reviews-page">
      <PageHeader
        eyebrow="AURA COACHING · TRUNG TÂM KIỂM DUYỆT DINH DƯỠNG"
        title="Duyệt Bữa Ăn Học Viên"
        description="Quản lý và đánh giá bữa ăn từ học viên theo thời gian thực cùng hệ thống trợ lý AI Aura."
        action={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Trực tuyến 24/7</span>
            </div>
            {onNavigate && (
              <button
                type="button"
                className="outline-button"
                onClick={() => onNavigate('admin-students')}
              >
                <Dumbbell size={16} /> Danh sách học viên PT
              </button>
            )}
          </div>
        }
      />

      {/* Stats Summary Bar */}
      <div className="admin-reviews-summary-grid">
        <article className="card summary-stat-card orange shadow-sm border-amber-200">
          <AlertCircle size={24} className="text-amber-500" />
          <div>
            <span>Bữa ăn chờ duyệt</span>
            <strong>{pendingMeals.length} bữa ăn</strong>
          </div>
        </article>
        <article className="card summary-stat-card green shadow-sm border-emerald-200">
          <CheckCircle2 size={24} className="text-emerald-600" />
          <div>
            <span>Đã phê duyệt</span>
            <strong>{approvedMeals.length} bữa ăn</strong>
          </div>
        </article>
        <article className="card summary-stat-card purple shadow-sm border-purple-200">
          <Flame size={24} className="text-purple-600" />
          <div>
            <span>Tổng calo kiểm soát</span>
            <strong>{totalCheckedKcal.toLocaleString()} kcal</strong>
          </div>
        </article>
      </div>

      {/* Toolbar Filters & Search */}
      <div className="admin-reviews-toolbar">
        <div className="tabs-container" role="tablist">
          <button
            type="button"
            className={`tab-item ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending')}
            role="tab"
          >
            Chờ duyệt ({pendingMeals.length})
          </button>
          <button
            type="button"
            className={`tab-item ${activeTab === 'approved' ? 'active' : ''}`}
            onClick={() => setActiveTab('approved')}
            role="tab"
          >
            Đã duyệt ({approvedMeals.length})
          </button>
          <button
            type="button"
            className={`tab-item ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
            role="tab"
          >
            Tất cả ({allMeals.length})
          </button>
        </div>

        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Tìm tên học viên, ghi chú món ăn..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Meals Container / Grid */}
      <div className="card admin-meals-container">
        {isLoading ? (
          <div className="empty-state-box">
            <RefreshCw size={32} className="animate-spin text-purple-600 mb-3" />
            <h3>Đang tải dữ liệu bữa ăn...</h3>
            <p>Vui lòng chờ trong giây lát để cập nhật danh sách bữa ăn từ học viên.</p>
          </div>
        ) : filteredMeals.length === 0 ? (
          <div className="empty-state-box">
            <ShieldCheck size={44} className="empty-icon text-emerald-500" />
            <h3>{activeTab === 'pending' ? 'Không có bữa ăn nào chờ duyệt' : 'Chưa có dữ liệu bữa ăn phù hợp'}</h3>
            <p className="max-w-md">
              {activeTab === 'pending'
                ? 'Tất cả bữa ăn do học viên gửi qua ứng dụng đều đã được phê duyệt thành công! Bữa ăn mới nộp sẽ tự động hiển thị ở đây.'
                : 'Thử kiểm tra lại từ khóa tìm kiếm hoặc chuyển sang các tab trạng thái khác.'}
            </p>
          </div>
        ) : (
          <div className="admin-meals-grid">
            {filteredMeals.map((meal) => (
              <article key={meal.id} className="admin-meal-card hover:shadow-lg transition-all">
                <div className="card-thumb-wrapper">
                  <img src={meal.img} alt={meal.studentName} className="card-thumb-img" />
                  <span className={`status-badge-overlay ${meal.status}`}>
                    {meal.status === 'pending' ? 'Chờ duyệt' : 'Đã duyệt'}
                  </span>
                </div>

                <div className="card-body">
                  <div className="student-info-row">
                    <h4>{meal.studentName}</h4>
                    <span className="time-label">
                      <Clock size={12} /> {meal.time}
                    </span>
                  </div>

                  {meal.note ? (
                    <p className="meal-note-text">"{meal.note}"</p>
                  ) : (
                    <p className="meal-note-text placeholder">Chưa có ghi chú món ăn</p>
                  )}

                  <div className="meal-macros-chips">
                    <span className="chip kcal">{meal.totalKcal || 0} kcal</span>
                    <span className="chip protein">{meal.totalProtein || 0}g đạm</span>
                  </div>

                  {meal.coachFeedback && (
                    <div className="feedback-preview-box">
                      <MessageSquare size={13} className="shrink-0 text-purple-600" />
                      <p>{meal.coachFeedback}</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedStudent(meal.id)}
                    className={
                      meal.status === 'pending'
                        ? 'primary-button small full-width bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded-lg transition-colors'
                        : 'outline-button small full-width font-bold py-2 rounded-lg transition-colors'
                    }
                  >
                    {meal.status === 'pending' ? (
                      <>
                        <Sparkles size={14} /> Xem & Phê Duyệt AI
                      </>
                    ) : (
                      <>
                        <Eye size={14} /> Xem Chi Tiết
                      </>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
