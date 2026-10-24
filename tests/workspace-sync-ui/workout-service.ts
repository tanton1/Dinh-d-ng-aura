import { firebaseAuth, currentSync } from './signals'
const state = window as any
state.workoutCalls ??= []
const log = (id: number) => ({
  id: `log-${id}`, studentId: firebaseAuth.currentUser?.uid, date: '2026-10-24', hour: 8,
  trainingDayTitle: `Buổi ${id}`, status: 'completed', revision: 1,
  sets: [{ exerciseId: 'squat', catalogExerciseId: 'squat', exerciseName: 'Squat', setType: 'working', weightKg: 20, reps: 10, completed: true }],
  metrics: { completedSets: 1, totalVolumeKg: 200, painAlert: id === 1 },
})
async function begin(kind: string, cursor: string | null = null) {
  const uid = firebaseAuth.currentUser?.uid
  const syncState = currentSync(kind)
  const revision = state.planRevision || 1
  state.workoutCalls.push({ uid, kind, cursor })
  const delay = cursor ? state.workoutPageDelay : state.workoutDelay
  if (delay) await new Promise(resolve => setTimeout(resolve, delay))
  if (state.workoutDenied) throw Object.assign(new Error('Tài khoản đã bị thu hồi quyền.'), { code: 'functions/permission-denied' })
  if (state.workoutFails) throw new Error('Dịch vụ tập luyện chưa phản hồi.')
  return { uid, syncState, revision }
}
export async function getMyPtTrainingPlan() {
  const { uid, syncState, revision } = await begin('studentTrainingPlan')
  return { studentId: uid, syncState, program: { id: uid, revision, title: `Giáo án ${uid} v${revision}`, goal: 'Khỏe hơn', trainingDays: [{ id: 'day', title: 'Buổi toàn thân', exercises: [], focusMuscles: [] }] } }
}
export async function listMyPtWorkoutHistoryPage(cursor: string | null = null) {
  const { uid, syncState } = await begin('studentWorkoutHistory', cursor)
  if (cursor && state.staleWorkoutCursor) {
    state.staleWorkoutCursor = false
    throw Object.assign(new Error('Lịch sử vừa thay đổi.'), { details: { issueCode: 'WORKOUT_HISTORY_CHANGED' } })
  }
  return { studentId: uid, syncState, logs: cursor ? [log(26), log(27)] : Array.from({ length: 25 }, (_, i) => log(i + 1)), hasMore: !cursor, nextCursor: cursor ? null : 'cursor-25' }
}
export async function listExerciseCatalogPage() { return { items: [], hasMore: false, nextCursor: null } }
export async function getExerciseCatalogMedia() { return { images: [], videos: [] } }
