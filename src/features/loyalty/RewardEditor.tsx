import { useEffect, useState } from 'react'
import { ImagePlus, LoaderCircle, Save, Trash2, X } from 'lucide-react'
import type { LoyaltyAdminReward } from './types'
import RewardImage from './RewardImage'

interface Props {
  reward: LoyaltyAdminReward
  busy: boolean
  error: string
  progress: number | null
  file: File | null
  onFile: (file: File | null) => void
  onChange: (reward: LoyaltyAdminReward) => void
  onSave: () => void
  onClose: () => void
}

export default function RewardEditor({ reward, busy, error, progress, file, onFile, onChange, onSave, onClose }: Props) {
  const [preview, setPreview] = useState('')
  const [fileError, setFileError] = useState('')
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])
  const update = (patch: Partial<LoyaltyAdminReward>) => onChange({ ...reward, ...patch })
  return <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}>
    <section className="loyalty-modal loyalty-admin-editor" role="dialog" aria-modal="true" aria-labelledby="loyalty-reward-editor-title" aria-busy={busy} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter((element) => !element.matches(':disabled') && element.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    }}>
      <div className="club-editor-heading"><h2 id="loyalty-reward-editor-title">{reward.id ? 'Sửa quà tặng' : 'Thêm quà tặng'}</h2><button type="button" aria-label="Đóng chỉnh sửa quà" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <form onSubmit={(event) => { event.preventDefault(); onSave() }}>
        <div className="club-reward-scroll">
        <fieldset disabled={busy} className="club-reward-fields">
          <div className="club-banner-upload">
            <RewardImage src={preview || reward.bannerUrl} name={reward.name || 'Ảnh xem trước'} />
            <div className="club-banner-upload__controls">
              <label className="club-upload-button"><ImagePlus size={18} />{preview || reward.bannerUrl ? 'Thay ảnh banner' : 'Tải ảnh banner'}
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Ảnh banner quà tặng" onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (!selected) return
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size === 0 || selected.size > 5 * 1024 * 1024) { setFileError('Chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.'); return }
                  setFileError(''); onFile(selected)
                }} />
              </label>
              {(file || reward.bannerUrl) && <button type="button" className="club-remove-banner" onClick={() => { onFile(null); update({ bannerUrl: '', bannerStoragePath: '' }); setFileError('') }}><Trash2 size={16} /> Bỏ ảnh</button>}
              <small>Ảnh ngang 2:1 · JPG, PNG, WebP · tối đa 5 MB</small>
            </div>
          </div>
          <div className="loyalty-admin-editor__grid">
            <label>Tên quà<input autoFocus required maxLength={160} value={reward.name} onChange={(event) => update({ name: event.target.value })} /></label>
            <label>Điểm đổi<input type="number" required min="1" max="1000000" step="1" value={reward.pointsCost} onChange={(event) => update({ pointsCost: Number(event.target.value) })} /></label>
            <label>Danh mục<input required maxLength={60} value={reward.category} onChange={(event) => update({ category: event.target.value })} /></label>
            <label>Thời hạn (ngày)<input type="number" required min="1" max="3650" step="1" value={reward.validityDays} onChange={(event) => update({ validityDays: Number(event.target.value) })} /></label>
            <label>Cách giao<select value={reward.fulfillmentType} onChange={(event) => update({ fulfillmentType: event.target.value as 'automatic' | 'staff', entitlementType: event.target.value === 'automatic' ? 'extra_reschedule' : null })}><option value="staff">Nhân viên xác nhận</option><option value="automatic">Cấp tự động</option></select></label>
            <label>Số lượng<input type="number" min="0" max="1000000" step="1" placeholder="Không giới hạn" value={reward.stock ?? ''} onChange={(event) => update({ stock: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            {reward.fulfillmentType === 'automatic' && <label className="is-wide">Quyền được cấp<select value={reward.entitlementType || ''} onChange={(event) => update({ entitlementType: event.target.value || null })}><option value="extra_reschedule">Thêm một lần đổi lịch</option></select></label>}
            <label className="is-wide">Chi nhánh<input value={reward.branchIds.join(', ')} onChange={(event) => update({ branchIds: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 30) })} placeholder="Để trống: toàn hệ thống" /></label>
            <label className="is-wide">Mô tả<textarea rows={2} maxLength={1000} value={reward.description} onChange={(event) => update({ description: event.target.value })} /></label>
            <label className="is-check"><input type="checkbox" checked={reward.active} onChange={(event) => update({ active: event.target.checked })} /> Đang mở</label>
            <label className="is-check"><input type="checkbox" checked={reward.featured} onChange={(event) => update({ featured: event.target.checked })} /> Nổi bật</label>
          </div>
        </fieldset>
        </div>
        {(fileError || error) && <p className="loyalty-inline-alert" role="alert">{fileError || error}</p>}
        {progress !== null && <div className="club-upload-progress" role="status"><progress value={progress} max={100} />Đang tải ảnh {progress}%</div>}
        <footer><button type="button" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="loyalty-spin" /> : <Save />} {busy ? 'Đang lưu…' : 'Lưu quà tặng'}</button></footer>
      </form>
    </section>
  </div>
}
