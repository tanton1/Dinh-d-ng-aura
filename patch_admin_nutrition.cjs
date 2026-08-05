const fs = require('fs');

const code = `import { useEffect, useState } from 'react'
import { Check, Clock, AlertCircle, LoaderCircle, ArrowLeft, Inbox, Sparkles, Send, MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { subscribeToAllMealReviews, updateMealReview } from '../../services/firebaseService'
import { generateMealReview } from '../../services/nutritionService'
import type { ViewId } from '../../types'

function formatTimeAgo(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  if (seconds < 60) return 'Vừa xong'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return \\\`\\\${minutes} phút trước\\\`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return \\\`\\\${hours} giờ trước\\\`
  const days = Math.floor(hours / 24)
  if (days < 7) return \\\`\\\${days} ngày trước\\\`
  
  const timeString = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return \\\`\\\${timeString} - Hôm nay\\\`
}

function getInitials(name: string) {
  if (!name) return '?'
  const parts = name.split(' ')
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

interface AdminNutritionReviewsPageProps {
  onNavigate: (view: ViewId) => void
}

export default function AdminNutritionReviewsPage({ onNavigate }: AdminNutritionReviewsPageProps) {
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReview, setSelectedReview] = useState<any | null>(null)
  const [feedbackInput, setFeedbackInput] = useState('')
  const [isGeneratingAI, setIsGeneratingAI] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Responsive layout state
  const [isMobileListHidden, setIsMobileListHidden] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeToAllMealReviews(
      (data) => {
        setReviews(data)
        setLoading(false)
      },
      () => {
        setLoading(false)
      }
    )
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (selectedReview) {
      const updated = reviews.find(r => r.id === selectedReview.id)
      if (updated) {
        setSelectedReview(updated)
      }
    }
  }, [reviews])

  const pendingCount = reviews.filter(r => r.status === 'pending').length

  const handleSelect = (review: any) => {
    setSelectedReview(review)
    setFeedbackInput(review.coachFeedback || '')
    setIsMobileListHidden(true)
  }

  const handleBackToList = () => {
    setIsMobileListHidden(false)
    setTimeout(() => setSelectedReview(null), 300) // Clear after animation
  }

  const handleGenerateAIFeedback = async () => {
    if (!selectedReview) return
    setIsGeneratingAI(true)
    try {
      const generated = await generateMealReview(selectedReview.meal, selectedReview.userProfile)
      setFeedbackInput(generated)
    } catch (e) {
      console.error('Failed to generate AI feedback', e)
    } finally {
      setIsGeneratingAI(false)
    }
  }

  const handleSendFeedback = async () => {
    if (!selectedReview || !feedbackInput.trim()) return
    setIsSubmitting(true)
    try {
      await updateMealReview(selectedReview.id, {
        status: 'reviewed',
        coachFeedback: feedbackInput
      })
      handleBackToList()
    } catch (e) {
      console.error(e)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const getItemsList = (review: any) => {
    if (review.analysis?.items && review.analysis.items.length > 0) return review.analysis.items
    if (review.meal?.items && review.meal.items.length > 0) return review.meal.items
    return []
  }

  return (
    <div className="page admin-page flex flex-col h-full bg-[#FAFAFA] min-h-screen">
      <div className="flex-1 flex flex-col md:flex-row relative w-full h-full mx-auto md:max-w-5xl md:py-6">
        
        {/* INBOX LIST PANEL */}
        <div className={\`w-full md:w-[420px] flex-shrink-0 flex-col md:rounded-3xl md:border md:border-slate-200 bg-[#FAFAFA] md:bg-white md:shadow-sm \${isMobileListHidden ? 'hidden md:flex' : 'flex'}\`}>
          {/* Mobile Header */}
          <div className="px-6 py-6 bg-[#FAFAFA] md:bg-white md:rounded-t-3xl">
            <h1 className="text-[28px] font-bold text-slate-900 tracking-tight leading-none mb-2">Duyệt Bữa Ăn</h1>
            <p className="text-[15px] text-slate-500 font-medium">Kiểm tra, phân tích và gửi phản hồi cho học viên.</p>
          </div>
          
          <div className="px-4 md:px-6 pb-24 md:pb-6 overflow-y-auto">
             {/* Pending Section Header */}
             <div className="bg-white rounded-3xl border border-slate-100 p-1">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-50">
                  <AlertCircle size={20} className="text-amber-500" strokeWidth={2.5} />
                  <span className="text-base font-bold text-slate-900">Chờ duyệt ({pendingCount})</span>
                </div>

                {/* List */}
                <div className="flex-1 flex flex-col">
                  {loading ? (
                    <div className="p-8 text-center text-slate-400 flex justify-center">
                       <LoaderCircle className="animate-spin opacity-50" size={24} />
                    </div>
                  ) : reviews.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-slate-400 h-40">
                      <Inbox size={32} className="mb-3 opacity-30" />
                      <p className="text-sm font-medium">Không có bữa ăn chờ duyệt</p>
                    </div>
                  ) : (
                    reviews.map((r, idx) => {
                      const isSelected = selectedReview?.id === r.id
                      const date = r.createdAt?.toDate?.() || new Date()
                      const isLast = idx === reviews.length - 1
                      
                      return (
                        <div 
                          key={r.id} 
                          onClick={() => handleSelect(r)} 
                          className={\`p-4 cursor-pointer transition-colors flex gap-4 items-center \${
                            isSelected ? 'bg-rose-50/30' : 'bg-white hover:bg-slate-50'
                          } \${!isLast ? 'border-b border-slate-50' : ''}\`}
                        >
                          <div className="w-[72px] h-[72px] rounded-2xl bg-slate-100 shrink-0 overflow-hidden relative border border-slate-100">
                             {r.meal.image ? (
                               <img src={r.meal.image} className="w-full h-full object-cover" alt="" />
                             ) : (
                               <div className="w-full h-full flex items-center justify-center text-slate-300">
                                 <Inbox size={20} />
                               </div>
                             )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <h3 className="text-[17px] font-bold text-slate-900 truncate mb-1">
                              {r.userName}
                            </h3>
                            <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
                              <Clock size={12} strokeWidth={2.5} />
                              {formatTimeAgo(date)}
                            </div>
                          </div>
                          
                          <div className="shrink-0">
                             <span className="px-3.5 py-2 rounded-xl text-[13px] font-bold bg-[#FFF1F3] text-[#F43F5E]">
                               Xem & Duyệt
                             </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
             </div>
          </div>
        </div>

        {/* DETAIL PANEL */}
        <AnimatePresence mode="wait">
          {(selectedReview || !isMobileListHidden) && (
            <motion.div 
              key={selectedReview ? 'detail' : 'empty'}
              initial={isMobileListHidden ? { x: '100%', opacity: 0 } : false}
              animate={{ x: 0, opacity: 1 }}
              exit={isMobileListHidden ? { x: '100%', opacity: 0 } : undefined}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={\`flex-1 bg-[#FAFAFA] flex-col \${selectedReview && isMobileListHidden ? 'flex absolute inset-0 z-20 md:static' : 'hidden md:flex'} md:ml-6 md:rounded-3xl md:border md:border-slate-200 md:bg-white md:shadow-sm overflow-hidden\`}
            >
              {selectedReview ? (
                <>
                  {/* Detail Header */}
                  <div className="h-16 flex items-center px-4 bg-white md:bg-transparent shrink-0 sticky top-0 z-30">
                    <button 
                      onClick={handleBackToList}
                      className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors mr-2 border border-slate-200"
                    >
                      <ArrowLeft size={18} strokeWidth={2.5} />
                    </button>
                    <div>
                      <h2 className="text-[17px] font-bold text-slate-900 leading-tight">
                        Duyệt bữa ăn: {selectedReview.userName}
                      </h2>
                      <p className="text-[13px] font-medium text-slate-500 mt-0.5">
                        {formatTimeAgo(selectedReview.createdAt?.toDate?.() || new Date())}
                      </p>
                    </div>
                  </div>
                  
                  {/* Detail Scrollable Content */}
                  <div className="flex-1 overflow-y-auto pb-32">
                    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
                      
                      {/* Hero Image Container matching screenshot */}
                      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-3 md:p-4">
                        {selectedReview.meal.image ? (
                          <div className="w-full h-64 md:h-80 rounded-2xl overflow-hidden relative">
                            <img 
                               src={selectedReview.meal.image} 
                               alt="Bữa ăn" 
                               className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                           <div className="w-full h-40 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                             Chưa có hình ảnh
                           </div>
                        )}
                      </div>

                      {/* Ingredients & Macros Bento */}
                      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
                        <div className="flex items-center gap-2 mb-5">
                          <Sparkles size={18} className="text-indigo-500" strokeWidth={2.5} />
                          <h4 className="text-[17px] font-bold text-slate-900">Kết quả phân tích (Có thể chỉnh sửa)</h4>
                        </div>
                        
                        {/* Ingredients List */}
                        {getItemsList(selectedReview).length > 0 && (
                          <div className="space-y-3 mb-6">
                            {getItemsList(selectedReview).map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center px-4 py-3.5 bg-[#FAFAFA] rounded-xl border border-slate-100">
                                <div className="text-[15px] font-semibold text-slate-900">
                                  {item.nameVi || item.name || 'Nguyên liệu'} 
                                  <span className="text-slate-400 font-medium ml-1.5">
                                    ({item.estimatedGrams || item.amount || 0}g)
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-[14px] font-bold">
                                  <span className="text-slate-600">{Math.round(item.nutrition?.calories || item.calories || 0)} kcal</span>
                                  <span className="text-emerald-600">{Math.round((item.nutrition?.proteinG || item.protein || 0)*10)/10}g P</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Total Macros Blocks */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-[#F5F3FF] rounded-2xl p-5 border border-indigo-50 flex flex-col items-center justify-center py-6">
                            <span className="text-[12px] font-bold text-indigo-900/60 uppercase tracking-wide mb-1">
                              TỔNG KCAL
                            </span>
                            <strong className="text-[28px] font-black text-slate-900">{Math.round(selectedReview.meal.calories)}</strong>
                          </div>
                          
                          <div className="bg-[#ECFDF5] rounded-2xl p-5 border border-emerald-50 flex flex-col items-center justify-center py-6">
                            <span className="text-[12px] font-bold text-emerald-900/60 uppercase tracking-wide mb-1">
                              TỔNG PROTEIN (G)
                            </span>
                            <strong className="text-[28px] font-black text-slate-900">{Math.round(selectedReview.meal.protein)}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Coach Feedback Box */}
                      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col p-5">
                        <div className="flex items-center gap-2 mb-4">
                          <MessageSquare size={18} className="text-rose-500" strokeWidth={2.5} />
                          <h4 className="text-[17px] font-bold text-slate-900">
                            Nhận xét cho học viên
                          </h4>
                        </div>

                        {/* AI Analysis (Context for Coach) */}
                        {selectedReview.aiAnalysis && (
                          <div className="bg-[#EFF6FF] rounded-2xl p-4 mb-4">
                            <h4 className="flex items-center gap-1.5 text-[12px] font-bold text-blue-700 uppercase tracking-wide mb-2">
                              <Sparkles size={14} />
                              AI PHÂN TÍCH (DỰA THEO MỤC TIÊU)
                            </h4>
                            <p className="text-[15px] leading-relaxed text-blue-900 font-medium whitespace-pre-wrap">
                              {selectedReview.aiAnalysis}
                            </p>
                          </div>
                        )}
                        
                        <div className="bg-[#FAFAFA] rounded-2xl border border-slate-100 p-4 relative">
                          <textarea
                            value={feedbackInput}
                            onChange={e => setFeedbackInput(e.target.value)}
                            className="w-full min-h-[140px] p-0 text-[15px] font-medium leading-relaxed text-slate-900 focus:outline-none resize-none placeholder-slate-400 bg-transparent"
                            placeholder="Nhập nhận xét của bạn tại đây..."
                          />
                        </div>
                      </div>
                      
                    </div>
                  </div>

                  {/* Sticky Mobile Action Bar */}
                  <div className="absolute bottom-0 left-0 w-full p-4 bg-white/90 backdrop-blur-lg border-t border-slate-100 z-40">
                    <div className="max-w-2xl mx-auto flex justify-end">
                      <button 
                        type="button" 
                        onClick={handleSendFeedback} 
                        disabled={isSubmitting || !feedbackInput.trim()}
                        className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-[#F43F5E] hover:bg-rose-600 text-white rounded-2xl font-bold text-[16px] transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                      >
                        {isSubmitting ? (
                          <LoaderCircle size={20} className="animate-spin" />
                        ) : (
                          <Send size={20} strokeWidth={2.5} />
                        )} 
                        Gửi Nhận Xét & Phê Duyệt
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center h-full">
                  <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-6 relative overflow-hidden">
                     <Inbox size={36} className="text-slate-300 relative z-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Chưa chọn yêu cầu nào</h3>
                  <p className="text-[15px] font-medium text-slate-500 max-w-sm leading-relaxed">
                    Chọn một yêu cầu bên danh sách hộp thư để xem chi tiết bữa ăn và viết phản hồi cho học viên.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
`
fs.writeFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', code);
