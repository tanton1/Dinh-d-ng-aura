import type { LessonWorkoutReference, WorkoutLogInput } from '../../types'

/** Validate, never repair, an already-sent command. Repairing its numbers or
 * IDs would make a retry mean something different from the first attempt. */
export function restoreWorkoutSubmission(value: unknown, reference: LessonWorkoutReference, clientLogId: string, exercises: Array<{ id: string; sets: number }>): WorkoutLogInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const log = value as WorkoutLogInput
  const integer = (number: unknown, min: number, max: number) => typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
  if (log.clientLogId !== clientLogId || !/^[A-Za-z0-9_-]{8,128}$/.test(clientLogId)
    || log.programId !== reference.programId || log.sessionId !== reference.sessionId || log.versionId !== reference.versionId
    || !text(log.title, 300) || !integer(log.durationSeconds, 0, 86_400) || !integer(log.perceivedExertion, 1, 4)
    || (log.readiness !== undefined && !integer(log.readiness, 1, 5)) || (log.sleepQuality !== undefined && !integer(log.sleepQuality, 1, 5))
    || (log.painNote !== undefined && !text(log.painNote, 1000)) || !Array.isArray(log.sets)
    || log.sets.length !== exercises.reduce((sum, exercise) => sum + exercise.sets, 0) || log.completedSets !== log.sets.length) return null
  const seen = new Set<string>()
  let totalLoad = 0
  for (const set of log.sets) {
    if (!set || typeof set !== 'object') return null
    const exercise = exercises.find(item => item.id === set.exerciseId)
    const key = `${set.exerciseId}:${set.setNumber}`
    if (!exercise || !integer(set.setNumber, 1, exercise.sets) || seen.has(key) || !text(set.exerciseName, 300)
      || typeof set.weightKg !== 'number' || !Number.isFinite(set.weightKg) || set.weightKg < 0 || set.weightKg > 1000
      || !integer(set.reps, 1, 1000)) return null
    seen.add(key)
    totalLoad += set.weightKg * set.reps
  }
  if (typeof log.totalLoadKg !== 'number' || !Number.isFinite(log.totalLoadKg) || Math.abs(totalLoad - log.totalLoadKg) > .000001) return null
  return {
    clientLogId, programId: log.programId, sessionId: log.sessionId, versionId: log.versionId, title: log.title,
    durationSeconds: log.durationSeconds, completedSets: log.completedSets, totalLoadKg: log.totalLoadKg,
    perceivedExertion: log.perceivedExertion,
    ...(log.readiness !== undefined ? { readiness: log.readiness } : {}),
    ...(log.sleepQuality !== undefined ? { sleepQuality: log.sleepQuality } : {}),
    ...(log.painNote !== undefined ? { painNote: log.painNote } : {}),
    sets: log.sets.map(set => ({ exerciseId: set.exerciseId, exerciseName: set.exerciseName, setNumber: set.setNumber, weightKg: set.weightKg, reps: set.reps })),
  }
}
