import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExerciseCatalogItem } from '../src/types'
import { exerciseMatchesMuscleGroup, exerciseMuscleGroupOptions } from '../src/utils/exerciseMuscleGroups'

function item(targetMuscles: string[], secondaryMuscles: string[] = [], bodyParts: string[] = []): ExerciseCatalogItem {
  return {
    id: targetMuscles.join('-'), schemaVersion: 1, revision: 1, status: 'published', nameVi: 'Bài kiểm thử', nameEn: 'Test', aliasesVi: [],
    bodyParts, targetMuscles, secondaryMuscles, equipment: ['Thảm'], environment: ['gym'], difficulty: 'beginner', goals: [],
    instructionsVi: ['Bước 1'], cuesVi: [], commonMistakesVi: [], media: {}, defaultPrescription: { sets: 3, reps: '10', restSeconds: 60, rpe: 7 },
    source: { provider: 'aura', sourceExerciseId: 'test', sourceVersion: '1', license: 'Aura-owned' }, sourceAttribution: 'Aura',
  }
}

test('exercise muscle groups normalize Vietnamese labels and include secondary muscles', () => {
  const glutes = item(['Mông nhỡ'], ['Core'])
  const adductors = item(['Cơ khép', 'Đùi trong'])
  const upper = item(['Cơ xô'], ['Tay trước', 'Vai sau'])

  assert.equal(exerciseMatchesMuscleGroup(glutes, 'glutes'), true)
  assert.equal(exerciseMatchesMuscleGroup(glutes, 'core'), true)
  assert.equal(exerciseMatchesMuscleGroup(adductors, 'inner_outer_thigh'), true)
  assert.equal(exerciseMatchesMuscleGroup(upper, 'back'), true)
  assert.equal(exerciseMatchesMuscleGroup(upper, 'chest_arms'), true)
  assert.equal(exerciseMatchesMuscleGroup(upper, 'shoulders'), true)
  assert.equal(exerciseMatchesMuscleGroup(upper, 'quadriceps'), false)
})

test('muscle filter options expose only groups represented by catalog data', () => {
  const options = exerciseMuscleGroupOptions([item(['Mông lớn']), item(['Đùi trước']), item(['Bắp chân'])])
  assert.deepEqual(options.map((option) => option.id), ['all', 'glutes', 'quadriceps', 'calves'])
  assert.deepEqual(options.map((option) => option.count), [3, 1, 1, 1])
})
