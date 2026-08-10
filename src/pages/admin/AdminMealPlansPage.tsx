import { useState, useMemo, useRef } from 'react'
import {
  Utensils,
  Plus,
  Search,
  SlidersHorizontal,
  Flame,
  ChefHat,
  Sparkles,
  Edit,
  Trash2,
  Copy,
  Clock,
  Eye,
  Check,
  X,
  Star,
  Bookmark,
  TrendingUp,
  Crown,
  Calendar,
  Layers,
  BarChart2,
  Filter,
  CheckCircle2,
  AlertCircle,
  Upload,
  Image as ImageIcon,
  Loader2,
  Bot,
  Lightbulb,
  Wand2,
  RefreshCw,
  ChevronRight
} from 'lucide-react'
import type { ViewId } from '../../types'
import { firebaseAuth } from '../../lib/firebase'
import '../../styles-admin-meal-plans.css'

interface AdminMealPlansPageProps {
  onNavigate?: (view: ViewId) => void
}

export interface AdminRecipe {
  id: string
  name: string
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  goal: 'fat-loss' | 'muscle-gain' | 'maintenance'
  diet?: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  minutes: number
  image: string
  badge?: string
  isPro?: boolean
  description?: string
  ingredients?: { name: string; amount: string }[]
  instructions?: string[]
  logsCount?: number
  savedCount?: number
}

// Initial Admin Demo Recipes Data
const INITIAL_ADMIN_RECIPES: AdminRecipe[] = [
  {
    id: 'rec-1',
    name: 'Ức gà áp chảo sốt bơ tỏi & bông cải xanh',
    meal: 'lunch',
    goal: 'fat-loss',
    diet: 'Giàu đạm',
    kcal: 420,
    protein: 48,
    carbs: 18,
    fat: 14,
    minutes: 20,
    image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80',
    badge: 'Hot Giảm Mỡ',
    isPro: true,
    description: 'Bữa trưa chuẩn fitness đạm cao, cực ít tinh bột giúp đốt mỡ bắp tay & bụng hiệu quả.',
    ingredients: [
      { name: 'Ức gà tươi', amount: '200g' },
      { name: 'Bông cải xanh', amount: '150g' },
      { name: 'Bơ thực vật tỏi', amount: '10g' },
      { name: 'Dầu olive', amount: '1 muỗng cà phê' }
    ],
    instructions: [
      'Thái ức gà miếng vừa ăn, ướp chút muối, tiêu và ớt bột trong 10 phút.',
      'Áp chảo ức gà với dầu olive lửa vừa 6-8 phút đến khi chín vàng 2 mặt.',
      'Hấp chín bông cải xanh và bày ra đĩa cùng sốt bơ tỏi thơm lừng.'
    ],
    logsCount: 1420,
    savedCount: 890
  },
  {
    id: 'rec-2',
    name: 'Salad cá hồi hun khói & bơ chín nướng',
    meal: 'dinner',
    goal: 'fat-loss',
    diet: 'Ít tinh bột',
    kcal: 380,
    protein: 32,
    carbs: 12,
    fat: 22,
    minutes: 15,
    image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80',
    badge: 'Pro Eat Clean',
    isPro: true,
    description: 'Nguồn chất béo tốt Omega-3 từ cá hồi và bơ giúp săn chắc da & no lâu.',
    ingredients: [
      { name: 'Cá hồi hun khói', amount: '120g' },
      { name: 'Bơ chín', amount: '1/2 quả' },
      { name: 'Xà lách thủy canh', amount: '100g' },
      { name: 'Sốt chanh dây', amount: '2 muỗng' }
    ],
    instructions: [
      'Rửa sạch rau xà lách, để ráo nước và xếp ra tô lớn.',
      'Cắt lát bơ chín và cuộn cá hồi hun khói đặt lên trên.',
      'Rưới sốt chanh dây nhẹ nhàng và thưởng thức.'
    ],
    logsCount: 980,
    savedCount: 640
  },
  {
    id: 'rec-3',
    name: 'Bánh mì sandwich bơ trứng ốp la tiêu đen',
    meal: 'breakfast',
    goal: 'maintenance',
    diet: 'Bữa sáng nhanh',
    kcal: 350,
    protein: 22,
    carbs: 38,
    fat: 12,
    minutes: 10,
    image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
    badge: 'Bữa Sáng Nhanh',
    isPro: false,
    description: 'Bữa sáng 10 phút nạp năng lượng tràn đầy cho ngày làm việc sung sức.',
    ingredients: [
      { name: 'Bánh mì nguyên cám', amount: '2 lát' },
      { name: 'Trứng gà tươi', amount: '2 quả' },
      { name: 'Bơ chín phết', amount: '30g' }
    ],
    instructions: [
      'Nướng giòn 2 lát bánh mì nguyên cám.',
      'Ốp la 2 quả trứng gà rắc chút tiêu đen.',
      'Phết bơ lên bánh mì và kẹp trứng thưởng thức.'
    ],
    logsCount: 2100,
    savedCount: 1120
  },
  {
    id: 'rec-4',
    name: 'Smoothie Protein Dâu Tây & Chuối Yến Mạch',
    meal: 'snack',
    goal: 'muscle-gain',
    diet: 'Giàu đạm',
    kcal: 290,
    protein: 28,
    carbs: 35,
    fat: 4,
    minutes: 5,
    image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=800&q=80',
    badge: 'Tăng Cơ',
    isPro: false,
    description: 'Sinh tố protein thơm ngon tiếp sức ngay sau buổi tập gym căng thẳng.',
    ingredients: [
      { name: 'Whey Protein vị Dâu', amount: '1 muỗng (30g)' },
      { name: 'Chuối đông lạnh', amount: '1 quả' },
      { name: 'Yến mạch cán mịn', amount: '20g' },
      { name: 'Sữa tươi không đường', amount: '200ml' }
    ],
    instructions: [
      'Cho tất cả nguyên liệu vào máy xay sinh tố.',
      'Xay nhuyễn mịn trong 45 giây.',
      'Rót ra ly và dùng ngay sau khi tập.'
    ],
    logsCount: 1750,
    savedCount: 930
  },
  {
    id: 'rec-5',
    name: 'Thịt bò xào ớt chuông & nấm đùi gà',
    meal: 'lunch',
    goal: 'muscle-gain',
    diet: 'Giàu đạm',
    kcal: 460,
    protein: 44,
    carbs: 22,
    fat: 18,
    minutes: 18,
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80',
    badge: 'Siêu Giàu Đạm',
    isPro: true,
    description: 'Thịt bò tơ xào đậm vị, kết hợp vitamins từ ớt chuông giòn ngọt.',
    ingredients: [
      { name: 'Thịt thăn bò', amount: '180g' },
      { name: 'Ớt chuông 3 màu', amount: '100g' },
      { name: 'Nấm đùi gà', amount: '80g' }
    ],
    instructions: [
      'Thái mỏng thịt bò, ướp dầu tỏi & tỏi băm.',
      'Xào nhanh bò lửa lớn trong 3 phút rồi trút ra đĩa.',
      'Xào chín ớt chuông & nấm rồi đảo đều cùng thịt bò.'
    ],
    logsCount: 1320,
    savedCount: 710
  }
]

export default function AdminMealPlansPage({ onNavigate }: AdminMealPlansPageProps) {
  const [activeTab, setActiveTab] = useState<'recipes' | 'plans' | 'analytics'>('recipes')
  const [recipes, setRecipes] = useState<AdminRecipe[]>(INITIAL_ADMIN_RECIPES)
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMealFilter, setSelectedMealFilter] = useState<string>('all')
  const [selectedGoalFilter, setSelectedGoalFilter] = useState<string>('all')
  const [proOnlyFilter, setProOnlyFilter] = useState(false)

  // File Upload Reference & Image Tab
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageUploadMode, setImageUploadMode] = useState<'file' | 'url'>('file')

  // AI Recipe Generator Modal state
  const [isAiRecipeModalOpen, setIsAiRecipeModalOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGoal, setAiGoal] = useState<'fat-loss' | 'muscle-gain' | 'maintenance'>('fat-loss')
  const [aiMealType, setAiMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch')
  const [isGeneratingAiRecipe, setIsGeneratingAiRecipe] = useState(false)

  // AI Meal Plan Recommendation Modal state
  const [isAiPlanModalOpen, setIsAiPlanModalOpen] = useState(false)
  const [aiPlanGoal, setAiPlanGoal] = useState('Giảm mỡ thâm hụt calo chuẩn PT')
  const [aiPlanCalories, setAiPlanCalories] = useState(1600)
  const [aiPlanProtein, setAiPlanProtein] = useState(130)
  const [isGeneratingAiPlan, setIsGeneratingAiPlan] = useState(false)
  const [aiPlanResult, setAiPlanResult] = useState<{
    title?: string
    summary?: string
    recommendations?: string[]
    sampleDays?: Array<{
      dayName: string
      breakfast: string
      lunch: string
      snack: string
      dinner: string
      totalKcal: number
      totalProtein: number
    }>
  } | null>(null)

  // Modals state
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<AdminRecipe | null>(null)
  const [previewRecipe, setPreviewRecipe] = useState<AdminRecipe | null>(null)
  const [selectedPlanToEdit, setSelectedPlanToEdit] = useState<{
    title: string;
    goal: string;
    protein: string;
    daysCount: number;
    assignedStudents: number;
    popularRecipe: string;
  } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Form state for creating/editing recipe
  const [formData, setFormData] = useState<Partial<AdminRecipe>>({
    name: '',
    meal: 'lunch',
    goal: 'fat-loss',
    diet: 'Giàu đạm',
    kcal: 400,
    protein: 35,
    carbs: 30,
    fat: 12,
    minutes: 15,
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
    badge: 'Mới',
    isPro: false,
    description: '',
    ingredients: [{ name: '', amount: '' }],
    instructions: ['']
  })

  // Show temporary toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Handle Image File Upload from Computer with automatic canvas compression
  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      showToast('Kích thước ảnh vượt quá 10MB. Vui lòng chọn tệp nhỏ hơn!')
      return
    }
    const reader = new FileReader()
    reader.onload = (evt) => {
      if (evt.target?.result) {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const maxDim = 1000
          let width = img.width
          let height = img.height
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height)
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.82)
            setFormData((prev) => ({ ...prev, image: compressedBase64 }))
            showToast('Đã tối ưu và tải ảnh từ máy tính lên thành công!')
          } else {
            setFormData((prev) => ({ ...prev, image: evt.target!.result as string }))
            showToast('Đã tải ảnh từ máy tính lên thành công!')
          }
        }
        img.onerror = () => {
          setFormData((prev) => ({ ...prev, image: evt.target!.result as string }))
        }
        img.src = evt.target.result as string
      }
    }
    reader.readAsDataURL(file)
  }

  // Handle AI Recipe Generation
  const handleGenerateAiRecipe = async () => {
    if (!aiPrompt.trim()) {
      showToast('Vui lòng nhập ý tưởng món ăn hoặc nguyên liệu!')
      return
    }
    try {
      setIsGeneratingAiRecipe(true)
      let token: string | null = null
      if (firebaseAuth?.currentUser) {
        token = await firebaseAuth.currentUser.getIdToken()
      }
      const res = await fetch('/api/ai/generate-recipe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          prompt: aiPrompt,
          goal: aiGoal,
          mealType: aiMealType
        })
      })
      const data = await res.json()
      if (data.success && data.recipe) {
        const rec = data.recipe
        setFormData({
          name: rec.name || 'Món ăn AI',
          meal: rec.meal || aiMealType,
          goal: rec.goal || aiGoal,
          diet: rec.diet || 'Gợi ý AI',
          kcal: Number(rec.kcal) || 380,
          protein: Number(rec.protein) || 35,
          carbs: Number(rec.carbs) || 28,
          fat: Number(rec.fat) || 12,
          minutes: Number(rec.minutes) || 15,
          image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
          badge: rec.badge || 'AI Đề Xuất',
          isPro: false,
          description: rec.description || '',
          ingredients: Array.isArray(rec.ingredients)
            ? rec.ingredients.map((ing: any) =>
                typeof ing === 'string' ? { name: ing, amount: '' } : ing
              )
            : [{ name: 'Nguyên liệu AI', amount: 'Định lượng chuẩn' }],
          instructions: Array.isArray(rec.instructions) ? rec.instructions : ['Chế biến theo hướng dẫn']
        })
        setIsAiRecipeModalOpen(false)
        setEditingRecipe(null)
        setIsRecipeModalOpen(true)
        showToast('AI đã tạo công thức! Bạn có thể chọn ảnh từ máy tính trước khi lưu.')
      } else {
        showToast(data.error || 'Không thể tạo công thức AI')
      }
    } catch (err) {
      console.error(err)
      showToast('Lỗi kết nối máy chủ AI')
    } finally {
      setIsGeneratingAiRecipe(false)
    }
  }

  // Handle AI Meal Plan Suggestion
  const handleGenerateAiPlan = async () => {
    try {
      setIsGeneratingAiPlan(true)
      let token: string | null = null
      if (firebaseAuth?.currentUser) {
        token = await firebaseAuth.currentUser.getIdToken()
      }
      const res = await fetch('/api/ai/suggest-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          goal: aiPlanGoal,
          targetCalories: aiPlanCalories,
          targetProtein: aiPlanProtein
        })
      })
      const data = await res.json()
      if (data.success && data.planSuggestion) {
        setAiPlanResult(data.planSuggestion)
        showToast('AI đã hoàn tất gợi ý khung thực đơn!')
      } else {
        showToast('Không thể kết nối dịch vụ gợi ý thực đơn')
      }
    } catch (err) {
      console.error(err)
      showToast('Lỗi khi gọi AI gợi ý thực đơn')
    } finally {
      setIsGeneratingAiPlan(false)
    }
  }

  // Filtered recipes
  const filteredRecipes = useMemo(() => {
    return recipes.filter((item) => {
      if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (selectedMealFilter !== 'all' && item.meal !== selectedMealFilter) {
        return false
      }
      if (selectedGoalFilter !== 'all' && item.goal !== selectedGoalFilter) {
        return false
      }
      if (proOnlyFilter && !item.isPro) {
        return false
      }
      return true
    })
  }, [recipes, searchQuery, selectedMealFilter, selectedGoalFilter, proOnlyFilter])

  // Open Create Recipe Modal
  const handleOpenCreateModal = () => {
    setEditingRecipe(null)
    setFormData({
      name: '',
      meal: 'lunch',
      goal: 'fat-loss',
      diet: 'Giàu đạm',
      kcal: 400,
      protein: 35,
      carbs: 30,
      fat: 12,
      minutes: 15,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
      badge: 'Nổi bật',
      isPro: false,
      description: '',
      ingredients: [{ name: 'Ức gà / Bò / Cá', amount: '150g' }],
      instructions: ['Sơ chế sạch nguyên liệu', 'Nấu chín ở nhiệt độ vừa phải']
    })
    setIsRecipeModalOpen(true)
  }

  // Open Edit Recipe Modal
  const handleOpenEditModal = (recipe: AdminRecipe) => {
    setEditingRecipe(recipe)
    setFormData({ ...recipe })
    setIsRecipeModalOpen(true)
  }

  // Handle Save Recipe (Create or Edit)
  const handleSaveRecipe = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name?.trim()) {
      alert('Vui lòng nhập tên công thức món ăn!')
      return
    }

    if (editingRecipe) {
      setRecipes((prev) =>
        prev.map((r) => (r.id === editingRecipe.id ? ({ ...r, ...formData } as AdminRecipe) : r))
      )
      showToast(`Đã cập nhật món "${formData.name}"!`)
    } else {
      const newRec: AdminRecipe = {
        id: `rec-${Date.now()}`,
        name: formData.name || 'Món mới',
        meal: (formData.meal as any) || 'lunch',
        goal: (formData.goal as any) || 'fat-loss',
        diet: formData.diet || 'Cân bằng',
        kcal: Number(formData.kcal) || 350,
        protein: Number(formData.protein) || 25,
        carbs: Number(formData.carbs) || 30,
        fat: Number(formData.fat) || 10,
        minutes: Number(formData.minutes) || 15,
        image: formData.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
        badge: formData.badge || 'Mới',
        isPro: Boolean(formData.isPro),
        description: formData.description || '',
        ingredients: formData.ingredients || [],
        instructions: formData.instructions || [],
        logsCount: 0,
        savedCount: 0
      }
      setRecipes([newRec, ...recipes])
      showToast(`Đã thêm món mới "${newRec.name}" vào thư viện!`)
    }
    setIsRecipeModalOpen(false)
  }

  // Delete Recipe
  const handleDeleteRecipe = (id: string, name: string) => {
    if (window.confirm(`Bạn có chắc chắn muốn xóa món "${name}" khỏi thư viện?`)) {
      setRecipes((prev) => prev.filter((r) => r.id !== id))
      showToast(`Đã xóa thành công món "${name}"!`)
    }
  }

  // Duplicate Recipe
  const handleDuplicateRecipe = (recipe: AdminRecipe) => {
    const dup: AdminRecipe = {
      ...recipe,
      id: `rec-${Date.now()}`,
      name: `${recipe.name} (Bản sao)`,
      logsCount: 0,
      savedCount: 0
    }
    setRecipes([dup, ...recipes])
    showToast(`Đã nhân bản "${recipe.name}"!`)
  }

  // Toggle Pro badge
  const handleTogglePro = (id: string) => {
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isPro: !r.isPro } : r))
    )
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] pb-24">
      {/* TOAST ALERT */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 rounded-2xl bg-[#0f172a] px-5 py-3 text-sm font-bold text-white shadow-2xl animate-in slide-in-from-top duration-200">
          <CheckCircle2 size={18} className="text-[#10b981]" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6">
        {/* TOP HEADER */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div>
            <div className="flex items-center gap-2 text-[11px] sm:text-xs font-extrabold uppercase tracking-widest text-[#ff3f7d]">
              <Utensils size={15} /> QUẢN TRỊ DINH DƯỠNG & THỰC ĐƠN
            </div>
            <h1 className="mt-1 text-xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Quản lý Công thức & Kế hoạch Ăn 7 Ngày
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
              Tạo mới công thức, thiết lập gợi ý khẩu phần macro và tùy chỉnh 7-Day Meal Plan cho học viên Aura.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 mt-1 sm:mt-0">
            <button
              type="button"
              onClick={() => setIsAiRecipeModalOpen(true)}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2.5 text-xs font-extrabold shadow-md active:scale-95 transition-all cursor-pointer whitespace-nowrap border border-slate-800"
            >
              <Sparkles size={15} className="text-amber-300 animate-pulse shrink-0" />
              <span>Tạo bằng AI</span>
            </button>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ff3f7d] to-[#ff6b35] hover:opacity-95 text-white px-3.5 py-2.5 text-xs font-extrabold shadow-md active:scale-95 transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus size={15} className="shrink-0" />
              <span>Thêm thủ công</span>
            </button>
          </div>
        </div>

        {/* OVERVIEW STATS BANNER */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1.5">
              <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider">Tổng công thức</span>
              <ChefHat size={18} className="text-[#ff3f7d] shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900">{recipes.length} <span className="text-[10px] sm:text-xs font-bold text-slate-400">món</span></div>
            <p className="mt-1 text-[10px] sm:text-xs text-slate-500 font-semibold">+12 món mới tuần này</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1.5">
              <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider">Kế hoạch 7 Ngày</span>
              <Calendar size={18} className="text-[#8b5cf6] shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900">8 <span className="text-[10px] sm:text-xs font-bold text-slate-400">mẫu</span></div>
            <p className="mt-1 text-[10px] sm:text-xs font-semibold text-emerald-600">Sẵn sàng áp dụng</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1.5">
              <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider">Lượt ghi món</span>
              <Flame size={18} className="text-[#f59e0b] shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900">7,570</div>
            <p className="mt-1 text-[10px] sm:text-xs font-semibold text-emerald-600">↑ 18% so với tuần trước</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 mb-1.5">
              <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider">Món Pro / VIP</span>
              <Crown size={18} className="text-[#3b82f6] shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-900">{recipes.filter(r => r.isPro).length}</div>
            <p className="mt-1 text-[10px] sm:text-xs text-slate-500 font-semibold">Dành cho hội viên Pro</p>
          </div>
        </div>

        {/* TABS NAVIGATION */}
        <div className="flex items-center gap-2 border-b border-slate-200 mb-6 pb-2 overflow-x-auto whitespace-nowrap scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('recipes')}
            className={`shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
              activeTab === 'recipes'
                ? 'bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ChefHat size={16} /> Thư viện công thức ({recipes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('plans')}
            className={`shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
              activeTab === 'plans'
                ? 'bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Calendar size={16} /> Kế hoạch 7 Ngày mẫu (8)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <BarChart2 size={16} /> Thống kê & Món Hot
          </button>
        </div>

        {/* TAB 1: RECIPES CATALOG MANAGEMENT */}
        {activeTab === 'recipes' && (
          <div>
            {/* SEARCH & FILTERS BAR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-2 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <Search size={18} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Tìm theo tên công thức, nguyên liệu..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-sm font-medium outline-none text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Meal Filter */}
                <select
                  value={selectedMealFilter}
                  onChange={(e) => setSelectedMealFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                >
                  <option value="all">Tất cả bữa ăn</option>
                  <option value="breakfast">Bữa sáng</option>
                  <option value="lunch">Bữa trưa</option>
                  <option value="dinner">Bữa tối</option>
                  <option value="snack">Bữa phụ</option>
                </select>

                {/* Goal Filter */}
                <select
                  value={selectedGoalFilter}
                  onChange={(e) => setSelectedGoalFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                >
                  <option value="all">Tất cả mục tiêu</option>
                  <option value="fat-loss">Giảm mỡ</option>
                  <option value="muscle-gain">Tăng cơ</option>
                  <option value="maintenance">Cân bằng</option>
                </select>

                {/* Pro Toggle Filter */}
                <button
                  type="button"
                  onClick={() => setProOnlyFilter(!proOnlyFilter)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    proOnlyFilter
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  <Crown size={14} className={proOnlyFilter ? 'text-amber-600' : ''} /> Chỉ món Pro
                </button>
              </div>
            </div>

            {/* RECIPES LIST: MOBILE CARD VIEW (md:hidden) */}
            <div className="block md:hidden space-y-3 mb-6">
              {filteredRecipes.length > 0 ? (
                filteredRecipes.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs flex flex-col gap-3 min-w-0 w-full overflow-hidden">
                    {/* Top row: Image & Name */}
                    <div className="flex items-start gap-3 min-w-0 w-full">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-16 w-16 recipe-card-thumbnail rounded-xl object-cover shrink-0 border border-slate-200"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80'
                        }}
                      />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700 capitalize shrink-0">
                            {item.meal === 'breakfast' && 'Bữa sáng'}
                            {item.meal === 'lunch' && 'Bữa trưa'}
                            {item.meal === 'dinner' && 'Bữa tối'}
                            {item.meal === 'snack' && 'Bữa phụ'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTogglePro(item.id)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold cursor-pointer shrink-0 ${
                              item.isPro ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            <Crown size={10} /> {item.isPro ? 'Pro' : 'Miễn phí'}
                          </button>
                        </div>
                        <h4 className="font-extrabold text-slate-900 text-sm mt-1 truncate max-w-full">{item.name}</h4>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap min-w-0">
                          {item.badge && (
                            <span className="rounded-full bg-pink-100 text-[#ff3f7d] px-2 py-0.5 text-[10px] font-bold shrink-0">
                              {item.badge}
                            </span>
                          )}
                          <span className="text-slate-400 text-[10px] truncate max-w-full">{item.diet}</span>
                        </div>
                      </div>
                    </div>

                    {/* Middle row: Macros preview */}
                    <div className="grid grid-cols-4 gap-1 bg-slate-50 p-2.5 rounded-xl text-center text-[10px]">
                      <div>
                        <div className="text-slate-400 font-semibold">Calo</div>
                        <div className="font-black text-slate-900 text-xs">{item.kcal}</div>
                      </div>
                      <div>
                        <div className="text-emerald-600 font-semibold">Đạm</div>
                        <div className="font-extrabold text-slate-900">{item.protein}g</div>
                      </div>
                      <div>
                        <div className="text-amber-600 font-semibold">Carb</div>
                        <div className="font-extrabold text-slate-900">{item.carbs}g</div>
                      </div>
                      <div>
                        <div className="text-purple-600 font-semibold">Béo</div>
                        <div className="font-extrabold text-slate-900">{item.fat}g</div>
                      </div>
                    </div>

                    {/* Bottom row: Time & Actions */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                      <span className="inline-flex items-center gap-1 font-bold text-slate-500 text-[11px]">
                        <Clock size={12} className="text-slate-400" /> {item.minutes} phút
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewRecipe(item)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold text-[11px] hover:bg-slate-200"
                        >
                          Xem
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateRecipe(item)}
                          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                          title="Nhân bản"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                          title="Sửa"
                        >
                          <Edit size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecipe(item.id, item.name)}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50"
                          title="Xóa"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-slate-400 font-medium bg-white rounded-2xl border border-slate-200">
                  Chưa tìm thấy công thức nào.
                </div>
              )}
            </div>

            {/* RECIPES TABLE GRID: DESKTOP VIEW (hidden md:block) */}
            <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-4">Món ăn & Công thức</th>
                      <th className="py-3.5 px-4">Bữa ăn</th>
                      <th className="py-3.5 px-4">Mục tiêu</th>
                      <th className="py-3.5 px-4">Calo & Macro (P/C/F)</th>
                      <th className="py-3.5 px-4">Thời gian</th>
                      <th className="py-3.5 px-4">Gói VIP</th>
                      <th className="py-3.5 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredRecipes.length > 0 ? (
                      filteredRecipes.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-12 w-12 rounded-xl object-cover shrink-0 border border-slate-200"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80'
                                }}
                              />
                              <div>
                                <div className="font-extrabold text-slate-900 text-sm">{item.name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {item.badge && (
                                    <span className="rounded-full bg-pink-100 text-[#ff3f7d] px-2 py-0.5 text-[10px] font-bold">
                                      {item.badge}
                                    </span>
                                  )}
                                  <span className="text-slate-400 text-[11px]">{item.diet}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 capitalize">
                              {item.meal === 'breakfast' && 'Bữa sáng'}
                              {item.meal === 'lunch' && 'Bữa trưa'}
                              {item.meal === 'dinner' && 'Bữa tối'}
                              {item.meal === 'snack' && 'Bữa phụ'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              item.goal === 'fat-loss' ? 'bg-pink-100 text-pink-700' :
                              item.goal === 'muscle-gain' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {item.goal === 'fat-loss' && 'Giảm mỡ'}
                              {item.goal === 'muscle-gain' && 'Tăng cơ'}
                              {item.goal === 'maintenance' && 'Giữ dáng'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">{item.kcal} kcal</div>
                            <div className="flex items-center gap-1.5 text-[11px] mt-0.5 font-semibold">
                              <span className="text-emerald-600">{item.protein}g Đạm</span>
                              <span className="text-slate-300">•</span>
                              <span className="text-amber-600">{item.carbs}g Carb</span>
                              <span className="text-slate-300">•</span>
                              <span className="text-purple-600">{item.fat}g Béo</span>
                            </div>
                          </td>

                          <td className="py-3 px-4 font-bold text-slate-700">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={13} className="text-slate-400" /> {item.minutes} phút
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => handleTogglePro(item.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold cursor-pointer transition-all ${
                                item.isPro
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              <Crown size={12} /> {item.isPro ? 'Gói Pro' : 'Miễn phí'}
                            </button>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                title="Xem thử"
                                onClick={() => setPreviewRecipe(item)}
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
                              >
                                <Eye size={16} />
                              </button>

                              <button
                                type="button"
                                title="Nhân bản"
                                onClick={() => handleDuplicateRecipe(item)}
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
                              >
                                <Copy size={16} />
                              </button>

                              <button
                                type="button"
                                title="Chỉnh sửa"
                                onClick={() => handleOpenEditModal(item)}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                              >
                                <Edit size={16} />
                              </button>

                              <button
                                type="button"
                                title="Xóa món"
                                onClick={() => handleDeleteRecipe(item.id, item.name)}
                                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                          Chưa tìm thấy công thức nào phù hợp với bộ lọc.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 7-DAY MEAL PLANS TEMPLATES */}
        {activeTab === 'plans' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 p-5 sm:p-6 text-white shadow-lg">
              <div>
                <h3 className="text-lg sm:text-xl font-black">Thiết Lập Kế Hoạch 7 Ngày Cho Học Viên</h3>
                <p className="mt-1 text-xs opacity-90 max-w-xl">
                  Tùy biến khung thực đơn tuần theo từng mục tiêu calo để giúp học viên dễ dàng theo đuổi thói quen ăn uống khoa học.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsAiPlanModalOpen(true)}
                  className="rounded-xl bg-purple-900/90 hover:bg-purple-900 px-4 py-2.5 text-xs font-extrabold text-white shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles size={16} className="text-amber-300 animate-pulse" /> Gợi Ý Khung Thực Đơn AI
                </button>
                <button
                  type="button"
                  onClick={() => showToast('Tính năng tạo mẫu 7 ngày mới đang mở!')}
                  className="rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-rose-600 shadow-md hover:bg-slate-50 transition-all cursor-pointer"
                >
                  + Tạo Mẫu Thực Đơn Mới
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                {
                  title: 'Thực đơn Giảm Mỡ 1.600 kcal / ngày',
                  goal: 'Giảm Mỡ Chuẩn Siết Body',
                  protein: '115g/ngày',
                  daysCount: 7,
                  assignedStudents: 340,
                  popularRecipe: 'Ức gà sốt bơ tỏi'
                },
                {
                  title: 'Thực đơn Tăng Cơ 2.200 kcal / ngày',
                  goal: 'Tăng Cơ Săn Chắc Sợi Cơ',
                  protein: '145g/ngày',
                  daysCount: 7,
                  assignedStudents: 215,
                  popularRecipe: 'Thịt bò xào ớt chuông'
                },
                {
                  title: 'Thực đơn Eat Clean Dễ Nấu 1.800 kcal',
                  goal: 'Duy Trì Vóc Dáng & Khỏe Đẹp',
                  protein: '100g/ngày',
                  daysCount: 7,
                  assignedStudents: 510,
                  popularRecipe: 'Salad cá hồi hun khói'
                },
                {
                  title: 'Thực đơn High Protein Bận Rộn 1.500 kcal',
                  goal: 'Giảm Mỡ Nhanh Cho Dân Văn Phòng',
                  protein: '120g/ngày',
                  daysCount: 7,
                  assignedStudents: 180,
                  popularRecipe: 'Smoothie Protein Dâu'
                }
              ].map((plan, index) => (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-pink-300 transition-all">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                    <span className="rounded-full bg-pink-100 text-[#ff3f7d] px-3 py-1 text-xs font-extrabold">
                      {plan.goal}
                    </span>
                    <span className="text-xs font-bold text-slate-400">{plan.assignedStudents} học viên đang dùng</span>
                  </div>

                  <h4 className="text-base font-extrabold text-slate-900">{plan.title}</h4>
                  
                  <div className="grid grid-cols-2 gap-2 mt-4 text-xs font-bold text-slate-600 bg-slate-50 p-3 rounded-xl">
                    <div>Lượng Đạm: <span className="text-emerald-600 font-extrabold">{plan.protein}</span></div>
                    <div>Số ngày: <span className="text-slate-900 font-extrabold">{plan.daysCount} ngày</span></div>
                    <div className="col-span-2">Món nổi bật: <span className="text-[#ff3f7d]">{plan.popularRecipe}</span></div>
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => showToast(`Đã sao chép liên kết mẫu ${plan.title}`)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      Sao chép mẫu
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlanToEdit(plan)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-xs font-extrabold text-white shadow-sm hover:opacity-95 cursor-pointer"
                    >
                      Chỉnh sửa khung 7 ngày
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: ANALYTICS & HOT RECIPES */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* TOP LOGGED DISHES */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="text-base font-extrabold text-slate-900 mb-4 flex items-center gap-2">
                  <TrendingUp size={18} className="text-[#ff3f7d]" /> Top 5 Món Được Học Viên Lưu & Ghi Nhiều Nhất
                </h3>
                <div className="space-y-3">
                  {recipes.slice(0, 5).map((r, i) => (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff3f7d] text-xs font-black text-white shrink-0">
                          {i + 1}
                        </span>
                        <div>
                          <div className="font-extrabold text-slate-900 text-xs">{r.name}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{r.kcal} kcal • {r.protein}g đạm</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-extrabold text-emerald-600">{r.logsCount} lượt ghi</span>
                        <small className="block text-[10px] text-slate-400">{r.savedCount} lưu</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* MACRO DISTRIBUTION SUMMARY */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="text-base font-extrabold text-slate-900 mb-4 flex items-center gap-2">
                  <Sparkles size={18} className="text-[#8b5cf6]" /> Phân Bổ Macro Trung Bình Của Thư Viện
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-emerald-600">Đạm (Protein)</span>
                      <span>35% (~120g/ngày)</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: '35%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-amber-600">Tinh bột (Carbs)</span>
                      <span>42% (~160g/ngày)</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: '42%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-purple-600">Chất béo (Fat)</span>
                      <span>23% (~45g/ngày)</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: '23%' }} />
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-pink-100 bg-pink-50/50 p-3 text-xs font-medium text-pink-900">
                    💡 Khẩu phần đạm được duy trì ở mức cao (&gt;30%) giúp tối ưu hóa việc duy trì khối cơ trong quá trình thâm hụt calo giảm mỡ của học viên.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: CREATE / EDIT RECIPE */}
        {isRecipeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
            <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto my-auto rounded-3xl bg-white p-4 sm:p-6 shadow-2xl text-slate-900 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <h3 className="text-base sm:text-lg font-black flex items-center gap-2">
                  <ChefHat size={20} className="text-[#ff3f7d]" />
                  {editingRecipe ? 'Chỉnh Sửa Công Thức Món Ăn' : 'Thêm Công Thức Món Ăn Mới'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsRecipeModalOpen(false)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveRecipe} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">Tên món ăn (*)</label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ví dụ: Ức gà áp chảo sốt bơ tỏi"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-[#ff3f7d]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Bữa ăn</label>
                    <select
                      value={formData.meal || 'lunch'}
                      onChange={(e) => setFormData({ ...formData, meal: e.target.value as any })}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none"
                    >
                      <option value="breakfast">Bữa sáng</option>
                      <option value="lunch">Bữa trưa</option>
                      <option value="dinner">Bữa tối</option>
                      <option value="snack">Bữa phụ</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Mục tiêu</label>
                    <select
                      value={formData.goal || 'fat-loss'}
                      onChange={(e) => setFormData({ ...formData, goal: e.target.value as any })}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none"
                    >
                      <option value="fat-loss">Giảm mỡ</option>
                      <option value="muscle-gain">Tăng cơ</option>
                      <option value="maintenance">Giữ dáng</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Nhãn Chế độ</label>
                    <input
                      type="text"
                      value={formData.diet || ''}
                      onChange={(e) => setFormData({ ...formData, diet: e.target.value })}
                      placeholder="Giàu đạm, Ít carb..."
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                    />
                  </div>
                </div>

                {/* MACROS & TIME */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-600 mb-1">Năng lượng (kcal)</label>
                    <input
                      type="number"
                      value={formData.kcal || 0}
                      onChange={(e) => setFormData({ ...formData, kcal: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-[#ff3f7d]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-600 mb-1">Đạm (Protein g)</label>
                    <input
                      type="number"
                      value={formData.protein || 0}
                      onChange={(e) => setFormData({ ...formData, protein: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-600 mb-1">Tinh bột (Carb g)</label>
                    <input
                      type="number"
                      value={formData.carbs || 0}
                      onChange={(e) => setFormData({ ...formData, carbs: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-amber-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-600 mb-1">Chất béo (Fat g)</label>
                    <input
                      type="number"
                      value={formData.fat || 0}
                      onChange={(e) => setFormData({ ...formData, fat: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-purple-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-600 mb-1">Thời gian (phút)</label>
                    <input
                      type="number"
                      value={formData.minutes || 15}
                      onChange={(e) => setFormData({ ...formData, minutes: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-800"
                    />
                  </div>
                </div>

                {/* IMAGE UPLOAD & BADGE */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-extrabold text-slate-700">Hình ảnh món ăn (*)</label>
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setImageUploadMode('file')}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                          imageUploadMode === 'file' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Tải từ máy tính
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageUploadMode('url')}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                          imageUploadMode === 'url' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Chèn URL Link
                      </button>
                    </div>
                  </div>

                  {imageUploadMode === 'file' ? (
                    <div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleImageFileUpload}
                        className="hidden"
                      />
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-200 hover:border-pink-400 bg-slate-50 hover:bg-pink-50/30 p-4 rounded-2xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5"
                      >
                        <Upload size={22} className="text-[#ff3f7d]" />
                        <span className="text-xs font-extrabold text-slate-800">Bấm để chọn tệp ảnh từ máy tính của bạn</span>
                        <span className="text-[10px] text-slate-400">Định dạng PNG, JPG, WebP (Tối đa 5MB)</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        value={formData.image || ''}
                        onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold outline-none focus:border-[#ff3f7d]"
                      />
                    </div>
                  )}

                  {/* PREVIEW IMAGE THUMBNAIL WITH STRICT BOUNDS */}
                  {formData.image && (
                    <div className="relative w-full max-h-36 h-32 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center">
                      <img
                        src={formData.image}
                        alt="Preview"
                        className="w-full h-full object-cover max-h-36"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, image: '' })}
                        className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                        title="Xóa / Chọn lại"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Huy Hiệu (Badge)</label>
                    <input
                      type="text"
                      value={formData.badge || ''}
                      onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                      placeholder="Ví dụ: Hot Giảm Mỡ, Siêu Đạm, Easy Cook..."
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold outline-none"
                    />
                  </div>
                </div>

                {/* PRO CHECKBOX */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="isProCheck"
                    checked={Boolean(formData.isPro)}
                    onChange={(e) => setFormData({ ...formData, isPro: e.target.checked })}
                    className="h-4 w-4 rounded text-[#ff3f7d] accent-[#ff3f7d] cursor-pointer"
                  />
                  <label htmlFor="isProCheck" className="text-xs font-extrabold text-slate-800 cursor-pointer flex items-center gap-1">
                    <Crown size={14} className="text-amber-500" /> Giới hạn công thức chỉ dành riêng cho hội viên gói Pro
                  </label>
                </div>

                {/* DESCRIPTION */}
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">Mô tả món ăn</label>
                  <textarea
                    rows={2}
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Mô tả công dụng, hương vị hoặc lưu ý chế biến..."
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs font-medium outline-none"
                  />
                </div>

                {/* ACTIONS */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsRecipeModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-xs font-extrabold text-white shadow-md hover:opacity-95 cursor-pointer"
                  >
                    Lưu Công Thức
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: PREVIEW RECIPE */}
        {previewRecipe && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto" onClick={() => setPreviewRecipe(null)}>
            <div className="w-full max-w-md max-h-[85vh] overflow-y-auto my-auto rounded-3xl bg-white p-5 sm:p-6 shadow-2xl text-slate-900" onClick={(e) => e.stopPropagation()}>
              <div className="recipe-modal-image-wrapper -mx-5 -mt-5 sm:-mx-6 sm:-mt-6 mb-4">
                <img
                  src={previewRecipe.image}
                  alt={previewRecipe.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPreviewRecipe(null)}
                  className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <h3 className="text-lg font-black text-slate-900 break-words">{previewRecipe.name}</h3>
              <p className="mt-1 text-xs text-slate-500 break-words font-medium">{previewRecipe.description}</p>

              <div className="grid grid-cols-4 gap-2 text-center rounded-xl bg-slate-50 p-3 my-4 border border-slate-100">
                <div>
                  <small className="block text-[10px] text-slate-400 font-bold">KCAL</small>
                  <strong className="text-xs font-extrabold text-[#ff3f7d]">{previewRecipe.kcal}</strong>
                </div>
                <div>
                  <small className="block text-[10px] text-slate-400 font-bold">ĐẠM</small>
                  <strong className="text-xs font-extrabold text-emerald-600">{previewRecipe.protein}g</strong>
                </div>
                <div>
                  <small className="block text-[10px] text-slate-400 font-bold">CARB</small>
                  <strong className="text-xs font-extrabold text-amber-600">{previewRecipe.carbs}g</strong>
                </div>
                <div>
                  <small className="block text-[10px] text-slate-400 font-bold">BÉO</small>
                  <strong className="text-xs font-extrabold text-purple-600">{previewRecipe.fat}g</strong>
                </div>
              </div>

              {previewRecipe.ingredients && previewRecipe.ingredients.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-extrabold text-slate-800 mb-1.5">Nguyên liệu chế biến:</h4>
                  <ul className="space-y-1 text-xs text-slate-600 pl-4 list-disc break-words">
                    {previewRecipe.ingredients.map((ing, idx) => (
                      <li key={idx} className="break-words">
                        <span className="font-semibold text-slate-800">{ing.name}</span>
                        {ing.amount && <span className="text-slate-400 font-normal"> - {ing.amount}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {previewRecipe.instructions && previewRecipe.instructions.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-extrabold text-slate-800 mb-1.5">Hướng dẫn thực hiện:</h4>
                  <ol className="space-y-1.5 text-xs text-slate-600 pl-4 list-decimal break-words">
                    {previewRecipe.instructions.map((step, idx) => (
                      <li key={idx} className="break-words leading-relaxed">{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={() => setPreviewRecipe(null)}
                className="w-full py-2.5 rounded-xl bg-slate-900 text-xs font-extrabold text-white hover:bg-slate-800 cursor-pointer"
              >
                Đóng xem thử
              </button>
            </div>
          </div>
        )}

        {/* MODAL: EDIT 7-DAY MEAL PLAN TEMPLATE */}
        {selectedPlanToEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto" onClick={() => setSelectedPlanToEdit(null)}>
            <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto my-auto rounded-3xl bg-white p-4 sm:p-6 shadow-2xl text-slate-900 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div>
                  <div className="text-[10px] sm:text-xs font-extrabold uppercase text-[#ff3f7d] tracking-wider">TÙY CHỈNH KHUNG 7 NGÀY</div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900">{selectedPlanToEdit.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlanToEdit(null)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Goal summary info */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-pink-50/60 border border-pink-100 mb-4 text-xs">
                <div>
                  <span className="text-slate-500 font-bold">Mục tiêu: </span>
                  <span className="font-extrabold text-[#ff3f7d]">{selectedPlanToEdit.goal}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold">Chỉ tiêu đạm: </span>
                  <span className="font-extrabold text-emerald-600">{selectedPlanToEdit.protein}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold">Học viên áp dụng: </span>
                  <span className="font-extrabold text-slate-900">{selectedPlanToEdit.assignedStudents} học viên</span>
                </div>
              </div>

              {/* Day selection tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
                {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'].map((dayName, idx) => (
                  <button
                    key={dayName}
                    type="button"
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold shrink-0 cursor-pointer ${
                      idx === 0
                        ? 'bg-[#ff3f7d] text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {dayName}
                  </button>
                ))}
              </div>

              {/* Meals list for selected day */}
              <div className="space-y-3 mb-6">
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">BỮA SÁNG (~450 kcal)</span>
                    <div className="font-black text-slate-900 text-sm mt-0.5">Yến mạch ngũ cốc trái cây tươi</div>
                    <div className="text-[11px] text-emerald-600 font-bold mt-0.5">28g Đạm • 45g Carb • 8g Béo</div>
                  </div>
                  <button type="button" onClick={() => showToast('Đổi món cho Bữa sáng')} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                    Đổi món
                  </button>
                </div>

                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">BỮA TRƯA (~650 kcal)</span>
                    <div className="font-black text-slate-900 text-sm mt-0.5">Ức gà sốt bơ tỏi & cơm lứt măng tây</div>
                    <div className="text-[11px] text-emerald-600 font-bold mt-0.5">42g Đạm • 55g Carb • 14g Béo</div>
                  </div>
                  <button type="button" onClick={() => showToast('Đổi món cho Bữa trưa')} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                    Đổi món
                  </button>
                </div>

                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">BỮA PHỤ (~250 kcal)</span>
                    <div className="font-black text-slate-900 text-sm mt-0.5">Smoothie Protein Dâu Tây</div>
                    <div className="text-[11px] text-emerald-600 font-bold mt-0.5">25g Đạm • 20g Carb • 3g Béo</div>
                  </div>
                  <button type="button" onClick={() => showToast('Đổi món cho Bữa phụ')} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                    Đổi món
                  </button>
                </div>

                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">BỮA TỐI (~500 kcal)</span>
                    <div className="font-black text-slate-900 text-sm mt-0.5">Salad Cá Hồi Áp Chảo Măng Tây</div>
                    <div className="text-[11px] text-emerald-600 font-bold mt-0.5">38g Đạm • 15g Carb • 22g Béo</div>
                  </div>
                  <button type="button" onClick={() => showToast('Đổi món cho Bữa tối')} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
                    Đổi món
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedPlanToEdit(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => {
                    showToast(`Đã lưu cấu hình khung 7 ngày: ${selectedPlanToEdit.title}`)
                    setSelectedPlanToEdit(null)
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ff3f7d] to-[#ff7e40] text-xs font-extrabold text-white shadow-md hover:opacity-95 cursor-pointer"
                >
                  Lưu Khung Thực Đơn
                </button>
              </div>
            </div>
          </div>
        )}
        {/* MODAL: AI RECIPE GENERATOR */}
        {isAiRecipeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto" onClick={() => !isGeneratingAiRecipe && setIsAiRecipeModalOpen(false)}>
            <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto my-auto rounded-3xl bg-white p-5 sm:p-6 shadow-2xl text-slate-900 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-pink-500 text-white shadow-md">
                    <Bot size={22} />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-900">AI Chef & Dinh Dưỡng Cao Cấp</h3>
                    <p className="text-xs text-slate-500 font-medium">Tạo tự động công thức món ăn chuẩn Macros với Gemini AI</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isGeneratingAiRecipe}
                  onClick={() => setIsAiRecipeModalOpen(false)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Ý tưởng món ăn hoặc nguyên liệu có sẵn (*):
                  </label>
                  <textarea
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ví dụ: Bữa trưa thâm hụt calo với ức gà, quả bơ và hạt điều..."
                    className="w-full rounded-2xl border border-slate-200 p-3 text-xs font-medium outline-none focus:border-purple-500"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[10px] text-slate-400 font-bold">Gợi ý nhanh:</span>
                    {[
                      'Salad cá hồi quả bơ',
                      'Bánh pancake đạm yến mạch',
                      'Thịt bò xào bắp bao tử ít calo',
                      'Bát poke tôm áp chảo'
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => setAiPrompt(sample)}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-purple-100 hover:text-purple-700 transition-colors cursor-pointer"
                      >
                        + {sample}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Mục tiêu thể hình</label>
                    <select
                      value={aiGoal}
                      onChange={(e) => setAiGoal(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none"
                    >
                      <option value="fat-loss">Giảm mỡ thâm hụt calo</option>
                      <option value="muscle-gain">Tăng cơ nạc đạm cao</option>
                      <option value="maintenance">Giữ dáng Eat Clean</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Loại bữa ăn</label>
                    <select
                      value={aiMealType}
                      onChange={(e) => setAiMealType(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none"
                    >
                      <option value="breakfast">Bữa sáng</option>
                      <option value="lunch">Bữa trưa</option>
                      <option value="dinner">Bữa tối</option>
                      <option value="snack">Bữa phụ</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-3.5 text-xs text-purple-900 font-medium">
                  ✨ AI sẽ tự động phân tích tính toán chuẩn chỉ Calo, Protein, Carb, Fat, lên danh sách nguyên liệu và các bước chế biến chi tiết!
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={isGeneratingAiRecipe}
                    onClick={() => setIsAiRecipeModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    disabled={isGeneratingAiRecipe}
                    onClick={handleGenerateAiRecipe}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 text-xs font-extrabold text-white shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingAiRecipe ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Đang thiết kế công thức AI...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} /> Sáng Tạo Món Ăn Bằng AI
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: AI MEAL PLAN SUGGESTION */}
        {isAiPlanModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto" onClick={() => !isGeneratingAiPlan && setIsAiPlanModalOpen(false)}>
            <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto my-auto rounded-3xl bg-white p-5 sm:p-6 shadow-2xl text-slate-900 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-amber-500 text-white shadow-md">
                    <Lightbulb size={22} />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-900">Gợi Ý Khung Thực Đơn 7 Ngày AI</h3>
                    <p className="text-xs text-slate-500 font-medium">Chiến lược phân bổ thực đơn tuần tối ưu cho học viên Aura Fitness</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isGeneratingAiPlan}
                  onClick={() => setIsAiPlanModalOpen(false)}
                  className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Mục tiêu học viên</label>
                    <input
                      type="text"
                      value={aiPlanGoal}
                      onChange={(e) => setAiPlanGoal(e.target.value)}
                      placeholder="Giảm mỡ thâm hụt..."
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Calo mục tiêu (kcal/ngày)</label>
                    <input
                      type="number"
                      value={aiPlanCalories}
                      onChange={(e) => setAiPlanCalories(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-[#ff3f7d] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">Đạm mục tiêu (g/ngày)</label>
                    <input
                      type="number"
                      value={aiPlanProtein}
                      onChange={(e) => setAiPlanProtein(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-emerald-600 outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isGeneratingAiPlan}
                    onClick={handleGenerateAiPlan}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 text-xs font-extrabold text-white shadow-md hover:opacity-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingAiPlan ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> AI đang tính toán thực đơn tuần...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} /> Tạo Đề Xuất Thực Đơn AI
                      </>
                    )}
                  </button>
                </div>

                {/* AI RESULT DISPLAY */}
                {aiPlanResult && (
                  <div className="mt-4 space-y-4 rounded-2xl border border-pink-200 bg-pink-50/40 p-4 text-xs animate-in fade-in duration-300">
                    <div>
                      <h4 className="text-sm font-black text-slate-900">{aiPlanResult.title || 'Khung Thực Đơn AI Đề Xuất'}</h4>
                      <p className="text-slate-600 mt-1 font-medium">{aiPlanResult.summary}</p>
                    </div>

                    {aiPlanResult.recommendations && (
                      <div>
                        <strong className="block text-xs font-extrabold text-[#ff3f7d] mb-1.5">💡 Khuyên dùng chiến lược cho PT:</strong>
                        <ul className="space-y-1 pl-4 list-disc text-slate-700 font-medium">
                          {aiPlanResult.recommendations.map((rec, idx) => (
                            <li key={idx}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiPlanResult.sampleDays && (
                      <div className="space-y-2 pt-2 border-t border-pink-100">
                        <strong className="block text-xs font-extrabold text-slate-800">Cấu trúc thực đơn mẫu theo ngày:</strong>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {aiPlanResult.sampleDays.map((day, dIdx) => (
                            <div key={dIdx} className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-black text-xs text-[#ff3f7d]">{day.dayName}</span>
                                <span className="text-[10px] font-bold text-slate-500">{day.totalKcal} kcal • {day.totalProtein}g đạm</span>
                              </div>
                              <div className="text-[11px] text-slate-700 font-medium space-y-0.5">
                                <div>• <strong>Sáng:</strong> {day.breakfast}</div>
                                <div>• <strong>Trưa:</strong> {day.lunch}</div>
                                <div>• <strong>Phụ:</strong> {day.snack}</div>
                                <div>• <strong>Tối:</strong> {day.dinner}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => setIsAiPlanModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
