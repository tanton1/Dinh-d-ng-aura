import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  memberLoyaltyReadAllowed,
  memberScheduleReadAllowed,
  rememberSessionAccess,
  sessionAccessFor,
} from '../src/identity/sessionAccess'

const context = (accessRole: 'student' | 'staff' | 'admin' | 'super_admin', status: 'active' | 'suspended' | 'invited' = 'active') => ({ uid: 'account-a', accessRole, status })

test('an unknown access context never blocks a member read', () => {
  rememberSessionAccess(null)
  assert.equal(sessionAccessFor('account-a'), null)
  assert.equal(memberLoyaltyReadAllowed(null), true)
  assert.equal(memberScheduleReadAllowed(null), true)
})

test('the confirmed context belongs to one account only', () => {
  rememberSessionAccess(context('admin'))
  assert.deepEqual(sessionAccessFor('account-a'), context('admin'))
  assert.equal(sessionAccessFor('account-b'), null)
  assert.equal(sessionAccessFor(''), null)
  assert.equal(sessionAccessFor(undefined), null)
  rememberSessionAccess(null)
  assert.equal(sessionAccessFor('account-a'), null)
})

test('member reads follow the roles the callables accept', () => {
  const expectations = [
    ['student', true, true],
    ['staff', false, true],
    ['admin', false, false],
    ['super_admin', false, false],
  ] as const
  for (const [role, loyalty, schedule] of expectations) {
    rememberSessionAccess(context(role))
    const access = sessionAccessFor('account-a')
    assert.equal(memberLoyaltyReadAllowed(access), loyalty, `loyalty for ${role}`)
    assert.equal(memberScheduleReadAllowed(access), schedule, `schedule for ${role}`)
  }
  rememberSessionAccess(null)
})

test('a suspended or invited account is left for the server to answer', () => {
  for (const status of ['suspended', 'invited'] as const) {
    rememberSessionAccess(context('admin', status))
    const access = sessionAccessFor('account-a')
    assert.equal(memberLoyaltyReadAllowed(access), true)
    assert.equal(memberScheduleReadAllowed(access), true)
  }
  rememberSessionAccess(null)
})

test('the client rules name the same roles as the server guards', () => {
  const loyalty = readFileSync('functions/loyalty.js', 'utf8')
  const operations = readFileSync('functions/pt-operations-v2.js', 'utf8')
  assert.match(loyalty, /async function studentActor\(request, db\) \{[\s\S]*?if \(actor\.accessRole !== 'student'\) throw new HttpsError\('permission-denied', 'Aura Club học viên chỉ dành cho tài khoản học viên\.'\)/)
  assert.match(operations, /if \(!\['student', 'staff'\]\.includes\(actor\.accessRole\)\) \{\s*throw new HttpsError\('permission-denied', 'Lịch cá nhân chỉ dành cho học viên hoặc Staff có hồ sơ học viên được liên kết\.', \{\s*issueCode: 'STUDENT_ROLE_REQUIRED'/)
})

test('services answer a known rejection locally and the session forgets on sign-out', () => {
  const scheduleService = readFileSync('src/services/studentPtScheduleService.ts', 'utf8')
  const loyaltyService = readFileSync('src/features/loyalty/loyaltyService.ts', 'utf8')
  const auth = readFileSync('src/contexts/AuthContext.tsx', 'utf8')
  assert.match(scheduleService, /if \(!memberScheduleReadAllowed\(sessionAccessFor\(accountUid\)\)\) \{\s*throw new StudentPtScheduleServiceError\('Lịch cá nhân chỉ dành cho học viên hoặc Staff có hồ sơ học viên được liên kết\.', 'STUDENT_ROLE_REQUIRED', false/)
  assert.match(loyaltyService, /if \(!memberLoyaltyReadAllowed\(sessionAccessFor\(firebaseAuth\?\.currentUser\?\.uid\)\)\) \{\s*return Promise\.reject\(Object\.assign\(new Error\('Aura Club học viên chỉ dành cho tài khoản học viên\.'\), \{ code: 'functions\/permission-denied' \}\)\)/)
  assert.match(auth, /setAccessContext\(nextAccessContext\)\s*rememberSessionAccess\(nextAccessContext\)/)
  assert.match(auth, /setAccessContext\(emptyStudentAccessContext\(firebaseUser\.uid\)\)\s*rememberSessionAccess\(null\)/)
  assert.match(auth, /setAccessContext\(null\)\s*rememberSessionAccess\(null\)/)
})
