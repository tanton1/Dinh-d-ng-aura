import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'
import FinanceManagement from './FinanceManagement'
import TrainerPayroll from './TrainerPayroll'
import CashbookPanel from './CashbookPanel'
import '../../../styles-operations-hub.css'

type FinanceTab = 'ledger' | 'cashbook' | 'payroll'

export default function AdminFinanceHub({ user, profile, initialTab = 'ledger' }: { user: User | null; profile: UserProfile | null; initialTab?: FinanceTab }) {
  const [tab, setTab] = useState<FinanceTab>(initialTab)
  const { branches } = useDatabase()
  return <div className="operations-hub">
    <div className="admin-tabs admin-operations-tabs" role="tablist">
      <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>Thu chi & Công nợ</button>
      <button className={tab === 'cashbook' ? 'active' : ''} onClick={() => setTab('cashbook')}>Sổ quỹ</button>
      <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>Chấm công & Lương PT</button>
    </div>
    {tab === 'ledger' && <FinanceManagement user={user} profile={profile} />}
    {tab === 'cashbook' && <CashbookPanel branches={branches} />}
    {tab === 'payroll' && <TrainerPayroll user={user} profile={profile} />}
  </div>
}
