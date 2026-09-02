import React from 'react'
import { Check, CircleAlert, Info, Scale, TriangleAlert } from 'lucide-react'
import type { NutritionClarificationResponse } from '../../features/nutrition/types'
import '../../styles-nutrition-scan-clarifications.css'

interface AdjustmentResult {
  calories: number
  recognized: boolean
}

interface NutritionScanClarificationsProps {
  questions: string[]
  responses: Record<string, NutritionClarificationResponse>
  adjustments: Record<string, string>
  unresolvedCount: number
  resolveAdjustment: (value: string) => AdjustmentResult
  onResponse: (question: string, response: NutritionClarificationResponse) => void
  onAdjustment: (question: string, value: string) => void
}

export default React.memo(function NutritionScanClarifications({
  questions,
  responses,
  adjustments,
  unresolvedCount,
  resolveAdjustment,
  onResponse,
  onAdjustment,
}: NutritionScanClarificationsProps) {
  return (
    <section className="nutrition-scan-clarifications" aria-labelledby="nutrition-scan-clarifications-title">
      <div className="nutrition-scan-clarifications__heading">
        <div>
          <span><CircleAlert size={14} /> Xác nhận khẩu phần</span>
          <h2 id="nutrition-scan-clarifications-title">Giúp Aura tính sát bữa ăn thực tế</h2>
        </div>
        <small>{questions.length - unresolvedCount}/{questions.length} đã rõ</small>
      </div>
      <div className="nutrition-scan-clarifications__list">
        {questions.map((question, index) => {
          const response = responses[question]
          const adjustment = adjustments[question] ?? ''
          const adjustmentResult = resolveAdjustment(adjustment)
          return (
            <article className={`nutrition-scan-clarification ${response ? `is-${response}` : ''}`} key={`${question}-${index}`}>
              <p><strong>{index + 1}</strong><span>{question}</span></p>
              <div className="nutrition-scan-clarification__choices" role="group" aria-label={`Trả lời: ${question}`}>
                <button type="button" className={response === 'confirmed' ? 'is-active' : ''} aria-pressed={response === 'confirmed'} onClick={() => onResponse(question, 'confirmed')}><Check size={13} /> Đúng</button>
                <button type="button" className={response === 'adjust' ? 'is-active' : ''} aria-pressed={response === 'adjust'} onClick={() => onResponse(question, 'adjust')}><Scale size={13} /> Cần sửa</button>
                <button type="button" className={response === 'unknown' ? 'is-active' : ''} aria-pressed={response === 'unknown'} onClick={() => onResponse(question, 'unknown')}><Info size={13} /> Không rõ</button>
              </div>
              {response === 'adjust' && (
                <label className="nutrition-scan-clarification__adjustment">
                  <span>Mô tả phần cần điều chỉnh</span>
                  <input value={adjustment} onChange={(event) => onAdjustment(question, event.target.value)} placeholder="Ví dụ: thêm 1 trứng, bỏ da, thêm cơm hoặc thêm thịt" />
                  <small className={adjustment && !adjustmentResult.recognized ? 'is-warning' : ''}>
                    {adjustmentResult.recognized
                      ? `Đã cập nhật ${adjustmentResult.calories >= 0 ? '+' : ''}${adjustmentResult.calories} kcal vào kết quả.`
                      : adjustment
                        ? 'Aura chưa quy đổi được mô tả này. Hãy chỉnh trực tiếp gram từng thành phần.'
                        : 'Nhập thay đổi để Aura cập nhật calories và macro.'}
                  </small>
                </label>
              )}
            </article>
          )
        })}
      </div>
      {unresolvedCount > 0 && <p className="nutrition-scan-clarifications__notice"><TriangleAlert size={14} /> Còn {unresolvedCount} câu chưa rõ. Bạn vẫn có thể lưu, nhưng kết quả sẽ được đánh dấu là ước tính cần kiểm tra.</p>}
    </section>
  )
})
