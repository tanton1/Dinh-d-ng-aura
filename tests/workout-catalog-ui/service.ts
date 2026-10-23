const state = window as unknown as {
  catalogCalls?: Array<{ query?: string; cursor?: string | null }>
  catalogFails?: boolean
  catalogDelayMs?: number
  catalogItems?: boolean
  saveCalls?: unknown[]
  saveFails?: boolean
  saveDelayMs?: number
  catalogDelays?: Record<string, number>
}
state.catalogCalls = []
state.saveCalls = []
const exercise = (query = '') => ({
  id: 'exercise-' + query, schemaVersion: 1, revision: 1, status: 'published', nameVi: 'Bài tập ' + query, nameEn: 'Exercise ' + query,
  aliasesVi: [], bodyParts: ['Chân'], targetMuscles: ['Mông'], secondaryMuscles: [], equipment: [], environment: ['gym'], difficulty: 'beginner', goals: [],
  instructionsVi: [], cuesVi: [], commonMistakesVi: [], media: {}, defaultPrescription: { sets: 3, reps: '10', restSeconds: 60, rpe: 7 },
  source: { provider: 'aura', sourceExerciseId: 'exercise-' + query, sourceVersion: 'test', license: 'Aura-owned' }, sourceAttribution: 'Aura Fitness',
})
export async function listExerciseCatalogPage(input: { query?: string; cursor?: string | null }) {
  state.catalogCalls!.push(input)
  const delay = state.catalogDelays?.[input.query || ''] ?? state.catalogDelayMs
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  if (state.catalogFails) throw new Error('Dịch vụ thư viện tạm thời chưa phản hồi.')
  return { items: state.catalogItems ? [exercise(input.query)] : [], hasMore: false, nextCursor: null }
}
export async function getPtWorkoutWorkspace() { return { students: [{ id: 'student', name: 'Học viên kiểm thử' }], sessions: [], programs: [], logs: [] } }
export async function listPtWorkoutHistory() { return { studentId: 'student', logs: [], analytics: { completedWorkouts: 0, totalVolumeKg: 0, painAlerts: 0, personalRecords: [] } } }
export async function savePtSessionWorkoutLog() { throw new Error('Writes are disabled in this fixture.') }
export async function savePtStudentTrainingPlan() { throw new Error('Writes are disabled in this fixture.') }
export async function getExerciseCatalogItem() { return { item: exercise(), editItem: exercise() } }
export async function getExternalExercisePreview() { return {} }
export async function searchExternalExerciseCatalog() { return { items: [] } }
export async function getExerciseCatalogMedia() { return { images: [], videos: [] } }
export async function publishExerciseCatalogItem() { throw new Error('Publishing is disabled in this fixture.') }
export async function uploadExerciseCatalogImage() { throw new Error('Uploads are disabled in this fixture.') }
export async function saveExerciseCatalogDraft(input: { expectedRevision: number }) {
  state.saveCalls!.push(input)
  if (state.saveDelayMs) await new Promise((resolve) => setTimeout(resolve, state.saveDelayMs))
  if (state.saveFails) throw new Error('Chưa thể lưu bản nháp.')
  return { revision: input.expectedRevision + 1 }
}
