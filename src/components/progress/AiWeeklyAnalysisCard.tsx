import React from 'react'
import { ArrowRight, Bot, CheckCircle2, Sparkles } from 'lucide-react'

export function AiWeeklyAnalysisCard({ onOpenCoach }: { onOpenCoach: () => void }) {
  const priorities = [
    'Ghi cân 2 lần vào buổi sáng để làm mịn đường xu hướng.',
    'Duy trì protein ít nhất 100g/ngày để hỗ trợ phục hồi cơ.',
    'Hoàn thành thêm 1 buổi tập sức mạnh vào cuối tuần.',
  ]

  return (
    <div className="pg-ai-card">
      <div className="pg-ai-card-inner">
        <div className="pg-ai-robot-badge">
          <Bot size={28} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f72567', fontSize: 13, fontWeight: 800 }}>
            <Sparkles size={16} fill="#f72567" />
            <span>AI Coach Phân Tích Tuần</span>
          </div>

          <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', margin: '4px 0 8px' }}>
            Bạn đang đi đúng hướng!
          </h3>

          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#475569' }}>
            Bạn đã ghi bữa ăn đầy đủ 5/7 ngày và hoàn thành 3 buổi tập. Cân nặng vẫn ổn định, đây chưa phải dấu hiệu không tiến bộ. Lượng năng lượng trung bình đang gần mục tiêu và dữ liệu hiện tại mới đủ để theo dõi ngắn hạn.
          </p>

          {/* Action priorities box */}
          <div style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #fbcfe8', borderRadius: 18, padding: 14, marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#db1557', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Ưu tiên tuần tới
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {priorities.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#334155', fontWeight: 600 }}>
                  <CheckCircle2 size={16} style={{ color: '#f72567', flexShrink: 0, marginTop: 2 }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenCoach}
            style={{
              background: 'none',
              border: 'none',
              color: '#f72567',
              fontWeight: 800,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              marginTop: 14,
              padding: 0,
            }}
          >
            <span>Hỏi thêm AI Coach về tiến độ</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
