import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../../../types'
import { BarChart3, CircleDollarSign, WalletCards } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import FinanceManagement from './FinanceManagement'
import CashbookPanel from './CashbookPanel'
import BusinessPerformancePanel from './BusinessPerformancePanel'
import '../../../styles-operations-hub.css'

type FinanceTab = 'overview' | 'ledger' | 'cashbook'

export default function AdminFinanceHub({ user, profile, initialTab = 'overview' }: { user: User | null; profile: UserProfile | null; initialTab?: FinanceTab }) {
  const [tab, setTab] = useState<FinanceTab>(initialTab)
  const { branches } = useDatabase()
  const tabs: Array<{ id: FinanceTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
    { id: 'ledger', label: 'Trả góp', icon: CircleDollarSign },
    { id: 'cashbook', label: 'Sổ quỹ', icon: WalletCards },
  ]
  return <div className="operations-hub">
    <nav className="finance-hub__tabs" role="tablist" aria-label="Phân hệ tài chính">
      {tabs.map((item) => {
        const Icon = item.icon
        const active = tab === item.id
        return <button key={item.id} type="button" role="tab" aria-selected={active} className={active ? 'is-active' : ''} onClick={() => setTab(item.id)}><Icon size={18} /><strong>{item.label}</strong></button>
      })}
    </nav>
    {tab === 'overview' && <BusinessPerformancePanel />}
    {tab === 'ledger' && <FinanceManagement user={user} profile={profile} />}
    {tab === 'cashbook' && <CashbookPanel branches={branches} />}
  </div>
}
