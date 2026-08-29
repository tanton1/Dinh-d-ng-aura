const assert = require('node:assert/strict')
const test = require('node:test')
const { historyAnalytics, logDocumentId, normalizeProgramDraft, normalizeWorkoutSets, workspaceStudentIds, workoutMetrics } = require('./pt-workout-tracking')

test('program draft preserves muscle-day structure and bounded prescription', () => {
  const program = normalizeProgramDraft({ title: 'Mông đùi A', trainingDays: [{
    id: 'lower-a', title: 'Mông đùi', focusMuscles: ['Mông', 'Đùi sau'],
    exercises: [{ id: 'hip-thrust', catalogExerciseId: 'barbell-hip-thrust', sets: 4, repMinimum: 8, repMaximum: 12, targetRpe: 8, targetRir: 2 }],
  }] })
  assert.equal(program.trainingDays[0].title, 'Mông đùi')
  assert.deepEqual(program.trainingDays[0].focusMuscles, ['Mông', 'Đùi sau'])
  assert.equal(program.trainingDays[0].exercises[0].sets, 4)
  assert.equal(program.trainingDays[0].exercises[0].targetRpe, 8)
})

test('set log records load reps RPE and computes volume without incomplete sets', () => {
  const exercise = { id: 'hip-thrust', catalogExerciseId: 'barbell-hip-thrust', nameVi: 'Hip Thrust' }
  const sets = normalizeWorkoutSets([
    { exerciseId: exercise.id, setNumber: 1, weightKg: 50, reps: 10, rpe: 7, completed: true },
    { exerciseId: exercise.id, setNumber: 2, weightKg: 60, reps: 8, rpe: 8, completed: true },
    { exerciseId: exercise.id, setNumber: 3, weightKg: 70, reps: 6, rpe: 9, completed: false },
  ], new Map([[exercise.id, exercise]]))
  assert.deepEqual(workoutMetrics(sets), { completedSets: 2, totalVolumeKg: 980, maximumWeightKg: 60, maximumRpe: 8, painAlert: false })
})

test('pain level four creates a safety alert while preserving the set', () => {
  const exercise = { id: 'squat', catalogExerciseId: 'squat', nameVi: 'Squat' }
  const sets = normalizeWorkoutSets([{ exerciseId: 'squat', weightKg: 20, reps: 10, painLevel: 4 }], new Map([['squat', exercise]]))
  assert.equal(workoutMetrics(sets).painAlert, true)
})

test('history analytics returns per-exercise records from completed logs only', () => {
  const analytics = historyAnalytics([
    { status: 'completed', metrics: { totalVolumeKg: 500, painAlert: false }, sets: [{ completed: true, catalogExerciseId: 'squat', exerciseName: 'Squat', weightKg: 40, reps: 10 }] },
    { status: 'completed', metrics: { totalVolumeKg: 360, painAlert: true }, sets: [{ completed: true, catalogExerciseId: 'squat', exerciseName: 'Squat', weightKg: 60, reps: 6 }] },
    { status: 'draft', metrics: { totalVolumeKg: 9_999 }, sets: [] },
  ])
  assert.equal(analytics.completedWorkouts, 2)
  assert.equal(analytics.totalVolumeKg, 860)
  assert.equal(analytics.painAlerts, 1)
  assert.equal(analytics.personalRecords[0].maximumWeightKg, 60)
  assert.equal(analytics.personalRecords[0].maximumSetVolumeKg, 400)
})

test('one deterministic log exists per source session and learner', () => {
  assert.equal(logDocumentId('session-a', 'student-a'), logDocumentId('session-a', 'student-a'))
  assert.notEqual(logDocumentId('session-a', 'student-a'), logDocumentId('session-a', 'student-b'))
})

test('workspace includes assigned learners without requiring a session in the selected day', () => {
  const studentIds = workspaceStudentIds(
    [{ studentId: 'student-with-session' }],
    [
      { studentId: 'student-assigned', status: 'active' },
      { studentId: 'student-future', status: 'future' },
      { studentId: 'student-frozen', status: 'frozen' },
      { studentId: 'student-expired', status: 'expired' },
      { studentId: 'student-with-session', status: 'active' },
    ],
  )
  assert.deepEqual(studentIds, ['student-with-session', 'student-assigned', 'student-future', 'student-frozen'])
})
