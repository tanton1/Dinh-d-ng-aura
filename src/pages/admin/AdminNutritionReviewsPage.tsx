import { useEffect, useState } from 'react'
import { Check, Clock, Reply, Search, X } from 'lucide-react'
import { subscribeToAllMealReviews, updateMealReview } from '../../services/firebaseService'
import type { ViewId } from '../../types'

function formatTimeAgo(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds} giây trước`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}

interface AdminNutritionReviewsPageProps {
  onNavigate: (view: ViewId) => void
}

export default function AdminNutritionReviewsPage({ onNavigate }: AdminNutritionReviewsPageProps) {
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedReview, setSelectedReview] = useState<any>(null)
  const [feedbackInput, setFeedbackInput] = useState('')

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

  const handleSelect = (r: any) => {
    setSelectedReview(r)
    setFeedbackInput(r.coachFeedback || r.aiAnalysis || '')
  }

  const handleSendFeedback = async () => {
    if (!selectedReview) return
    try {
      await updateMealReview(selectedReview.id, {
        status: 'reviewed',
        coachFeedback: feedbackInput
      })
      setSelectedReview(null)
    } catch (e) {
      console.error(e)
    }
  }

  const pendingCount = reviews.filter(r => r.status === 'pending').length

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div className="admin-page-header-titles">
          <h1>Duyệt ăn (Nutrition Reviews)</h1>
          <p>Nhận xét và gửi phản hồi bữa ăn cho học viên.</p>
        </div>
      </header>

      <div className="admin-reviews-layout" style={{ display: 'flex', gap: '24px', height: 'calc(100vh - 120px)' }}>
        <div className="admin-reviews-list" style={{ flex: '1', overflowY: 'auto', borderRight: '1px solid #e2e8f0', paddingRight: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 800, marginBottom: '16px' }}>Đang chờ ({pendingCount})</h2>
          {loading ? <p>Đang tải...</p> : reviews.length === 0 ? <p>Chưa có yêu cầu duyệt nào.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {reviews.map(r => (
                <div key={r.id} onClick={() => handleSelect(r)} style={{ padding: '16px', borderRadius: '12px', border: '1px solid', borderColor: selectedReview?.id === r.id ? '#0f172a' : '#e2e8f0', background: selectedReview?.id === r.id ? '#f8fafc' : '#fff', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '14px', color: '#0f172a' }}>{r.userName}</strong>
                    <span style={{ fontSize: '12px', color: r.status === 'pending' ? '#d97706' : '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {r.status === 'pending' ? <Clock size={14} /> : <Check size={14} />} {r.status === 'pending' ? 'Chờ duyệt' : 'Đã phản hồi'}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#475569', marginBottom: '8px' }}>{r.meal.title || 'Bữa ăn không tên'} - {r.meal.calories} kcal</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Gửi {formatTimeAgo(r.createdAt?.toDate?.() || new Date())}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-review-detail" style={{ flex: '2', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px', overflowY: 'auto' }}>
          {selectedReview ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Duyệt bữa ăn của {selectedReview.userName}</h2>
                <button type="button" onClick={() => setSelectedReview(null)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={20} color="#64748b" /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Thông tin bữa ăn</h3>
                  <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>{selectedReview.meal.title}</div>
                  <div style={{ fontSize: '14px', color: '#0f172a', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
                    <div><span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Kcal</span><strong>{selectedReview.meal.calories}</strong></div>
                    <div><span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Đạm</span><strong>{selectedReview.meal.protein}g</strong></div>
                    <div><span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Carb</span><strong>{selectedReview.meal.carbs}g</strong></div>
                    <div><span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>Béo</span><strong>{selectedReview.meal.fat}g</strong></div>
                  </div>
                  {selectedReview.meal.image && <img src={selectedReview.meal.image} alt="Bữa ăn" style={{ width: '100%', borderRadius: '8px', objectFit: 'cover', height: '160px' }} />}
                </div>

                <div style={{ padding: '16px', background: '#f0fdfa', borderRadius: '12px', border: '1px solid #ccfbf1' }}>
                  <h3 style={{ fontSize: '13px', color: '#0d9488', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}><Search size={16} /> AI Phân Tích</h3>
                  <p style={{ fontSize: '14px', color: '#134e4a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selectedReview.aiAnalysis || 'Chưa có phân tích từ AI.'}</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>Nhận xét của Coach (gửi tới học viên)</label>
                <textarea
                  value={feedbackInput}
                  onChange={e => setFeedbackInput(e.target.value)}
                  style={{ flex: 1, padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px', lineHeight: 1.5, resize: 'none', fontFamily: 'inherit' }}
                  placeholder="Nhập nhận xét tạo động lực cho học viên..."
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button type="button" onClick={handleSendFeedback} style={{ padding: '12px 24px', background: '#0f172a', color: '#fff', borderRadius: '12px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Reply size={16} /> {selectedReview.status === 'pending' ? 'Gửi phản hồi' : 'Cập nhật phản hồi'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#94a3b8' }}>
              <Check size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <p>Chọn một yêu cầu bên trái để duyệt.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
