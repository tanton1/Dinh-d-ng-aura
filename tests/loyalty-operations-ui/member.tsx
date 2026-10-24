import { createRoot } from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import AuraClubPage from '../../src/features/loyalty/AuraClubPage'

const root = createRoot(document.getElementById('root')!)
const render = (ownerId = 'owner-1') => root.render(<AuraClubPage ownerId={ownerId} initialTab="history" onNavigate={() => undefined} />)
render()
Object.assign(window, { renderClubOwner: render })
