import { createRoot } from 'react-dom/client'
import CrmWorkspacePage from '../../src/features/crm/CrmWorkspacePage'
import '../../src/styles-aura-tokens.css'

// Mounts the real CRM workspace on its in-memory demo transport, the same
// path the app uses in demo mode. Demo mode grants every CRM capability.
function App() {
  return <div style={{ fontFamily: 'var(--aura-font, system-ui)' }}>
    <CrmWorkspacePage mode="admin" isDemo accessRole="admin" positions={[]} capabilities={[]} branchIds={[]}
      onOpenStudent360={(id) => window.alert(`Mở Học viên 360: ${id}`)} onOpenQuotes={() => window.alert('Mở trang báo giá')} />
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
