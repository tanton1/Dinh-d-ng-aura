const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
  normalizedPhone,
  initialPasswordFromPhone,
  loginEmailFromPhone,
  legacyStudentIdentityFields,
  resolveStaffContactUpdate,
  identityDirectoryPageSize,
  identityDirectoryNextCursor,
  identityDirectoryAssignment,
  identityDirectoryStaffRecord,
  normalizedTrainerAvailabilitySlots,
  managedClientCountsFromContracts,
  staffIdsFromContract,
  isReclaimableDeletedStudent,
  studentProfilePhoneMatches,
} = require('./identity-access')

test('identity directory always exposes trainer availability as the canonical source', () => {
  const record = identityDirectoryStaffRecord(
    { availableSlots: ['T2-6'], availabilityRevision: 99, schedulingPriority: 20 },
    { availableSlots: ['T3-7', 'T3-7'], availabilityMode: 'configured', availabilityRevision: 4 },
  )
  assert.deepEqual(record.availableSlots, ['T3-7'])
  assert.equal(record.availabilityRevision, 4)
  assert.equal(record.availabilityMode, 'configured')
  assert.equal(record.schedulingPriority, 20)
})

test('trainer availability normalization rejects slots outside the configured schedule', () => {
  assert.throws(
    () => normalizedTrainerAvailabilitySlots(['T2-6', 'CN-9'], { workingDays: ['T2'], workingHours: [6] }),
    /ngoài lịch hoạt động/,
  )
  assert.deepEqual(
    normalizedTrainerAvailabilitySlots(['T2-7', 'T2-6', 'T2-6'], { workingDays: ['T2'], workingHours: [6, 7] }),
    ['T2-6', 'T2-7'],
  )
})

test('identity directory pagination stays bounded and preserves legacy assignment semantics', () => {
  assert.equal(identityDirectoryPageSize(undefined), 60)
  assert.equal(identityDirectoryPageSize(1), 20)
  assert.equal(identityDirectoryPageSize(500), 100)
  assert.deepEqual(identityDirectoryAssignment({ role: 'trainer', branchId: 'branch-a' }), {
    accessRole: 'staff',
    positions: ['trainer_pt'],
    branchIds: ['branch-a'],
    status: 'active',
  })
})

test('identity directory cursor advances past the complete inspected source window', () => {
  const sourceDocuments = [{ id: 'user-a' }, { id: 'staff-b' }, { id: 'user-c' }, { id: 'staff-d' }]
  assert.equal(identityDirectoryNextCursor(sourceDocuments, [{ user: { uid: 'user-a' } }, { user: { uid: 'user-c' } }], 2, true), 'user-c')
  assert.equal(identityDirectoryNextCursor(sourceDocuments, [{ user: { uid: 'user-c' } }], 4, true), 'staff-d')
  assert.equal(identityDirectoryNextCursor(sourceDocuments, [], 4, false), null)
  assert.equal(identityDirectoryNextCursor([], [], 4, true), null)
})

test('staff directory summaries count active primary, secondary and nutrition assignments once', () => {
  assert.deepEqual(managedClientCountsFromContracts('pt-1', [
    { status: 'active', trainerId: 'pt-1' },
    { status: 'future', trainerIds: ['other', 'pt-1'], nutritionPTIds: ['coach-1'] },
    { status: 'frozen', secondaryTrainerId: 'pt-1', nutritionTrainerId: 'pt-1' },
    { status: 'completed', trainerId: 'pt-1', nutritionTrainerId: 'pt-1' },
  ]), { main: 1, secondary: 2, nutrition: 1 })
})

test('contract assignment resolver refreshes every affected staff projection once', () => {
  assert.deepEqual(staffIdsFromContract({
    trainerId: 'pt-main',
    secondaryTrainerId: 'pt-secondary',
    trainerIds: ['pt-main', 'pt-secondary', 'pt-extra'],
    nutritionTrainerId: 'coach-nutrition',
    nutritionTrainerIds: ['coach-nutrition', 'coach-second'],
    nutritionPTIds: ['coach-second', 'coach-third'],
  }), ['pt-main', 'pt-secondary', 'coach-nutrition', 'pt-extra', 'coach-second', 'coach-third'])
  assert.deepEqual(staffIdsFromContract({ trainerId: ' ', trainerIds: [null, 42, 'pt-1', 'pt-1'] }), ['pt-1'])
})

test('normalizes a Vietnamese phone for Firebase Auth', () => {
  assert.equal(normalizedPhone('090 123 4567'), '+84901234567')
  assert.equal(normalizedPhone('+84 901-234-567'), '+84901234567')
})

test('uses the local phone number as the initial password', () => {
  assert.equal(initialPasswordFromPhone('+84901234567'), '0901234567')
})

test('derives an Aura login email when a personal email is missing', () => {
  for (const email of [undefined, null, '', '   ']) {
    for (const phone of ['0901234567', '090 123-4567', '+84901234567', '84901234567']) {
      assert.equal(loginEmailFromPhone(email, normalizedPhone(phone)), '0901234567@aurafitness.com')
    }
  }
  assert.equal(loginEmailFromPhone('  Nhan.Vien@Example.COM ', '+84901234567'), 'nhan.vien@example.com')
})

test('preserves an explicitly supplied legacy Aura email', () => {
  assert.equal(loginEmailFromPhone(' 0901234567@AuraFitness.VN ', '+84901234567'), '0901234567@aurafitness.vn')
})

test('recognizes only explicitly deleted, unlinked student profiles as reusable', () => {
  const phone = normalizedPhone('070 272 8851')
  assert.equal(studentProfilePhoneMatches({ phone: '0702728851' }, phone), true)
  assert.equal(isReclaimableDeletedStudent({ phone: '0702728851', accountStatus: 'deleted' }, phone), true)
  assert.equal(isReclaimableDeletedStudent({ phone: '0702728851', accountStatus: 'deleted', accountUid: 'old-uid' }, phone), false)
  assert.equal(isReclaimableDeletedStudent({ phone: '0702728851', status: 'inactive' }, phone), false)
  assert.equal(isReclaimableDeletedStudent({ phone: '0900000000', accountStatus: 'deleted' }, phone), false)
})

test('new student profiles never send delete sentinels through transaction.create', () => {
  const fields = legacyStudentIdentityFields({
    restoredStudentFields: { id: 'student-new', name: 'Học viên mới', phone: '+84901234567' },
    uid: 'uid-new',
    actorUid: 'admin-1',
  })
  assert.equal(Object.hasOwn(fields, 'accountDeletedAt'), false)
  assert.equal(Object.hasOwn(fields, 'accountDeletedBy'), false)
  assert.equal(fields.revision, 1)

  const restored = legacyStudentIdentityFields({
    restoredStudentFields: { id: 'student-old', name: 'Học viên cũ', phone: '+84901234567' },
    uid: 'uid-new',
    actorUid: 'admin-1',
    existingStudent: true,
  })
  assert.equal(Object.hasOwn(restored, 'accountDeletedAt'), true)
  assert.equal(Object.hasOwn(restored, 'accountDeletedBy'), true)
  assert.equal(Object.hasOwn(restored, 'revision'), false)
})

test('saving an existing staff profile never migrates its legacy login alias', () => {
  for (const request of [{}, { email: '', contactChanges: { email: true } }]) {
    assert.deepEqual(resolveStaffContactUpdate(
      request,
      { email: '0901234567@aurafitness.com' },
      { email: '0901234567@aurafitness.vn', phoneNumber: '+84901234567' },
    ), {
      email: '0901234567@aurafitness.vn',
      phoneNumber: '+84901234567',
      emailChanged: false,
      phoneChanged: false,
    })
  }
})

test('rejects an invalid optional email instead of silently replacing it', () => {
  assert.throws(() => loginEmailFromPhone('email-khong-hop-le', '+84901234567'), /Email không hợp lệ/)
})

test('keeps canonical Auth contacts when a legacy staff save submits stale projections', () => {
  const result = resolveStaffContactUpdate(
    { email: 'stale@example.com', phoneNumber: '090 999 9999' },
    { email: 'legacy@example.com', phone: '090 888 8888' },
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.deepEqual(result, {
    email: 'staff@aura.vn',
    phoneNumber: '+84901234567',
    emailChanged: false,
    phoneChanged: false,
  })
})

test('updates staff contacts only when the editor explicitly marks them as changed', () => {
  const result = resolveStaffContactUpdate(
    {
      email: ' NEW.STAFF@Example.com ',
      phoneNumber: '091 234 5678',
      contactChanges: { email: true, phoneNumber: true },
    },
    {},
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.deepEqual(result, {
    email: 'new.staff@example.com',
    phoneNumber: '+84912345678',
    emailChanged: true,
    phoneChanged: true,
  })
})

test('does not update Auth when explicitly submitted contacts only differ by case or formatting', () => {
  const result = resolveStaffContactUpdate(
    {
      email: ' STAFF@AURA.VN ',
      phoneNumber: '090 123-4567',
      contactChanges: { email: true, phoneNumber: true },
    },
    {},
    { email: 'staff@aura.vn', phoneNumber: '+84901234567' },
  )

  assert.equal(result.emailChanged, false)
  assert.equal(result.phoneChanged, false)
  assert.equal(result.email, 'staff@aura.vn')
  assert.equal(result.phoneNumber, '+84901234567')
})

test('an operational-only staff save never changes Auth contacts', () => {
  const result = resolveStaffContactUpdate(
    {
      availabilitySlots: ['T2-6', 'T4-18'],
      slotCapacity: 2,
      contactChanges: { email: false, phoneNumber: false },
    },
    { email: 'projected@example.com', phone: '0999999999' },
    { email: 'canonical@aura.vn', phoneNumber: '+84987654321' },
  )

  assert.equal(result.emailChanged, false)
  assert.equal(result.phoneChanged, false)
  assert.equal(result.email, 'canonical@aura.vn')
  assert.equal(result.phoneNumber, '+84987654321')
})


test('event-driven reads see revoked assignments immediately inside the normal assignment cache window', async () => {
  const { trustedAccessContext } = require('./identity-access')
  let assignment = { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['branch-a'], status: 'active', authzVersion: 1 }
  let assignmentReads = 0
  const db = { doc(path) { return { async get() {
    const value = path.startsWith('users/') ? { role: 'trainer', displayName: 'PT', disabled: false } : structuredClone(assignment)
    if (path.startsWith('roleAssignments/')) assignmentReads += 1
    return { exists: true, data: () => value }
  } } } }
  const request = { auth: { uid: 'fresh-assignment-pt', token: { role: 'trainer', accessRole: 'staff', authzVersion: 1 } } }
  assert.deepEqual((await trustedAccessContext(request, db)).branchIds, ['branch-a'])
  await trustedAccessContext(request, db)
  assert.equal(assignmentReads, 1)
  assignment = { ...assignment, status: 'suspended' }
  await assert.rejects(trustedAccessContext(request, db, { freshAssignment: true }), { code: 'permission-denied' })
  assert.equal(assignmentReads, 2)
})

test('event-driven reads use the current branch assignment and still reject stale authorization claims', async () => {
  const { trustedAccessContext } = require('./identity-access')
  let assignment = { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['branch-a'], status: 'active', authzVersion: 1 }
  const db = { doc(path) { return { async get() {
    const value = path.startsWith('users/') ? { role: 'trainer', disabled: false } : structuredClone(assignment)
    return { exists: true, data: () => value }
  } } } }
  const request = { auth: { uid: 'fresh-branch-pt', token: { role: 'trainer', accessRole: 'staff', authzVersion: 1 } } }
  await trustedAccessContext(request, db)
  assignment = { ...assignment, branchIds: ['branch-b'], authzVersion: 2 }
  await assert.rejects(trustedAccessContext(request, db, { freshAssignment: true }), { code: 'permission-denied' })
  const updatedRequest = { auth: { ...request.auth, token: { ...request.auth.token, authzVersion: 2 } } }
  assert.deepEqual((await trustedAccessContext(updatedRequest, db, { freshAssignment: true })).branchIds, ['branch-b'])
})
