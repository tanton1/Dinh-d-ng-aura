import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Layers3,
  Link2,
  Send,
  Smartphone,
  Users,
  X,
} from 'lucide-react'
import type { AdminUserRecord, PushDispatchResult, PushTemplate } from '../../../types'
import {
  PUSH_AUDIENCE_OPTIONS,
  audienceLabel,
  categoryLabel,
  filterAudienceUsers,
  notificationTypeLabel,
  type PushComposerDraft,
} from './pushTypes'

interface PushComposerPanelProps {
  users: AdminUserRecord[]
  templates: PushTemplate[]
  draft: PushComposerDraft
  dispatching: boolean
  result: PushDispatchResult | null
  error: string
  onDraftChange: (draft: PushComposerDraft) => void
  onOpenTemplates: () => void
  onDispatch: (targetUserIds: string[]) => Promise<boolean>
}

const NOTIFICATION_TYPES: Array<{ value: PushComposerDraft['type']; label: string }> = [
  { value: 'REMINDER', label: 'Nhắc nhở' },
  { value: 'INFO', label: 'Thông tin' },
  { value: 'ANNOUNCEMENT', label: 'Thông báo' },
  { value: 'WORKOUT', label: 'Buổi tập' },
  { value: 'MOTIVATION', label: 'Động lực' },
  { value: 'ALERT', label: 'Quan trọng' },
]

const CATEGORIES: Array<{ value: PushComposerDraft['category']; label: string }> = [
  { value: 'nutrition', label: 'Dinh dưỡng' },
  { value: 'workout', label: 'Vận động' },
  { value: 'learning', label: 'Học tập' },
  { value: 'coach', label: 'Coach/PT' },
  { value: 'general', label: 'Chung' },
]

const ACTION_OPTIONS = [
  { value: '/nutrition', label: 'Trang dinh dưỡng' },
  { value: '/workout', label: 'Trang vận động' },
  { value: '/academy', label: 'Aura Academy' },
  { value: '/progress', label: 'Trang tiến độ' },
  { value: '/home', label: 'Trang Hôm nay' },
  { value: '/coach', label: 'Nhận xét Coach/PT' },
]

export function PushComposerPanel({
  users,
  templates,
  draft,
  dispatching,
  result,
  error,
  onDraftChange,
  onOpenTemplates,
  onDispatch,
}: PushComposerPanelProps) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [allConfirmed, setAllConfirmed] = useState(false)

  const targetUsers = useMemo(
    () => filterAudienceUsers(users, draft.audience, draft.userId),
    [users, draft.audience, draft.userId],
  )
  const targetOption = PUSH_AUDIENCE_OPTIONS.find((item) => item.value === draft.audience)
  const allStudents = users.filter((user) => user.role === 'student' && user.status !== 'disabled')
  const isServerResolvedAll = draft.audience === 'all' && allStudents.length === 0
  const hasAudience = isServerResolvedAll || targetUsers.length > 0
  const hasContent = draft.title.trim().length > 0 && draft.message.trim().length > 0
  const canReview = hasAudience && hasContent && draft.title.length <= 120 && draft.message.length <= 1000

  const updateDraft = <K extends keyof PushComposerDraft>(key: K, value: PushComposerDraft[K]) => {
    onDraftChange({ ...draft, [key]: value })
  }

  const openReview = () => {
    setAllConfirmed(false)
    setReviewOpen(true)
  }

  const confirmAndSend = async () => {
    if (draft.audience === 'all' && !allConfirmed) return
    const didSend = await onDispatch(targetUsers.map((user) => user.uid))
    if (didSend) setReviewOpen(false)
  }

  return (
    <div className="push-panel-stack" data-testid="push-composer">
      {result && (
        <section className="push-result-card" role="status">
          <CheckCircle2 size={22} />
          <div>
            <strong>Đã hoàn tất lượt gửi</strong>
            <p>
              Đã tạo {result.sentCount} inbox · FCM chấp nhận trên {result.webPushSentCount} thiết bị
              {result.webPushFailureCount > 0 ? ` · ${result.webPushFailureCount} lỗi thiết bị` : ''}
              {result.filteredOutCount > 0 ? ` · ${result.filteredOutCount} tài khoản không đủ điều kiện` : ''}.
            </p>
          </div>
        </section>
      )}

      {error && (
        <div className="push-alert push-alert--error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="push-compose-layout">
        <div className="push-compose-form">
          <section className="push-card push-step-card">
            <div className="push-step-heading">
              <span>1</span>
              <div>
                <h2>Chọn người nhận</h2>
                <p>Chọn một nhóm rõ ràng trước khi soạn nội dung.</p>
              </div>
            </div>

            <label className="push-field">
              <span>Nhóm người nhận</span>
              <select
                value={draft.audience}
                onChange={(event) => {
                  const audience = event.target.value as PushComposerDraft['audience']
                  onDraftChange({
                    ...draft,
                    audience,
                    userId: audience === 'individual' ? draft.userId : '',
                  })
                }}
              >
                {PUSH_AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small>{targetOption?.description}</small>
            </label>

            {draft.audience === 'individual' && (
              <label className="push-field">
                <span>Học viên</span>
                <select value={draft.userId} onChange={(event) => updateDraft('userId', event.target.value)}>
                  <option value="">Chọn một học viên</option>
                  {allStudents.map((user) => (
                    <option key={user.uid} value={user.uid}>
                      {user.displayName || user.email || user.uid}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className={`push-audience-summary ${hasAudience ? '' : 'is-empty'}`}>
              <Users size={19} />
              <div>
                <strong>
                  {isServerResolvedAll
                    ? 'Máy chủ sẽ xác định toàn bộ học viên'
                    : `${targetUsers.length} người nhận phù hợp`}
                </strong>
                <span>
                  {hasAudience
                    ? 'Cài đặt nhận thông báo cá nhân luôn được tôn trọng.'
                    : 'Nhóm này hiện không có người nhận. Hãy chọn nhóm khác.'}
                </span>
              </div>
            </div>
          </section>

          <section className="push-card push-step-card">
            <div className="push-step-heading push-step-heading--with-action">
              <span>2</span>
              <div>
                <h2>Soạn nội dung</h2>
                <p>Ngắn gọn, đúng ngữ cảnh và có hành động rõ ràng.</p>
              </div>
              <button type="button" className="push-button push-button--ghost" onClick={onOpenTemplates}>
                <Layers3 size={17} />
                Thư viện mẫu ({templates.filter((template) => template.active).length})
              </button>
            </div>

            <div className="push-form-grid push-form-grid--two">
              <label className="push-field">
                <span>Loại thông báo</span>
                <select value={draft.type} onChange={(event) => updateDraft('type', event.target.value as PushComposerDraft['type'])}>
                  {NOTIFICATION_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="push-field">
                <span>Danh mục</span>
                <select value={draft.category} onChange={(event) => updateDraft('category', event.target.value as PushComposerDraft['category'])}>
                  {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            </div>

            <label className="push-field">
              <span>Tiêu đề</span>
              <input
                value={draft.title}
                maxLength={120}
                onChange={(event) => updateDraft('title', event.target.value)}
                placeholder="Ví dụ: Đến giờ cập nhật bữa trưa"
              />
              <small className="push-character-count">{draft.title.length}/120</small>
            </label>

            <label className="push-field">
              <span>Nội dung</span>
              <textarea
                value={draft.message}
                maxLength={1000}
                rows={5}
                onChange={(event) => updateDraft('message', event.target.value)}
                placeholder="Thông điệp bạn muốn gửi đến học viên…"
              />
              <small className="push-character-count">{draft.message.length}/1000</small>
            </label>

            <label className="push-field">
              <span>Trang mở khi chạm thông báo</span>
              <span className="push-input-with-icon">
                <Link2 size={17} />
                <select value={draft.actionUrl} onChange={(event) => updateDraft('actionUrl', event.target.value)}>
                  {ACTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </span>
            </label>
          </section>

          <section className="push-card push-step-card push-review-step">
            <div className="push-step-heading">
              <span>3</span>
              <div>
                <h2>Kiểm tra và gửi</h2>
                <p>Xác nhận đối tượng, nội dung và điểm đến trước khi gửi.</p>
              </div>
            </div>
            <div className="push-send-summary">
              <span><Users size={16} /> {audienceLabel(draft.audience)}</span>
              <span><FileText size={16} /> {notificationTypeLabel(draft.type)}</span>
              <span><Link2 size={16} /> {ACTION_OPTIONS.find((item) => item.value === draft.actionUrl)?.label ?? draft.actionUrl}</span>
            </div>
          </section>
        </div>

        <aside className="push-preview-column" aria-label="Xem trước thông báo">
          <div className="push-preview-card">
            <div className="push-preview-card__heading">
              <Smartphone size={18} />
              <span>Xem trước trên điện thoại</span>
            </div>
            <div className="push-phone-preview">
              <div className="push-phone-preview__top">
                <span>AURA FITNESS</span>
                <small>Bây giờ</small>
              </div>
              <strong>{draft.title || 'Tiêu đề thông báo'}</strong>
              <p>{draft.message || 'Nội dung thông báo sẽ hiển thị tại đây.'}</p>
              <span className="push-preview-category">{categoryLabel(draft.category)}</span>
            </div>
            <small className="push-preview-note">Giao diện thực tế có thể khác nhẹ tùy thiết bị.</small>
          </div>
        </aside>
      </div>

      <div className="push-send-bar">
        <div>
          <strong>{hasAudience ? audienceLabel(draft.audience) : 'Chưa có người nhận'}</strong>
          <span>
            {isServerResolvedAll ? 'Máy chủ xác định khi gửi' : `${targetUsers.length} người nhận được chọn`}
          </span>
        </div>
        <button type="button" className="push-button push-button--primary push-button--large" onClick={openReview} disabled={!canReview || dispatching}>
          Kiểm tra trước khi gửi <ArrowRight size={18} />
        </button>
      </div>

      {reviewOpen && (
        <div className="push-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !dispatching) setReviewOpen(false)
        }}>
          <section className="push-dialog" role="dialog" aria-modal="true" aria-labelledby="push-review-title">
            <div className="push-dialog__header">
              <div>
                <span className="push-section-heading__eyebrow">Xác nhận lần cuối</span>
                <h2 id="push-review-title">Gửi thông báo này?</h2>
              </div>
              <button type="button" className="push-icon-button" aria-label="Đóng" onClick={() => setReviewOpen(false)} disabled={dispatching}>
                <X size={20} />
              </button>
            </div>

            <dl className="push-review-list">
              <div><dt>Người nhận</dt><dd>{audienceLabel(draft.audience)}{!isServerResolvedAll ? ` · ${targetUsers.length} tài khoản` : ''}</dd></div>
              <div><dt>Danh mục</dt><dd>{categoryLabel(draft.category)}</dd></div>
              <div><dt>Tiêu đề</dt><dd>{draft.title}</dd></div>
              <div><dt>Điểm đến</dt><dd>{draft.actionUrl}</dd></div>
            </dl>

            <div className="push-alert push-alert--info">
              <AlertTriangle size={18} />
              <span>“Đã tạo inbox” và “FCM chấp nhận” là hai chỉ số khác nhau. FCM chấp nhận không đảm bảo người dùng đã mở thông báo.</span>
            </div>

            {draft.audience === 'all' && (
              <label className="push-confirm-check">
                <input type="checkbox" checked={allConfirmed} onChange={(event) => setAllConfirmed(event.target.checked)} />
                <span>Tôi xác nhận gửi đến toàn bộ học viên đủ điều kiện.</span>
              </label>
            )}

            <div className="push-dialog__actions">
              <button type="button" className="push-button push-button--ghost" onClick={() => setReviewOpen(false)} disabled={dispatching}>Quay lại chỉnh sửa</button>
              <button
                type="button"
                className="push-button push-button--primary"
                onClick={confirmAndSend}
                disabled={dispatching || (draft.audience === 'all' && !allConfirmed)}
              >
                <Send size={17} />
                {dispatching ? 'Đang gửi…' : 'Xác nhận gửi'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
