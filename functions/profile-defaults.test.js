const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCompletedOnboardingDefaultsPatch } = require('./profile-defaults')

test('completed onboarding receives all three defaults when untouched controls were stored as null', () => {
  const patch = buildCompletedOnboardingDefaultsPatch({
    onboardingCompleted: true,
    birthYear: 1995,
    heightCm: null,
    weightKg: null,
    onboardingData: { birthYear: 1995, heightCm: null, weightKg: null },
    nutritionProfile: { age: 31, heightCm: null, weightKg: null, goal: 'maintain' },
  }, 2026)

  assert.equal(patch.birthYear, undefined)
  assert.equal(patch.heightCm, 165)
  assert.equal(patch.weightKg, 60)
  assert.deepEqual(patch.onboardingData, { birthYear: 1995, heightCm: 165, weightKg: 60 })
  assert.equal(patch.nutritionProfile.heightCm, 165)
  assert.equal(patch.nutritionProfile.weightKg, 60)
  assert.equal(patch.nutritionProfile.age, 31)
})

test('completed onboarding preserves valid member values and fills a missing top-level birth year', () => {
  const patch = buildCompletedOnboardingDefaultsPatch({
    onboardingCompleted: true,
    birthYear: null,
    heightCm: 168,
    weightKg: 65,
    onboardingData: { birthYear: 1990, heightCm: 168, weightKg: 65 },
    nutritionProfile: { age: 36, heightCm: 168, weightKg: 65 },
  }, 2026)

  assert.deepEqual(patch, { birthYear: 1990 })
})

test('incomplete onboarding is never mutated by the backend normalizer', () => {
  assert.equal(buildCompletedOnboardingDefaultsPatch({
    onboardingCompleted: false,
    heightCm: null,
    weightKg: null,
  }, 2026), null)
})

test('a consistent completed profile does not cause a trigger loop', () => {
  assert.equal(buildCompletedOnboardingDefaultsPatch({
    onboardingCompleted: true,
    birthYear: 1995,
    heightCm: 165,
    weightKg: 60,
    onboardingData: { birthYear: 1995, heightCm: 165, weightKg: 60 },
  }, 2026), null)
})
