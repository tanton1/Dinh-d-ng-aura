import { createRoot } from 'react-dom/client'
import TrainingHistoryWorkspace from '../../src/components/admin/pt/TrainingHistoryWorkspace'

Object.assign(window, { historyFixture: { directory: [], requests: [], histories: [], acquisitions: 0, releases: 0 } })
createRoot(document.getElementById('root')!).render(<TrainingHistoryWorkspace />)
