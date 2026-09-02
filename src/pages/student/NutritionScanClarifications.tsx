import React, { useId, useState } from 'react'
import { Check, CheckCircle2, ChevronDown, CircleAlert, Info, RefreshCw, Scale, TriangleAlert, Utensils } from 'lucide-react'
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
  cookingNote: string
  portionNote: string
  unresolvedCount: number
  canReanalyze: boolean
  resolveAdjustment: (value: string) => AdjustmentResult
  onResponse: (question: string, response: NutritionClarificationResponse) => void
  onAdjustment: (question: string, value: string) => void
  onCookingNoteChange: (value: string) => void
  onPortionNoteChange: (value: string) => void
  onReanalyze: () => void
}

export default React.memo(function NutritionScanClarifications({
  questions,
  responses,
  adjustments,
  cookingNote,
  portionNote,
  unresolvedCount,
  canReanalyze,
  resolveAdjustment,
  onResponse,
  onAdjustment,
  onCookingNoteChange,
  onPortionNoteChange,
  onReanalyze,
}: NutritionScanClarificationsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const toggleId = useId()
  const contentId = useId()
  const hasQuestions = questions.length > 0
  const hasCorrection = questions.some((question) => responses[question] === 'adjust' && Boolean(adjustments[question]?.trim()))
  const hasNotes = Boolean(cookingNote.trim() || portionNote.trim())
  const answeredCount = Math.max(0, questions.length - unresolvedCount)
  const toggleIconState = unresolvedCount > 0 ? 'is-pending' : hasQuestions ? 'is-ready' : 'is-notes'
  const statusText = hasQuestions
    ? unresolvedCount > 0 ? `${unresolvedCount} câu cần xác nhận` : 'Đã xác nhận đầy đủ'
    : 'Ghi chú tùy chọn'

  return (
    <section className={`nutrition-scan-clarifications ${isExpanded ? 'is-expanded' : ''}`} aria-labelledby={toggleId}>
      <button
        id={toggleId}
        type="button"
        className="nutrition-scan-clarifications__toggle"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className={`nutrition-scan-clarifications__toggle-icon ${toggleIconState}`} aria-hidden="true">
          {unresolvedCount > 0 ? <CircleAlert size={17} /> : hasQuestions ? <CheckCircle2 size={17} /> : <Utensils size={17} />}
        </span>
        <span className="nutrition-scan-clarifications__toggle-copy">
          <strong>Xác nhận thêm</strong>
          <small>{statusText}{hasQuestions ? ` · ${answeredCount}/${questions.length} đã rõ` : ''}</small>
        </span>
        {hasNotes && <span className="nutrition-scan-clarifications__toggle-note"><Utensils size={12} /> Có ghi chú</span>}
        <ChevronDown className="nutrition-scan-clarifications__toggle-chevron" size={17} aria-hidden="true" />
      </button>

      {isExpanded && <div id={contentId} className="nutrition-scan-clarifications__content">
        {hasQuestions ? (
          <>
            <div className="nutrition-scan-clarifications__heading">
              <div>
                <span><CircleAlert size={14} /> Xác nhận khẩu phần</span>
                <h2 id="nutrition-scan-clarifications-title">Giúp Aura tính sát bữa ăn thực tế</h2>
              </div>
              <small>{answeredCount}/{questions.length} đã rõ</small>
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
                              ? 'Đã ghi nhận mô tả. Chọn “Aura tính lại” để đọc lại ảnh và quy đổi toàn bộ kcal, đạm, carb, béo.'
                              : 'Nhập thay đổi để Aura cập nhật calories và macro.'}
                        </small>
                      </label>
                    )}
                    {response === 'unknown' && (
                      <p className="nutrition-scan-clarification__state-note">
                        <Info size={13} /> Aura sẽ giữ số liệu AI ban đầu, mở rộng khoảng ước tính và đánh dấu bữa ăn cần kiểm tra.
                      </p>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        ) : (
          <div className="nutrition-scan-clarifications__notes-only-intro">
            <Utensils size={14} />
            <span><strong>Bổ sung thông tin bữa ăn</strong><small>Ghi chú giúp Aura ước tính sát hơn với phần bạn thực tế đã ăn.</small></span>
          </div>
        )}

        <div className="nutrition-scan-clarifications__notes">
          <div className="nutrition-scan-clarifications__notes-heading">
            <div><Utensils size={14} /><strong>Ghi chú để Aura tính sát hơn</strong></div>
            <small>Tùy chọn</small>
          </div>
          <div className="nutrition-scan-clarifications__note-grid">
            <label>
              <span>Cách chế biến</span>
              <textarea value={cookingNote} onChange={(event) => onCookingNoteChange(event.target.value.slice(0, 180))} maxLength={180} rows={2} placeholder="Ví dụ: áp chảo ít dầu, chiên giòn, luộc, sốt nhiều…" />
              <small>{cookingNote.length}/180</small>
            </label>
            <label>
              <span>Khẩu phần thực tế</span>
              <textarea value={portionNote} onChange={(event) => onPortionNoteChange(event.target.value.slice(0, 180))} maxLength={180} rows={2} placeholder="Ví dụ: ăn nửa bát cơm, bỏ lại 1/3 phần sốt…" />
              <small>{portionNote.length}/180</small>
            </label>
          </div>
          {hasNotes && <p className="nutrition-scan-clarifications__notes-hint"><Info size={13} /> Sau khi nhập, bấm “Aura tính lại” để gửi ghi chú cùng ảnh và cập nhật khối lượng, kcal, macro.</p>}
        </div>

        {(hasCorrection || hasNotes) && (
          <div className="nutrition-scan-clarifications__reanalyze">
            <button type="button" onClick={onReanalyze} disabled={!canReanalyze}>
              <RefreshCw size={14} /> Aura tính lại từ phần sửa
            </button>
            <small>
              {canReanalyze
                ? 'Aura dùng lại ảnh trong phiên này và áp dụng mô tả như dữ liệu khẩu phần mới.'
                : 'Ảnh gốc không còn trong phiên này. Hãy quét lại ảnh hoặc chỉnh gram trực tiếp ở danh sách thành phần.'}
            </small>
          </div>
        )}
        {unresolvedCount > 0 && <p className="nutrition-scan-clarifications__notice"><TriangleAlert size={14} /> Còn {unresolvedCount} câu chưa rõ. Bạn vẫn có thể lưu, nhưng kết quả sẽ được đánh dấu là ước tính cần kiểm tra.</p>}
      </div>}
    </section>
  )
})
