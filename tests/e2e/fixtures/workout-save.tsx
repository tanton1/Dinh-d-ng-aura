import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles-bootstrap.css'
import WorkoutPage from '../../../src/pages/student/WorkoutPage'
import { useAuth } from '../../../src/contexts/AuthContext'
import { workoutExercises } from '../../../src/data'
import type { WorkoutLogInput } from '../../../src/types'

const reference = { programId: 'fixture-program', sessionId: 'fixture-session', versionId: 'fixture-version' }
const state = window as unknown as { workoutSaves: Array<{ owner: string; log: WorkoutLogInput }>; workoutFailCount: number; workoutHold: boolean; workoutRelease?: () => void; workoutNavigationThrows: boolean; workoutExits: number }
state.workoutSaves = []
state.workoutExits = 0
const key = `aura-workout-draft:v2:${reference.programId}:${reference.sessionId}:${reference.versionId}:member-one`
if (!localStorage.getItem('fixture-workout-seeded')) {
  const completedSets = Object.fromEntries(workoutExercises.map(exercise => [String(exercise.id), Array.from({ length: exercise.sets }, (_, index) => ({ exerciseId: String(exercise.id), exerciseName: exercise.name, setNumber: index + 1, weightKg: 10, reps: 8 }))]))
  localStorage.setItem(key, JSON.stringify({ version: 2, ...reference, clientLogId: 'fixture-log-123', exerciseIndex: 0, completedSets,
    setInputs: {}, elapsed: 120, paused: false, rest: 0, finished: true, perceivedExertion: 2, readiness: 3, sleepQuality: 3, painNote: 'Private note for member one' }))
  localStorage.setItem('fixture-workout-seeded', 'true')
}
function App() {
  const { user } = useAuth()
  return <WorkoutPage workoutRef={reference} onNavigate={() => { state.workoutExits++ }} onExit={() => {
    if (state.workoutNavigationThrows) throw new Error('Synthetic navigation failure')
    state.workoutExits++
  }} onSave={async log => {
    state.workoutSaves.push({ owner: user!.uid, log: JSON.parse(JSON.stringify(log)) })
    if (state.workoutHold) await new Promise<void>(resolve => { state.workoutRelease = resolve })
    if (state.workoutFailCount > 0) { state.workoutFailCount--; throw new Error('Synthetic response loss') }
  }} />
}
createRoot(document.getElementById('root')!).render(<App />)
