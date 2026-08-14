import { useMemo, useState } from 'react'
import { Boxes, CalendarDays, ChevronRight, Plus, Search } from 'lucide-react'
import { INVENTORY_STATUS_LABELS, formatDateTime, inventoryStatusFor, readableError } from '../adminEatCleanUtils'
import type { EatCleanInventoryItem, EatCleanInventoryStatus, EatCleanMeal, SaveEatCleanInventoryInput } from '../types'
import { EatCleanSheet } from './EatCleanSheet'

interface EatCleanInventoryTabProps {
  inventory: EatCleanInventoryItem[]
  meals: EatCleanMeal[]
  onSaveInventory: (input: SaveEatCleanInventoryInput) => Promise<void>
}

type InventoryFilter = 'all' | EatCleanInventoryStatus

function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function EatCleanInventoryTab({ inventory, meals, onSaveInventory }: EatCleanInventoryTabProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<InventoryFilter>('all')
  const [serviceDate, setServiceDate] = useState('')
  const [draft, setDraft] = useState<SaveEatCleanInventoryInput | null>(null)
  const [committed, setCommitted] = useState({ reserved: 0, sold: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const mealNames = useMemo(() => new Map(meals.map((meal) => [meal.id, meal.name])), [meals])
  const filteredInventory = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return inventory.filter((item) => {
      const status = inventoryStatusFor(item)
      if (filter !== 'all' && status !== filter) return false
      if (serviceDate && item.serviceDate !== serviceDate) return false
      const mealName = mealNames.get(item.mealId) ?? item.mealId
      return !normalizedQuery || mealName.toLocaleLowerCase('vi-VN').includes(normalizedQuery)
    })
  }, [filter, inventory, mealNames, query, serviceDate])

  const openInventory = (item?: EatCleanInventoryItem) => {
    if (item) {
      setDraft({
        mealId: item.mealId,
        serviceDate: item.serviceDate,
        capacity: item.capacity,
        active: item.active,
        expectedRevision: item.revision ?? 0,
      })
      setCommitted({ reserved: item.reserved, sold: item.sold })
    } else {
      setDraft({ mealId: meals[0]?.id ?? '', serviceDate: localDateKey(), capacity: 0, active: true, expectedRevision: 0 })
      setCommitted({ reserved: 0, sold: 0 })
    }
    setError('')
  }

  const closeInventory = () => {
    if (!saving) setDraft(null)
  }

  const saveInventory = async () => {
    if (!draft) return
    if (!draft.mealId) {
      setError('Hãy chọn món cần thiết lập sức chứa.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.serviceDate)) {
      setError('Ngày phục vụ không hợp lệ.')
      return
    }
    if (!Number.isInteger(draft.capacity) || draft.capacity < committed.reserved + committed.sold) {
      setError(`Sức chứa phải là số nguyên và không thấp hơn ${committed.reserved + committed.sold} suất đã giữ/đã bán.`)
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSaveInventory(draft)
      setDraft(null)
    } catch (saveError) {
      setError(readableError(saveError, 'Không thể lưu sức chứa món.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="eat-clean-panel" aria-labelledby="eat-clean-inventory-title">
      <div className="eat-clean-panel__heading eat-clean-panel__heading--action">
        <div>
          <span className="eat-clean-kicker">TỒN KHO</span>
          <h2 id="eat-clean-inventory-title">Sức chứa món theo ngày</h2>
          <p>Kiểm soát số suất tối đa, đã giữ, đã bán và còn nhận được cho từng ngày phục vụ.</p>
        </div>
        <button type="button" className="eat-clean-primary-button" onClick={() => openInventory()} disabled={meals.length === 0}><Plus size={18} /> Thiết lập ngày</button>
      </div>

      <div className="eat-clean-toolbar eat-clean-toolbar--inventory">
        <label className="eat-clean-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Tìm món trong tồn kho</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món..." />
        </label>
        <label className="eat-clean-filter-field"><span>Ngày phục vụ</span><input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
        <label className="eat-clean-filter-field">
          <span>Mức tồn</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as InventoryFilter)}>
            <option value="all">Tất cả</option>
            {Object.entries(INVENTORY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {filteredInventory.length === 0 ? (
        <div className="eat-clean-empty eat-clean-empty--compact">
          <Boxes size={30} />
          <h3>{inventory.length === 0 ? 'Chưa thiết lập sức chứa' : 'Không có dữ liệu phù hợp'}</h3>
          <p>{inventory.length === 0 ? 'Chọn “Thiết lập ngày” để khai báo số suất bán cho từng món.' : 'Thử đổi món, ngày hoặc mức tồn.'}</p>
          {inventory.length === 0 && meals.length > 0 && <button type="button" className="eat-clean-primary-button" onClick={() => openInventory()}><Plus size={18} /> Thiết lập đầu tiên</button>}
        </div>
      ) : (
        <>
          <div className="eat-clean-desktop-table" role="region" aria-label="Danh sách sức chứa Eat Clean" tabIndex={0}>
            <table>
              <thead><tr><th>Món / ngày</th><th>Sức chứa</th><th>Đã giữ</th><th>Đã bán</th><th>Còn nhận</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead>
              <tbody>
                {filteredInventory.map((item) => {
                  const status = inventoryStatusFor(item)
                  return (
                    <tr key={item.id}>
                      <td><strong>{mealNames.get(item.mealId) ?? item.mealId}</strong><small>{item.serviceDate}</small></td>
                      <td><strong>{item.capacity} suất</strong></td>
                      <td><span>{item.reserved} suất</span></td>
                      <td><span>{item.sold} suất</span></td>
                      <td><strong>{item.available} suất</strong></td>
                      <td><span className={`eat-clean-status eat-clean-status--${status}`}>{INVENTORY_STATUS_LABELS[status]}</span></td>
                      <td><button type="button" className="eat-clean-table-action" onClick={() => openInventory(item)}>Cập nhật <ChevronRight size={16} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="eat-clean-mobile-list">
            {filteredInventory.map((item) => {
              const status = inventoryStatusFor(item)
              const percent = item.capacity > 0 ? Math.max(0, Math.min(100, (item.available / item.capacity) * 100)) : 0
              return (
                <article key={item.id} className="eat-clean-mobile-card eat-clean-inventory-card">
                  <header>
                    <div><strong>{mealNames.get(item.mealId) ?? item.mealId}</strong><small><CalendarDays size={13} /> {item.serviceDate}</small></div>
                    <span className={`eat-clean-status eat-clean-status--${status}`}>{INVENTORY_STATUS_LABELS[status]}</span>
                  </header>
                  <div className="eat-clean-stock-value"><strong>{item.available}</strong><span>/ {item.capacity} suất còn nhận</span></div>
                  <div className={`eat-clean-stock-meter eat-clean-stock-meter--${status}`} aria-label={`Còn ${item.available} trên ${item.capacity} suất`}><span style={{ width: `${percent}%` }} /></div>
                  <div className="eat-clean-mobile-card__footer">
                    <span>Giữ {item.reserved} · bán {item.sold}</span>
                    <button type="button" className="eat-clean-link-button" onClick={() => openInventory(item)}>Cập nhật <ChevronRight size={15} /></button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <EatCleanSheet
        open={Boolean(draft)}
        title="Thiết lập sức chứa món"
        description="Sức chứa không được thấp hơn tổng số suất đã giữ và đã bán."
        onClose={closeInventory}
        footer={(
          <>
            <button type="button" className="eat-clean-secondary-button" onClick={closeInventory} disabled={saving}>Hủy</button>
            <button type="button" className="eat-clean-primary-button" onClick={saveInventory} disabled={saving}>{saving ? 'Đang cập nhật…' : 'Lưu sức chứa'}</button>
          </>
        )}
      >
        {draft && (
          <div className="eat-clean-sheet-stack">
            <label className="eat-clean-field">
              <span>Món ăn</span>
              <select value={draft.mealId} onChange={(event) => setDraft({ ...draft, mealId: event.target.value, expectedRevision: 0 })} disabled={(draft.expectedRevision ?? 0) > 0}>
                <option value="">Chọn món</option>
                {meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}</option>)}
              </select>
            </label>
            <label className="eat-clean-field"><span>Ngày phục vụ</span><input type="date" value={draft.serviceDate} onChange={(event) => setDraft({ ...draft, serviceDate: event.target.value, expectedRevision: 0 })} disabled={(draft.expectedRevision ?? 0) > 0} /></label>
            <label className="eat-clean-field"><span>Sức chứa tối đa (suất)</span><input type="number" min={committed.reserved + committed.sold} step={1} value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })} inputMode="numeric" /><small>Đã giữ {committed.reserved} · đã bán {committed.sold} · dự kiến còn {Math.max(0, draft.capacity - committed.reserved - committed.sold)} suất.</small></label>
            <label className="eat-clean-switch-field"><span><strong>Mở nhận món trong ngày này</strong><small>Tắt để khóa nhận thêm dù vẫn còn sức chứa.</small></span><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /></label>
            {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
          </div>
        )}
      </EatCleanSheet>
    </section>
  )
}
