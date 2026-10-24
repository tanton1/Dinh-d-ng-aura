const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createSessionOperationFunctions } = require('./session-operations')

function requestReader(kind) {
  const reads = []
  const request = kind === 'pause'
    ? { studentId: 'student-pause', contractId: 'contract-pause', type: 'off', status: 'pending', startDate: '2026-10-26', endDate: '2026-11-01' }
    : { studentId: 'student-session', contractId: 'contract-session', sessionId: 'session-1', trainerId: 'trainer-1', type: 'cancel', status: 'pending' }
  const source = kind === 'pause' ? 'leaveRequests' : 'sessionRequests'
  const db = {
    collection(name) {
      assert.equal(name, source, 'a dedicated tab must not query the other request collection')
      return { limit(maximum) {
        assert.equal(maximum, 501)
        return { async get() {
          reads.push(name)
          return { size: 1, docs: [{ id: 'request-1', data: () => request }] }
        } }
      } }
    },
    doc(path) { return { path, id: path.split('/').at(-1) } },
    async getAll(...references) {
      reads.push(...references.map(ref => ref.path))
      return references.map(ref => ({ ...ref, exists: true, data: () => ({ name: ref.id, packageName: 'Gói PT', revision: 2 }) }))
    },
  }
  const operations = createSessionOperationFunctions({ db, onCall: handler => handler, authorizeAdmin: async () => ({ uid: 'admin' }) })
  return { reads, list: operations.listPtOperationsRequests }
}

test('OFF reads only leave requests and referenced students/contracts, without session or trainer hydration', async () => {
  const { reads, list } = requestReader('pause')
  const result = await list({ data: { kind: 'pause' } })
  assert.equal(result.kind, 'pause')
  assert.equal(result.records.length, 1)
  assert.deepEqual(reads.sort(), ['leaveRequests', 'students/student-pause', 'contracts/contract-pause'].sort())
})

test('change/cancel reads only session requests and its referenced identities', async () => {
  const { reads, list } = requestReader('session')
  const result = await list({ data: { kind: 'session' } })
  assert.equal(result.records[0].sessionRevision, 2)
  assert.deepEqual(reads.sort(), ['sessionRequests', 'students/student-session', 'contracts/contract-session', 'sessions/session-1', 'trainers/trainer-1'].sort())
})
