import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

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
    ])
  })
}

function authenticatedDb(uid, role) {
  return testEnvironment.authenticatedContext(uid, { role }).firestore()
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
})
