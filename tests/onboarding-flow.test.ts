import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSteps } from '../src/onboarding/flow'
import { normalizeOnboardingProfile } from '../src/onboarding/defaults'

test('short onboarding keeps calculation inputs, restrictions and health before any plan', () => {
  const profile = normalizeOnboardingProfile({ primaryGoal: 'maintenance' })
  const steps = getSteps(profile)
  for (const name of ['sex', 'birth-year', 'height', 'weight', 'primary-goal', 'activity', 'restrictions', 'health'] as const) {
    assert.ok(steps.indexOf(name) >= 0 && steps.indexOf(name) < steps.indexOf('analyzing'))
  }
  assert.equal(steps.includes('sleep'), false)
  assert.equal(steps.includes('notifications'), false)
  assert.equal(profile.healthScreeningCompleted, undefined)
  assert.equal(profile.dietType, undefined)
})

test('conditional health and goal details cannot be skipped by optional preferences', () => {
  const profile = normalizeOnboardingProfile({ primaryGoal: 'fat_loss', healthConditions: ['Tiểu đường'] })
  const steps = getSteps(profile)
  assert.ok(steps.indexOf('health-details') < steps.indexOf('preferences-choice'))
  assert.ok(steps.includes('target-weight') && steps.includes('goal-pace'))
  const extended = getSteps(profile, true)
  assert.ok(extended.indexOf('sleep') > extended.indexOf('health-details'))
  assert.ok(extended.indexOf('notifications') < extended.indexOf('analyzing'))
  assert.equal(new Set(extended).size, extended.length)
})
