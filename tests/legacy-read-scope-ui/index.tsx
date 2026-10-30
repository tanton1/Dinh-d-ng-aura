import { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DatabaseProvider, useDatabase } from '../../src/contexts/DatabaseContext'
import { state } from './mocks'
function Consumer() {
  const database = useDatabase()
  const { branches, trainers, packages, students, operationsSync, refreshData } = database
  const references = [students, database.contracts, database.payments, database.sessions, trainers, branches, packages, database.staff, database.dailyCheckins, database.workoutLogs, database.leaveRequests, database.sessionRequests, database.schedules, database.ptAvailability, database.scheduleConfig]
  const [derivedRevision, setDerivedRevision] = useState(0)
  // Model consumers deriving state in an effect; cap regressions to keep the worker responsive.
  useEffect(() => {
    state.effectRuns += 1
    if (state.effectRuns <= 40) setDerivedRevision(value => value + 1)
  }, references)
  const snapshot = { branches: branches.map(item => item.name), trainers: trainers.map(item => item.name), packages: packages.map(item => item.name), students: students.map(item => item.name), rows: references.filter(Array.isArray).flatMap(items => items.map(item => item.id)), configRevision: database.scheduleConfig.revision ?? null, sync: operationsSync, references: references.map(identity), derivedRevision }
  useLayoutEffect(() => {
    state.snapshot = snapshot
    state.renders.push({ ...snapshot, ...state.authState() })
  })
  state.refresh = refreshData
  return <output>{JSON.stringify(snapshot)}</output>
}
const identities = new WeakMap<object, number>()
let nextIdentity = 0
function identity(value: object) {
  if (!identities.has(value)) identities.set(value, ++nextIdentity)
  return identities.get(value)
}
function Harness() {
  const [, forceRender] = useState(0)
  state.forceProviderRender = () => forceRender(value => value + 1)
  return <DatabaseProvider><Consumer /></DatabaseProvider>
}
location.hash = '#/admin-finance'
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
