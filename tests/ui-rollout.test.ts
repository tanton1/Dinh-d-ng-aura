import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AURA_UI_ROLLOUT,
  isAuraUiAssignmentActive,
  isAuraUiSurfaceEnabled,
  normalizeAuraUiAssignment,
  normalizeAuraUiRolloutConfig,
} from '../src/features/ui-rollout/config'
import { AURA_UI_SURFACES, type AuraUiRolloutConfig } from '../src/features/ui-rollout/types'

function rollout(overrides: Partial<AuraUiRolloutConfig['surfaces']>): AuraUiRolloutConfig {
  return {
    ...DEFAULT_AURA_UI_ROLLOUT,
    surfaces: { ...DEFAULT_AURA_UI_ROLLOUT.surfaces, ...overrides },
  }
}

test('invalid or missing rollout configuration fails closed', () => {
  assert.deepEqual(normalizeAuraUiRolloutConfig(null).surfaces, DEFAULT_AURA_UI_ROLLOUT.surfaces)
  const normalized = normalizeAuraUiRolloutConfig({ surfaces: { shell: 'everyone', 'member-home': 'all' } })
  assert.deepEqual(normalized.surfaces, DEFAULT_AURA_UI_ROLLOUT.surfaces)
  assert.equal(Object.keys(normalized.surfaces).length, AURA_UI_SURFACES.length)
})

test('audiences enable only their intended roles', () => {
  const config = rollout({ shell: 'staff', 'admin-dashboard': 'admin', 'member-home': 'all' })
  assert.equal(isAuraUiSurfaceEnabled('shell', 'trainer', config, null), true)
  assert.equal(isAuraUiSurfaceEnabled('shell', 'student', config, null), false)
  assert.equal(isAuraUiSurfaceEnabled('admin-dashboard', 'admin', config, null), true)
  assert.equal(isAuraUiSurfaceEnabled('admin-dashboard', 'super_admin', config, null), true)
  assert.equal(isAuraUiSurfaceEnabled('admin-dashboard', 'manager', config, null), false)
  assert.equal(isAuraUiSurfaceEnabled('member-home', 'student', config, null), true)
})

test('a valid personal assignment overrides an off audience until expiry', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z')
  const assignment = normalizeAuraUiAssignment({
    surfaces: ['student-360', 'student-360'],
    expiresAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    updatedBy: 'super-admin',
  })
  assert.deepEqual(assignment?.surfaces, ['student-360'])
  assert.equal(isAuraUiAssignmentActive(assignment, now), true)
  assert.equal(isAuraUiSurfaceEnabled('student-360', 'student', DEFAULT_AURA_UI_ROLLOUT, assignment, now), true)
  assert.equal(isAuraUiSurfaceEnabled('student-360', 'student', DEFAULT_AURA_UI_ROLLOUT, assignment, now + 86_400_000), false)
  assert.equal(normalizeAuraUiAssignment({ surfaces: ['student-360', 'not-a-surface'], expiresAt: null }), null)
})

test('an active personal assignment can keep omitted surfaces on legacy UI', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z')
  const assignment = normalizeAuraUiAssignment({
    surfaces: ['member-home'],
    expiresAt: null,
    updatedAt: '2026-09-04T00:00:00.000Z',
    updatedBy: 'super-admin',
  })
  const config = rollout({ 'member-home': 'all', 'member-nutrition': 'all' })
  assert.equal(isAuraUiSurfaceEnabled('member-home', 'student', config, assignment, now), true)
  assert.equal(isAuraUiSurfaceEnabled('member-nutrition', 'student', config, assignment, now), false)
})

test('invalid assignment expiry is rejected instead of remaining active forever', () => {
  assert.equal(normalizeAuraUiAssignment({ surfaces: ['shell'], expiresAt: 'later' }), null)
})
