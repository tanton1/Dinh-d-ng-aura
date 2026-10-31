import { createRoot } from 'react-dom/client'
import BusinessPerformancePanel from '../../src/components/admin/pt/BusinessPerformancePanel'
import '../../src/styles.css'
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1100, margin: 'auto', padding: 14 }}><BusinessPerformancePanel /></main>)
