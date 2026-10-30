import { lazy, Suspense, useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../../../types'
import { BarChart3, CircleDollarSign, PauseCircle, WalletCards } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import '../../../styles-operations-hub.css'

type FinanceTab = 'overview' | 'ledger' | 'frozen' | 'cashbook'
const FinanceManagement = lazy(() => import('./FinanceManagement'))
const CashbookPanel = lazy(() => import('./CashbookPanel'))
const BusinessPerformancePanel = lazy(() => import('./BusinessPerformancePanel'))

export default function AdminFinanceHub({ user, profile, initialTab = 'overview' }: { user: User | null; profile: UserProfile | null; initialTab?: FinanceTab }) {
  const [tab, setTab] = useState<FinanceTab>(initialTab)
  const { branches } = useDatabase()
  const tabs: Array<{ id: FinanceTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
    { id: 'ledger', label: 'Trả góp', icon: CircleDollarSign },
    { id: 'frozen', label: 'Bảo lưu', icon: PauseCircle },
    { id: 'cashbook', label: 'Sổ quỹ', icon: WalletCards },
  ]
  return <div className="operations-hub">
    <nav className="finance-hub__tabs finance-hub__tabs--management" role="tablist" aria-label="Phân hệ tài chính">
      {tabs.map((item, index) => {
        const Icon = item.icon
        const active = tab === item.id
        return <button key={item.id} id={`finance-tab-${item.id}`} type="button" role="tab" tabIndex={active ? 0 : -1} aria-controls="finance-tab-panel" aria-selected={active} className={active ? 'is-active' : ''} onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
          if (nextIndex === null) return
          event.preventDefault()
          setTab(tabs[nextIndex].id)
          document.getElementById(`finance-tab-${tabs[nextIndex].id}`)?.focus()
        }}><Icon size={18} /><strong>{item.label}</strong></button>
      })}
    </nav>
    <div id="finance-tab-panel" role="tabpanel" aria-labelledby={`finance-tab-${tab}`}>
      <Suspense fallback={<div role="status">Đang tải dữ liệu tài chính…</div>}>
      {tab === 'overview' && <BusinessPerformancePanel />}
      {(tab === 'ledger' || tab === 'frozen') && <FinanceManagement user={user} profile={profile} category={tab === 'ledger' ? 'installments' : tab} />}
      {tab === 'cashbook' && <CashbookPanel branches={branches} />}
      </Suspense>
    </div>
  </div>
}
