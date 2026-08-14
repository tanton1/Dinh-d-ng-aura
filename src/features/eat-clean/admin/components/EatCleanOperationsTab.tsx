import { useEffect, useState } from 'react'
import { Clock3, MapPinned, Plus, Save, Settings2, Trash2, Truck } from 'lucide-react'
import { formatCurrency, readableError } from '../adminEatCleanUtils'
import type { EatCleanConfig, EatCleanDeliverySlot, EatCleanDeliveryZone } from '../types'

interface EatCleanOperationsTabProps {
  config: EatCleanConfig
  onSaveConfig: (config: EatCleanConfig) => Promise<void>
}

function normalizedId(value: string, prefix: string) {
  const id = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return id || `${prefix}-${Date.now().toString(36)}`
}

function createSlot(): EatCleanDeliverySlot {
  return { id: `slot-${Date.now().toString(36)}`, label: 'Khung giao mới', start: '11:00', end: '12:00', enabled: true }
}

function createZone(): EatCleanDeliveryZone {
  return { id: `zone-${Date.now().toString(36)}`, label: 'Khu vực mới', fee: 25_000, enabled: true }
}

export function EatCleanOperationsTab({ config, onSaveConfig }: EatCleanOperationsTabProps) {
  const [draft, setDraft] = useState<EatCleanConfig>(config)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft({ ...config, deliverySlots: config.deliverySlots.map((slot) => ({ ...slot })), deliveryZones: config.deliveryZones.map((zone) => ({ ...zone })) })
  }, [config])

  const updateSlot = <K extends keyof EatCleanDeliverySlot>(index: number, key: K, value: EatCleanDeliverySlot[K]) => {
    setDraft((current) => ({ ...current, deliverySlots: current.deliverySlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: value } : slot) }))
  }

  const updateZone = <K extends keyof EatCleanDeliveryZone>(index: number, key: K, value: EatCleanDeliveryZone[K]) => {
    setDraft((current) => ({ ...current, deliveryZones: current.deliveryZones.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, [key]: value } : zone) }))
  }

  const saveConfig = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.sameDayCutoff)) {
      setError('Giờ chốt đơn không hợp lệ.')
      return
    }
    if ([draft.minOrderAmount, draft.defaultDeliveryFee, draft.freeDeliveryThreshold].some((value) => !Number.isInteger(value) || value < 0)) {
      setError('Các giá trị tiền phải là số nguyên không âm.')
      return
    }
    if (draft.deliverySlots.length === 0 || draft.deliveryZones.length === 0) {
      setError('Cần ít nhất một khung giờ và một khu vực giao hàng.')
      return
    }
    if (draft.deliverySlots.some((slot) => !slot.label.trim() || !slot.start || !slot.end || slot.end <= slot.start)) {
      setError('Mỗi khung giao cần đủ tên và giờ kết thúc phải sau giờ bắt đầu.')
      return
    }
    if (draft.deliveryZones.some((zone) => !zone.label.trim() || zone.fee < 0)) {
      setError('Mỗi khu vực cần tên và phí giao hợp lệ.')
      return
    }

    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await onSaveConfig({
        ...draft,
        supportPhone: draft.supportPhone.trim(),
        deliverySlots: draft.deliverySlots.map((slot) => ({ ...slot, id: normalizedId(slot.id || slot.label, 'slot'), label: slot.label.trim() })),
        deliveryZones: draft.deliveryZones.map((zone) => ({ ...zone, id: normalizedId(zone.id || zone.label, 'zone'), label: zone.label.trim() })),
      })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 3000)
    } catch (saveError) {
      setError(readableError(saveError, 'Không thể lưu cấu hình vận hành.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="eat-clean-panel" aria-labelledby="eat-clean-operations-title">
      <div className="eat-clean-panel__heading"><div><span className="eat-clean-kicker">VẬN HÀNH</span><h2 id="eat-clean-operations-title">Cấu hình nhận và giao đơn</h2><p>Kiểm soát storefront, chính sách đặt món và phạm vi giao tại {draft.cityName}.</p></div></div>

      <div className="eat-clean-operations-layout">
        <div className="eat-clean-settings-stack">
          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading"><span className="eat-clean-subcard__icon"><Settings2 size={19} /></span><div><h3>Trạng thái dịch vụ</h3><p>Tách rõ việc bật storefront và việc nhận đơn mới.</p></div></div>
            <div className="eat-clean-switch-stack">
              <label className="eat-clean-switch-field eat-clean-switch-field--strong"><span><strong>{draft.enabled ? 'Dịch vụ đang bật' : 'Dịch vụ đang tắt'}</strong><small>Tắt để ẩn toàn bộ trải nghiệm Eat Clean khỏi khách hàng.</small></span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked, acceptingOrders: event.target.checked ? draft.acceptingOrders : false })} /></label>
              <label className="eat-clean-switch-field"><span><strong>{draft.acceptingOrders ? 'Đang nhận đơn mới' : 'Đang tạm dừng nhận đơn'}</strong><small>Chỉ có hiệu lực khi dịch vụ đã bật.</small></span><input type="checkbox" checked={draft.acceptingOrders} disabled={!draft.enabled} onChange={(event) => setDraft({ ...draft, acceptingOrders: event.target.checked })} /></label>
            </div>
          </section>

          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading"><span className="eat-clean-subcard__icon"><Clock3 size={19} /></span><div><h3>Chính sách đặt món</h3><p>Áp dụng cho mọi đơn mới; tiền tệ cố định {draft.currency}.</p></div></div>
            <div className="eat-clean-form-grid eat-clean-form-grid--3">
              <label className="eat-clean-field"><span>Giờ chốt trong ngày</span><input type="time" value={draft.sameDayCutoff} onChange={(event) => setDraft({ ...draft, sameDayCutoff: event.target.value })} /></label>
              <label className="eat-clean-field"><span>Đơn tối thiểu (đ)</span><input type="number" min={0} step={1000} value={draft.minOrderAmount} onChange={(event) => setDraft({ ...draft, minOrderAmount: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Phí giao mặc định (đ)</span><input type="number" min={0} step={1000} value={draft.defaultDeliveryFee} onChange={(event) => setDraft({ ...draft, defaultDeliveryFee: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Mốc miễn phí giao (đ)</span><input type="number" min={0} step={1000} value={draft.freeDeliveryThreshold} onChange={(event) => setDraft({ ...draft, freeDeliveryThreshold: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Chuẩn bị tối thiểu (ngày)</span><input type="number" min={0} max={7} value={draft.minimumLeadDays} onChange={(event) => setDraft({ ...draft, minimumLeadDays: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Đặt trước tối đa (ngày)</span><input type="number" min={1} max={60} value={draft.maxAdvanceDays} onChange={(event) => setDraft({ ...draft, maxAdvanceDays: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Hủy trước giao (giờ)</span><input type="number" min={0} max={72} value={draft.cancellationCutoffHours} onChange={(event) => setDraft({ ...draft, cancellationCutoffHours: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Tối đa mỗi món</span><input type="number" min={1} max={100} value={draft.maxItemQuantity} onChange={(event) => setDraft({ ...draft, maxItemQuantity: Number(event.target.value) })} /></label>
              <label className="eat-clean-field"><span>Tối đa mỗi đơn</span><input type="number" min={1} max={200} value={draft.maxOrderQuantity} onChange={(event) => setDraft({ ...draft, maxOrderQuantity: Number(event.target.value) })} /></label>
            </div>
            <label className="eat-clean-field"><span>Số điện thoại hỗ trợ</span><input type="tel" value={draft.supportPhone} onChange={(event) => setDraft({ ...draft, supportPhone: event.target.value })} maxLength={30} inputMode="tel" placeholder="090..." /></label>
          </section>

          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading eat-clean-subcard__heading--action"><span className="eat-clean-subcard__icon"><Truck size={19} /></span><div><h3>Khung giờ giao</h3><p>Chỉ khung đang bật xuất hiện cho khách.</p></div><button type="button" className="eat-clean-secondary-button" onClick={() => setDraft({ ...draft, deliverySlots: [...draft.deliverySlots, createSlot()] })}><Plus size={17} /> Thêm khung</button></div>
            <div className="eat-clean-slot-list">{draft.deliverySlots.map((slot, index) => <article key={`${slot.id}-${index}`} className="eat-clean-slot-row"><label className="eat-clean-field"><span>Tên khung</span><input value={slot.label} onChange={(event) => updateSlot(index, 'label', event.target.value)} maxLength={80} /></label><label className="eat-clean-field"><span>Bắt đầu</span><input type="time" value={slot.start} onChange={(event) => updateSlot(index, 'start', event.target.value)} /></label><label className="eat-clean-field"><span>Kết thúc</span><input type="time" value={slot.end} onChange={(event) => updateSlot(index, 'end', event.target.value)} /></label><label className="eat-clean-slot-enabled"><span>Đang dùng</span><input type="checkbox" checked={slot.enabled} onChange={(event) => updateSlot(index, 'enabled', event.target.checked)} /></label><button type="button" className="eat-clean-icon-button eat-clean-icon-button--danger" onClick={() => setDraft({ ...draft, deliverySlots: draft.deliverySlots.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Xóa khung ${slot.label}`}><Trash2 size={18} /></button></article>)}</div>
          </section>

          <section className="eat-clean-subcard">
            <div className="eat-clean-subcard__heading eat-clean-subcard__heading--action"><span className="eat-clean-subcard__icon"><MapPinned size={19} /></span><div><h3>Khu vực giao</h3><p>Phí từng khu vực được ưu tiên hơn phí mặc định.</p></div><button type="button" className="eat-clean-secondary-button" onClick={() => setDraft({ ...draft, deliveryZones: [...draft.deliveryZones, createZone()] })}><Plus size={17} /> Thêm khu vực</button></div>
            <div className="eat-clean-zone-list">{draft.deliveryZones.map((zone, index) => <article key={`${zone.id}-${index}`} className="eat-clean-zone-row"><label className="eat-clean-field"><span>Tên khu vực</span><input value={zone.label} onChange={(event) => updateZone(index, 'label', event.target.value)} maxLength={80} /></label><label className="eat-clean-field"><span>Phí giao (đ)</span><input type="number" min={0} step={1000} value={zone.fee} onChange={(event) => updateZone(index, 'fee', Number(event.target.value))} /></label><label className="eat-clean-slot-enabled"><span>Đang dùng</span><input type="checkbox" checked={zone.enabled} onChange={(event) => updateZone(index, 'enabled', event.target.checked)} /></label><button type="button" className="eat-clean-icon-button eat-clean-icon-button--danger" onClick={() => setDraft({ ...draft, deliveryZones: draft.deliveryZones.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Xóa khu vực ${zone.label}`}><Trash2 size={18} /></button></article>)}</div>
          </section>

          {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
          {saved && <div className="eat-clean-inline-success" role="status">Đã lưu cấu hình vận hành.</div>}
          <div className="eat-clean-save-row"><button type="button" className="eat-clean-primary-button" onClick={saveConfig} disabled={saving}><Save size={18} /> {saving ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
        </div>

        <aside className="eat-clean-operation-preview" aria-label="Xem trước trạng thái bán"><img src="/images/eat-clean/hero-bowl.webp" alt="Suất ăn Eat Clean" /><div><span className={`eat-clean-status ${draft.enabled && draft.acceptingOrders ? 'eat-clean-status--active' : 'eat-clean-status--inactive'}`}>{draft.enabled && draft.acceptingOrders ? 'Đang nhận đơn' : 'Tạm ngưng nhận đơn'}</span><h3>Eat Clean tại {draft.cityName}</h3><p>Đặt trước tối đa {draft.maxAdvanceDays} ngày. Chốt đơn cùng ngày lúc {draft.sameDayCutoff}.</p><dl><div><dt>Đơn tối thiểu</dt><dd>{formatCurrency(draft.minOrderAmount)}</dd></div><div><dt>Khung giao</dt><dd>{draft.deliverySlots.filter((slot) => slot.enabled).length}</dd></div><div><dt>Khu vực</dt><dd>{draft.deliveryZones.filter((zone) => zone.enabled).length}</dd></div></dl></div></aside>
      </div>
    </section>
  )
}
