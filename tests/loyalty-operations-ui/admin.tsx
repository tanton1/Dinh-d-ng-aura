import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../../src/styles-bootstrap.css'
import '../../src/styles-aura-tokens.css'
import AdminLoyaltyPage from '../../src/features/loyalty/AdminLoyaltyPage'
function Harness() {
  const [revision, setRevision] = useState('scope-a')
  const [actorUid, setActorUid] = useState<string | undefined>()
  Object.assign(window, { setClubAccessRevision: setRevision, setClubActor: setActorUid })
  return <AdminLoyaltyPage actorUid={actorUid} accessRevision={revision} isDemo={new URLSearchParams(location.search).has('demo')} useMobileDock canReviewRedemptions canManagePolicy canManageRewards canManageAmbassadors canApproveAdjustments canAdjust />
}
createRoot(document.getElementById('root')!).render(<Harness />)
