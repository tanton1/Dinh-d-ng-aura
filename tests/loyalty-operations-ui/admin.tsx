import { createRoot } from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import AdminLoyaltyPage from '../../src/features/loyalty/AdminLoyaltyPage'
createRoot(document.getElementById('root')!).render(<AdminLoyaltyPage canReviewRedemptions />)
