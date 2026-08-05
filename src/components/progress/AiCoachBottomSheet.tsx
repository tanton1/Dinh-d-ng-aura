import React, { useState } from 'react'
import { Bot, Send, Sparkles, X } from 'lucide-react'

interface AiCoachBottomSheetProps {
  onClose: () => void
}

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
}

export function AiCoachBottomSheet({ onClose }: AiCoachBottomSheetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      text: 'Xin chào! Tôi là AI Coach của Aura. Bạn muốn hỏi gì về tiến độ sức khỏe và vóc dáng hôm nay?',
    },
  ])
  const [inputVal, setInputVal] = useState('')

  const chips = [
    '• Vì sao cân chưa thay đổi?',
    '• Tôi cần ăn bao nhiêu hôm nay?',
    '• Tuần này tập luyện có hiệu quả không?',
    '• Phân tích dữ liệu 7 ngày qua',
  ]

  const handleSend = (textToSend?: string) => {
    const text = textToSend || inputVal
    if (!text.trim()) return

    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInputVal('')

    // Generate AI response based on topic
    setTimeout(() => {
      let aiText = 'Dựa trên dữ liệu 7 ngày qua: '
      if (text.includes('Vì sao cân chưa thay đổi') || text.includes('cân')) {
        aiText += 'Cân nặng của bạn đang dao động trong khoảng 0.2-0.3kg. Đây là hiện tượng bình thường do lượng nước và glycogen tích trữ sau các buổi tập strength. Xu hướng 30 ngày vẫn đang đi đúng tiến độ!'
      } else if (text.includes('ăn bao nhiêu')) {
        aiText += 'Mục tiêu khuyến nghị hôm nay là 2.200 kcal với 105g Protein, 240g Carb và 65g Fat. Hãy ưu tiên bổ sung protein từ ức gà, cá ngừ hoặc lòng trắng trứng!'
      } else if (text.includes('tập luyện')) {
        aiText += 'Bạn đã hoàn thành 3 buổi tập chất lượng trong tuần này. Chỉ số Impact đạt 82/100, độ phục hồi cơ bắp rất tốt. Tiếp tục duy trì buổi tập tiếp theo nhé!'
      } else {
        aiText += 'Bạn đang duy trì thói quen rất tốt với chuỗi 5 ngày liên tiếp. Điểm tiến độ đạt 82/100, tăng 8 điểm so với tuần trước. Ưu tiên tuần tới là ghi nhận cân nặng 2 lần vào buổi sáng!'
      }

      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', text: aiText }])
    }, 600)
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
            placeholder="Hỏi AI Coach về tiến độ..."
            value={inputVal}
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
            }}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              border: 'none',
              background: 'linear-gradient(110deg, #f72567 0%, #ff7a38 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
