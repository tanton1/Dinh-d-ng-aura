import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'
import { applyAcademyAdoption, parseAcademyAdoptionRead, type AcademyAdoptionCandidate } from '../src/features/academy/adoption'
const require = createRequire(import.meta.url)
const { academyAdoptionFixture } = require('../functions/test-support/academy-adoption-fixture')
const clone = (value: any) => JSON.parse(JSON.stringify(value))

async function candidateFixture() {
  const f = await academyAdoptionFixture()
  const { candidateId } = await f.reviewed()
  const raw = await f.adoption.readCandidate(f.request({ adoptionCandidate: { courseId: 'course', candidateId } }))
  const candidate = parseAcademyAdoptionRead(raw, 'course', 3) as AcademyAdoptionCandidate
  return { ...f, candidate, raw }
}

test('candidate parsing binds course, chapter, immutable ID and private assessment before display', async () => {
  const f = await candidateFixture()
  assert.equal(f.candidate.artifact.checkpointQuestions.length, 8)
  assert.deepEqual(parseAcademyAdoptionRead({ candidateId: null, courseRevision: 3 }, 'course', 3), { candidateId: null, courseRevision: 3 })
  for (const mutate of [
    (value: any) => { value.artifact.courseId = 'other' },
    (value: any) => { value.artifact.chapter = 4 },
    (value: any) => { value.artifact.module.id = 'other' },
    (value: any) => { value.artifact.source.unit.chapter = 4 },
    (value: any) => { value.candidateId = 'not-a-digest' },
    (value: any) => { value.artifact.quizKeys['chapter-03-checkpoint'].answers = {} },
    (value: any) => { value.review.checks.safety = false },
    (value: any) => { value.courseRevision = -1 },
  ]) {
    const changed = clone(f.raw); mutate(changed)
    assert.throws(() => parseAcademyAdoptionRead(changed, 'course', 3))
  }
  assert.throws(() => parseAcademyAdoptionRead(f.raw, 'course', 3, 'a'.repeat(64)))
})

test('fresh adoption merges only its chapter and private answers; an exact editor round-trip remains publication-review valid', async () => {
  const f = await candidateFixture(), editor = await f.readEditor(3), before = clone(editor)
  const result = await f.adopt(f.candidate.candidateId)
  const next = applyAcademyAdoption(editor, f.candidate, result)
  assert.deepEqual(clone(editor), before)
  assert.equal(next.publicationStatus, 'draft')
  assert.equal(next.revision, 4)
  assert.equal(next.publishedRevision, 3)
  assert.deepEqual(next.modules[1], editor.modules[1])
  assert.deepEqual(next.quizAnswerKeys?.['chapter-04-checkpoint'], editor.quizAnswerKeys['chapter-04-checkpoint'])
  const source = readFileSync(new URL('../src/pages/admin/CourseEditorPage.tsx', import.meta.url), 'utf8')
  const helpers = source.slice(source.indexOf('function ensureLessonMeta('), source.indexOf('const publicationLabels ='))
  const throwLegacy = () => { throw new Error('Reviewed chapters must not use legacy enrichment') }
  const context: any = { structuredClone, crypto, getAcademyLessonContent: throwLegacy, getAcademyCoachNote: throwLegacy,
    hasAcademyLessonContent: throwLegacy, toAcademyLessonMemory: throwLegacy }
  runInNewContext(transformSync(helpers, { loader: 'ts', target: 'node22' }).code, context)
  const protectedEditor = context.createEditorDraft({ ...next, modules: [next.modules[0]] })
  next.modules[0] = protectedEditor.modules[0]
  next.publicationStatus = 'review'
  await f.handlers.save(f.request({ course: next, expectedRevision: 4 }))
  assert.equal(f.root().status, 'review')
  assert.equal(f.chapterCount(), 3, 'unchanged reviewed bytes do not produce another chapter version')
})

test('a replay, different revision, course or candidate cannot overwrite a clean local editor by optimistic merge', async () => {
  const f = await candidateFixture(), editor = await f.readEditor(3)
  const result = await f.adopt(f.candidate.candidateId)
  for (const patch of [{ alreadyAdopted: true }, { revision: 5 }, { courseId: 'other' }, { candidateId: 'b'.repeat(64) }, { status: 'published' }]) {
    assert.throws(() => applyAcademyAdoption(editor, f.candidate, { ...result, ...patch }))
  }
  assert.throws(() => applyAcademyAdoption({ ...editor, revision: 2 }, f.candidate, result))
  assert.equal(applyAcademyAdoption(editor, f.candidate, { ...result, publishedRevision: null }).publishedRevision, null)
})

const serviceSource = readFileSync(new URL('../src/services/academyAdoptionService.ts', import.meta.url), 'utf8')
const compiled = transformSync(serviceSource, { loader: 'ts', format: 'cjs', target: 'node22' }).code
function serviceFixture() {
  const calls: any[] = [], auth = { currentUser: { uid: 'staff' } as { uid: string } | null }
  let reply = async (): Promise<any> => ({ data: {} })
  const module = { exports: {} as any }
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (name === 'firebase/functions') return { httpsCallable: (_client: any, callable: string) => async (input: any) => { calls.push({ callable, input }); return reply() } }
    if (name.endsWith('/firebase')) return { firebaseAuth: auth }
    if (name.endsWith('/firebaseFunctions')) return { firebaseFunctions: {} }
    if (name.endsWith('/academyReadService')) return { callAcademyReadFunction: async (_name: string, input: any) => { calls.push({ input }); return (await reply()).data } }
    if (name.endsWith('/adoption')) return { parseAcademyAdoptionRead }
    throw new Error(`Unexpected import ${name}`)
  } })
  return { api: module.exports, calls, auth, respond: (next: typeof reply) => { reply = next } }
}

test('actual mutation service sends the initiating UID, uses one existing endpoint and never retries an uncertain failure', async () => {
  const f = serviceFixture()
  f.respond(async () => { throw new Error('network result unknown') })
  await assert.rejects(f.api.prepareAcademyAdoption('course', 3, 4), /network result unknown/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].callable, 'saveCourseDraftAtomic')
  assert.equal(f.calls[0].input.academyAdoption.expectedActorId, 'staff')
  f.auth.currentUser = null
  await assert.rejects(f.api.prepareAcademyAdoption('course', 3, 4), /đăng nhập/)
  assert.equal(f.calls.length, 1)
})

test('actual mutation service ignores a result after a new auth session, even with the same UID', async () => {
  const f = serviceFixture()
  f.respond(async () => {
    f.auth.currentUser = { uid: 'staff' }
    return { data: { courseId: 'course', chapter: 3, candidateId: 'a'.repeat(64), preparedAtRevision: 4 } }
  })
  await assert.rejects(f.api.prepareAcademyAdoption('course', 3, 4), /Phiên đăng nhập đã đổi/)
  assert.equal(f.calls.length, 1)
})
