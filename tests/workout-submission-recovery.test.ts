import assert from 'node:assert/strict'
import { test } from 'node:test'
import { restoreWorkoutSubmission } from '../src/features/workouts/submissionRecovery'
import type { WorkoutLogInput } from '../src/types'

const reference = { programId: 'program', sessionId: 'session', versionId: 'version' }
const exercises = [{ id: 'one', sets: 1 }]
const log: WorkoutLogInput = { ...reference, clientLogId: 'stable-log-123', title: 'Workout', durationSeconds: 90, completedSets: 1,
  totalLoadKg: 20, perceivedExertion: 2, readiness: 3, sleepQuality: 4, painNote: 'A note',
  sets: [{ exerciseId: 'one', exerciseName: 'Exercise', setNumber: 1, weightKg: 10, reps: 2 }] }

test('pending workout restores the exact command while discarding unrelated cached properties', () => {
  assert.deepEqual(restoreWorkoutSubmission({ ...log, ownerUid: 'other', secret: 'not-allowed' }, reference, log.clientLogId, exercises), log)
})

test('changed identity, invalid numbers, duplicates and inconsistent totals never get repaired into another submission', () => {
  for (const patch of [{ versionId: 'other' }, { clientLogId: 'other-key' }, { durationSeconds: NaN }, { perceivedExertion: 5 },
    { painNote: 'x'.repeat(1001) }, { sets: [log.sets[0], log.sets[0]] }, { totalLoadKg: 21 },
    { sets: [{ ...log.sets[0], reps: 2.5 }] }, { sets: [{ ...log.sets[0], weightKg: -1 }] }, { sets: [{ ...log.sets[0], exerciseId: 'foreign' }] }]) {
    assert.equal(restoreWorkoutSubmission({ ...log, ...patch }, reference, log.clientLogId, exercises), null)
  }
})
