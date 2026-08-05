import React, { useState } from 'react'
import {
  ArrowLeft,
  Bookmark,
  Check,
  Edit3,
  Flame,
  MoreHorizontal,
  Pencil,
  Plus,
  ScanLine,
  LoaderCircle,
  Share2,
  Sparkles,
  Trash2,
  X,
  Maximize2,
  ArrowLeftRight,
  Info,
} from 'lucide-react'
import '../../styles-nutrition-detail.css'

export interface AiFoodItem {
  id: string
  name: string
  grams: number
  calories: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  sugar?: number
  sodium?: number
  confidence?: 'high' | 'medium' | 'low'
  calculationSource?: 'database' | 'manual' | 'mixed' | 'ai-estimate'
}

export interface MealLogItem {
  id: string
  date: string
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  label: string
  time: string
  title: string
  description?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  sodium?: number
  status: 'logged' | 'planned'
  tone?: 'violet' | 'orange' | 'green' | 'pink'
  image?: string
  source?: 'ai-scan' | 'demo' | 'catalog' | 'manual'
  confidence?: 'verified' | 'estimated' | 'needs-review'
  calorieRange?: { low: number; high: number }
  items?: AiFoodItem[]
  coachFeedback?: string
  aiAnalysis?: string
  reviewStatus?: 'pending' | 'reviewed'
}

import { useAuth } from '../../contexts/AuthContext'
import { generateMealReview } from '../../services/nutritionService'
import { submitMealReview } from '../../services/firebaseService'

export interface CapturedMealDetailProps {
  meal: MealLogItem
  dailyCalorieGoal?: number
  userGoal?: 'lose-fat' | 'gain-muscle' | 'maintain'
  onBack: () => void
  onEdit?: (mealId: string) => void
  onDelete?: (mealId: string) => void
}

const DEFAULT_INGREDIENTS: Record<string, AiFoodItem[]> = {
  default: [
    { id: 'ing-1', name: 'Thịt gà luộc (xé phay)', grams: 90, calories: 577, protein: 28, carbs: 0, fat: 12 },
    { id: 'ing-2', name: 'Cơm trắng', grams: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { id: 'ing-3', name: 'Trứng gà luộc', grams: 50, calories: 105, protein: 6.3, carbs: 0.6, fat: 5.3 },
    { id: 'ing-4', name: 'Súp lơ xanh luộc', grams: 80, calories: 96, protein: 2.5, carbs: 6, fat: 0.3 },
    { id: 'ing-5', name: 'Cà rốt luộc', grams: 60, calories: 112, protein: 0.8, carbs: 8, fat: 0.2 },
    { id: 'ing-6', name: 'Cà chua bi', grams: 60, calories: 19, protein: 0.5, carbs: 2.4, fat: 0.1 },
  ],
  pho: [
    { id: 'ing-p1', name: 'Bánh phở tươi', grams: 150, calories: 210, protein: 4, carbs: 46, fat: 0.8 },
    { id: 'ing-p2', name: 'Thịt bò tái/nạm', grams: 100, calories: 288, protein: 26, carbs: 0, fat: 20 },
    { id: 'ing-p3', name: 'Nước dùng phở bò', grams: 250, calories: 44, protein: 3, carbs: 2, fat: 2.5 },
    { id: 'ing-p4', name: 'Hành lá & rau thơm', grams: 20, calories: 8, protein: 0.5, carbs: 1.5, fat: 0.1 },
  ],
}

export const CapturedMealDetail: React.FC<CapturedMealDetailProps> = ({
  meal,
  dailyCalorieGoal = 2000,
  userGoal = 'lose-fat',
  onBack,
  onEdit,
  onDelete,
}) => {
  const { user } = useAuth()
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(false)

  const handleSubmitReview = async () => {
    if (!user) return alert('Vui lòng đăng nhập để gửi.')
    setIsSubmittingReview(true)
    try {
      const aiAnalysis = await generateMealReview(meal, { goals: [userGoal] })
      await submitMealReview(user.uid, user.displayName || user.email || 'Học viên', {
        ...meal,
        aiAnalysis
      })
      setReviewSubmitted(true)
    } catch (error) {
      console.error(error)
      alert('Có lỗi xảy ra khi gửi.')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  const [isBookmarked, setIsBookmarked] = useState(false)
  const [portionCount, setPortionCount] = useState<number>(1)
  const [activeSlide, setActiveSlide] = useState<number>(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [isEditingPortion, setIsEditingPortion] = useState(false)
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showAddIngredientModal, setShowAddIngredientModal] = useState(false)
  const [newIngName, setNewIngName] = useState('')
  const [newIngGrams, setNewIngGrams] = useState('50')
  const [newIngCalories, setNewIngCalories] = useState('80')

  // Initial ingredients
  const initialItems = React.useMemo(() => {
    if (meal.items && meal.items.length > 0) return meal.items
    const lowerTitle = meal.title.toLowerCase()
    if (lowerTitle.includes('phở') || lowerTitle.includes('pho')) {
      return DEFAULT_INGREDIENTS.pho
    }
    return DEFAULT_INGREDIENTS.default
  }, [meal])

  const [ingredients, setIngredients] = useState<AiFoodItem[]>(initialItems)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 2500)
  }

  // Multiply scaled values by portion count
  const totalCal = Math.round((meal.calories || 780) * portionCount)
  const totalProtein = Math.round((meal.protein || 32) * portionCount)
  const totalCarbs = Math.round((meal.carbs || 40) * portionCount)
  const totalFat = Math.round((meal.fat || 12) * portionCount)
  const totalFiber = Math.round((meal.fiber || 0) * portionCount)
  
  const macroSumCal = Math.max(1, (totalProtein * 4) + (totalCarbs * 4) + (totalFat * 9))

  const handleAddIngredient = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newIngName.trim()) return
    const newItem: AiFoodItem = {
      id: `custom-${Date.now()}`,
      name: newIngName.trim(),
      grams: parseFloat(newIngGrams) || 50,
      calories: parseFloat(newIngCalories) || 80,
    }
    setIngredients((prev) => [...prev, newItem])
    setNewIngName('')
    setShowAddIngredientModal(false)
    showToast(`Đã thêm thành phần: ${newItem.name}`)
  }

  const handleDeleteIngredient = (id: string) => {
    setIngredients((prev) => prev.filter((item) => item.id !== id))
    showToast('Đã xóa thành phần')
  }

  // Image Fallback
  const heroImageUrl =
    meal.image ||
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80'

  const formattedTime = meal.time || '10:57'

  return (
    <div className="fdet-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fdet-toast">
          <Check size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {lightboxOpen && (
        <div className="fdet-lightbox" onClick={() => setLightboxOpen(false)}>
          <div className="fdet-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="fdet-lightbox-close" onClick={() => setLightboxOpen(false)}>
              <X size={20} />
            </button>
            <img src={heroImageUrl} alt={meal.title} className="fdet-lightbox-img" />
            <div className="fdet-lightbox-caption">
              <strong>{meal.title}</strong>
              <span>{totalCal} kcal · {portionCount} phần</span>
            </div>
          </div>
        </div>
      )}

      {/* Hero Top Image Section */}
      <div className="fdet-hero">
        <img src={heroImageUrl} alt={meal.title} className="fdet-hero-img" onClick={() => setLightboxOpen(true)} />

        {/* Overlaid Top Header Controls */}
        <div className="fdet-hero-overlay">
          <button type="button" className="fdet-btn-circle" onClick={onBack} title="Quay lại">
            <ArrowLeft size={20} />
          </button>

          <div className="fdet-nutrition-badge">
            <span>Dinh dưỡng</span>
          </div>

          <div className="fdet-hero-actions">
            <button
              type="button"
              className="fdet-btn-circle"
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href)
                showToast('Đã sao chép liên kết bữa ăn!')
              }}
              title="Chia sẻ"
            >
              <Share2 size={18} />
            </button>

            <button
              type="button"
              className="fdet-btn-circle"
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              title="Khác"
            >
              <MoreHorizontal size={20} />
            </button>

            {/* Options Dropdown Menu */}
            {showOptionsMenu && (
              <div className="fdet-menu-dropdown">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOptionsMenu(false)
                      onEdit(meal.id)
                    }}
                  >
                    <Edit3 size={15} /> Chỉnh sửa chi tiết
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsBookmarked(!isBookmarked)
                    setShowOptionsMenu(false)
                    showToast(isBookmarked ? 'Đã bỏ lưu bữa ăn' : 'Đã lưu bữa ăn vào yêu thích!')
                  }}
                >
                  <Bookmark size={15} /> {isBookmarked ? 'Bỏ lưu yêu thích' : 'Lưu vào yêu thích'}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setShowOptionsMenu(false)
                      if (window.confirm(`Xác nhận xóa món "${meal.title}"?`)) {
                        onDelete(meal.id)
                      }
                    }}
                  >
                    <Trash2 size={15} /> Xóa món này
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Bottom Sheet Sheet Card */}
      <div className="fdet-sheet">
        {/* Top Meta Bar inside Sheet */}
        <div className="fdet-meta-row">
          <button
            type="button"
            className={`fdet-bookmark-btn ${isBookmarked ? 'active' : ''}`}
            onClick={() => {
              setIsBookmarked(!isBookmarked)
              showToast(isBookmarked ? 'Đã bỏ lưu món' : 'Đã lưu món vào danh sách')
            }}
            title="Đánh dấu yêu thích"
          >
            <Bookmark size={20} fill={isBookmarked ? '#111827' : 'none'} />
          </button>

          <span className="fdet-time-badge">{formattedTime}</span>
        </div>

        {/* Title & Calories Header Flex Layout */}
        <div className="fdet-title-cal-row">
          <div className="fdet-title-col">
            <h1 className="fdet-title">{meal.title}</h1>

            <button
              type="button"
              className="fdet-portion-pill"
              onClick={() => setIsEditingPortion(true)}
              title="Sửa khẩu phần"
            >
              <span>{portionCount} phần</span>
              <Pencil size={13} className="fdet-pencil-icon" />
            </button>
          </div>

          <div className="fdet-calories-col">
            <span className="fdet-cal-label">⚡ NĂNG LƯỢNG</span>
            <span className="fdet-cal-value">{totalCal}</span>
          </div>
        </div>

        {meal.coachFeedback && (
          <div className="fdet-coach-feedback" style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontWeight: 800, marginBottom: '8px', fontSize: '13px' }}>
              <Sparkles size={16} /> <span>Coach nhận xét</span>
            </div>
            <p style={{ margin: 0, fontSize: '14px', color: '#14532d', lineHeight: 1.5 }}>{meal.coachFeedback}</p>
          </div>
        )}

        {/* Macro & Micro Nutrients Carousel (Slide 1 & Slide 2) */}
        <div
          className="fdet-carousel-area"
          onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchStartX === null) return
            const diffX = touchStartX - e.changedTouches[0].clientX
            if (diffX > 40) setActiveSlide(1)
            else if (diffX < -40) setActiveSlide(0)
            setTouchStartX(null)
          }}
        >
          {activeSlide === 0 ? (
            <div className="fdet-macros-grid fdet-slide-anim">
              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon fdet-icon-protein">🥩</span>
                  <span className="fdet-macro-label">Chất đạm</span>
                </div>
                <span className="fdet-macro-val">{totalProtein} g</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon fdet-icon-carbs">🌾</span>
                  <span className="fdet-macro-label">Bột đường</span>
                </div>
                <span className="fdet-macro-val">{totalCarbs} g</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon fdet-icon-fats">💧</span>
                  <span className="fdet-macro-label">Chất béo</span>
                </div>
                <span className="fdet-macro-val">{totalFat} g</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon fdet-icon-fiber">🥦</span>
                  <span className="fdet-macro-label">Chất xơ</span>
                </div>
                <span className="fdet-macro-val">{totalFiber || Math.round(totalCarbs * 0.12)} g</span>
              </div>
            </div>
          ) : (
            <div className="fdet-macros-grid fdet-slide-anim">
              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon">🍯</span>
                  <span className="fdet-macro-label">Đường</span>
                </div>
                <span className="fdet-macro-val">{Math.round((meal.sugar ?? (meal.carbs * 0.22)) * portionCount)} g</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon">🧂</span>
                  <span className="fdet-macro-label">Muối</span>
                </div>
                <span className="fdet-macro-val">{Math.round((meal.sodium ?? 420) * portionCount)} mg</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon">🥩</span>
                  <span className="fdet-macro-label">% Đạm</span>
                </div>
                <span className="fdet-macro-val">{Math.round((totalProtein * 4 / Math.max(1, totalCal)) * 100)}%</span>
              </div>

              <div className="fdet-macro-card">
                <div className="fdet-macro-head">
                  <span className="fdet-macro-icon">🌾</span>
                  <span className="fdet-macro-label">% Bột đường / Béo</span>
                </div>
                <span className="fdet-macro-val">
                  {Math.round((totalCarbs * 4 / Math.max(1, totalCal)) * 100)}% / {Math.round((totalFat * 9 / Math.max(1, totalCal)) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Carousel Pagination Dots */}
        <div className="fdet-dots-bar">
          <button
            type="button"
            className={`fdet-dot-btn ${activeSlide === 0 ? 'active' : ''}`}
            onClick={() => setActiveSlide(0)}
            aria-label="Slide 1: Đa lượng"
          />
          <button
            type="button"
            className={`fdet-dot-btn ${activeSlide === 1 ? 'active' : ''}`}
            onClick={() => setActiveSlide(1)}
            aria-label="Slide 2: Vi chất & Tỷ lệ Kcal"
          />
        </div>

        {/* Ingredients / Thành Phần Section */}
        <div className="fdet-section">
          <div className="fdet-section-header">
            <h2 className="fdet-section-title">Thành phần</h2>
            <button
              type="button"
              className="fdet-add-more-btn"
              onClick={() => setShowAddIngredientModal(true)}
            >
              <Plus size={15} />
              <span>Thêm</span>
            </button>
          </div>

          <div className="fdet-ingredients-list">
            {ingredients.map((item) => {
              const scaledGrams = Math.round(item.grams * portionCount)
              const scaledCalories = Math.round(item.calories * portionCount)

              return (
                <div className="fdet-ingredient-card" key={item.id}>
                  <div className="fdet-ing-left">
                    <strong className="fdet-ing-name">{item.name}</strong>
                    <span className="fdet-ing-cal"> · {scaledCalories} cal</span>
                  </div>

                  <div className="fdet-ing-right">
                    <span className="fdet-ing-grams">{scaledGrams}g</span>
                    {ingredients.length > 1 && (
                      <button
                        type="button"
                        className="fdet-ing-del"
                        onClick={() => handleDeleteIngredient(item.id)}
                        title="Xóa thành phần"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ✨ Đánh Giá Từ AI Coach & Nhận Xét Từ Coach */}
        <div className="fdet-section">
          <div className="fdet-section-header">
            <h2 className="fdet-section-title fdet-ai-title">
              <Sparkles size={18} className="fdet-sparkle-icon text-purple-600" />
              <span>Đánh giá từ AI Coach</span>
            </h2>
          </div>

          {/* AI Aura Coach Assessment Card */}
          <div className="p-4 bg-gray-50/90 border border-gray-200 rounded-2xl space-y-2 text-left my-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-purple-600 text-white rounded-xl shadow-xs flex items-center justify-center">
                <Sparkles size={15} />
              </div>
              <span className="text-xs font-extrabold text-gray-900 uppercase tracking-wider">AI Aura Coach</span>
            </div>
            <p className="text-xs sm:text-sm text-gray-800 font-medium leading-relaxed bg-white p-3 rounded-xl border border-gray-200/80">
              {meal.aiAnalysis || `Khẩu phần ${portionCount} phần gồm ${ingredients.map((i) => i.name).join(', ')}. Tổng năng lượng ${totalCal} kcal (${totalProtein}g Đạm, ${totalCarbs}g Carb, ${totalFat}g Béo) đạt tỉ lệ dinh dưỡng cân đối, phù hợp với chế độ tập luyện.`}
            </p>
          </div>

          {/* Coach Reviewed Feedback (When reviewed by Coach) */}
          {meal.coachFeedback && (
            <div className="p-4 bg-emerald-50/90 border border-emerald-200 rounded-2xl space-y-2 text-left my-3 shadow-2xs">
              <div className="flex items-center gap-2 text-emerald-800">
                <div className="p-1.5 bg-emerald-600 text-white rounded-xl shadow-xs flex items-center justify-center">
                  <Sparkles size={15} />
                </div>
                <span className="text-xs font-extrabold uppercase tracking-wider">LỜI KHUYÊN TỪ COACH KHI DUYỆT MÓN</span>
              </div>
              <p className="text-xs sm:text-sm text-emerald-950 font-medium leading-relaxed bg-white/90 p-3 rounded-xl border border-emerald-200/80">
                "{meal.coachFeedback}"
              </p>
            </div>
          )}
        </div>

      </div>

      {/* Sticky Bottom Action Buttons */}
      <div className="fdet-bottom-bar">
        <button
          type="button"
          className="fdet-btn-secondary"
          onClick={() => {
            if (onEdit) {
              onEdit(meal.id)
            } else {
              setIsEditingPortion(true)
            }
          }}
        >
          <Edit3 size={16} />
          <span>Sửa món</span>
        </button>

        <button
          type="button"
          className="fdet-btn-secondary"
          onClick={handleSubmitReview}
          disabled={isSubmittingReview || reviewSubmitted || meal.reviewStatus === 'pending' || meal.reviewStatus === 'reviewed'}
          style={{ color: (reviewSubmitted || meal.reviewStatus) ? '#10b981' : undefined }}
        >
          {isSubmittingReview ? <LoaderCircle size={16} className="animate-spin" /> : (reviewSubmitted || meal.reviewStatus) ? <Check size={16} /> : <ScanLine size={16} />}
          <span>
            {isSubmittingReview ? 'Đang gửi...' 
             : meal.reviewStatus === 'reviewed' ? 'Đã duyệt'
             : (reviewSubmitted || meal.reviewStatus === 'pending') ? 'Đang chờ duyệt' 
             : 'Gửi duyệt'}
          </span>
        </button>

        <button type="button" className="fdet-btn-primary" onClick={onBack}>
          <span>Hoàn tất</span>
        </button>
      </div>

      {/* Edit Portion Modal */}
      {isEditingPortion && (
        <div className="fdet-modal-overlay" onClick={() => setIsEditingPortion(false)}>
          <div className="fdet-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fdet-modal-head">
              <h3>Điều chỉnh khẩu phần</h3>
              <button type="button" onClick={() => setIsEditingPortion(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="fdet-modal-sub">
              Chọn số lượng phần ăn để tự động tính toán lại Kcal & Macro:
            </p>

            <div className="fdet-portion-selector">
              {[0.5, 1, 1.5, 2, 2.5, 3].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`fdet-portion-opt ${portionCount === val ? 'selected' : ''}`}
                  onClick={() => {
                    setPortionCount(val)
                    setIsEditingPortion(false)
                    showToast(`Đã cập nhật khẩu phần: ${val} phần`)
                  }}
                >
                  {val} phần
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Ingredient Modal */}
      {showAddIngredientModal && (
        <div className="fdet-modal-overlay" onClick={() => setShowAddIngredientModal(false)}>
          <div className="fdet-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fdet-modal-head">
              <h3>Thêm thành phần món ăn</h3>
              <button type="button" onClick={() => setShowAddIngredientModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddIngredient} className="fdet-add-form">
              <div className="fdet-form-group">
                <label>Tên thực phẩm / món phụ</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Rau luộc, Trứng chiên..."
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  required
                />
              </div>

              <div className="fdet-form-row">
                <div className="fdet-form-group">
                  <label>Khối lượng (gam)</label>
                  <input
                    type="number"
                    value={newIngGrams}
                    onChange={(e) => setNewIngGrams(e.target.value)}
                    required
                  />
                </div>

                <div className="fdet-form-group">
                  <label>Năng lượng (kcal)</label>
                  <input
                    type="number"
                    value={newIngCalories}
                    onChange={(e) => setNewIngCalories(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="fdet-modal-actions">
                <button
                  type="button"
                  className="fdet-btn-secondary"
                  onClick={() => setShowAddIngredientModal(false)}
                >
                  Hủy
                </button>
                <button type="submit" className="fdet-btn-primary">
                  Thêm thành phần
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CapturedMealDetail
