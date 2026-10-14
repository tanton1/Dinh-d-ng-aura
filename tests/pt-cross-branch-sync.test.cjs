'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildAudit } = require('../scripts/firebase-pt-schedule-week-audit.cjs')
const { prepareWrites } = require('../scripts/firebase-pt-cross-branch-sync.cjs')
const { TARGET } = require('../scripts/firebase-pt-schedule-audit.cjs')
function fixture() {
  const week = '2026-10-12'
  const doc = (collection, id, data) => ({ id, name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collection}/${id}`, data, updateTime: '2026-10-14T00:00:00Z' })
  return { week, branches: [doc('branches', 'home', {}), doc('branches', 'site', {})],
    students: [doc('students', 'learner', { branchId: 'home' })], trainers: [doc('trainers', 'pt', { branchId: 'site' })],
    contracts: [doc('contracts', 'contract', { studentId: 'learner', branchId: 'home', startDate: week, endDate: '2026-11-12', status: 'active' })],
    sessions: [doc('sessions', 'legacy', { studentId: 'learner', trainerId: 'pt', contractId: 'contract', date: week, hour: 6, branchId: 'all', status: 'scheduled', billingStatus: 'pending', revision: 3 })],
    schedules: [doc('schedules', `schedule_${week}`, { schedule: { 'T2-6': [{ studentId: 'learner', trainerId: 'pt', branchId: 'all' }] } })], drafts: [] }
}
test('sync uses an existing session identity independent of legacy branch metadata and only patches metadata', () => {
  const state = fixture(), before = structuredClone(state)
  const audit = buildAudit(state), prepared = prepareWrites(state, audit)
  assert.equal(audit.publicPlan.missingCrossBranch, 0)
  assert.equal(audit.publicPlan.repairSessions, 1)
  assert.equal(prepared.writes.length, 3)
  const sessionWrite = prepared.writes.find((w) => w.update.name.endsWith('/sessions/legacy'))
  assert.deepEqual(sessionWrite.currentDocument, { updateTime: state.sessions[0].updateTime })
  assert.equal(sessionWrite.update.fields.branchId.stringValue, 'site')
  assert.equal(sessionWrite.update.fields.revision.integerValue, '4')
  assert.equal(sessionWrite.update.fields.contractId, undefined)
  assert.equal(sessionWrite.update.fields.status, undefined)
  assert.equal(sessionWrite.update.fields.billingStatus, undefined)
  assert.deepEqual(state, before)
  for (const change of prepared.changes) Object.assign([...state.sessions, ...state.schedules].find((d) => d.name === change.doc.name).data, change.patch)
  assert.equal(buildAudit(state).repairs.length, 0)
})
test('missing, conflicting, cancelled or invalid-contract sessions are never fabricated or overwritten', () => {
  for (const scenario of ['missing', 'duplicate', 'trainer', 'cancelled', 'expired']) {
    const state = fixture()
    if (scenario === 'missing') state.sessions = []
    if (scenario === 'duplicate') state.sessions.push({ ...state.sessions[0], id: 'duplicate' })
    if (scenario === 'trainer') state.sessions[0].data.trainerId = 'other'
    if (scenario === 'cancelled') state.sessions[0].data.status = 'canceled_by_student'
    if (scenario === 'expired') state.contracts[0].data.endDate = '2026-10-11'
    const audit = buildAudit(state)
    assert.equal(audit.repairs.length, 0, scenario)
    assert.equal(prepareWrites(state, audit).writes.length, 0, scenario)
  }
})
