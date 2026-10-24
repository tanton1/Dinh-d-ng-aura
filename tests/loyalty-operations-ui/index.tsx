import { createRoot } from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import '../../src/features/loyalty/loyalty.css'
import '../../src/features/loyalty/loyalty-admin.css'
import AdminLoyaltyOperations from '../../src/features/loyalty/AdminLoyaltyOperations'

const parameters = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)
root.render(<AdminLoyaltyOperations initialStudentId={parameters.get('studentId') || undefined} canManageRewards={parameters.has('rewards')} canAdjust={parameters.has('adjust')} canAudit />)
Object.assign(window, { unmountLoyaltyOperations: () => root.unmount() })
