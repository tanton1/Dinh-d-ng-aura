import { createRoot } from 'react-dom/client'
import PtWorkoutWorkspacePage from '../../src/pages/operations/PtWorkoutWorkspacePage'
import ExerciseCatalogManager from '../../src/components/exercise-catalog/ExerciseCatalogManager'
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('manager') ? <ExerciseCatalogManager canPublish /> : <PtWorkoutWorkspacePage />)
