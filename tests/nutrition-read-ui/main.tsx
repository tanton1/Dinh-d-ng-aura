import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import ScanQueueFixture from './scan-queue-fixture'
import NutritionPageController from '../../src/pages/student/NutritionPageController'
import { DEFAULT_PROFILE } from '../../src/features/nutrition/profileDefaults'
import { useNutritionAssistantController } from '../../src/features/nutrition/useNutritionAssistantController'
import { useDailyNutritionSummary } from '../../src/hooks/useDailyNutritionSummary'
const state = { uid: 'a', calls: [] as any[], listeners: [] as any[], hold: [] as string[], pending: new Map(), coverage: 'ready',
  release(id: number, value?: any, fail = false) { const pending = this.pending.get(id); if (!pending) throw new Error(`Missing ${id}`); this.pending.delete(id); fail ? pending.reject(new Error('Late failed response')) : pending.resolve(value ?? pending.value) },
}
Object.assign(window, { nutritionFixture: state })
const profile = { ...DEFAULT_PROFILE, age: 30, heightCm: 165, weightKg: 60, biologicalSex: 'female' as const, goal: 'maintain' as const, activityLevel: 'moderate' as const, trainingSessions: 3, mealsPerDay: 3 }
function AssistantFixture() {
  const [date, setDate] = useState('day-a')
  const result = useNutritionAssistantController({ resetKey: date, profileDraft: profile, selectedDateLabel: date, loggedMeals: [], selectedDayActivities: [], calorieGoal: 2000, proteinGoal: 100, carbGoal: 200, fatGoal: 70, waterGoal: 2000, caloriesConsumed: 0, proteinConsumed: 0, carbsConsumed: 0, fatConsumed: 0, fiberConsumed: 0, sugarConsumed: 0, sodiumConsumed: 0, water: 0, activityMinutes: 0, activityCalories: 0, fiberDataComplete: false, sugarDataComplete: false, sodiumDataComplete: false, nutritionTargetsConfigured: true, catalogSnapshot: [], setCatalogSnapshot: () => {} })
  return <div><button onClick={() => setDate('day-b')}>Change day</button><button onClick={() => void result.submitAssistantQuestion(`Question ${date}`)}>Ask</button><div data-testid="loading">{String(result.assistantLoading)}</div>{result.assistantMessages.map(item => <p key={item.id}>{item.content}</p>)}</div>
}
function SummaryFixture() {
  const [owner, setOwner] = useState('a')
  const summary = useDailyNutritionSummary(owner, profile, true)
  Object.assign(state, { changeSummaryOwner: setOwner })
  return <div data-testid="consumed">{summary.caloriesConsumed}</div>
}
const mode = new URLSearchParams(location.search).get('mode')
createRoot(document.getElementById('root')!).render(mode === 'scan-queue' ? <ScanQueueFixture /> : mode === 'assistant' ? <AssistantFixture /> : mode === 'summary' ? <SummaryFixture /> : <NutritionPageController entry={mode === 'library' ? 'library' : 'nutrition'} storageOwnerId="a" displayName="Read fixture" hasProfile profile={profile} />)
