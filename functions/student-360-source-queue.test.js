'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Firestore, Timestamp } = require('firebase-admin/firestore')
const { STUDENT360_SOURCE_QUEUE_DOCUMENT, sourceQueueReference, sourceEventKey } = require('./student-360-source-queue')
const { enqueueStudent360ProjectionFromEvent } = require('./student-360')

test('source queue producer and trigger share a valid per-student document path', () => {
  const db = new Firestore({ projectId: 'demo-aura-source-queue' })
  assert.equal(sourceQueueReference(db, 'student').path, STUDENT360_SOURCE_QUEUE_DOCUMENT.replace('{studentId}', 'student'))
  for (const value of ['', ' ', 'student/other', undefined]) assert.throws(() => sourceQueueReference(db, value), /INVALID_STUDENT360_QUEUE_SUBJECT/)
})

test('source delivery keys preserve nanoseconds, deletes and distinct source paths without persisting payloads', () => {
  const event = (path, time, exists = true) => ({ data: {
    before: { exists: true, updateTime: time, ref: { path } },
    after: { exists, updateTime: exists ? time : undefined, ref: { path } },
  } })
  const first = sourceEventKey(event('sessions/one', new Timestamp(1, 2)))
  assert.equal(first, sourceEventKey(event('sessions/one', new Timestamp(1, 2))))
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(first, sourceEventKey(event('sessions/one', new Timestamp(1, 3))))
  assert.notEqual(first, sourceEventKey(event('sessions/two', new Timestamp(1, 2))))
  assert.notEqual(first, sourceEventKey(event('sessions/one', new Timestamp(1, 2), false)))
})

test('queued source wrapper retains no-op metadata filtering before database access', async () => {
  const db = new Proxy({}, { get() { throw new Error('unexpected database access') } })
  const snapshot = value => ({ exists: true, ref: { path: 'students/student', parent: { id: 'students' } }, data: () => value })
  const before = snapshot({ name: 'Member', updatedAt: 1 })
  assert.equal((await enqueueStudent360ProjectionFromEvent({ db, event: { data: { before, after: before } } })).reason, 'source_unchanged')
  assert.equal((await enqueueStudent360ProjectionFromEvent({ db, event: { data: { before, after: snapshot({ name: 'Member', updatedAt: 2 }) } } })).reason, 'source_metadata_only')
})
