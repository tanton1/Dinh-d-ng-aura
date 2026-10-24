import type { PtWorkoutHistory, PtWorkoutLog } from '../services/ptWorkoutTrackingService'

/** These are statistics of the loaded rows, never an all-time total. */
export function summarizeLoadedWorkouts(logs: PtWorkoutLog[]): PtWorkoutHistory['analytics'] {
  const completed = logs.filter((log) => log.status === 'completed')
  const records = new Map<string, PtWorkoutHistory['analytics']['personalRecords'][number]>()
  for (const log of completed) for (const set of log.sets || []) {
    if (!set.completed || set.setType === 'warmup') continue
    const key = set.catalogExerciseId || set.exerciseId
    const current = records.get(key) || { catalogExerciseId: key, exerciseName: set.exerciseName || 'Bài tập', maximumWeightKg: 0, maximumSetVolumeKg: 0 }
    current.maximumWeightKg = Math.max(current.maximumWeightKg, Number(set.weightKg || 0))
    current.maximumSetVolumeKg = Math.max(current.maximumSetVolumeKg, Number(set.weightKg || 0) * Number(set.reps || 0))
    records.set(key, current)
  }
  return {
    completedWorkouts: completed.length,
    totalVolumeKg: Math.round(completed.reduce((sum, log) => sum + Number(log.metrics?.totalVolumeKg || 0), 0) * 10) / 10,
    painAlerts: completed.filter((log) => log.metrics?.painAlert === true).length,
    personalRecords: [...records.values()].sort((a, b) => b.maximumWeightKg - a.maximumWeightKg).slice(0, 12),
  }
}
