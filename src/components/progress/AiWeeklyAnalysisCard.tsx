import React from 'react'
import { ArrowRight, Bot, CheckCircle2, Sparkles, TrendingUp, AlertTriangle, Target } from 'lucide-react'

export function AiWeeklyAnalysisCard({ onOpenCoach }: { onOpenCoach: () => void }) {
  const priorities = [
    'Thêm nguồn protein nạc (ức gà, trứng) vào bữa sáng.',
    'Uống thêm 500ml nước vào các ngày có tập luyện.',
  ]
  return (
    <div className="pg-ai-card">
      <div className="pg-ai-card-inner">
        <div className="pg-ai-robot-badge">
          <Bot size={28} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ec4899', fontSize: 13, fontWeight: 800 }}>
            <Sparkles size={16} fill="#ec4899" />
            <span>AI Coach Review Tuần</span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', margin: '4px 0 8px' }}>
            Điều làm tốt: Ghi nhận đều đặn!
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <TrendingUp size={16} style={{ color: '#10b981', marginTop: 2, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#334155' }}>
                <strong>Thói quen tốt:</strong> Bạn đã check-in bữa ăn 6/7 ngày và hoàn thành 3 buổi tập. Streak hiện tại phản ánh sự kỷ luật rất tuyệt vời.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Target size={16} style={{ color: '#3b82f6', marginTop: 2, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#334155' }}>
                <strong>So sánh Tập vs Nghỉ:</strong> Năng lượng nạp vào ngày có tập cao hơn ngày nghỉ khoảng 300 kcal (rất hợp lý để phục hồi), nhưng lượng nước chưa tăng tương ứng.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} style={{ color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#334155' }}>
                <strong>Insight phát hiện:</strong> Thiếu hụt protein ở bữa sáng trong 3 ngày liên tiếp. <br/><span style={{ color: '#64748b' }}>Nguyên nhân: Thường bỏ bữa hoặc chỉ ăn bánh ngọt nhẹ. Hành động: Chuẩn bị sẵn trứng luộc hoặc sữa chua protein.</span>
              </p>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid #fbcfe8', borderRadius: 18, padding: 14, marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#db1557', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Ưu tiên điều chỉnh tuần tới
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {priorities.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#334155', fontWeight: 600 }}>
                  <CheckCircle2 size={16} style={{ color: '#ec4899', flexShrink: 0, marginTop: 2 }} />
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
              color: '#ec4899',
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
            <span>Thảo luận chi tiết với AI Coach</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
