import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Flame,
  History,
  Leaf,
  LoaderCircle,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import './EatCleanPage.css'
import { EatCleanDeliveryPanel } from './EatCleanDeliveryPanel'
import { EatCleanTrackingPanel } from './EatCleanTrackingPanel'
import { addEatCleanCartItem, readEatCleanCart, setEatCleanCartQuantity, writeEatCleanCart } from './cartStorage'
import {
  clearEatCleanCheckoutAttempt,
  getOrCreateEatCleanCheckoutAttempt,
  readEatCleanCheckoutAttempt,
} from './checkoutAttemptStorage'
import { createDemoOrder } from './demoCatalog'
import {
  cancelEatCleanOrder,
  confirmEatCleanConsumption,
  createEatCleanOrder,
  getEatCleanStorefront,
  isEatCleanDemoMode,
  listMyEatCleanOrders,
  quoteEatCleanOrder,
  recommendEatCleanMeals,
} from './eatCleanService'
import {
  EAT_CLEAN_STATUS_LABELS,
  EatCleanLoading,
  EatCleanMealCard,
  EatCleanQuantityControl,
  EatCleanState,
  EatCleanStatusBadge,
  formatEatCleanDate,
  formatEatCleanMoney,
} from './EatCleanUi'
import type {
  EatCleanCartItem,
  EatCleanCartLine,
  EatCleanCreateOrderRequest,
  EatCleanDeliveryAddress,
  EatCleanDeliverySlot,
  EatCleanDistrict,
  EatCleanMeal,
  EatCleanMealCategory,
  EatCleanOrder,
  EatCleanOrderQuote,
  EatCleanPageProps,
  EatCleanPaymentMethod,
  EatCleanRoute,
  EatCleanStorefront,
} from './types'

const DEFAULT_ROUTE: EatCleanRoute = { screen: 'storefront' }

function vietnamIsoDate(dayOffset = 0) {
  const vietnamTime = new Date(Date.now() + 7 * 60 * 60 * 1000)
  vietnamTime.setUTCDate(vietnamTime.getUTCDate() + dayOffset)
  return `${vietnamTime.getUTCFullYear()}-${String(vietnamTime.getUTCMonth() + 1).padStart(2, '0')}-${String(vietnamTime.getUTCDate()).padStart(2, '0')}`
}

function tomorrowIsoDate() {
  return vietnamIsoDate(1)
}

function todayIsoDate() {
  return vietnamIsoDate()
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback
  const message = error.message.trim()
  if (/^(internal|functions\/internal)$/i.test(message)) return `${fallback} Dịch vụ chưa phản hồi đúng, vui lòng thử lại.`
  return message
}

function screenTitle(route: EatCleanRoute) {
  switch (route.screen) {
    case 'meal-detail': return 'Chi tiết món'
    case 'cart': return 'Giỏ Eat Clean'
    case 'checkout': return 'Xác nhận đơn'
    case 'orders': return 'Đơn của bạn'
    case 'order-detail': return 'Chi tiết đơn'
    default: return 'Eat Clean'
  }
}

function mergeOrder(orders: EatCleanOrder[], nextOrder: EatCleanOrder) {
  return [nextOrder, ...orders.filter((order) => order.id !== nextOrder.id)]
}

export default function EatCleanPage({
  route = DEFAULT_ROUTE,
  onNavigate,
  ownerId,
  displayName,
  recommendationProfile = {},
  onBack,
  onOrderCreated,
  onConsumptionConfirmed,
}: EatCleanPageProps) {
  const [storefront, setStorefront] = useState<EatCleanStorefront | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cart, setCart] = useState<EatCleanCartItem[]>(() => readEatCleanCart(ownerId))
  const [orders, setOrders] = useState<EatCleanOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [ordersReloadKey, setOrdersReloadKey] = useState(0)
  const [recommendedIds, setRecommendedIds] = useState<string[]>([])
  const [recommendationReason, setRecommendationReason] = useState('')
  const [recommending, setRecommending] = useState(false)
  const [actionError, setActionError] = useState('')
  const [quote, setQuote] = useState<EatCleanOrderQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [deliveryContextLoading, setDeliveryContextLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkoutContact, setCheckoutContact] = useState({ fullName: displayName ?? '', phone: '' })
  const [deliveryAddress, setDeliveryAddress] = useState<EatCleanDeliveryAddress>({
    addressLine: '',
    ward: '',
    districtId: 'hai-chau',
    city: 'Đà Nẵng',
    deliveryMode: 'scheduled',
    deliveryDate: tomorrowIsoDate(),
    deliveryWindow: 'morning',
  })
  const [paymentMethod, setPaymentMethod] = useState<EatCleanPaymentMethod>('cod')
  const [orderNote, setOrderNote] = useState('')
  const checkoutAttemptRef = useRef(readEatCleanCheckoutAttempt(ownerId))
  const deliveryContextRequestRef = useRef(0)
  const quoteRequestRef = useRef(0)

  const invalidateQuote = useCallback(() => {
    quoteRequestRef.current += 1
    setQuote(null)
    setQuoteLoading(false)
  }, [])

  const loadStorefront = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const scheduledStorefront = await getEatCleanStorefront({ deliveryMode: 'scheduled' })
      const nextStorefront = scheduledStorefront.asapEnabled
        ? await getEatCleanStorefront({ deliveryMode: 'asap' }).catch(() => scheduledStorefront)
        : scheduledStorefront
      setStorefront(nextStorefront)
      setDeliveryAddress((current) => {
        const slots = (nextStorefront.deliverySlots ?? []).filter((slot) => slot.active)
        const districts = (nextStorefront.districts ?? []).filter((district) => district.active)
        return {
          ...current,
          city: 'Đà Nẵng',
          deliveryMode: nextStorefront.deliveryMode,
          deliveryDate: nextStorefront.serviceDate ?? current.deliveryDate,
          deliveryWindow: nextStorefront.deliveryMode === 'asap'
            ? 'asap'
            : slots.some((slot) => slot.id === current.deliveryWindow) ? current.deliveryWindow : slots[0]?.id ?? current.deliveryWindow,
          districtId: districts.some((district) => district.id === current.districtId) ? current.districtId : districts[0]?.id ?? current.districtId,
        }
      })
    } catch (error) {
      setStorefront(null)
      setLoadError(actionErrorMessage(error, 'Chưa thể tải thực đơn Eat Clean.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const changeDeliveryAddress = useCallback(async (nextAddress: EatCleanDeliveryAddress) => {
    const previousAddress = deliveryAddress
    const nextMode = nextAddress.deliveryMode ?? 'scheduled'
    const nextServiceDate = nextMode === 'asap' ? todayIsoDate() : nextAddress.deliveryDate
    const catalogContextChanged = Boolean(storefront)
      && (storefront?.deliveryMode !== nextMode
        || (nextMode === 'scheduled' && storefront.serviceDate !== nextServiceDate))
    setDeliveryAddress(nextAddress)
    invalidateQuote()
    if (!catalogContextChanged) return
    const requestId = deliveryContextRequestRef.current + 1
    deliveryContextRequestRef.current = requestId
    setDeliveryContextLoading(true)
    try {
      const nextStorefront = await getEatCleanStorefront({ deliveryMode: nextMode, serviceDate: nextServiceDate })
      if (deliveryContextRequestRef.current !== requestId) return
      setStorefront(nextStorefront)
    } catch (error) {
      if (deliveryContextRequestRef.current !== requestId) return
      setDeliveryAddress(previousAddress)
      setActionError(actionErrorMessage(error, 'Chưa thể tải tồn kho cho thời gian giao đã chọn.'))
    } finally {
      if (deliveryContextRequestRef.current === requestId) setDeliveryContextLoading(false)
    }
  }, [deliveryAddress, invalidateQuote, storefront])

  useEffect(() => { void loadStorefront() }, [loadStorefront])

  useEffect(() => {
    if ((route.screen !== 'orders' && route.screen !== 'order-detail') || !storefront || storefront.source === 'demo') return
    let active = true
    setOrdersLoading(true)
    setOrdersError('')
    void listMyEatCleanOrders()
      .then((nextOrders) => { if (active) setOrders(nextOrders) })
      .catch((error) => { if (active) setOrdersError(actionErrorMessage(error, 'Chưa thể tải danh sách đơn.')) })
      .finally(() => { if (active) setOrdersLoading(false) })
    return () => { active = false }
  }, [route.screen, storefront, ordersReloadKey, ownerId])

  useEffect(() => {
    const nextCart = readEatCleanCart(ownerId)
    setCart(nextCart)
    checkoutAttemptRef.current = readEatCleanCheckoutAttempt(ownerId)
    setCheckoutContact({ fullName: displayName ?? '', phone: '' })
    setDeliveryAddress({
      addressLine: '',
      ward: '',
      districtId: 'hai-chau',
      city: 'Đà Nẵng',
      deliveryMode: 'scheduled',
      deliveryDate: tomorrowIsoDate(),
      deliveryWindow: 'morning',
    })
    setOrderNote('')
    invalidateQuote()
    setOrders([])
  }, [invalidateQuote, ownerId])

  const updateCart = useCallback((nextCart: EatCleanCartItem[]) => {
    setCart(writeEatCleanCart(ownerId, nextCart))
    clearEatCleanCheckoutAttempt(ownerId)
    checkoutAttemptRef.current = null
    invalidateQuote()
    setActionError('')
  }, [invalidateQuote, ownerId])

  const mealsById = useMemo(() => new Map((storefront?.meals ?? []).map((meal) => [meal.id, meal])), [storefront?.meals])
  const cartLines = useMemo<EatCleanCartLine[]>(() => cart.flatMap((item) => {
    const meal = mealsById.get(item.mealId)
    if (!meal) return []
    return [{ ...item, meal, unitPrice: meal.price, lineTotal: meal.price * item.quantity }]
  }), [cart, mealsById])
  const cartQuantity = cart.reduce((total, item) => total + item.quantity, 0)
  const estimatedSubtotal = cartLines.reduce((total, line) => total + line.lineTotal, 0)

  const addMeal = useCallback((meal: EatCleanMeal, quantity = 1) => {
    if (!meal.available) return
    if (!storefront?.orderingEnabled) {
      setActionError('Cửa hàng đang tạm ngừng nhận đơn. Bạn vẫn có thể xem thực đơn và quay lại sau.')
      return
    }
    updateCart(addEatCleanCartItem(cart, meal.id, quantity))
  }, [cart, storefront?.orderingEnabled, updateCart])

  const navigate = (nextRoute: EatCleanRoute) => {
    setActionError('')
    onNavigate(nextRoute)
  }

  const requestRecommendations = async () => {
    setRecommending(true)
    setActionError('')
    try {
      const result = await recommendEatCleanMeals(recommendationProfile, 4)
      setRecommendedIds(result.mealIds)
      setRecommendationReason(result.reason ?? 'Aura đã ưu tiên các món phù hợp với mục tiêu của bạn.')
    } catch (error) {
      setActionError(actionErrorMessage(error, 'Chưa thể tạo gợi ý cá nhân hóa.'))
    } finally {
      setRecommending(false)
    }
  }

  const requestQuote = useCallback(async () => {
    if (cart.length === 0) return
    const digits = checkoutContact.phone.replace(/\D/g, '')
    const scheduleMissing = deliveryAddress.deliveryMode === 'scheduled' && (!deliveryAddress.deliveryDate || !deliveryAddress.deliveryWindow)
    if (!checkoutContact.fullName.trim() || digits.length < 9 || !deliveryAddress.addressLine.trim() || !deliveryAddress.ward?.trim() || !deliveryAddress.districtId || scheduleMissing) {
      setActionError('Hãy nhập đủ người nhận, phường/xã, quận/huyện và thời gian giao trước khi báo giá.')
      return
    }
    setQuoteLoading(true)
    setActionError('')
    const requestId = quoteRequestRef.current + 1
    quoteRequestRef.current = requestId
    try {
      const nextQuote = await quoteEatCleanOrder(
        { items: cart, contact: checkoutContact, deliveryAddress, paymentMethod, note: orderNote.trim() || undefined },
      )
      if (quoteRequestRef.current !== requestId) return
      setQuote(nextQuote)
    } catch (error) {
      if (quoteRequestRef.current !== requestId) return
      setQuote(null)
      setActionError(actionErrorMessage(error, 'Chưa thể tính phí cho đơn hàng.'))
    } finally {
      if (quoteRequestRef.current === requestId) setQuoteLoading(false)
    }
  }, [cart, checkoutContact, deliveryAddress, orderNote, paymentMethod, storefront?.source])

  const placeOrder = async () => {
    const digits = checkoutContact.phone.replace(/\D/g, '')
    if (!storefront?.orderingEnabled) {
      setActionError('Cửa hàng đang tạm ngừng nhận đơn mới.')
      return
    }
    if (!checkoutContact.fullName.trim() || digits.length < 9 || !deliveryAddress.addressLine.trim() || !deliveryAddress.ward?.trim() || !deliveryAddress.districtId || !deliveryAddress.city.trim()) {
      setActionError('Hãy nhập đủ họ tên, số điện thoại, phường/xã và quận/huyện giao món.')
      return
    }
    if (!quote) {
      setActionError('Hãy cập nhật báo giá trước khi đặt món.')
      return
    }
    setSubmitting(true)
    setActionError('')
    try {
      const attemptPayload = {
        items: cart,
        contact: { fullName: checkoutContact.fullName.trim(), phone: checkoutContact.phone.trim() },
        deliveryAddress: { ...deliveryAddress, addressLine: deliveryAddress.addressLine.trim(), city: deliveryAddress.city.trim() },
        paymentMethod,
        note: orderNote.trim() || undefined,
      }
      const attempt = getOrCreateEatCleanCheckoutAttempt(ownerId, attemptPayload, checkoutAttemptRef.current)
      checkoutAttemptRef.current = attempt
      const input: EatCleanCreateOrderRequest = {
        quoteId: quote.quoteId,
        idempotencyKey: attempt.idempotencyKey,
        ...attemptPayload,
      }
      const order = storefront?.source === 'demo'
        ? createDemoOrder(quote, {
          contact: input.contact,
          deliveryAddress: input.deliveryAddress,
          paymentMethod: input.paymentMethod,
          note: input.note,
        })
        : await createEatCleanOrder(input)
      setOrders((current) => mergeOrder(current, order))
      updateCart([])
      clearEatCleanCheckoutAttempt(ownerId)
      checkoutAttemptRef.current = null
      onOrderCreated?.(order)
      navigate({ screen: 'order-detail', orderId: order.id })
    } catch (error) {
      setActionError(actionErrorMessage(error, 'Chưa thể tạo đơn Eat Clean.'))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelOrder = async (order: EatCleanOrder) => {
    if (!window.confirm(`Hủy đơn ${order.code}?`)) return
    setSubmitting(true)
    setActionError('')
    try {
      const nextOrder = storefront?.source === 'demo'
        ? { ...order, status: 'cancelled' as const, canCancel: false, updatedAt: new Date().toISOString() }
        : await cancelEatCleanOrder(order.id, 'Khách hàng yêu cầu hủy trên ứng dụng')
      setOrders((current) => mergeOrder(current, nextOrder))
    } catch (error) {
      setActionError(actionErrorMessage(error, 'Chưa thể hủy đơn.'))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmConsumption = async (order: EatCleanOrder, consumedRatio: 25 | 50 | 75 | 100) => {
    setSubmitting(true)
    setActionError('')
    try {
      const nextOrder = storefront?.source === 'demo'
        ? { ...order, consumptionConfirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        : await confirmEatCleanConsumption(order.id, order.items.map((item) => item.mealId), consumedRatio)
      setOrders((current) => mergeOrder(current, nextOrder))
      onConsumptionConfirmed?.(nextOrder)
    } catch (error) {
      setActionError(actionErrorMessage(error, 'Chưa thể ghi nhận bữa ăn vào nhật ký.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <main className="page eat-clean-page"><EatCleanLoading /></main>

  if (!storefront) {
    return (
      <main className="page eat-clean-page">
        <EatCleanState
          icon={<AlertCircle size={28} />}
          title="Chưa tải được Eat Clean"
          description={loadError || 'Hãy kiểm tra kết nối và thử lại.'}
          action={<div className="eat-clean-state__actions"><button type="button" className="eat-clean-button eat-clean-button--primary" onClick={() => void loadStorefront()}><RefreshCw size={17} /> Thử lại</button>{isEatCleanDemoMode && <span>Chế độ demo đang bật.</span>}</div>}
        />
      </main>
    )
  }

  const selectedMeal = route.screen === 'meal-detail' ? mealsById.get(route.mealId) : undefined
  const selectedOrder = route.screen === 'order-detail' ? orders.find((order) => order.id === route.orderId) : undefined
  const showBack = route.screen !== 'storefront'

  return (
    <main className={`page eat-clean-page eat-clean-page--${route.screen}`}>
      <header className="eat-clean-toolbar">
        <div>
          {showBack ? (
            <button type="button" className="eat-clean-icon-button" aria-label="Quay lại" onClick={() => navigate(route.screen === 'meal-detail' ? { screen: 'storefront' } : route.screen === 'checkout' ? { screen: 'cart' } : route.screen === 'order-detail' ? { screen: 'orders' } : { screen: 'storefront' })}>
              <ArrowLeft size={21} />
            </button>
          ) : onBack ? (
            <button type="button" className="eat-clean-icon-button" aria-label="Quay lại" onClick={onBack}><ArrowLeft size={21} /></button>
          ) : null}
          <span><small>AURA NUTRITION</small><strong>{screenTitle(route)}</strong></span>
        </div>
        <div className="eat-clean-toolbar__actions">
          <button type="button" className="eat-clean-toolbar__orders" onClick={() => navigate({ screen: 'cart' })} aria-label="Mở giỏ Eat Clean">
            <ShoppingCart size={19} /><span>Giỏ hàng</span>{cartQuantity > 0 && <i>{cartQuantity}</i>}
          </button>
          <button type="button" className="eat-clean-toolbar__orders" onClick={() => navigate({ screen: 'orders' })} aria-label="Xem đơn Eat Clean">
            <History size={19} /><span>Đơn hàng</span>
          </button>
        </div>
      </header>

      {storefront.notice && route.screen === 'storefront' && <div className="eat-clean-notice"><Sparkles size={16} /><span>{storefront.notice}</span></div>}
      {!storefront.orderingEnabled && route.screen === 'storefront' && <div className="eat-clean-alert" role="status"><Clock3 size={18} /><span>Cửa hàng đang tạm ngừng nhận đơn. Thực đơn vẫn mở để bạn tham khảo.</span></div>}
      {actionError && <div className="eat-clean-alert" role="alert"><AlertCircle size={18} /><span>{actionError}</span><button type="button" aria-label="Đóng" onClick={() => setActionError('')}><XCircle size={18} /></button></div>}

      {route.screen === 'storefront' && (
        <StorefrontScreen
          storefront={storefront}
          displayName={displayName}
          recommendedIds={recommendedIds}
          recommendationReason={recommendationReason}
          recommending={recommending}
          onRecommend={() => void requestRecommendations()}
          onOpen={(mealId) => navigate({ screen: 'meal-detail', mealId })}
          onAdd={addMeal}
        />
      )}
      {route.screen === 'meal-detail' && (
        <MealDetailScreen meal={selectedMeal} currentQuantity={selectedMeal ? cart.find((item) => item.mealId === selectedMeal.id)?.quantity ?? 0 : 0} onAdd={addMeal} onBrowse={() => navigate({ screen: 'storefront' })} />
      )}
      {route.screen === 'cart' && (
        <CartScreen lines={cartLines} onQuantityChange={(mealId, quantity) => updateCart(setEatCleanCartQuantity(cart, mealId, quantity))} onBrowse={() => navigate({ screen: 'storefront' })} onCheckout={() => navigate({ screen: 'checkout' })} />
      )}
      {route.screen === 'checkout' && (
        <CheckoutScreen
          lines={cartLines}
          contact={checkoutContact}
          address={deliveryAddress}
          paymentMethod={paymentMethod}
          note={orderNote}
          quote={quote}
          quoteLoading={quoteLoading}
          submitting={submitting}
          onContactChange={(value) => { setCheckoutContact(value); invalidateQuote() }}
          onAddressChange={(value) => { void changeDeliveryAddress(value) }}
          onNoteChange={(value) => { setOrderNote(value); invalidateQuote() }}
          onQuote={() => void requestQuote()}
          onSubmit={() => void placeOrder()}
          onBrowse={() => navigate({ screen: 'storefront' })}
          deliverySlots={storefront.deliverySlots ?? []}
          districts={storefront.districts ?? []}
          ownerId={ownerId}
          asapEnabled={storefront.asapEnabled}
          deliveryContextLoading={deliveryContextLoading}
        />
      )}
      {route.screen === 'orders' && <OrdersScreen orders={orders} loading={ordersLoading} error={ordersError} onRetry={() => setOrdersReloadKey((value) => value + 1)} onOpen={(orderId) => navigate({ screen: 'order-detail', orderId })} onBrowse={() => navigate({ screen: 'storefront' })} />}
      {route.screen === 'order-detail' && <OrderDetailScreen order={selectedOrder} loading={ordersLoading} error={ordersError} submitting={submitting} onCancel={cancelOrder} onConfirmConsumption={confirmConsumption} onOrders={() => navigate({ screen: 'orders' })} />}

      {route.screen === 'storefront' && cartQuantity > 0 && (
        <button type="button" className="eat-clean-cart-dock" onClick={() => navigate({ screen: 'cart' })}>
          <span><ShoppingCart size={20} /><i>{cartQuantity}</i><strong>Xem giỏ</strong></span>
          <b>{formatEatCleanMoney(estimatedSubtotal)}</b>
          <ChevronRight size={19} />
        </button>
      )}
    </main>
  )
}

function StorefrontScreen({
  storefront,
  displayName,
  recommendedIds,
  recommendationReason,
  recommending,
  onRecommend,
  onOpen,
  onAdd,
}: {
  storefront: EatCleanStorefront
  displayName?: string
  recommendedIds: string[]
  recommendationReason: string
  recommending: boolean
  onRecommend: () => void
  onOpen: (mealId: string) => void
  onAdd: (meal: EatCleanMeal) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<EatCleanMealCategory | 'all'>('all')
  const normalizedSearch = search.trim().toLocaleLowerCase('vi')
  const meals = storefront.meals.filter((meal) => {
    if (category !== 'all' && meal.category !== category) return false
    if (!normalizedSearch) return true
    return `${meal.name} ${meal.shortDescription} ${meal.tags.join(' ')}`.toLocaleLowerCase('vi').includes(normalizedSearch)
  })
  const recommendedSet = new Set(recommendedIds)

  return (
    <div className="eat-clean-stack" data-testid="eat-clean-storefront">
      <section className="eat-clean-hero">
        <div className="eat-clean-hero__copy">
          <span><Leaf size={16} /> Ăn sạch · sống khỏe</span>
          <h1>Bữa ngon đúng mục tiêu, giao đến tận tay.</h1>
          <p>{displayName ? `${displayName}, ` : ''}chọn món theo macro rõ ràng và để Aura lo phần chuẩn bị.</p>
          <div>
            <button type="button" className="eat-clean-button eat-clean-button--light" onClick={onRecommend} disabled={recommending}>
              {recommending ? <LoaderCircle className="eat-clean-spin" size={18} /> : <Sparkles size={18} />}
              {recommending ? 'Đang chọn món…' : 'Gợi ý cho tôi'}
            </button>
            {storefront.nextDeliveryLabel && <small><Truck size={15} /> {storefront.nextDeliveryLabel}</small>}
          </div>
        </div>
        <div className="eat-clean-hero__facts" aria-label="Cam kết Eat Clean">
          <span><BadgeCheck size={19} /><strong>Macro rõ</strong><small>Định lượng từng phần</small></span>
          <span><Clock3 size={19} /><strong>Nấu mới</strong><small>Theo ca giao hàng</small></span>
          <span><Leaf size={19} /><strong>Ít dầu</strong><small>Ưu tiên nguyên liệu thật</small></span>
        </div>
      </section>

      {recommendationReason && <div className="eat-clean-recommendation-note"><Sparkles size={17} /><span><strong>Aura gợi ý:</strong> {recommendationReason}</span></div>}

      <section className="eat-clean-catalog">
        <div className="eat-clean-section-heading"><div><small>THỰC ĐƠN HÔM NAY</small><h2>Chọn bữa phù hợp</h2></div><span>{meals.length} món</span></div>
        <label className="eat-clean-search"><Search size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm món, nguyên liệu hoặc mục tiêu…" /></label>
        <div className="eat-clean-categories" role="list" aria-label="Nhóm món Eat Clean">
          {storefront.categories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </div>
        {meals.length > 0 ? (
          <div className="eat-clean-meal-grid">
            {meals.map((meal) => <EatCleanMealCard key={meal.id} meal={meal} recommended={recommendedSet.has(meal.id)} onOpen={() => onOpen(meal.id)} onAdd={() => onAdd(meal)} />)}
          </div>
        ) : (
          <EatCleanState icon={<Search size={26} />} title="Chưa tìm thấy món" description="Thử từ khóa khác hoặc chọn lại nhóm thực đơn." action={<button type="button" className="eat-clean-button eat-clean-button--secondary" onClick={() => { setSearch(''); setCategory('all') }}>Xóa bộ lọc</button>} />
        )}
      </section>
    </div>
  )
}

function MealDetailScreen({ meal, currentQuantity, onAdd, onBrowse }: { meal?: EatCleanMeal; currentQuantity: number; onAdd: (meal: EatCleanMeal, quantity: number) => void; onBrowse: () => void }) {
  const [quantity, setQuantity] = useState(1)
  if (!meal) return <EatCleanState icon={<UtensilsCrossed size={27} />} title="Không tìm thấy món" description="Món này có thể đã ngừng phục vụ." action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onBrowse}>Xem thực đơn</button>} />
  return (
    <div className="eat-clean-detail" data-testid="eat-clean-meal-detail">
      <div className="eat-clean-detail__visual">{meal.imageUrl ? <img src={meal.imageUrl} alt={meal.name} /> : <UtensilsCrossed size={42} />}{meal.badge && <span>{meal.badge}</span>}</div>
      <section className="eat-clean-detail__content">
        <div className="eat-clean-detail__title"><div><div className="eat-clean-tag-row">{meal.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><h1>{meal.name}</h1><p>{meal.description}</p></div><strong>{formatEatCleanMoney(meal.price)}</strong></div>
        <div className="eat-clean-macro-grid">
          <span><Flame size={18} /><strong>{meal.nutrition.calories}</strong><small>kcal</small></span>
          <span><strong>{meal.nutrition.protein}g</strong><small>Đạm</small></span>
          <span><strong>{meal.nutrition.carbs}g</strong><small>Carb</small></span>
          <span><strong>{meal.nutrition.fat}g</strong><small>Chất béo</small></span>
        </div>
        <div className="eat-clean-detail__grid">
          <div><h2>Thành phần</h2><ul>{meal.ingredients.map((ingredient) => <li key={ingredient}><Check size={15} /> {ingredient}</li>)}</ul></div>
          <div><h2>Thông tin phần ăn</h2><dl><div><dt>Khẩu phần</dt><dd>{meal.portionLabel}</dd></div><div><dt>Chuẩn bị</dt><dd>{meal.prepMinutes ?? 15} phút</dd></div><div><dt>Dị ứng</dt><dd>{meal.allergens?.length ? meal.allergens.join(', ') : 'Không ghi nhận'}</dd></div></dl></div>
        </div>
        <div className="eat-clean-detail__action"><EatCleanQuantityControl value={quantity} onChange={(value) => setQuantity(Math.max(1, Math.min(20, value)))} /><button type="button" className="eat-clean-button eat-clean-button--primary" disabled={!meal.available} onClick={() => onAdd(meal, quantity)}><ShoppingBag size={18} />{currentQuantity > 0 ? `Thêm nữa · Đang có ${currentQuantity}` : meal.available ? 'Thêm vào giỏ' : 'Tạm hết món'}</button></div>
      </section>
    </div>
  )
}

function CartScreen({ lines, onQuantityChange, onBrowse, onCheckout }: { lines: EatCleanCartLine[]; onQuantityChange: (mealId: string, quantity: number) => void; onBrowse: () => void; onCheckout: () => void }) {
  if (lines.length === 0) return <EatCleanState icon={<ShoppingCart size={28} />} title="Giỏ đang trống" description="Chọn một vài bữa ngon để bắt đầu đơn Eat Clean." action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onBrowse}>Chọn món ngay</button>} />
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  return (
    <div className="eat-clean-cart-layout" data-testid="eat-clean-cart">
      <section className="eat-clean-card eat-clean-cart-list"><div className="eat-clean-section-heading"><div><small>GIỎ CỦA BẠN</small><h1>{lines.length} món đã chọn</h1></div></div>{lines.map((line) => <article className="eat-clean-cart-line" key={line.mealId}>{line.meal.imageUrl ? <img src={line.meal.imageUrl} alt="" /> : <span />}<div><strong>{line.meal.name}</strong><small>{line.meal.nutrition.calories} kcal · {line.meal.portionLabel}</small><b>{formatEatCleanMoney(line.unitPrice)}</b></div><div><EatCleanQuantityControl compact value={line.quantity} onChange={(quantity) => onQuantityChange(line.mealId, quantity)} /><button type="button" aria-label={`Xóa ${line.meal.name}`} onClick={() => onQuantityChange(line.mealId, 0)}><Trash2 size={17} /></button></div></article>)}</section>
      <aside className="eat-clean-card eat-clean-summary"><h2>Tạm tính</h2><dl><div><dt>Tiền món</dt><dd>{formatEatCleanMoney(subtotal)}</dd></div><div><dt>Phí giao</dt><dd>Tính ở bước sau</dd></div></dl><div className="eat-clean-summary__total"><span>Tạm tính</span><strong>{formatEatCleanMoney(subtotal)}</strong></div><button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onCheckout}>Tiếp tục giao hàng <ChevronRight size={18} /></button><button type="button" className="eat-clean-text-button" onClick={onBrowse}>Thêm món khác</button></aside>
    </div>
  )
}

function CheckoutScreen({ ownerId, lines, contact, address, paymentMethod, note, quote, quoteLoading, submitting, deliverySlots, districts, asapEnabled, deliveryContextLoading, onContactChange, onAddressChange, onNoteChange, onQuote, onSubmit, onBrowse }: { ownerId?: string; lines: EatCleanCartLine[]; contact: { fullName: string; phone: string }; address: EatCleanDeliveryAddress; paymentMethod: EatCleanPaymentMethod; note: string; quote: EatCleanOrderQuote | null; quoteLoading: boolean; submitting: boolean; deliverySlots: EatCleanDeliverySlot[]; districts: EatCleanDistrict[]; asapEnabled: boolean; deliveryContextLoading: boolean; onContactChange: (value: { fullName: string; phone: string }) => void; onAddressChange: (value: EatCleanDeliveryAddress) => void; onNoteChange: (value: string) => void; onQuote: () => void; onSubmit: () => void; onBrowse: () => void }) {
  if (lines.length === 0) return <EatCleanState icon={<ShoppingBag size={28} />} title="Không còn món để đặt" description="Giỏ đã trống hoặc các món không còn phục vụ." action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onBrowse}>Về thực đơn</button>} />
  const activeSlots = deliverySlots.filter((slot) => slot.active)
  const deliveryMode = address.deliveryMode ?? 'asap'
  const distanceLabel = quote?.distanceMeters == null ? '' : `${(quote.distanceMeters / 1000).toFixed(1)} km`
  const durationLabel = quote?.routeDurationSeconds == null ? '' : `${Math.max(1, Math.round(quote.routeDurationSeconds / 60))} phút di chuyển`
  return (
    <div className="eat-clean-checkout" data-testid="eat-clean-checkout">
      <div className="eat-clean-checkout__form">
        <EatCleanDeliveryPanel ownerId={ownerId} contact={contact} address={address} districts={districts} onContactChange={onContactChange} onAddressChange={onAddressChange} />
        <section className="eat-clean-card eat-clean-delivery-time">
          <div className="eat-clean-section-heading"><div><small>BƯỚC 2</small><h2>Khi nào bạn muốn nhận?</h2></div><CalendarDays size={21} /></div>
          <div className={`eat-clean-delivery-mode ${!asapEnabled ? 'is-scheduled-only' : ''}`} role="radiogroup" aria-label="Chế độ giao hàng" aria-busy={deliveryContextLoading}>
            {asapEnabled && <button type="button" role="radio" aria-checked={deliveryMode === 'asap'} className={deliveryMode === 'asap' ? 'is-active' : ''} disabled={deliveryContextLoading} onClick={() => onAddressChange({ ...address, deliveryMode: 'asap', deliveryDate: todayIsoDate(), deliveryWindow: 'asap' })}><Truck size={20} /><span><strong>Giao sớm nhất</strong><small>Bếp xác nhận và giao ngay khi món sẵn sàng</small></span>{deliveryMode === 'asap' && <Check size={18} />}</button>}
            <button type="button" role="radio" aria-checked={deliveryMode === 'scheduled'} className={deliveryMode === 'scheduled' ? 'is-active' : ''} disabled={deliveryContextLoading} onClick={() => onAddressChange({ ...address, deliveryMode: 'scheduled', deliveryDate: address.deliveryDate && address.deliveryDate > todayIsoDate() ? address.deliveryDate : tomorrowIsoDate(), deliveryWindow: address.deliveryWindow && address.deliveryWindow !== 'asap' ? address.deliveryWindow : activeSlots[0]?.id ?? 'morning' })}><CalendarDays size={20} /><span><strong>Đặt lịch giao</strong><small>Chọn trước ngày và khung giờ phù hợp</small></span>{deliveryMode === 'scheduled' && <Check size={18} />}</button>
          </div>
          {deliveryContextLoading && <div className="eat-clean-context-loading"><LoaderCircle className="eat-clean-spin" size={16} /> Đang kiểm tra tồn kho theo thời gian giao…</div>}
          {deliveryMode === 'scheduled' ? <div className="eat-clean-form-grid eat-clean-schedule-fields"><label><span>Ngày giao</span><input type="date" min={tomorrowIsoDate()} value={address.deliveryDate ?? ''} onChange={(event) => onAddressChange({ ...address, deliveryDate: event.target.value })} /></label><label><span>Khung giờ</span><select value={address.deliveryWindow ?? ''} onChange={(event) => onAddressChange({ ...address, deliveryWindow: event.target.value })}>{activeSlots.length === 0 && <><option value="morning">07:00–09:00</option><option value="lunch">10:30–12:30</option><option value="evening">16:30–18:30</option></>}{activeSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></label></div> : <div className="eat-clean-asap-note"><Clock3 size={18} /><span><strong>ETA sẽ được tính theo thời gian chuẩn bị và tuyến đường thực tế</strong><small>Bạn sẽ thấy giờ giao dự kiến trước khi xác nhận đơn.</small></span></div>}
        </section>
        <section className="eat-clean-card"><div className="eat-clean-section-heading"><div><small>BƯỚC 3</small><h2>Thanh toán</h2></div><CircleDollarSign size={21} /></div><div className="eat-clean-payment-static"><CircleDollarSign size={20} /><span><strong>Thanh toán khi nhận hàng</strong><small>COD · Tiền mặt hoặc chuyển khoản cho nhân viên giao hàng</small></span><BadgeCheck size={19} /></div><label className="eat-clean-note"><span>Ghi chú cho bếp / giao hàng</span><textarea value={note} maxLength={300} onChange={(event) => onNoteChange(event.target.value)} placeholder="Ví dụ: để sốt riêng, gọi trước khi giao…" /></label><input type="hidden" value={paymentMethod} readOnly /></section>
      </div>
      <aside className="eat-clean-card eat-clean-summary eat-clean-summary--checkout">
        <h2>Kiểm tra đơn hàng</h2>
        {lines.map((line) => <div className="eat-clean-summary-line" key={line.mealId}><span>{line.quantity}× {line.meal.name}</span><strong>{formatEatCleanMoney(line.lineTotal)}</strong></div>)}
        {quoteLoading ? <div className="eat-clean-quote-loading"><LoaderCircle className="eat-clean-spin" size={18} /> Đang tính tuyến đường, phí ship và ETA…</div> : quote ? <>
          {(distanceLabel || durationLabel || quote.estimatedArrivalAt) && <div className="eat-clean-route-quote"><Truck size={19} /><span><strong>{[distanceLabel, durationLabel].filter(Boolean).join(' · ') || 'Tuyến giao hàng'}</strong><small>{quote.estimatedArrivalAt ? `Dự kiến giao: ${formatEatCleanDate(quote.estimatedArrivalAt)}` : 'ETA sẽ cập nhật khi shipper xác nhận'}</small></span></div>}
          {quote.verifiedDeliveryAddress && <div className="eat-clean-verified-address"><BadgeCheck size={19} /><span><strong>Địa chỉ Google đã xác nhận</strong><small>{quote.verifiedDeliveryAddress.addressLine}</small></span></div>}
          <dl>
            <div><dt>Tiền món</dt><dd>{formatEatCleanMoney(quote.subtotal)}</dd></div>
            {quote.deliveryFeeBeforeDiscount != null && quote.deliveryFeeBeforeDiscount !== quote.deliveryFee && <div><dt>Phí giao theo khoảng cách</dt><dd>{formatEatCleanMoney(quote.deliveryFeeBeforeDiscount)}</dd></div>}
            <div><dt>Phí giao</dt><dd>{quote.deliveryFee === 0 ? 'Miễn phí' : formatEatCleanMoney(quote.deliveryFee)}</dd></div>
            {(quote.deliveryFeeDiscount ?? 0) > 0 && <div><dt>Giảm phí giao</dt><dd>−{formatEatCleanMoney(quote.deliveryFeeDiscount ?? 0)}</dd></div>}
            {quote.discount > 0 && <div><dt>Ưu đãi món</dt><dd>−{formatEatCleanMoney(quote.discount)}</dd></div>}
          </dl>
          {quote.serviceAreaLabel && <small className="eat-clean-fee-rule">{quote.serviceAreaLabel}{quote.feeRuleVersion ? ` · Bảng phí ${quote.feeRuleVersion}` : ''}</small>}
          <div className="eat-clean-summary__total"><span>Tổng cộng</span><strong>{formatEatCleanMoney(quote.total)}</strong></div>
        </> : <button type="button" className="eat-clean-button eat-clean-button--secondary" aria-label="Cập nhật báo giá, tính phí ship và ETA" onClick={onQuote} disabled={deliveryContextLoading}><Truck size={18} /> Tính phí ship và ETA</button>}
        <button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onSubmit} disabled={!quote || submitting || deliveryContextLoading}>{submitting ? <LoaderCircle className="eat-clean-spin" size={18} /> : <PackageCheck size={18} />}{submitting ? 'Đang tạo đơn…' : 'Đặt món ngay'}</button>
        <small className="eat-clean-summary__note">Giá, tồn kho và phí giao được backend xác minh lại. Aura không tự động trừ tiền.</small>
      </aside>
    </div>
  )
}

function OrdersScreen({ orders, loading, error, onRetry, onOpen, onBrowse }: { orders: EatCleanOrder[]; loading: boolean; error: string; onRetry: () => void; onOpen: (orderId: string) => void; onBrowse: () => void }) {
  if (loading) return <EatCleanLoading />
  if (error) return <EatCleanState icon={<AlertCircle size={28} />} title="Chưa tải được đơn hàng" description={error} action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onRetry}><RefreshCw size={17} /> Thử lại</button>} />
  if (orders.length === 0) return <EatCleanState icon={<History size={28} />} title="Chưa có đơn Eat Clean" description="Đơn đầu tiên của bạn sẽ xuất hiện ở đây để tiện theo dõi." action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onBrowse}>Khám phá thực đơn</button>} />
  return <section className="eat-clean-orders" data-testid="eat-clean-orders"><div className="eat-clean-section-heading"><div><small>LỊCH SỬ</small><h1>Đơn Eat Clean</h1></div><span>{orders.length} đơn</span></div><div className="eat-clean-order-list">{orders.map((order) => <button type="button" key={order.id} className="eat-clean-order-card" onClick={() => onOpen(order.id)}><span className="eat-clean-order-card__icon"><ShoppingBag size={20} /></span><span><small>{order.code} · {formatEatCleanDate(order.createdAt)}</small><strong>{order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</strong><em>{formatEatCleanMoney(order.total)}</em></span><EatCleanStatusBadge status={order.status} /><ChevronRight size={18} /></button>)}</div></section>
}

function OrderDetailScreen({ order, loading, error, submitting, onCancel, onConfirmConsumption, onOrders }: { order?: EatCleanOrder; loading: boolean; error: string; submitting: boolean; onCancel: (order: EatCleanOrder) => void; onConfirmConsumption: (order: EatCleanOrder, consumedRatio: 25 | 50 | 75 | 100) => void; onOrders: () => void }) {
  const [consumedRatio, setConsumedRatio] = useState<25 | 50 | 75 | 100>(100)
  if (loading) return <EatCleanLoading />
  if (error) return <EatCleanState icon={<AlertCircle size={28} />} title="Chưa tải được đơn" description={error} action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onOrders}>Về danh sách đơn</button>} />
  if (!order) return <EatCleanState icon={<AlertCircle size={28} />} title="Không tìm thấy đơn" description="Đơn hàng có thể chưa đồng bộ hoặc không còn khả dụng." action={<button type="button" className="eat-clean-button eat-clean-button--primary" onClick={onOrders}>Về danh sách đơn</button>} />
  const statusFlow: EatCleanOrder['status'][] = ['confirmed', 'preparing', 'ready', 'assigned', 'picked-up', 'delivering', 'arrived', 'delivered']
  const currentIndex = statusFlow.indexOf(order.status)
  const steps = order.timeline?.length ? order.timeline : statusFlow.map((status) => ({ status, label: EAT_CLEAN_STATUS_LABELS[status], completed: currentIndex >= 0 && statusFlow.indexOf(status) <= currentIndex, at: status === 'confirmed' ? order.createdAt : undefined }))
  return (
    <div className="eat-clean-order-detail" data-testid="eat-clean-order-detail">
      <section className="eat-clean-order-hero"><div><span>ĐƠN {order.code}</span><h1>{EAT_CLEAN_STATUS_LABELS[order.status]}</h1><p>Cập nhật lần cuối: {formatEatCleanDate(order.updatedAt ?? order.createdAt)}</p></div><EatCleanStatusBadge status={order.status} /></section>
      {order.status !== 'cancelled' && <EatCleanTrackingPanel key={order.id} order={order} />}
      <div className="eat-clean-order-detail__grid">
        <div className="eat-clean-stack">
          <section className="eat-clean-card"><h2>Hành trình đơn</h2><div className="eat-clean-timeline">{order.status === 'cancelled' ? <span className="is-cancelled"><XCircle size={19} /><strong>Đơn đã hủy</strong></span> : steps.map((step) => <span key={`${step.status}-${step.label}`} className={step.completed ? 'is-completed' : ''}><i>{step.completed ? <Check size={15} /> : null}</i><b><strong>{step.label}</strong><small>{step.at ? formatEatCleanDate(step.at) : 'Đang chờ'}</small></b></span>)}</div></section>
          <section className="eat-clean-card"><h2>Món đã đặt</h2>{order.items.map((item) => <div className="eat-clean-order-line" key={item.mealId}><span><strong>{item.quantity}× {item.name}</strong><small>{formatEatCleanMoney(item.unitPrice)} / phần</small></span><b>{formatEatCleanMoney(item.lineTotal)}</b></div>)}</section>
        </div>
        <aside className="eat-clean-card eat-clean-summary">
          <h2>Giao đến</h2>
          <p className="eat-clean-address"><MapPin size={18} /><span><strong>{order.contact.fullName} · {order.contact.phone}</strong><small>{order.deliveryAddress.addressLine}, {order.deliveryAddress.city}</small><small>{order.deliveryAddress.deliveryMode === 'asap' ? 'Giao sớm nhất' : `${order.deliveryAddress.deliveryDate ?? ''} · ${order.deliveryAddress.deliveryWindow ?? ''}`}</small></span></p>
          <dl><div><dt>Tiền món</dt><dd>{formatEatCleanMoney(order.subtotal)}</dd></div><div><dt>Phí giao</dt><dd>{formatEatCleanMoney(order.deliveryFee)}</dd></div></dl>
          <div className="eat-clean-summary__total"><span>Tổng cộng</span><strong>{formatEatCleanMoney(order.total)}</strong></div>
          {order.status === 'delivered' && !order.consumptionConfirmedAt && <div className="eat-clean-consumption"><label><span>Ước tính phần đã ăn</span><select value={consumedRatio} onChange={(event) => setConsumedRatio(Number(event.target.value) as 25 | 50 | 75 | 100)}><option value={25}>25%</option><option value={50}>50%</option><option value={75}>75%</option><option value={100}>100%</option></select></label><button type="button" className="eat-clean-button eat-clean-button--primary" onClick={() => onConfirmConsumption(order, consumedRatio)} disabled={submitting}><UtensilsCrossed size={18} /> Ghi vào nhật ký</button></div>}
          {order.consumptionConfirmedAt && <div className="eat-clean-confirmed"><BadgeCheck size={18} /><span>Đã ghi nhận vào nhật ký dinh dưỡng.</span></div>}
          {order.canCancel && !['delivered', 'cancelled'].includes(order.status) && <button type="button" className="eat-clean-button eat-clean-button--danger" onClick={() => onCancel(order)} disabled={submitting}>Hủy đơn</button>}
        </aside>
      </div>
    </div>
  )
}
