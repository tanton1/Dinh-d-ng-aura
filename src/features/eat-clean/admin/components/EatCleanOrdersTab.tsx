import { useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, ChevronRight, ClipboardList, MapPin, RotateCcw, Search, ShieldCheck, Truck } from 'lucide-react'
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
  readableError,
} from '../adminEatCleanUtils'
import type { EatCleanOrder, EatCleanOrderStatus, EatCleanRefundStatus, UpdateEatCleanOrderInput } from '../types'
import { EatCleanSheet } from './EatCleanSheet'

interface EatCleanOrdersTabProps {
  orders: EatCleanOrder[]
  onUpdateOrder: (input: UpdateEatCleanOrderInput) => Promise<void>
  onRecordRefundOutcome: (input: {
    orderId: string
    outcome: 'refunded' | 'rejected'
    idempotencyKey: string
    externalReference?: string
    note?: string
    confirmedExternally?: boolean
  }) => Promise<void>
  onReverseRefundOutcome: (input: {
    orderId: string
    adjustmentId: string
    idempotencyKey: string
    externalReference: string
    reason: string
    confirmedExternally: true
  }) => Promise<void>
}

type OrderFilter = 'all' | EatCleanOrderStatus

const NEXT_ORDER_STATUSES: Record<EatCleanOrderStatus, EatCleanOrderStatus[]> = {
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  // Delivery milestones and OTP are authoritative after the kitchen marks an
  // order ready. Admin cannot bypass the shipper flow from this sheet.
  ready: ['cancelled'],
  out_for_delivery: [],
  delivered: [],
  cancelled: [],
}

const REFUND_STATUS_LABELS: Record<EatCleanRefundStatus, string> = {
  blocked_provider_not_configured: 'Chờ đối soát ngoài hệ thống',
  manual_review_required: 'Cần kiểm tra thủ công',
  refunded: 'Đã ghi nhận hoàn tiền',
  rejected: 'Không hoàn tiền',
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `eat-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function EatCleanOrdersTab({
  orders,
  onUpdateOrder,
  onRecordRefundOutcome,
  onReverseRefundOutcome,
}: EatCleanOrdersTabProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<OrderFilter>('all')
  const [selectedOrder, setSelectedOrder] = useState<EatCleanOrder | null>(null)
  const [draftStatus, setDraftStatus] = useState<EatCleanOrderStatus>('pending_confirmation')
  const [adminNote, setAdminNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [refundExternalReference, setRefundExternalReference] = useState('')
  const [refundNote, setRefundNote] = useState('')
  const [refundConfirmedExternally, setRefundConfirmedExternally] = useState(false)
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState(createIdempotencyKey)
  const [refundSaving, setRefundSaving] = useState(false)
  const [refundError, setRefundError] = useState('')

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return orders.filter((order) => {
      if (filter !== 'all' && order.status !== filter) return false
      if (!normalizedQuery) return true
      return [order.code, order.customer.name, order.customer.phone, order.customer.addressLine]
        .some((value) => value?.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    })
  }, [filter, orders, query])
  const pendingRefundCount = useMemo(
    () => orders.filter((order) => order.refund && !['refunded', 'rejected'].includes(order.refund.status)).length,
    [orders],
  )

  const openOrder = (order: EatCleanOrder) => {
    setSelectedOrder(order)
    setDraftStatus(order.status)
    setAdminNote(order.adminNote ?? '')
    setError('')
    setRefundExternalReference('')
    setRefundNote('')
    setRefundConfirmedExternally(false)
    setRefundIdempotencyKey(createIdempotencyKey())
    setRefundError('')
  }

  const closeOrder = () => {
    if (!saving && !refundSaving) setSelectedOrder(null)
  }

  const resolveRefund = async (outcome: 'refunded' | 'rejected') => {
    if (!selectedOrder?.refund) return
    const externalReference = refundExternalReference.trim()
    const note = refundNote.trim()
    if (outcome === 'refunded' && (!refundConfirmedExternally || externalReference.length < 4)) {
      setRefundError('Cần xác nhận giao dịch ngoài hệ thống và nhập mã đối soát hợp lệ trước khi ghi nhận đã hoàn tiền.')
      return
    }
    if (outcome === 'rejected' && note.length < 4) {
      setRefundError('Cần nhập lý do rõ ràng khi chốt không hoàn tiền.')
      return
    }
    setRefundSaving(true)
    setRefundError('')
    try {
      await onRecordRefundOutcome({
        orderId: selectedOrder.id,
        outcome,
        idempotencyKey: refundIdempotencyKey,
        externalReference: externalReference || undefined,
        note: note || undefined,
        confirmedExternally: outcome === 'refunded' ? true : undefined,
      })
      setSelectedOrder(null)
    } catch (saveError) {
      setRefundError(readableError(saveError, 'Không thể ghi nhận kết quả hoàn tiền.'))
    } finally {
      setRefundSaving(false)
    }
  }

  const reverseRefund = async () => {
    const refund = selectedOrder?.refund
    if (!selectedOrder || !refund?.adjustmentId) return
    const externalReference = refundExternalReference.trim()
    const reason = refundNote.trim()
    if (!refundConfirmedExternally || externalReference.length < 4 || reason.length < 4) {
      setRefundError('Cần xác nhận ngoài hệ thống, nhập mã đối soát đảo giao dịch và lý do rõ ràng.')
      return
    }
    setRefundSaving(true)
    setRefundError('')
    try {
      await onReverseRefundOutcome({
        orderId: selectedOrder.id,
        adjustmentId: refund.adjustmentId,
        idempotencyKey: refundIdempotencyKey,
        externalReference,
        reason,
        confirmedExternally: true,
      })
      setSelectedOrder(null)
    } catch (saveError) {
      setRefundError(readableError(saveError, 'Không thể ghi nhận đảo giao dịch hoàn tiền.'))
    } finally {
      setRefundSaving(false)
    }
  }

  const saveOrder = async () => {
    if (!selectedOrder) return
    if (draftStatus === 'cancelled' && adminNote.trim().length < 4) {
      setError('Cần nhập lý do hủy rõ ràng trong ghi chú vận hành.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onUpdateOrder({
        orderId: selectedOrder.id,
        status: draftStatus,
        adminNote: adminNote.trim() || undefined,
        cancellationReason: draftStatus === 'cancelled' ? adminNote.trim() : undefined,
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
          <p>
            {orders.length} đơn trong hệ thống · cập nhật trạng thái theo từng chặng vận hành
            {pendingRefundCount > 0 ? ` · ${pendingRefundCount} yêu cầu hoàn tiền cần xử lý.` : '.'}
          </p>
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
                      {order.deliveryRecordMissing && <small className="eat-clean-integrity-text">Thiếu hồ sơ giao hàng</small>}
                      {order.refund && <small>{REFUND_STATUS_LABELS[order.refund.status]}</small>}
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
                {order.refund && <p><ShieldCheck size={15} /> {REFUND_STATUS_LABELS[order.refund.status]}</p>}
                {order.deliveryRecordMissing && <p className="eat-clean-integrity-text"><AlertTriangle size={15} /> Cần đối soát hồ sơ giao hàng</p>}
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
            <button type="button" className="eat-clean-secondary-button" onClick={closeOrder} disabled={saving || refundSaving}>Đóng</button>
            <button type="button" className="eat-clean-primary-button" onClick={saveOrder} disabled={saving || refundSaving}>
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

            {selectedOrder.refund && (
              <section className="eat-clean-sheet-section eat-clean-refund-card" aria-labelledby="eat-clean-refund-title">
                <div className="eat-clean-refund-card__heading">
                  <div>
                    <h3 id="eat-clean-refund-title">Đối soát hoàn tiền</h3>
                    <p>Không tự gọi nhà cung cấp thanh toán. Chỉ ghi nhận sau khi giao dịch ngoài hệ thống đã có bằng chứng.</p>
                  </div>
                  <span className={`eat-clean-status eat-clean-status--${selectedOrder.refund.status}`}>
                    {REFUND_STATUS_LABELS[selectedOrder.refund.status]}
                  </span>
                </div>
                <dl className="eat-clean-refund-facts">
                  <div><dt>Số tiền</dt><dd>{formatCurrency(selectedOrder.refund.amount)}</dd></div>
                  <div><dt>Phương thức</dt><dd>{selectedOrder.refund.paymentMethod || 'Chưa xác định'}</dd></div>
                  {selectedOrder.refund.externalReference && <div><dt>Mã đối soát</dt><dd>{selectedOrder.refund.externalReference}</dd></div>}
                </dl>

                {selectedOrder.refund.status !== 'rejected' && (
                  <>
                    <label className="eat-clean-field">
                      <span>{selectedOrder.refund.status === 'refunded' ? 'Mã đối soát đảo giao dịch' : 'Mã đối soát hoàn tiền'}</span>
                      <input
                        value={refundExternalReference}
                        onChange={(event) => setRefundExternalReference(event.target.value)}
                        maxLength={160}
                        placeholder="Nhập mã từ ngân hàng/cổng thanh toán"
                        disabled={refundSaving}
                      />
                    </label>
                    <label className="eat-clean-field">
                      <span>{selectedOrder.refund.status === 'refunded' ? 'Lý do đảo giao dịch' : 'Ghi chú đối soát / lý do không hoàn'}</span>
                      <textarea
                        rows={3}
                        value={refundNote}
                        onChange={(event) => setRefundNote(event.target.value)}
                        maxLength={500}
                        disabled={refundSaving}
                      />
                    </label>
                    <label className="eat-clean-refund-confirmation">
                      <input
                        type="checkbox"
                        checked={refundConfirmedExternally}
                        onChange={(event) => setRefundConfirmedExternally(event.target.checked)}
                        disabled={refundSaving}
                      />
                      <span>Tôi xác nhận giao dịch này đã được kiểm tra và hoàn tất ngoài hệ thống Aura.</span>
                    </label>
                    {refundError && <div className="eat-clean-inline-error" role="alert">{refundError}</div>}
                    <div className="eat-clean-refund-actions">
                      {selectedOrder.refund.status === 'refunded' ? (
                        <button type="button" className="eat-clean-secondary-button" onClick={() => void reverseRefund()} disabled={refundSaving}>
                          <RotateCcw size={16} /> {refundSaving ? 'Đang ghi…' : 'Ghi nhận đảo giao dịch'}
                        </button>
                      ) : (
                        <>
                          <button type="button" className="eat-clean-primary-button" onClick={() => void resolveRefund('refunded')} disabled={refundSaving}>
                            <BadgeCheck size={16} /> {refundSaving ? 'Đang ghi…' : 'Ghi nhận đã hoàn'}
                          </button>
                          <button type="button" className="eat-clean-secondary-button" onClick={() => void resolveRefund('rejected')} disabled={refundSaving}>
                            Chốt không hoàn tiền
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
                {selectedOrder.refund.reversalAdjustmentId && (
                  <div className="eat-clean-inline-success">Đã có bút toán đảo trước đó. Lịch sử vẫn được giữ bất biến; yêu cầu hiện tại có thể tiếp tục đối soát theo trạng thái mới.</div>
                )}
              </section>
            )}

            <label className="eat-clean-field">
              <span>Trạng thái đơn</span>
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as EatCleanOrderStatus)} disabled={refundSaving}>
                {[selectedOrder.status, ...NEXT_ORDER_STATUSES[selectedOrder.status]].map((value) => (
                  <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>
                ))}
              </select>
            </label>
            {draftStatus === 'cancelled' && (
              <div className="eat-clean-inline-error" role="note">
                {['preparing', 'ready'].includes(selectedOrder.status)
                  ? 'Đơn đã vào bếp: hệ thống sẽ giải phóng tồn kho nhưng bắt buộc đánh dấu kiểm tra hao hụt và hoàn tiền thủ công nếu đã thanh toán.'
                  : 'Hủy trước khi vào bếp sẽ giải phóng suất giữ. Nếu đã thu tiền, yêu cầu hoàn tiền được khóa chờ đối soát ngoài hệ thống.'}
              </div>
            )}
            <label className="eat-clean-field">
              <span>Ghi chú vận hành</span>
              <textarea rows={3} value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={500} placeholder="Ví dụ: đã gọi xác nhận, khách đổi giờ giao..." disabled={refundSaving} />
              <small>{adminNote.length}/500 ký tự</small>
            </label>
            {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
          </div>
        )}
      </EatCleanSheet>
    </section>
  )
}
