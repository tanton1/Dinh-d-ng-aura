import {
  BookOpen,
  Brain,
  Layers3,
  Lightbulb,
  MessageCircleQuestion,
  Plus,
  Trash2,
} from 'lucide-react'
import type { AcademyLessonContent } from '../../services/academyLearningService'
import '../../styles-academy.css'

interface AcademyLessonMemoryEditorProps {
  content: AcademyLessonContent
  onChange: (content: AcademyLessonContent) => void
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

export default function AcademyLessonMemoryEditor({ content, onChange }: AcademyLessonMemoryEditorProps) {
  return (
    <section className="academy-memory-editor" aria-labelledby="academy-memory-editor-title">
      <header>
        <span className="academy-icon"><Brain size={19} /></span>
        <div>
          <span className="eyebrow">AURA ACADEMY · HỌC SÂU</span>
          <h3 id="academy-memory-editor-title">Bộ công cụ ghi nhớ kiến thức</h3>
          <p>Biến nội dung dinh dưỡng thành các nhịp học ngắn, chủ động nhớ lại và ôn tập ngắt quãng.</p>
        </div>
      </header>

      <div className="academy-editor-section">
        <div className="academy-editor-section__heading"><BookOpen size={17} /><div><strong>Tóm tắt 60 giây</strong><small>Một đoạn ngắn giúp học viên nắm lõi kiến thức trước khi ôn sâu.</small></div></div>
        <textarea
          value={content.minuteSummary}
          onChange={(event) => onChange({ ...content, minuteSummary: event.target.value })}
          rows={3}
          placeholder="Ví dụ: Cân bằng năng lượng là mối quan hệ giữa năng lượng nạp vào và tiêu hao; xu hướng dài hạn quyết định thay đổi cân nặng..."
        />
      </div>

      <div className="academy-editor-section">
        <div className="academy-editor-section__heading"><Lightbulb size={17} /><div><strong>Ý chính bắt buộc ghi nhớ</strong><small>Nên có 3–5 ý, mỗi ý chỉ truyền đạt một thông điệp.</small></div></div>
        <div className="academy-repeat-list">
          {content.keyTakeaways.map((takeaway, index) => (
            <div className="academy-inline-field" key={`takeaway-${index}`}>
              <span>{index + 1}</span>
              <input
                value={takeaway}
                onChange={(event) => onChange({ ...content, keyTakeaways: content.keyTakeaways.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })}
                placeholder="Một kiến thức quan trọng..."
              />
              <button type="button" title="Xóa ý chính" onClick={() => onChange({ ...content, keyTakeaways: content.keyTakeaways.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button className="outline-button small" type="button" onClick={() => onChange({ ...content, keyTakeaways: [...content.keyTakeaways, ''] })}><Plus size={14} /> Thêm ý chính</button>
      </div>

      <div className="academy-editor-section">
        <div className="academy-editor-section__heading"><Layers3 size={17} /><div><strong>Thuật ngữ dinh dưỡng</strong><small>Thuật ngữ sẽ tự trở thành flashcard khi chưa có bộ thẻ riêng.</small></div></div>
        <div className="academy-repeat-list">
          {content.terms.map((term) => (
            <div className="academy-paired-field" key={term.id}>
              <input value={term.term} onChange={(event) => onChange({ ...content, terms: content.terms.map((item) => item.id === term.id ? { ...item, term: event.target.value } : item) })} placeholder="Thuật ngữ" />
              <textarea value={term.definition} onChange={(event) => onChange({ ...content, terms: content.terms.map((item) => item.id === term.id ? { ...item, definition: event.target.value } : item) })} placeholder="Định nghĩa ngắn, chính xác" rows={2} />
              <button type="button" title="Xóa thuật ngữ" onClick={() => onChange({ ...content, terms: content.terms.filter((item) => item.id !== term.id) })}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button className="outline-button small" type="button" onClick={() => onChange({ ...content, terms: [...content.terms, { id: newId('term'), term: '', definition: '' }] })}><Plus size={14} /> Thêm thuật ngữ</button>
      </div>

      <div className="academy-editor-section">
        <div className="academy-editor-section__heading"><MessageCircleQuestion size={17} /><div><strong>Active Recall</strong><small>Học viên phải tự trả lời trước khi mở đáp án gợi ý.</small></div></div>
        <div className="academy-repeat-list">
          {content.recallPrompts.map((recall, index) => (
            <div className="academy-paired-field" key={recall.id}>
              <input value={recall.prompt} onChange={(event) => onChange({ ...content, recallPrompts: content.recallPrompts.map((item) => item.id === recall.id ? { ...item, prompt: event.target.value } : item) })} placeholder={`Câu hỏi tự nhớ ${index + 1}`} />
              <textarea value={recall.answer} onChange={(event) => onChange({ ...content, recallPrompts: content.recallPrompts.map((item) => item.id === recall.id ? { ...item, answer: event.target.value } : item) })} placeholder="Các ý cần có trong câu trả lời" rows={2} />
              <button type="button" title="Xóa câu hỏi" onClick={() => onChange({ ...content, recallPrompts: content.recallPrompts.filter((item) => item.id !== recall.id) })}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button className="outline-button small" type="button" onClick={() => onChange({ ...content, recallPrompts: [...content.recallPrompts, { id: newId('recall'), prompt: '', answer: '' }] })}><Plus size={14} /> Thêm câu tự nhớ</button>
      </div>

      <div className="academy-editor-section">
        <div className="academy-editor-section__heading"><Brain size={17} /><div><strong>Flashcard chuyên sâu</strong><small>Thêm gợi ý vừa đủ để học viên chủ động nhớ, không lộ đáp án ngay.</small></div></div>
        <div className="academy-repeat-list">
          {content.flashcards.map((card, index) => (
            <div className="academy-card-field" key={card.id}>
              <div><span>THẺ {String(index + 1).padStart(2, '0')}</span><button type="button" title="Xóa flashcard" onClick={() => onChange({ ...content, flashcards: content.flashcards.filter((item) => item.id !== card.id) })}><Trash2 size={14} /></button></div>
              <input value={card.front} onChange={(event) => onChange({ ...content, flashcards: content.flashcards.map((item) => item.id === card.id ? { ...item, front: event.target.value } : item) })} placeholder="Mặt trước: câu hỏi / khái niệm" />
              <textarea value={card.back} onChange={(event) => onChange({ ...content, flashcards: content.flashcards.map((item) => item.id === card.id ? { ...item, back: event.target.value } : item) })} placeholder="Mặt sau: đáp án và giải thích" rows={2} />
              <input value={card.hint ?? ''} onChange={(event) => onChange({ ...content, flashcards: content.flashcards.map((item) => item.id === card.id ? { ...item, hint: event.target.value } : item) })} placeholder="Gợi ý (không bắt buộc)" />
            </div>
          ))}
        </div>
        <button className="outline-button small" type="button" onClick={() => onChange({ ...content, flashcards: [...content.flashcards, { id: newId('card'), front: '', back: '', hint: '' }] })}><Plus size={14} /> Thêm flashcard</button>
      </div>
    </section>
  )
}
