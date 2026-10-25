'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Firestore } = require('firebase-admin/firestore')
const { STUDENT360_REFRESH_DOCUMENT, refreshQueueReference } = require('./student-360-refresh-queue')

test('Student 360 queue uses the same valid document path for producer and trigger', () => {
  const db = new Firestore({ projectId: 'demo-aura-queue-path' })
  const ref = refreshQueueReference(db, 'student-1')
  assert.equal(ref.path, STUDENT360_REFRESH_DOCUMENT.replace('{studentId}', 'student-1'))
  assert.equal(ref.parent.parent.id, 'student360ProjectionRefreshQueue')
  for (const value of ['', ' ', 'student/other', undefined]) assert.throws(() => refreshQueueReference(db, value), /INVALID_STUDENT360_QUEUE_SUBJECT/)
})
