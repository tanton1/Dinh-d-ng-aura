import React, { useState } from 'react'
import { Bot, Send, Sparkles, X, Loader2 } from 'lucide-react'
import { askAiCoach } from '../../services/nutritionService'

interface AiCoachBottomSheetProps {
  onClose: () => void
  userProfile?: {
    weightKg?: number
    heightCm?: number
    targetWeightDeltaKg?: number
    targetTimeframeMonths?: number
    age?: number
    biologicalSex?: 'male' | 'female'
    goal?: string
    targetCalories?: number
  }
}

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
}

export function AiCoachBottomSheet({ onClose, userProfile }: AiCoachBottomSheetProps) {
  const currentWeight = userProfile?.weightKg || 65
  const targetWeight = currentWeight + (userProfile?.targetWeightDeltaKg || -4)
  const isLoss = (userProfile?.targetWeightDeltaKg || -4) < 0

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: `Xin chào! Tôi là AI Coach của Aura. Dựa trên hồ sơ của bạn (Cân nặng ${currentWeight}kg, mục tiêu ${isLoss ? 'giảm' : 'tăng'} về ${targetWeight}kg), bạn cần hỗ trợ thông tin gì hôm nay?`,
    },
  ])
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)

  const chips = [
    '• Vì sao cân chưa thay đổi?',
    '• Tôi cần ăn bao nhiêu kcal hôm nay?',
    '• Tuần này tập luyện có hiệu quả không?',
    '• Lời khuyên tối ưu cho vóc dáng tôi',
  ]

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputVal
    if (!text.trim() || loading) return

    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInputVal('')

    setLoading(true)

    try {
      const responseText = await askAiCoach(text, userProfile || {})
      if (responseText && responseText !== 'Không thể kết nối với AI Coach.' && responseText !== 'AI Coach chưa thể trả lời lúc này.') {
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', text: responseText }])
      } else {
        // Dynamic calculated fallback based strictly on user profile
        let fallback = ''
        if (text.includes('Vì sao cân chưa thay đổi') || text.includes('cân')) {
          fallback = `Cân nặng hiện tại ${currentWeight}kg đang dao động bình thường. Với mục tiêu ${targetWeight}kg, việc cân nặng giữ nguyên trong vài ngày thường do tích nước cơ bắp sau tập. Hãy tiếp tục duy trì thói quen nhé!`
        } else if (text.includes('ăn bao nhiêu')) {
          const bmr = Math.round(10 * currentWeight + 6.25 * (userProfile?.heightCm || 168) - 5 * (userProfile?.age || 25) + (userProfile?.biologicalSex === 'male' ? 5 : -161))
          const targetCal = userProfile?.targetCalories || (isLoss ? Math.round(bmr * 1.3 - 350) : Math.round(bmr * 1.35 + 300))
          const protein = Math.round(currentWeight * 1.8)
          fallback = `Dựa trên cân nặng ${currentWeight}kg và chiều cao ${userProfile?.heightCm || 168}cm: Mức calo khuyến nghị cho bạn là khoảng ${targetCal} kcal/ngày, với ${protein}g Protein để duy trì cơ bắp.`
        } else if (text.includes('tập luyện')) {
          fallback = `Hoạt động tập luyện đều đặn rất tốt cho mục tiêu ${currentWeight}kg -> ${targetWeight}kg của bạn. Hãy đảm bảo nghỉ ngơi đầy đủ giữa các buổi tập!`
        } else {
          fallback = `Hồ sơ vóc dáng của bạn (${currentWeight}kg, mục tiêu ${targetWeight}kg) đang đi đúng hướng. Hãy kiên trì ghi nhận dinh dưỡng và tập luyện hàng ngày!`
        }
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', text: fallback }])
      }
    } catch {
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', text: 'Có lỗi xảy ra khi gọi AI Coach. Bạn vui lòng thử lại sau.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pg-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pg-modal-sheet" style={{ maxWidth: 520 }}>
        <div className="pg-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pg-ai-robot-badge" style={{ width: 38, height: 38, borderRadius: 12 }}>
              <Bot size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>AI Health Coach</h2>
              <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>• Trực tuyến sẵn sàng hỗ trợ</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        {/* Prompt Chips */}
        <div className="pg-coach-chips">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleSend(chip)}
              className="pg-coach-chip"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Chat History */}
        <div className="pg-coach-chat-list">
          {messages.map((m) => (
            <div key={m.id} className={`pg-coach-msg ${m.sender}`}>
              {m.text}
            </div>
          ))}
        </div>

        {/* Input box */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            placeholder={loading ? "AI đang suy nghĩ..." : "Hỏi AI Coach về tiến độ..."}
            value={inputVal}
            disabled={loading}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 16,
              border: '1px solid #cbd5e1',
              padding: '0 16px',
              fontSize: 14,
              outline: 'none',
              opacity: loading ? 0.7 : 1,
            }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSend()}
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              border: 'none',
              background: 'linear-gradient(110deg, #ec4899 0%, #fb923c 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              flexShrink: 0,
            }}
          >
            {loading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  )
}
