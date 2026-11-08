import { HeartHandshake, Inbox, PlugZap, SquareKanban, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmCareTab } from './CrmCareTab'
import { CrmCustomerPanel } from './CrmCustomerPanel'
import { CrmCustomersTab } from './CrmCustomersTab'
import { CrmInboxTab } from './CrmInboxTab'
import { CrmIntegrationTab } from './CrmIntegrationTab'
import { CrmPipelineTab } from './CrmPipelineTab'
import { createCrmDemoTransport } from './crmDemoTransport'
import { createCrmService, firebaseCrmTransport } from './crmService'
import { Notice } from './crmUi'
import './CrmWorkspace.css'

export type CrmTab = 'inbox' | 'pipeline' | 'care' | 'customers' | 'connect'

export interface CrmPermissions {
  inbox: boolean
  pipeline: boolean
  steps: boolean
  branchSteps: boolean
  assignCare: boolean
  integration: boolean
  admin: boolean
}

export interface CrmWorkspacePageProps {
  mode: 'admin' | 'staff'
  isDemo: boolean
  capabilities: string[]
  positions: string[]
  branchIds: string[]
  accessRole: string
  initialCustomerId?: string | null
  onOpenStudent360?: (studentId: string, name: string) => void
  onOpenQuotes?: () => void
}

export function crmPermissions({ isDemo, capabilities, positions, accessRole }: Pick<CrmWorkspacePageProps, 'isDemo' | 'capabilities' | 'positions' | 'accessRole'>): CrmPermissions {
  const admin = isDemo || accessRole === 'admin' || accessRole === 'super_admin'
  const has = (capability: string) => isDemo || capabilities.includes(capability)
  const branchView = has('crm.customers.branch.view')
  return {
    inbox: branchView && has('crm.messages.presale.read'),
    pipeline: branchView,
    steps: has('crm.steps.assigned.manage'),
    branchSteps: admin || branchView || positions.includes('branch_manager'),
    assignCare: has('crm.care_owner.assign'),
    integration: admin && has('crm.integration.manage'),
    admin,
  }
}

const TAB_META: Record<CrmTab, { label: string; icon: typeof Inbox }> = {
  inbox: { label: 'Hộp thư', icon: Inbox },
  pipeline: { label: 'Pipeline', icon: SquareKanban },
  care: { label: 'Chăm sóc', icon: HeartHandshake },
  customers: { label: 'Khách hàng', icon: Users },
  connect: { label: 'Kết nối Pancake', icon: PlugZap },
}

export default function CrmWorkspacePage(props: CrmWorkspacePageProps) {
  const { isDemo, branchIds, initialCustomerId, onOpenStudent360, onOpenQuotes } = props
  const service = useMemo(() => createCrmService(isDemo ? createCrmDemoTransport() : firebaseCrmTransport), [isDemo])
  const permissions = useMemo(() => crmPermissions(props), [props])
  const tabs = useMemo(() => (['inbox', 'pipeline', 'care', 'customers', 'connect'] as CrmTab[]).filter((tab) => (
    tab === 'inbox' ? permissions.inbox
      : tab === 'pipeline' ? permissions.pipeline
        : tab === 'care' ? permissions.steps
          : tab === 'connect' ? permissions.integration
            : true
  )), [permissions])
  const [tab, setTab] = useState<CrmTab>(() => tabs[0] || 'customers')
  const [branchId, setBranchId] = useState<string>(() => (branchIds.length === 1 ? branchIds[0] : ''))
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId || null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { if (initialCustomerId) setCustomerId(initialCustomerId) }, [initialCustomerId])
  useEffect(() => { if (!tabs.includes(tab) && tabs[0]) setTab(tabs[0]) }, [tab, tabs])

  // Admins pick any branch; the list comes with the integration overview.
  useEffect(() => {
    if (!permissions.integration) return
    let active = true
    service.integrationOverview().then((overview) => { if (active) setBranches(overview.branches) }).catch(() => {})
    return () => { active = false }
  }, [permissions.integration, service])

  const branchOptions = permissions.admin ? branches : branchIds.map((id) => ({ id, name: id }))
  const openCustomer = useCallback((id: string) => setCustomerId(id), [])
  const changed = useCallback(() => setRefreshKey((value) => value + 1), [])
  const scopeBranch = branchId || undefined

  if (!tabs.length) {
    return <main className="crm-page"><Notice tone="warning">Tài khoản chưa có quyền CRM (Sales, CSKH hoặc quản lý chi nhánh). Liên hệ quản trị viên.</Notice></main>
  }

  // The shell top bar already names the page, so the heading is for
  // assistive tech only; the tab row is the first thing on screen.
  return <main className="crm-page" aria-labelledby="crm-title">
    <h1 id="crm-title" className="crm-sr-only">Hộp thư & CRM</h1>
    <div className="crm-tabbar">
      <nav className="crm-tabs" role="tablist" aria-label="Khu vực CRM">
        {tabs.map((item) => {
          const Icon = TAB_META[item].icon
          return <button key={item} type="button" role="tab" id={`crm-tab-${item}`} aria-selected={tab === item} aria-controls={`crm-panel-${item}`} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>
            <Icon size={16} aria-hidden="true" /> <span>{TAB_META[item].label}</span>
          </button>
        })}
      </nav>
      {branchOptions.length > 1 && <label className="crm-branch">
        <span className="crm-sr-only">Chi nhánh</span>
        <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          {permissions.admin && <option value="">Tất cả chi nhánh</option>}
          {!permissions.admin && <option value="">Chi nhánh của tôi</option>}
          {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>}
    </div>
    {isDemo && <Notice>Bản demo: dữ liệu mẫu trong trình duyệt.</Notice>}
    <section className="crm-panel" role="tabpanel" id={`crm-panel-${tab}`} aria-labelledby={`crm-tab-${tab}`}>
      {tab === 'inbox' && <CrmInboxTab service={service} branchId={scopeBranch} refreshKey={refreshKey} onOpenCustomer={openCustomer} />}
      {tab === 'pipeline' && <CrmPipelineTab service={service} branchId={scopeBranch} refreshKey={refreshKey} onOpenCustomer={openCustomer} />}
      {tab === 'care' && <CrmCareTab service={service} branchId={scopeBranch} permissions={permissions} refreshKey={refreshKey} onOpenCustomer={openCustomer} onChanged={changed} branchIds={branchIds} />}
      {tab === 'customers' && <CrmCustomersTab service={service} branchId={scopeBranch} careOnly={!permissions.pipeline} refreshKey={refreshKey} onOpenCustomer={openCustomer} />}
      {tab === 'connect' && <CrmIntegrationTab service={service} />}
    </section>
    {customerId && <CrmCustomerPanel
      key={customerId}
      service={service}
      customerId={customerId}
      isAdmin={permissions.admin}
      onClose={() => setCustomerId(null)}
      onChanged={changed}
      onOpenCustomer={openCustomer}
      onOpenStudent360={onOpenStudent360}
      onOpenQuotes={onOpenQuotes}
    />}
  </main>
}
