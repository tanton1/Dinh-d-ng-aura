import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  acknowledgeAcademyWorkbook, academyWorkbookSignature, AcademyWorkbookConflictError,
  AcademyWorkbookSizeError, prepareAcademyWorkbookDraft, reconcileAcademyWorkbook,
  serializeAcademyWorkbookForCloud,
} from '../src/features/academy/workbookPersistence'
import type { AcademyWorkbookState } from '../src/services/academyLearningService'

const empty = (): AcademyWorkbookState => ({
  schemaVersion: 2, definitionVersion: 1, cloudRevision: 0, sharedWithCoach: false,
  answers: {}, challengeDone: {}, microCheckAnswers: {}, confidenceBefore: null, confidenceAfter: null,
  rubric: { data: 0, mechanism: 0, feasibility: 0, safety: 0 }, decision: null,
  reviewAt: '', safetyAcknowledged: false, updatedAt: 0,
})
const draft = (answer = 'Bản một') => prepareAcademyWorkbookDraft({ ...empty(), answers: { context: answer } }, 100, 'edit-1')

test('every input creates a durable pending marker even within the same millisecond', () => {
  const first = draft()
  const second = prepareAcademyWorkbookDraft(first, 100, 'edit-2')
  assert.equal(first.pendingSync, true)
  assert.equal(second.updatedAt, 101)
  assert.notEqual(first.localEditId, second.localEditId)
})

test('an old ACK rebases the newer device draft without overwriting its answers or timestamp', () => {
  const sent = draft()
  const newer = prepareAcademyWorkbookDraft({ ...sent, answers: { context: 'Gõ thêm khi đang lưu' } }, 200, 'edit-2')
  const result = acknowledgeAcademyWorkbook(newer, sent, { ...sent, cloudRevision: 1, pendingSync: false })
  assert.equal(result.answers.context, 'Gõ thêm khi đang lưu')
  assert.equal(result.cloudRevision, 1)
  assert.equal(result.updatedAt, 200)
  assert.equal(result.pendingSync, true)
  assert.equal(result.localEditId, 'edit-2')
})

test('an ACK for exactly the current content clears pending, not the evidence fields', () => {
  const sent = { ...draft(), safetyAcknowledged: true, sharedWithCoach: true }
  const result = acknowledgeAcademyWorkbook(sent, sent, { ...sent, cloudRevision: 1 })
  assert.equal(result.pendingSync, false)
  assert.equal(result.safetyAcknowledged, true)
  assert.equal(result.sharedWithCoach, true)
})

test('out-of-order ACKs cannot decrease the device base revision', () => {
  const current = { ...draft('Mới nhất'), cloudRevision: 5 }
  assert.equal(acknowledgeAcademyWorkbook(current, draft(), { ...draft(), cloudRevision: 1 }), current)
})

test('reopening before the debounce retains and resumes the unsynchronized draft', () => {
  const local = JSON.parse(JSON.stringify(draft()))
  assert.deepEqual(reconcileAcademyWorkbook(local, empty()), local)
})

test('pending marker wins over device clock skew, but a different revision requires a conflict choice', () => {
  const local = draft()
  const remote = { ...empty(), updatedAt: 50_000 }
  assert.equal(reconcileAcademyWorkbook(local, remote).answers.context, 'Bản một')
  assert.throws(() => reconcileAcademyWorkbook(local, { ...remote, cloudRevision: 1 }), AcademyWorkbookConflictError)
})

test('same remote content recovers a lost ACK without another write', () => {
  const local = draft()
  const result = reconcileAcademyWorkbook(local, { ...local, cloudRevision: 1, pendingSync: false })
  assert.equal(result.cloudRevision, 1)
  assert.equal(result.pendingSync, false)
})

test('legacy newer local drafts remain pending; clean drafts accept cloud edits', () => {
  const local = { ...empty(), answers: { context: 'Bản thiết bị cũ' }, updatedAt: 300 }
  assert.equal(reconcileAcademyWorkbook(local, empty()).pendingSync, true)
  const clean = { ...local, pendingSync: false }
  assert.deepEqual(reconcileAcademyWorkbook(clean, { ...empty(), cloudRevision: 1 }).answers, {})
})

test('content signature ignores sync metadata and key ordering but includes sharing and safety', () => {
  const first = { ...draft(), answers: { a: '1', b: '2' } }
  const second = { ...first, cloudRevision: 8, updatedAt: 999, pendingSync: false, localEditId: 'other', answers: { b: '2', a: '1' } }
  assert.equal(academyWorkbookSignature(first), academyWorkbookSignature(second))
  assert.notEqual(academyWorkbookSignature(first), academyWorkbookSignature({ ...first, sharedWithCoach: true }))
})

test('cloud serialization excludes device metadata and rejects oversized UTF-8 without truncation', () => {
  const body = serializeAcademyWorkbookForCloud(draft())
  assert.equal(JSON.parse(body).answers.context, 'Bản một')
  assert.equal(JSON.parse(body).pendingSync, undefined)
  assert.equal(JSON.parse(body).localEditId, undefined)
  assert.throws(() => serializeAcademyWorkbookForCloud({ ...draft(), answers: { context: 'ộ'.repeat(7000) } }), AcademyWorkbookSizeError)
})

test('both studios share synchronous on-input persistence and stop retries on sync errors', () => {
  const hook = readFileSync(new URL('../src/features/academy/useAcademyWorkbook.ts', import.meta.url), 'utf8')
  const service = readFileSync(new URL('../src/services/academyLearningService.ts', import.meta.url), 'utf8')
  for (const file of ['AcademyChapterLearningStudio', 'AcademyPortfolioStudio']) {
    const source = readFileSync(new URL(`../src/components/academy/${file}.tsx`, import.meta.url), 'utf8')
    assert.match(source, /useAcademyWorkbook\(/)
    assert.doesNotMatch(source, /setWorkbook\(update\)|setPortfolio\(update\)/)
  }
  assert.match(hook, /persistAcademyWorkbookDraft[\s\S]*replace\(result.state\)/)
  assert.match(hook, /saving \|\| issue\) return/)
  assert.match(service, /acknowledgeAcademyWorkbook\(current, state, synchronized\)/)
  assert.doesNotMatch(service, /JSON.stringify\(synchronized\).slice/)
})
