import { createRoot } from 'react-dom/client'
import '../../../src/styles-bootstrap.css'
import ContractRenewals from '../../../src/components/admin/pt/ContractRenewals'

const root = createRoot(document.getElementById('root')!)
root.render(<ContractRenewals />)
Object.assign(window, { unmountRenewalQueue: () => root.unmount() })
