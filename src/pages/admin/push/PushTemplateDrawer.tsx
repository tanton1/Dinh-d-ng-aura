import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Edit3,
  FilePlus2,
  Layers3,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { FitnessGoalTarget, NotificationCategory, PushTemplate } from '../../../types'
import { categoryLabel } from './pushTypes'

interface PushTemplateDrawerProps {
  open: boolean
  templates: PushTemplate[]
  busy: boolean
  error: string
  onClose: () => void
  onApply: (template: PushTemplate) => void
  onSave: (template: PushTemplate) => Promise<boolean>
  onDelete: (templateId: string) => Promise<void>
  onToggle: (templateId: string, active: boolean) => Promise<void>
}

function makeDraft(): PushTemplate {
  return {
    id: `template_${Date.now()}`,
    title: '',
    message: '',
    type: 'REMINDER',
    category: 'nutrition',
    targetGoal: 'all',
    triggerLabel: '',
    actionUrl: '/nutrition',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

export function PushTemplateDrawer({
  open,
  templates,
  busy,
  error,
  onClose,
  onApply,
  onSave,
  onDelete,
  onToggle,
}: PushTemplateDrawerProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all')
  const [editing, setEditing] = useState<PushTemplate | null>(null)

  useEffect(() => {
    if (!open) setEditing(null)
  }, [open])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return templates.filter((template) => {
      const matchesCategory = category === 'all' || template.category === category
      const haystack = `${template.title} ${template.message} ${template.triggerLabel ?? ''}`.toLocaleLowerCase('vi-VN')
      return matchesCategory && (!normalizedQuery || haystack.includes(normalizedQuery))
    })
  }, [category, query, templates])

  if (!open) return null

  const updateEditing = <K extends keyof PushTemplate>(key: K, value: PushTemplate[K]) => {
    if (editing) setEditing({ ...editing, [key]: value })
  }

  const saveEditing = async () => {
    if (!editing?.title.trim() || !editing.message.trim()) return
    const didSave = await onSave(editing)
    if (didSave) setEditing(null)
  }

  return (
    <div className="push-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <aside className="push-drawer" role="dialog" aria-modal="true" aria-labelledby="push-template-title">
        <header className="push-drawer__header">
          <div>
            <span className="push-section-heading__eyebrow">Nội dung tái sử dụng</span>
            <h2 id="push-template-title">Thư viện mẫu Push</h2>
            <p>Mẫu chỉ lưu nội dung và đối tượng gợi ý; lịch gửi được quản lý ở tab Tự động hóa.</p>
          </div>
          <button type="button" className="push-icon-button" onClick={onClose} aria-label="Đóng thư viện mẫu"><X size={21} /></button>
        </header>

        {editing ? (
          <div className="push-template-editor">
            <div className="push-section-heading">
              <div>
                <span className="push-section-heading__eyebrow">{templates.some((item) => item.id === editing.id) ? 'Chỉnh sửa' : 'Mẫu mới'}</span>
                <h3>Nội dung mẫu</h3>
              </div>
              <button type="button" className="push-text-button" onClick={() => setEditing(null)}>Quay lại danh sách</button>
            </div>
            <label className="push-field">
              <span>Tiêu đề</span>
              <input value={editing.title} maxLength={120} onChange={(event) => updateEditing('title', event.target.value)} />
              <small className="push-character-count">{editing.title.length}/120</small>
            </label>
            <label className="push-field">
              <span>Nội dung</span>
              <textarea value={editing.message} maxLength={1000} rows={6} onChange={(event) => updateEditing('message', event.target.value)} />
              <small className="push-character-count">{editing.message.length}/1000</small>
            </label>
            <div className="push-form-grid push-form-grid--two">
              <label className="push-field">
                <span>Danh mục</span>
                <select value={editing.category ?? 'general'} onChange={(event) => updateEditing('category', event.target.value as NotificationCategory)}>
                  <option value="nutrition">Dinh dưỡng</option>
                  <option value="workout">Vận động</option>
                  <option value="learning">Học tập</option>
                  <option value="coach">Coach/PT</option>
                  <option value="general">Chung</option>
                </select>
              </label>
              <label className="push-field">
                <span>Mục tiêu gợi ý</span>
                <select value={editing.targetGoal} onChange={(event) => updateEditing('targetGoal', event.target.value as FitnessGoalTarget)}>
                  <option value="all">Tất cả</option>
                  <option value="lose-fat">Giảm mỡ</option>
                  <option value="gain-muscle">Tăng cơ</option>
                  <option value="maintain">Duy trì</option>
                  <option value="health">Sức khỏe</option>
                </select>
              </label>
            </div>
            <div className="push-form-grid push-form-grid--two">
              <label className="push-field">
                <span>Nhãn nội bộ</span>
                <input value={editing.triggerLabel ?? ''} onChange={(event) => updateEditing('triggerLabel', event.target.value)} placeholder="Ví dụ: Nhắc bữa trưa" />
              </label>
              <label className="push-field">
                <span>Trang đích</span>
                <input value={editing.actionUrl} onChange={(event) => updateEditing('actionUrl', event.target.value)} placeholder="/nutrition" />
              </label>
            </div>
            <label className="push-confirm-check">
              <input type="checkbox" checked={editing.active} onChange={(event) => updateEditing('active', event.target.checked)} />
              <span>Cho phép sử dụng mẫu này</span>
            </label>
            {error && <div className="push-alert push-alert--error">{error}</div>}
            <div className="push-drawer__actions">
              <button type="button" className="push-button push-button--ghost" onClick={() => setEditing(null)} disabled={busy}>Hủy</button>
              <button type="button" className="push-button push-button--primary" onClick={saveEditing} disabled={busy || !editing.title.trim() || !editing.message.trim()}>
                <Check size={17} /> {busy ? 'Đang lưu…' : 'Lưu mẫu'}
              </button>
            </div>
          </div>
        ) : (
          <div className="push-template-library">
            <div className="push-template-toolbar">
              <label className="push-search-field">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tiêu đề hoặc nội dung" />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value as NotificationCategory | 'all')} aria-label="Lọc danh mục mẫu">
                <option value="all">Mọi danh mục</option>
                <option value="nutrition">Dinh dưỡng</option>
                <option value="workout">Vận động</option>
                <option value="learning">Học tập</option>
                <option value="coach">Coach/PT</option>
                <option value="general">Chung</option>
              </select>
              <button type="button" className="push-button push-button--primary" onClick={() => setEditing(makeDraft())}>
                <FilePlus2 size={17} /> Tạo mẫu
              </button>
            </div>

            {filtered.length === 0 ? (
              <div className="push-empty-state"><Layers3 size={28} /><strong>Không tìm thấy mẫu phù hợp</strong></div>
            ) : (
              <div className="push-template-list">
                {filtered.map((template) => (
                  <article key={template.id} className={`push-template-card ${template.active ? '' : 'is-disabled'}`}>
                    <div className="push-template-card__heading">
                      <div className="push-template-card__icon"><Sparkles size={18} /></div>
                      <div>
                        <strong>{template.title}</strong>
                        <span>{categoryLabel(template.category)} · {template.triggerLabel || 'Không có nhãn nội bộ'}</span>
                      </div>
                      <span className={`push-status-pill ${template.active ? 'is-success' : 'is-neutral'}`}>{template.active ? 'Đang dùng' : 'Tạm ẩn'}</span>
                    </div>
                    <p>{template.message}</p>
                    <div className="push-template-card__actions">
                      <button type="button" className="push-button push-button--secondary" onClick={() => onApply(template)} disabled={!template.active}>
                        <Check size={16} /> Dùng mẫu
                      </button>
                      <button type="button" className="push-icon-button" onClick={() => setEditing(template)} aria-label={`Sửa mẫu ${template.title}`}><Edit3 size={17} /></button>
                      <button type="button" className="push-text-button" onClick={() => onToggle(template.id, !template.active)} disabled={busy}>
                        {template.active ? 'Tạm ẩn' : 'Bật lại'}
                      </button>
                      <button
                        type="button"
                        className="push-icon-button push-icon-button--danger"
                        onClick={() => {
                          if (window.confirm(`Xóa mẫu “${template.title}”?`)) void onDelete(template.id)
                        }}
                        aria-label={`Xóa mẫu ${template.title}`}
                        disabled={busy}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
