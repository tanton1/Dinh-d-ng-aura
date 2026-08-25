import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'

const projectId = 'demo-aura-fitness'
const rulesPath = new URL('../firestore.rules', import.meta.url)

let testEnvironment

async function seedPtSecurityFixtures() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', 'client-1'), {
        uid: 'client-1',
        displayName: 'Học viên Aura',
        role: 'student',
        membership: 'free',
        disabled: false,
      }),
      setDoc(doc(db, 'users', 'other-client'), {
        uid: 'other-client',
        displayName: 'Học viên khác',
        role: 'student',
        membership: 'free',
        disabled: false,
      }),
      setDoc(doc(db, 'users', 'coach-1'), {
        uid: 'coach-1',
        displayName: 'PT phụ trách',
        role: 'coach',
        membership: 'coach',
        disabled: false,
      }),
      setDoc(doc(db, 'users', 'other-coach'), {
        uid: 'other-coach',
        displayName: 'PT khác',
        role: 'coach',
        membership: 'coach',
        disabled: false,
      }),
      setDoc(doc(db, 'users', 'admin-1'), {
        uid: 'admin-1',
        displayName: 'Admin Aura',
        role: 'admin',
        membership: 'coach',
        disabled: false,
      }),
      setDoc(doc(db, 'coachClients', 'client-1'), {
        clientId: 'client-1',
        coachId: 'coach-1',
        coachingStatus: 'active',
      }),
      setDoc(doc(db, 'programAssignmentCycles', 'cycle-1'), {
        schemaVersion: 2,
        domain: 'pt-coaching',
        cycleId: 'cycle-1',
        clientId: 'client-1',
        coachId: 'coach-1',
        programId: 'program-1',
        versionId: 'version-1',
        status: 'active',
      }),
      setDoc(doc(db, 'users', 'client-1', 'coachingWorkoutLogs', 'log-1'), {
        clientId: 'client-1',
        coachId: 'coach-1',
        assignmentCycleId: 'cycle-1',
        programId: 'program-1',
        versionId: 'version-1',
        sessionId: 'session-1',
        verificationVersion: 1,
      }),
      setDoc(doc(db, 'coachClients', 'client-1', 'scheduleEvents', 'event-1'), {
        eventId: 'event-1',
        clientId: 'client-1',
        coachId: 'coach-1',
        title: 'Lower Body Strength',
        status: 'planned',
      }),
      setDoc(doc(db, 'system', 'pushConfig'), {
        enabled: true,
      }),
      setDoc(doc(db, 'mealReviews', 'review-1'), {
        id: 'review-1',
        userId: 'client-1',
        userName: 'Aura learner',
        meal: { id: 'meal-1', calories: 450 },
        status: 'pending',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      setDoc(doc(db, 'users', 'client-1', 'notifications', 'notification-1'), {
        userId: 'client-1',
        title: 'Aura update',
        read: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      setDoc(doc(db, 'eatCleanMeals', 'active-meal'), {
        name: 'Cơm gà Aura',
        active: true,
        price: 59000,
      }),
      setDoc(doc(db, 'eatCleanMeals', 'draft-meal'), {
        name: 'Món đang soạn',
        active: false,
        price: 69000,
      }),
      setDoc(doc(db, 'eatCleanOrders', 'order-client-1'), {
        userId: 'client-1',
        orderCode: 'EC-TEST-001',
        orderStatus: 'pending',
      }),
      setDoc(doc(db, 'students', 'legacy-student-1'), {
        id: 'legacy-student-1',
        name: 'Học viên legacy',
      }),
      setDoc(doc(db, 'contracts', 'legacy-contract-1'), {
        id: 'legacy-contract-1',
        studentId: 'legacy-student-1',
        status: 'active',
      }),
      setDoc(doc(db, 'payments', 'legacy-payment-1'), {
        id: 'legacy-payment-1',
        contractId: 'legacy-contract-1',
        amount: 100000,
      }),
      setDoc(doc(db, 'sessions', 'legacy-session-1'), {
        id: 'legacy-session-1',
        studentId: 'legacy-student-1',
        trainerId: 'legacy-trainer-1',
        status: 'completed',
      }),
      setDoc(doc(db, 'staff', 'legacy-staff-1'), {
        id: 'legacy-staff-1',
        name: 'Nhân viên legacy',
        role: 'manager',
      }),
      setDoc(doc(db, 'schedules', 'schedule_2026-08-17'), {
        schedule: {},
        warnings: [],
      }),
      setDoc(doc(db, 'settings', 'scheduleConfig'), {
        workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
        workingHours: [6, 7, 8],
      }),
    ])
  })
}

function authenticatedDb(uid, role, extraClaims = {}) {
  return testEnvironment.authenticatedContext(uid, { role, ...extraClaims }).firestore()
}

describe('Aura PT Firestore rules', () => {
  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: await readFile(rulesPath, 'utf8'),
      },
    })
  })

  beforeEach(async () => {
    await testEnvironment.clearFirestore()
    await seedPtSecurityFixtures()
  })

  after(async () => {
    await testEnvironment?.cleanup()
  })

  test('assignment cycles are readable only by the client, assigned coach, and admin', async () => {
    const cyclePath = ['programAssignmentCycles', 'cycle-1']

    await assertSucceeds(getDoc(doc(authenticatedDb('client-1', 'student'), ...cyclePath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('coach-1', 'coach'), ...cyclePath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('admin-1', 'admin'), ...cyclePath)))
    await assertFails(getDoc(doc(authenticatedDb('other-client', 'student'), ...cyclePath)))
    await assertFails(getDoc(doc(authenticatedDb('other-coach', 'coach'), ...cyclePath)))
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), ...cyclePath)))
  })

  test('assignment cycles reject direct writes from owner, coach, and admin clients', async () => {
    const attempts = [
      authenticatedDb('client-1', 'student'),
      authenticatedDb('coach-1', 'coach'),
      authenticatedDb('admin-1', 'admin'),
    ].map((db) => setDoc(doc(db, 'programAssignmentCycles', 'cycle-direct-write'), {
      clientId: 'client-1',
      coachId: 'coach-1',
      status: 'active',
    }))

    await Promise.all(attempts.map((attempt) => assertFails(attempt)))
  })

  test('schedule events remain callable-only for reads and writes', async () => {
    for (const [uid, role] of [
      ['client-1', 'student'],
      ['coach-1', 'coach'],
      ['admin-1', 'admin'],
    ]) {
      const db = authenticatedDb(uid, role)
      const eventReference = doc(db, 'coachClients', 'client-1', 'scheduleEvents', 'event-1')
      await assertFails(getDoc(eventReference))
      await assertFails(setDoc(doc(db, 'coachClients', 'client-1', 'scheduleEvents', `direct-${uid}`), {
        clientId: 'client-1',
        coachId: 'coach-1',
        title: 'Direct write must fail',
      }))
    }
  })

  test('verified workout logs are readable by owner, assigned coach, and admin only', async () => {
    const logPath = ['users', 'client-1', 'coachingWorkoutLogs', 'log-1']

    await assertSucceeds(getDoc(doc(authenticatedDb('client-1', 'student'), ...logPath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('coach-1', 'coach'), ...logPath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('admin-1', 'admin'), ...logPath)))
    await assertFails(getDoc(doc(authenticatedDb('other-client', 'student'), ...logPath)))
    await assertFails(getDoc(doc(authenticatedDb('other-coach', 'coach'), ...logPath)))
  })

  test('verified workout logs reject direct create and update attempts', async () => {
    for (const [uid, role] of [
      ['client-1', 'student'],
      ['coach-1', 'coach'],
      ['admin-1', 'admin'],
    ]) {
      const db = authenticatedDb(uid, role)
      await assertFails(setDoc(doc(db, 'users', 'client-1', 'coachingWorkoutLogs', `direct-${uid}`), {
        clientId: 'client-1',
        verificationVersion: 1,
      }))
      await assertFails(updateDoc(doc(db, 'users', 'client-1', 'coachingWorkoutLogs', 'log-1'), {
        sessionId: 'forged-session',
      }))
    }
  })

  test('users can update profile fields but cannot elevate role or membership', async () => {
    const db = authenticatedDb('client-1', 'student')
    const profileReference = doc(db, 'users', 'client-1')

    await assertSucceeds(updateDoc(profileReference, { displayName: 'Updated learner', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(profileReference, { role: 'admin' }))
    await assertFails(updateDoc(profileReference, { membership: 'coach' }))
    await assertFails(updateDoc(profileReference, { disabled: true }))
    await assertFails(updateDoc(profileReference, { uid: 'admin-1' }))
  })

  test('new profiles must use the authenticated identity and safe defaults', async () => {
    const validDb = authenticatedDb('new-user', 'student', { email: 'new@example.com' })
    await assertSucceeds(setDoc(doc(validDb, 'users', 'new-user'), {
      uid: 'new-user',
      email: 'new@example.com',
      displayName: 'New learner',
      role: 'student',
      membership: 'free',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }))

    const invalidDb = authenticatedDb('forged-user', 'admin', { email: 'forged@example.com' })
    await assertFails(setDoc(doc(invalidDb, 'users', 'forged-user'), {
      uid: 'forged-user',
      email: 'forged@example.com',
      role: 'admin',
      membership: 'pro',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }))
  })

  test('Eat Clean catalog exposes active meals while drafts remain admin-only', async () => {
    const studentDb = authenticatedDb('client-1', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')

    await assertSucceeds(getDoc(doc(studentDb, 'eatCleanMeals', 'active-meal')))
    await assertFails(getDoc(doc(studentDb, 'eatCleanMeals', 'draft-meal')))
    await assertSucceeds(getDoc(doc(adminDb, 'eatCleanMeals', 'draft-meal')))
    await assertFails(setDoc(doc(adminDb, 'eatCleanMeals', 'direct-admin-write'), {
      name: 'Không được ghi trực tiếp',
      active: true,
    }))
  })

  test('Eat Clean orders are owner-readable and callable-only for mutations', async () => {
    const ownerDb = authenticatedDb('client-1', 'student')
    const otherDb = authenticatedDb('other-client', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')
    const orderReference = ['eatCleanOrders', 'order-client-1']

    await assertSucceeds(getDoc(doc(ownerDb, ...orderReference)))
    await assertSucceeds(getDoc(doc(adminDb, ...orderReference)))
    await assertFails(getDoc(doc(otherDb, ...orderReference)))
    await assertFails(updateDoc(doc(ownerDb, ...orderReference), { orderStatus: 'delivered' }))
    await assertFails(setDoc(doc(ownerDb, 'eatCleanOrders', 'forged-order'), {
      userId: 'client-1',
      orderStatus: 'pending',
    }))
  })

  test('Eat Clean quotes, inventory, and idempotency markers remain server-only', async () => {
    const ownerDb = authenticatedDb('client-1', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')
    const serverOnlyDocuments = [
      ['eatCleanQuotes', 'quote-1'],
      ['eatCleanInventory', '2026-08-15_active-meal'],
      ['eatCleanIdempotency', 'request-1'],
    ]

    for (const documentPath of serverOnlyDocuments) {
      await assertFails(getDoc(doc(ownerDb, ...documentPath)))
      await assertFails(getDoc(doc(adminDb, ...documentPath)))
      await assertFails(setDoc(doc(ownerDb, ...documentPath), { forged: true }))
      await assertFails(setDoc(doc(adminDb, ...documentPath), { forged: true }))
    }
  })

  test('renewal cases, activities and approvals are callable-only for every browser role', async () => {
    const studentDb = authenticatedDb('client-1', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')
    const serverOnlyDocuments = [
      ['contractRenewalCases', 'contract-1'],
      ['contractRenewalActivities', 'activity-1'],
      ['contractRenewalApprovals', 'approval-1'],
    ]

    for (const documentPath of serverOnlyDocuments) {
      await assertFails(getDoc(doc(studentDb, ...documentPath)))
      await assertFails(getDoc(doc(adminDb, ...documentPath)))
      await assertFails(setDoc(doc(adminDb, ...documentPath), { forged: true }))
    }
  })

  test('staff payroll calendars, attendance, earnings and inquiries are callable-only', async () => {
    const studentDb = authenticatedDb('client-1', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')
    const serverOnlyDocuments = [
      ['workCalendars', 'global_2026-08'],
      ['staffAttendanceDays', 'staff-1_20260825'],
      ['staffPayrollInquiries', 'inquiry-1'],
      ['staffEarningEvents', 'earning-1'],
    ]

    for (const documentPath of serverOnlyDocuments) {
      await assertFails(getDoc(doc(studentDb, ...documentPath)))
      await assertFails(getDoc(doc(adminDb, ...documentPath)))
      await assertFails(setDoc(doc(studentDb, ...documentPath), { forged: true }))
      await assertFails(setDoc(doc(adminDb, ...documentPath), { forged: true }))
    }
  })

  test('Eat Clean audit, refund, and operational records are admin-readable but callable-only', async () => {
    const ownerDb = authenticatedDb('client-1', 'student')
    const adminDb = authenticatedDb('admin-1', 'admin')
    const auditDocuments = [
      ['eatCleanMealRevisions', 'revision-1'],
      ['eatCleanRefundJobs', 'order-client-1'],
      ['eatCleanPaymentAdjustments', 'adjustment-1'],
      ['eatCleanOperationalSignals', '2026-08-21'],
    ]

    for (const documentPath of auditDocuments) {
      await assertFails(getDoc(doc(ownerDb, ...documentPath)))
      await assertSucceeds(getDoc(doc(adminDb, ...documentPath)))
      await assertFails(setDoc(doc(adminDb, ...documentPath), { forged: true }))
    }
  })

  test('Eat Clean favorites are private and can only reference their document id', async () => {
    const ownerDb = authenticatedDb('client-1', 'student')
    const otherDb = authenticatedDb('other-client', 'student')
    const favoriteReference = doc(ownerDb, 'users', 'client-1', 'favoriteMeals', 'active-meal')

    await assertSucceeds(setDoc(favoriteReference, {
      mealId: 'active-meal',
      createdAt: serverTimestamp(),
    }))
    await assertSucceeds(getDoc(favoriteReference))
    await assertFails(getDoc(doc(otherDb, 'users', 'client-1', 'favoriteMeals', 'active-meal')))
    await assertFails(setDoc(doc(ownerDb, 'users', 'client-1', 'favoriteMeals', 'other-id'), {
      mealId: 'active-meal',
      createdAt: serverTimestamp(),
    }))
  })

  test('stored roles and token roles must match for privileged access', async () => {
    const systemPath = ['system', 'pushConfig']
    await assertSucceeds(getDoc(doc(authenticatedDb('admin-1', 'admin'), ...systemPath)))
    await assertFails(getDoc(doc(authenticatedDb('client-1', 'student'), ...systemPath)))
    await assertFails(getDoc(doc(authenticatedDb('coach-1', 'admin'), ...systemPath)))
    await assertFails(getDoc(doc(testEnvironment.unauthenticatedContext().firestore(), ...systemPath)))
  })

  test('migrated PT operations are admin-only and remain editable by the admin console', async () => {
    const adminDb = authenticatedDb('admin-1', 'admin')
    const studentDb = authenticatedDb('client-1', 'student')
    const coachDb = authenticatedDb('coach-1', 'coach')
    const mismatchedAdminDb = authenticatedDb('coach-1', 'admin')
    const protectedPaths = [
      ['students', 'legacy-student-1'],
      ['staff', 'legacy-staff-1'],
      ['schedules', 'schedule_2026-08-17'],
      ['ptScheduleVersions', 'schedule_2026-08-17_branch-a_v1'],
      ['settings', 'scheduleConfig'],
    ]

    for (const documentPath of protectedPaths) {
      await assertSucceeds(getDoc(doc(adminDb, ...documentPath)))
      await assertFails(getDoc(doc(studentDb, ...documentPath)))
      await assertFails(getDoc(doc(coachDb, ...documentPath)))
      await assertFails(getDoc(doc(mismatchedAdminDb, ...documentPath)))
    }

    await assertSucceeds(updateDoc(doc(adminDb, 'staff', 'legacy-staff-1'), {
      status: 'active',
    }))
    await assertFails(updateDoc(doc(studentDb, 'staff', 'legacy-staff-1'), {
      status: 'inactive',
    }))
  })

  test('legacy business records reject browser hard-delete including admin clients', async () => {
    const adminDb = authenticatedDb('admin-1', 'admin')
    for (const [collectionName, documentId] of [
      ['contracts', 'legacy-contract-1'],
      ['payments', 'legacy-payment-1'],
      ['sessions', 'legacy-session-1'],
    ]) {
      await assertFails(deleteDoc(doc(adminDb, collectionName, documentId)))
    }
  })

  test('session lifecycle is callable-only even for an authenticated admin browser', async () => {
    const adminDb = authenticatedDb('admin-1', 'admin')
    const reference = doc(adminDb, 'sessions', 'legacy-session-1')
    await assertSucceeds(getDoc(reference))
    await assertFails(updateDoc(reference, { status: 'completed' }))
    await assertFails(setDoc(doc(adminDb, 'sessions', 'forged-session'), {
      studentId: 'legacy-student-1',
      trainerId: 'legacy-trainer-1',
      contractId: 'legacy-contract-1',
      date: '2026-08-20',
      status: 'scheduled',
    }))
  })

  test('PT change, OFF and preservation policy records are callable-only', async () => {
    const adminDb = authenticatedDb('admin-1', 'admin')
    const studentDb = authenticatedDb('client-1', 'student')
    for (const [collectionName, documentId] of [
      ['sessionRequests', 'request-1'],
      ['leaveRequests', 'leave-1'],
      ['ptPolicyUsage', 'client-1_2026-08'],
      ['contractPauseEvents', 'pause-1'],
    ]) {
      await assertSucceeds(getDoc(doc(adminDb, collectionName, documentId)))
      await assertFails(getDoc(doc(studentDb, collectionName, documentId)))
      await assertFails(setDoc(doc(adminDb, collectionName, `${documentId}-forged`), { forged: true }))
      await assertFails(setDoc(doc(studentDb, collectionName, `${documentId}-student`), { forged: true }))
    }
  })

  test('published PT schedule versions are server-owned and immutable to browsers', async () => {
    const adminDb = authenticatedDb('admin-1', 'admin')
    const studentDb = authenticatedDb('client-1', 'student')
    const reference = doc(adminDb, 'ptScheduleVersions', 'schedule_2026-08-17_branch-a_v1')
    await assertSucceeds(getDoc(reference))
    await assertFails(getDoc(doc(studentDb, 'ptScheduleVersions', 'schedule_2026-08-17_branch-a_v1')))
    await assertFails(setDoc(reference, { version: 999 }))
  })

  test('meal reviews are private and only the assigned coach or admin can moderate', async () => {
    const reviewPath = ['mealReviews', 'review-1']
    await assertSucceeds(getDoc(doc(authenticatedDb('client-1', 'student'), ...reviewPath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('coach-1', 'coach'), ...reviewPath)))
    await assertSucceeds(getDoc(doc(authenticatedDb('admin-1', 'admin'), ...reviewPath)))
    await assertFails(getDoc(doc(authenticatedDb('other-client', 'student'), ...reviewPath)))
    await assertFails(getDoc(doc(authenticatedDb('other-coach', 'coach'), ...reviewPath)))

    await assertFails(updateDoc(doc(authenticatedDb('client-1', 'student'), ...reviewPath), {
      status: 'approved',
      updatedAt: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(authenticatedDb('other-coach', 'coach'), ...reviewPath), {
      status: 'approved',
      updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(updateDoc(doc(authenticatedDb('coach-1', 'coach'), ...reviewPath), {
      status: 'approved',
      coachFeedback: 'Balanced meal',
      updatedAt: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(authenticatedDb('coach-1', 'coach'), ...reviewPath), {
      userId: 'other-client',
      updatedAt: serverTimestamp(),
    }))
  })

  test('user notifications are isolated and only support safe acknowledgement updates', async () => {
    const notificationPath = ['users', 'client-1', 'notifications', 'notification-1']
    await assertSucceeds(getDoc(doc(authenticatedDb('client-1', 'student'), ...notificationPath)))
    await assertFails(getDoc(doc(authenticatedDb('other-client', 'student'), ...notificationPath)))

    await assertSucceeds(setDoc(doc(authenticatedDb('client-1', 'student'), 'users', 'client-1', 'notifications', 'notification-2'), {
      userId: 'client-1',
      title: 'New notification',
      read: false,
      createdAt: serverTimestamp(),
    }))
    await assertFails(setDoc(doc(authenticatedDb('other-client', 'student'), 'users', 'client-1', 'notifications', 'notification-3'), {
      userId: 'client-1',
      title: 'Forged notification',
      read: false,
      createdAt: serverTimestamp(),
    }))
    await assertSucceeds(updateDoc(doc(authenticatedDb('client-1', 'student'), ...notificationPath), {
      read: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(authenticatedDb('client-1', 'student'), ...notificationPath), {
      title: 'Tampered title',
      updatedAt: serverTimestamp(),
    }))
  })
})
