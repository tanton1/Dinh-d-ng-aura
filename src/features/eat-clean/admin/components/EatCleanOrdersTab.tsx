import { useMemo, useState } from 'react'
import { ChevronRight, ClipboardList, MapPin, Search, Truck } from 'lucide-react'
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
  readableError,
} from '../adminEatCleanUtils'
import type { EatCleanOrder, EatCleanOrderStatus, UpdateEatCleanOrderInput } from '../types'
import { EatCleanSheet } from './EatCleanSheet'

interface EatCleanOrdersTabProps {
  orders: EatCleanOrder[]
  onUpdateOrder: (input: UpdateEatCleanOrderInput) => Promise<void>
}

type OrderFilter = 'all' | EatCleanOrderStatus

const NEXT_ORDER_STATUSES: Record<EatCleanOrderStatus, EatCleanOrderStatus[]> = {
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function EatCleanOrdersTab({ orders, onUpdateOrder }: EatCleanOrdersTabProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [selectedOrder, setSelectedOrder] = useState<EatCleanOrder | null>(null)
  const [draftStatus, setDraftStatus] = useState<EatCleanOrderStatus>('pending_confirmation')
  const [adminNote, setAdminNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return orders.filter((order) => {
      if (filter !== 'all' && order.status !== filter) return false
      if (!normalizedQuery) return true
      return [order.code, order.customer.name, order.customer.phone, order.customer.addressLine]
        .some((value) => value?.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    })
  }, [filter, orders, query])

  const openOrder = (order: EatCleanOrder) => {
    setSelectedOrder(order)
    setDraftStatus(order.status)
    setAdminNote(order.adminNote ?? '')
    setError('')
  }

  const closeOrder = () => {
    if (!saving) setSelectedOrder(null)
  }

  const saveOrder = async () => {
    if (!selectedOrder) return
    setSaving(true)
    setError('')
    try {
      await onUpdateOrder({
        orderId: selectedOrder.id,
        status: draftStatus,
        adminNote: adminNote.trim() || undefined,
      })
      setSelectedOrder(null)
    } catch (saveError) {
      setError(readableError(saveError, 'Không thể cập nhật đơn hàng.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="eat-clean-panel" aria-labelledby="eat-clean-orders-title">
      <div className="eat-clean-panel__heading">
        <div>
          <span className="eat-clean-kicker">ĐƠN HÀNG</span>
          <h2 id="eat-clean-orders-title">Theo dõi từ xác nhận đến giao món</h2>
          <p>{orders.length} đơn trong hệ thống · cập nhật trạng thái theo từng chặng vận hành.</p>
        </div>
      </div>

      <div className="eat-clean-toolbar">
        <label className="eat-clean-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Tìm đơn hàng</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Mã đơn, khách hàng, số điện thoại..."
          />
        </label>
        <label className="eat-clean-filter-field">
          <span>Trạng thái</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as OrderFilter)}>
            <option value="all">Tất cả</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="eat-clean-empty eat-clean-empty--compact">
          <ClipboardList size={30} aria-hidden="true" />
          <h3>Không tìm thấy đơn phù hợp</h3>
          <p>{orders.length === 0 ? 'Chưa có đơn hàng Eat Clean nào.' : 'Thử đổi từ khóa hoặc bộ lọc trạng thái.'}</p>
        </div>
      ) : (
        <>
          <div className="eat-clean-desktop-table" role="region" aria-label="Danh sách đơn hàng" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Đơn hàng</th>
                  <th>Khách hàng</th>
                  <th>Giao món</th>
                  <th>Giá trị</th>
                  <th>Trạng thái</th>
                  <th><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.code || order.id}</strong>
                      <small>{formatDateTime(order.createdAt)}</small>
                    </td>
                    <td>
                      <strong>{order.customer.name || 'Khách hàng'}</strong>
                      <small>{order.customer.phone || 'Chưa có số điện thoại'}</small>
                    </td>
                    <td>
                      <span>{order.serviceDate || 'Chưa chọn ngày'}</span>
                      <small>{order.deliverySlot?.label || 'Chưa chọn khung giờ'}</small>
                    </td>
                    <td>
                      <strong>{formatCurrency(order.total)}</strong>
                      <small>{order.items?.length ?? 0} món</small>
                    </td>
                    <td>
                      <span className={`eat-clean-status eat-clean-status--${order.status}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                    </td>
                    <td>
                      <button type="button" className="eat-clean-table-action" onClick={() => openOrder(order)}>
                        Chi tiết <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="eat-clean-mobile-list">
            {filteredOrders.map((order) => (
              <article key={order.id} className="eat-clean-mobile-card">
                <header>
                  <div>
                    <strong>{order.code || order.id}</strong>
                    <small>{formatDateTime(order.createdAt)}</small>
                  </div>
                  <span className={`eat-clean-status eat-clean-status--${order.status}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                </header>
                <div className="eat-clean-mobile-card__customer">
                  <span>{order.customer.name || 'Khách hàng'}</span>
                  <strong>{formatCurrency(order.total)}</strong>
                </div>
                <p><Truck size={15} /> {order.serviceDate || 'Chưa chọn ngày'} · {order.deliverySlot?.label || 'Chưa chọn giờ'}</p>
                {order.customer.addressLine && <p><MapPin size={15} /> {order.customer.addressLine}</p>}
                <button type="button" className="eat-clean-secondary-button" onClick={() => openOrder(order)}>
                  Xem và cập nhật <ChevronRight size={16} />
                </button>
              </article>
            ))}
          </div>
        </>
      )}

      <EatCleanSheet
        open={Boolean(selectedOrder)}
        title={selectedOrder ? `Đơn ${selectedOrder.code || selectedOrder.id}` : 'Chi tiết đơn hàng'}
        description="Kiểm tra món, thông tin giao và cập nhật đúng trạng thái thực tế."
        onClose={closeOrder}
        footer={(
          <>
            <button type="button" className="eat-clean-secondary-button" onClick={closeOrder} disabled={saving}>Đóng</button>
            <button type="button" className="eat-clean-primary-button" onClick={saveOrder} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu trạng thái'}
            </button>
          </>
        )}
      >
        {selectedOrder && (
          <div className="eat-clean-sheet-stack">
            <dl className="eat-clean-order-facts">
              <div><dt>Khách hàng</dt><dd>{selectedOrder.customer.name || 'Chưa có tên'}</dd></div>
              <div><dt>Liên hệ</dt><dd>{selectedOrder.customer.phone || 'Chưa cập nhật'}</dd></div>
              <div><dt>Thanh toán</dt><dd>{PAYMENT_STATUS_LABELS[selectedOrder.paymentStatus] ?? selectedOrder.paymentStatus}</dd></div>
              <div><dt>Tổng cộng</dt><dd>{formatCurrency(selectedOrder.total)}</dd></div>
            </dl>

            <section className="eat-clean-sheet-section">
              <h3>Món đã đặt</h3>
              <div className="eat-clean-order-lines">
                {(selectedOrder.items ?? []).map((item, index) => (
                  <div key={`${item.mealId}-${index}`}>
                    <span>{item.quantity} × {item.name}</span>
                    <strong>{formatCurrency(item.lineTotal || item.unitPrice * item.quantity)}</strong>
                  </div>
                ))}
                {(selectedOrder.items ?? []).length === 0 && <p>Backend chưa trả danh sách món cho đơn này.</p>}
              </div>
            </section>

            <section className="eat-clean-sheet-section">
              <h3>Thông tin giao</h3>
              <p>{selectedOrder.serviceDate || 'Chưa chọn ngày'} · {selectedOrder.deliverySlot?.label || 'Chưa chọn khung giờ'}</p>
              <p>{selectedOrder.customer.addressLine || 'Chưa cập nhật địa chỉ giao món.'}{selectedOrder.customer.ward ? `, ${selectedOrder.customer.ward}` : ''}</p>
              {selectedOrder.note && <p className="eat-clean-customer-note">Ghi chú khách: {selectedOrder.note}</p>}
            </section>

            <label className="eat-clean-field">
              <span>Trạng thái đơn</span>
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as EatCleanOrderStatus)}>
                {[selectedOrder.status, ...NEXT_ORDER_STATUSES[selectedOrder.status]].map((value) => (
                  <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label className="eat-clean-field">
              <span>Ghi chú vận hành</span>
              <textarea rows={3} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={500} placeholder="Ví dụ: đã gọi xác nhận, khách đổi giờ giao..." />
              <small>{adminNote.length}/500 ký tự</small>
            </label>
            {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
          </div>
        )}
      </EatCleanSheet>
    </section>
  )
}
