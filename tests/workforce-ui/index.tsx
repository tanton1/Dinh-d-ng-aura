import {createRoot} from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import '../../src/styles.css'
import '../../src/styles-aura-tokens.css'
import PerformanceReviewPage from '../../src/pages/operations/PerformanceReviewPage'
createRoot(document.getElementById('root')!).render(<PerformanceReviewPage onNavigate={()=>{}} backView="admin-dashboard" scopeLabel="Trung tâm điều hành" />)
