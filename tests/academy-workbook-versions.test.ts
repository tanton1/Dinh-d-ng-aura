import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { randomUUID } from 'node:crypto'
import { transformSync } from 'esbuild'
import * as persistence from '../src/features/academy/workbookPersistence'

// Execute the actual production service functions with an atomic SDK fake.
// Real Security Rules and batch behavior are covered by the emulator suite.
const source = readFileSync(new URL('../src/services/academyLearningService.ts', import.meta.url), 'utf8')
const sections = [
  source.slice(source.indexOf('function academyWorkbookStorageKey('), source.indexOf('export async function loadAcademyNoteFromCloud(')),
  source.slice(source.indexOf('export function emptyAcademyWorkbookState('), source.indexOf('const reviewClient =')),
  source.slice(source.indexOf('export function persistAcademyWorkbookDraft('), source.indexOf('export function loadAcademyRecallAnswers(')),
].join('\n').replace(/^export /gm, '')
const compiled = transformSync(sections, { loader: 'ts', target: 'node22' }).code
const key = 'aura:academy:workbook:v1:student:course:core'
const cloudKey = 'users/student/academyWorkbooks/course__core'
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

function fixture() {
  const device = new Map<string, string>()
  const store = new Map<string, any>()
  const auth = { currentUser: { uid: 'student' } }
  const writes: string[][] = []
  let failCommit = false, failBackup = false, reads = 0
  const ref = (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) })
  const snapshot = (path: string) => ({ exists: () => store.has(path), data: () => plain(store.get(path)) })
  const context: any = { ...persistence, Date, TextEncoder, crypto: { randomUUID }, firebaseAuth: auth, firestoreDb: {},
    localStorage: { getItem: (name: string) => device.get(name) ?? null, setItem: (name: string, value: string) => {
      if (failBackup && name.includes(':archive:')) throw new Error('Quota exceeded')
      device.set(name, value)
    } }, doc: ref, serverTimestamp: () => 12345,
    getDoc: async (reference: any) => { reads++; return snapshot(reference.path) },
    runTransaction: async (_db: unknown, callback: any) => {
      const plan: Array<{ reference: any; data: any }> = []
      const result = await callback({
        get: async (reference: any) => { assert.equal(plan.length, 0, 'read before write'); reads++; return snapshot(reference.path) },
        set: (reference: any, data: any) => { plan.push({ reference, data: plain(data) }) },
      })
      if (failCommit) throw new Error('Commit denied')
      for (const { reference } of plan) {
        if (reference.path.includes('/academyWorkbookArchives/') && store.has(reference.path)) throw new Error('Archive cannot be overwritten')
      }
      for (const { reference, data } of plan) store.set(reference.path, data)
      writes.push(plan.map(({ reference }) => reference.path))
      return result
    },
  }
  runInNewContext(compiled, context)
  const old = { ...plain(context.emptyAcademyWorkbookState()), cloudRevision: 4, updatedAt: 100, sharedWithCoach: true,
    answers: { context: 'Bản cũ cần giữ nguyên' }, rubric: { data: 2, mechanism: 2, feasibility: 2, safety: 2 }, safetyAcknowledged: true }
  const document = { courseId: 'course', lessonId: 'core', revision: 4, sharedWithCoach: true, body: JSON.stringify(old), createdAt: 12, updatedAt: 100 }
  store.set(cloudKey, plain(document)); device.set(key, JSON.stringify(old))
  return { service: context, device, store, old, document, writes, auth,
    failCommit: (value = true) => { failCommit = value }, failBackup: () => { failBackup = true }, reads: () => reads }
}

test('explicit definition change preserves the old device draft, clears evidence and retains the concurrency base', () => {
  const f = fixture()
  const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2)
  assert.equal(next.definitionVersion, 2); assert.equal(next.cloudRevision, 4)
  assert.deepEqual(plain(next.answers), {}); assert.equal(next.safetyAcknowledged, false)
  assert.equal(next.sharedWithCoach, false); assert.equal(next.pendingSync, true)
  assert.deepEqual(JSON.parse(f.device.get(`${key}:archive:course__core__r4`)!), f.old)
  assert.equal(f.reads(), 0); assert.equal(f.writes.length, 0)
  assert.throws(() => f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', next, 2))
})

test('saving identical workbook content acknowledges the device draft with one read and no cloud writes', async () => {
  const f = fixture()
  const draft = f.service.persistAcademyWorkbookDraft('student', 'course', 'core', {
    ...f.old, answers: { ...f.old.answers }, rubric: { safety: 2, feasibility: 2, mechanism: 2, data: 2 },
  }).state
  assert.equal(draft.pendingSync, true)
  const saved = await f.service.saveAcademyWorkbook('student', 'course', 'core', draft)
  assert.equal(f.reads(), 1)
  assert.equal(f.writes.flat().length, 0)
  assert.deepEqual(f.store.get(cloudKey), f.document)
  assert.equal(saved.cloudRevision, 4)
  assert.equal(saved.pendingSync, false)
  assert.equal(saved.updatedAt, 100)
  assert.equal(saved.localEditId, draft.localEditId)
  assert.equal(JSON.parse(f.device.get(key)!).pendingSync, false)
})

test('identical content never bypasses a newer remote revision or malformed cloud body', async () => {
  for (const failure of ['revision', 'body']) {
    const f = fixture()
    if (failure === 'revision') f.store.get(cloudKey).revision = 5
    else f.store.get(cloudKey).body = '{'
    const before = plain(f.store.get(cloudKey))
    await assert.rejects(f.service.saveAcademyWorkbook('student', 'course', 'core', f.old),
      failure === 'revision' ? persistence.AcademyWorkbookConflictError : /không đọc được/)
    assert.equal(f.writes.flat().length, 0)
    assert.deepEqual(f.store.get(cloudKey), before)
  }
})

test('an unchanged legacy workbook still establishes its first cloud revision', async () => {
  for (const existingRevision of [undefined, 0]) {
    const f = fixture()
    const legacy = { ...f.old, cloudRevision: 0 }
    const document = { ...f.document, body: JSON.stringify(legacy), revision: existingRevision }
    f.store.set(cloudKey, plain(document))
    f.device.set(key, JSON.stringify(legacy))
    const saved = await f.service.saveAcademyWorkbook('student', 'course', 'core', legacy)
    assert.equal(saved.cloudRevision, 1)
    assert.deepEqual(f.writes.flat(), [cloudKey])
    assert.equal(f.store.get(cloudKey).revision, 1)
    assert.equal(JSON.parse(f.device.get(key)!).cloudRevision, 1)
  }
})

test('sharing, safety, answers and envelope repairs still write an authoritative new workbook revision', async () => {
  for (const change of ['sharing', 'safety', 'answers', 'envelope']) {
    const f = fixture()
    const next = { ...f.old }
    if (change === 'sharing') next.sharedWithCoach = false
    else if (change === 'safety') next.safetyAcknowledged = false
    else if (change === 'answers') next.answers = { context: 'Nội dung đã thay đổi' }
    else f.store.get(cloudKey).sharedWithCoach = false
    const saved = await f.service.saveAcademyWorkbook('student', 'course', 'core', next)
    assert.equal(saved.cloudRevision, 5)
    assert.deepEqual(f.writes.flat(), [cloudKey])
    assert.equal(f.store.get(cloudKey).sharedWithCoach, next.sharedWithCoach)
    assert.equal(JSON.parse(f.store.get(cloudKey).body).safetyAcknowledged, next.safetyAcknowledged)
  }
})

test('failed device backup leaves the original draft unchanged and never starts a new definition', () => {
  const f = fixture(); f.failBackup()
  assert.throws(() => f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2), /bản nháp cũ/)
  assert.deepEqual(JSON.parse(f.device.get(key)!), f.old)
  assert.equal(f.writes.length, 0)
})

test('cloud replacement archives the real old snapshot atomically; later same-version edits add no archives', async () => {
  const f = fixture()
  const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2)
  const saved = await f.service.saveAcademyWorkbook('student', 'course', 'core', next)
  const archivePath = 'users/student/academyWorkbookArchives/course__core__r4'
  assert.deepEqual(f.store.get(archivePath).source, f.document)
  assert.deepEqual(f.writes[0], [archivePath, cloudKey])
  assert.equal(saved.cloudRevision, 5); assert.equal(saved.definitionVersion, 2)
  assert.equal(saved.previousArchiveId, 'course__core__r4')
  const edited = f.service.persistAcademyWorkbookDraft('student', 'course', 'core', { ...saved, answers: { context: 'Bản mới' } }).state
  await f.service.saveAcademyWorkbook('student', 'course', 'core', edited)
  assert.deepEqual(f.writes[1], [cloudKey])
  assert.deepEqual(f.store.get(archivePath).source, f.document)
})

test('changed prompts with an unchanged numeric version still require a fresh draft and atomic archive', async () => {
  const f = fixture()
  const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 1, 'a'.repeat(64))
  assert.deepEqual(plain(next.answers), {})
  await f.service.saveAcademyWorkbook('student', 'course', 'core', next)
  assert.deepEqual(f.store.get('users/student/academyWorkbookArchives/course__core__r4').source, f.document)
  assert.equal(JSON.parse(f.store.get(cloudKey).body).definitionHash, 'a'.repeat(64))
})

test('failed commit or newer remote revision changes neither the cloud source nor its history', async () => {
  for (const conflict of [false, true]) {
    const f = fixture()
    const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2)
    if (conflict) f.store.get(cloudKey).revision = 5
    else f.failCommit()
    const before = plain(f.store.get(cloudKey))
    await assert.rejects(f.service.saveAcademyWorkbook('student', 'course', 'core', next))
    assert.deepEqual(f.store.get(cloudKey), before)
    assert.equal([...f.store.keys()].some((path) => path.includes('/academyWorkbookArchives/')), false)
    assert.equal(f.writes.length, 0)
  }
})

test('old draft is read only on request, locally when possible, otherwise one scoped cloud document', async () => {
  const f = fixture()
  const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2)
  assert.deepEqual(plain(await f.service.loadAcademyWorkbookArchive('student', 'course', 'core', next.previousArchiveId)), f.old)
  assert.equal(f.reads(), 0)
  await f.service.saveAcademyWorkbook('student', 'course', 'core', next)
  f.device.delete(`${key}:archive:${next.previousArchiveId}`)
  const before = f.reads()
  assert.deepEqual(plain(await f.service.loadAcademyWorkbookArchive('student', 'course', 'core', next.previousArchiveId)), f.old)
  assert.equal(f.reads() - before, 1)
  await assert.rejects(f.service.loadAcademyWorkbookArchive('student', 'other-course', 'core', next.previousArchiveId), /bài học này/)
  f.auth.currentUser.uid = 'other'
  await assert.rejects(f.service.loadAcademyWorkbookArchive('student', 'course', 'core', next.previousArchiveId), /tài khoản/)
})

test('first visit can start at the published definition, but loading an existing draft never retags it', () => {
  const f = fixture()
  assert.equal(f.service.loadAcademyWorkbook('student', 'course', 'core', 2).definitionVersion, 1)
  f.device.delete(key)
  assert.equal(f.service.loadAcademyWorkbook('student', 'course', 'core', 2).definitionVersion, 2)
  assert.equal(f.device.size, 0)
})

test('a cancelled explicit cloud reload cannot overwrite a newer local definition after a scope change', async () => {
  const f = fixture()
  let release = () => {}
  const delayed = new Promise<void>((resolve) => { release = resolve })
  f.service.getDoc = async () => { await delayed; return { exists: () => true, data: () => f.document } }
  let current = true
  const pending = f.service.loadAcademyWorkbookFromCloud('student', 'course', 'core', { preferRemote: true, isCurrent: () => current })
  const next = f.service.beginAcademyWorkbookDefinition('student', 'course', 'core', f.old, 2)
  current = false; release()
  assert.equal((await pending).definitionVersion, 2)
  assert.deepEqual(JSON.parse(f.device.get(key)!), plain(next))
  assert.equal(f.device.has(`${key}:recovery`), false)
})
