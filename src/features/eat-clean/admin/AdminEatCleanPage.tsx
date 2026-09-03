import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  ChefHat,
  ClipboardList,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  MapPinned,
  UtensilsCrossed,
  WalletCards,
} from 'lucide-react'
import type { UserRole } from '../../../types'
import { formatCurrency, inventoryStatusFor } from './adminEatCleanUtils'
import {
  getEatCleanAdminErrorMessage,
  initializeEatCleanCatalog,
  listEatCleanAdminData,
  recordEatCleanRefundOutcome,
  reverseEatCleanRefundOutcome,
  saveEatCleanConfig,
  saveEatCleanInventory,
  saveEatCleanMeal,
  updateEatCleanOrder,
} from './eatCleanAdminService'
import type {
  EatCleanAdminData,
  EatCleanConfig,
  EatCleanMeal,
  SaveEatCleanInventoryInput,
  UpdateEatCleanOrderInput,
} from './types'
import { DEFAULT_EAT_CLEAN_CONFIG, EMPTY_EAT_CLEAN_SUMMARY } from './types'
import { EatCleanInventoryTab } from './components/EatCleanInventoryTab'
import { EatCleanMenuTab } from './components/EatCleanMenuTab'
import { EatCleanOperationsTab } from './components/EatCleanOperationsTab'
import { EatCleanOrdersTab } from './components/EatCleanOrdersTab'
import { EatCleanDispatchTab } from './components/EatCleanDispatchTab'
import './AdminEatCleanPage.css'

export type EatCleanAdminTab = 'dispatch' | 'orders' | 'menu' | 'inventory' | 'operations'

export interface AdminEatCleanPageProps {
  currentRole: UserRole
  initialTab?: EatCleanAdminTab
  className?: string
  isDemo?: boolean
}

const TABS: Array<{ id: EatCleanAdminTab; label: string; icon: typeof ShoppingBag }> = [
  { id: 'dispatch', label: 'Điều phối', icon: MapPinned },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingBag },
  { id: 'menu', label: 'Thực đơn', icon: UtensilsCrossed },
  { id: 'inventory', label: 'Tồn kho', icon: Boxes },
  { id: 'operations', label: 'Vận hành', icon: Settings2 },
]

function canManageEatClean(role: UserRole): role is Extract<UserRole, 'admin' | 'super_admin'> {
  return role === 'admin' || role === 'super_admin'
}

export default function AdminEatCleanPage({ currentRole, initialTab = 'dispatch', className = '', isDemo = false }: AdminEatCleanPageProps) {
  const [activeTab, setActiveTab] = useState<EatCleanAdminTab>(initialTab)
  const [data, setData] = useState<EatCleanAdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [initializeError, setInitializeError] = useState('')

  const loadData = useCallback(async (background = false) => {
    if (!canManageEatClean(currentRole)) {
      setLoading(false)
      return
    }
    if (background) setRefreshing(true)
    else setLoading(true)
    setLoadError('')
    try {
      if (isDemo) {
        setData({
          schemaVersion: 1,
          orders: [],
          meals: [],
          inventory: [],
          config: { ...DEFAULT_EAT_CLEAN_CONFIG },
          summary: { ...EMPTY_EAT_CLEAN_SUMMARY },
          seeded: true,
        })
      } else {
        setData(await listEatCleanAdminData())
      }
    } catch (error) {
      setLoadError(getEatCleanAdminErrorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [currentRole, isDemo])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const summary = useMemo(() => {
    if (!data) return { pendingOrders: 0, preparingOrders: 0, todayRevenue: 0, lowStockItems: 0 }
    return {
      pendingOrders: data.summary.byStatus.pending_confirmation ?? data.orders.filter((order) => order.status === 'pending_confirmation').length,
      preparingOrders: (data.summary.byStatus.preparing ?? 0) + (data.summary.byStatus.ready ?? 0),
      todayRevenue: data.summary.deliveredRevenue,
      lowStockItems: data.inventory.filter((item) => inventoryStatusFor(item) !== 'in_stock').length,
    }
  }, [data])

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    setActiveTab(TABS[nextIndex].id)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  const handleInitialize = async () => {
    setInitializing(true)
    setInitializeError('')
    try {
      await initializeEatCleanCatalog()
      await loadData(true)
    } catch (error) {
      setInitializeError(getEatCleanAdminErrorMessage(error))
    } finally {
      setInitializing(false)
    }
  }

  const handleSaveMeal = async (meal: EatCleanMeal) => {
    try {
      const savedMeal = await saveEatCleanMeal({ meal })
      setData((current) => current ? {
        ...current,
        seeded: true,
        meals: current.meals.some((item) => item.id === savedMeal.id)
          ? current.meals.map((item) => item.id === savedMeal.id ? savedMeal : item)
          : [savedMeal, ...current.meals],
      } : current)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  const handleSaveInventory = async (input: SaveEatCleanInventoryInput) => {
    try {
      const savedItem = await saveEatCleanInventory(input)
      setData((current) => current ? {
        ...current,
        inventory: current.inventory.some((item) => item.id === savedItem.id)
          ? current.inventory.map((item) => item.id === savedItem.id ? savedItem : item)
          : [savedItem, ...current.inventory],
      } : current)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  const handleSaveConfig = async (config: EatCleanConfig) => {
    try {
      const savedConfig = await saveEatCleanConfig({ config })
      setData((current) => current ? { ...current, seeded: true, config: savedConfig } : current)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  const handleUpdateOrder = async (input: UpdateEatCleanOrderInput) => {
    try {
      const savedOrder = await updateEatCleanOrder(input)
      setData((current) => current ? {
        ...current,
        orders: current.orders.map((order) => order.id === savedOrder.id ? { ...order, ...savedOrder } : order),
      } : current)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  const handleRecordRefundOutcome = async (input: Parameters<typeof recordEatCleanRefundOutcome>[0]) => {
    try {
      await recordEatCleanRefundOutcome(input)
      await loadData(true)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  const handleReverseRefundOutcome = async (input: Parameters<typeof reverseEatCleanRefundOutcome>[0]) => {
    try {
      await reverseEatCleanRefundOutcome(input)
      await loadData(true)
    } catch (error) {
      throw new Error(getEatCleanAdminErrorMessage(error))
    }
  }

  if (!canManageEatClean(currentRole)) {
    return (
      <main className={`page admin-eat-clean-page ${className}`.trim()}>
        <div className="eat-clean-access-denied" role="alert">
          <ShieldAlert size={34} />
          <h1>Không có quyền quản trị Eat Clean</h1>
          <p>Khu vực này chỉ dành cho tài khoản admin và super admin.</p>
        </div>
      </main>
    )
  }

  return (
    <main className={`page admin-eat-clean-page ${className}`.trim()} aria-busy={loading || refreshing}>
      <header className="eat-clean-hero">
        <div className="eat-clean-hero__content">
          <span className="eat-clean-eyebrow"><ChefHat size={14} /> AURA · EAT CLEAN ADMIN</span>
          <h1>Trung tâm vận hành Eat Clean</h1>
          <p>Kiểm soát đơn hàng, món ăn, nguyên liệu và lịch giao trong một luồng rõ ràng.</p>
          <div className="eat-clean-hero__actions">
            <span className={`eat-clean-live-state ${data?.config.acceptingOrders ? 'is-open' : ''}`}>
              <span /> {data?.config.acceptingOrders ? 'Đang nhận đơn' : 'Đang tạm dừng'}
            </span>
            <button type="button" className="eat-clean-refresh-button" onClick={() => void loadData(true)} disabled={loading || refreshing}>
              <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} /> {refreshing ? 'Đang tải…' : 'Làm mới'}
            </button>
          </div>
        </div>
        <img src="/images/eat-clean/hero-bowl.webp" alt="Suất ăn Eat Clean với rau củ tươi" />
      </header>

      {!loading && data && (
        <section className="eat-clean-stats" aria-label="Tổng quan Eat Clean">
          <article><span><ClipboardList size={19} /></span><div><strong>{summary.pendingOrders}</strong><small>Đơn chờ xác nhận</small></div></article>
          <article><span><PackageCheck size={19} /></span><div><strong>{summary.preparingOrders}</strong><small>Đang chuẩn bị</small></div></article>
          <article><span><WalletCards size={19} /></span><div><strong>{formatCurrency(summary.todayRevenue)}</strong><small>Doanh thu đã giao</small></div></article>
          <article><span><AlertCircle size={19} /></span><div><strong>{summary.lowStockItems}</strong><small>Nguyên liệu cần chú ý</small></div></article>
        </section>
      )}

      {!loading && data && data.summary.missingDeliveryRecords > 0 && (
        <section className="eat-clean-integrity-alert" role="alert">
          <span><AlertTriangle size={20} /></span>
          <div>
            <strong>{data.summary.missingDeliveryRecords} đơn cần đối soát giao hàng</strong>
            <p>Đơn lịch sử đang thiếu bản ghi delivery. Hệ thống không tự đoán đã giao hay đã hủy để tránh làm sai doanh thu và tồn kho.</p>
          </div>
          <button type="button" onClick={() => setActiveTab('orders')}>Mở đơn hàng</button>
        </section>
      )}

      <nav className="eat-clean-tabs" role="tablist" aria-label="Quản trị Eat Clean">
        {TABS.map((tab, index) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              id={`eat-clean-tab-${tab.id}`}
              role="tab"
              aria-selected={active}
              aria-controls={`eat-clean-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className={active ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon size={18} /><span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {loading ? (
        <div className="eat-clean-loading" role="status" aria-live="polite">
          <span className="eat-clean-loader" />
          <strong>Đang tải dữ liệu Eat Clean…</strong>
          <p>Kết nối hệ thống đơn hàng và thực đơn.</p>
        </div>
      ) : loadError ? (
        <div className="eat-clean-error-state" role="alert">
          <AlertCircle size={34} />
          <h2>Chưa thể tải trung tâm Eat Clean</h2>
          <p>{loadError}</p>
          <button type="button" className="eat-clean-primary-button" onClick={() => void loadData()}><RefreshCw size={18} /> Thử tải lại</button>
        </div>
      ) : data && !data.seeded ? (
        <section className="eat-clean-seed-state" aria-labelledby="eat-clean-seed-title">
          <div className="eat-clean-seed-state__visual"><img src="/images/eat-clean/salmon-vegetables.webp" alt="Món cá hồi rau củ Eat Clean" /></div>
          <div>
            <span className="eat-clean-kicker"><Sparkles size={15} /> KHỞI TẠO DỮ LIỆU</span>
            <h2 id="eat-clean-seed-title">Backend đã sẵn sàng nhưng chưa có danh mục Eat Clean</h2>
            <p>Khởi tạo thực đơn mẫu, tồn kho và cấu hình vận hành cơ bản. Không có dữ liệu demo nào được tự chèn ở phía trình duyệt.</p>
            {initializeError && <div className="eat-clean-inline-error" role="alert">{initializeError}</div>}
            <button type="button" className="eat-clean-primary-button" onClick={handleInitialize} disabled={initializing}>
              <Sparkles size={18} /> {initializing ? 'Đang khởi tạo…' : 'Khởi tạo thực đơn mẫu'}
            </button>
            <small>Nút này gọi callable <code>initializeEatCleanCatalog</code>. Nếu backend chưa deploy callable, hệ thống sẽ báo lỗi rõ để admin xử lý.</small>
          </div>
        </section>
      ) : data ? (
        <div
          id={`eat-clean-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`eat-clean-tab-${activeTab}`}
          tabIndex={0}
          className="eat-clean-tab-panel"
        >
          {activeTab === 'orders' && (
            <EatCleanOrdersTab
              orders={data.orders}
              onUpdateOrder={handleUpdateOrder}
              onRecordRefundOutcome={handleRecordRefundOutcome}
              onReverseRefundOutcome={handleReverseRefundOutcome}
            />
          )}
          {activeTab === 'dispatch' && <EatCleanDispatchTab isDemo={isDemo} />}
          {activeTab === 'menu' && <EatCleanMenuTab meals={data.meals} deliverySlots={data.config.deliverySlots} onSaveMeal={handleSaveMeal} />}
          {activeTab === 'inventory' && <EatCleanInventoryTab inventory={data.inventory} meals={data.meals} onSaveInventory={handleSaveInventory} />}
          {activeTab === 'operations' && <EatCleanOperationsTab config={data.config} onSaveConfig={handleSaveConfig} />}
        </div>
      ) : null}
    </main>
  )
}
