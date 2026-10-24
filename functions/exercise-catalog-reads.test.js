'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { FieldPath } = require('firebase-admin/firestore')
const { createExerciseCatalogFunctions } = require('./exercise-catalog')

const compareId = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const idFor = index => `exercise-${String(index).padStart(4, '0')}`

function exercise(index, overrides = {}) {
  return {
    status: 'published', revision: 7, nameVi: `Bài ${String(9999 - index).padStart(4, '0')}`, nameEn: `Exercise ${index}`,
    aliasesVi: ['Bài tập chân'], bodyParts: ['legs'], targetMuscles: ['glutes'], secondaryMuscles: ['core'],
    equipment: ['dumbbell'], environment: ['gym'], difficulty: 'beginner', goals: ['strength'],
    instructionsVi: ['Bước một', 'Bước hai'], cuesVi: ['Giữ thăng bằng'], commonMistakesVi: ['Không khóa gối'], breathingVi: 'Thở đều',
    defaultPrescription: { sets: 4, reps: '8–10', restSeconds: 75, rpe: 8 },
    media: {
      images: Array.from({ length: 16 }, (_, imageIndex) => ({
        id: `image-${imageIndex}`, url: `https://example.com/${index}/${imageIndex}.webp`,
        role: imageIndex ? 'detail' : 'start', order: imageIndex, alt: `Góc ${imageIndex}`,
      })),
      videos: [{ id: 'video-1', provider: 'aura', url: `https://example.com/${index}.mp4`, format: 'mp4' }],
    },
    source: { provider: 'aura', sourceExerciseId: `source-${index}`, sourceVersion: 'v7', license: 'Aura-owned' },
    ...overrides,
  }
}

function catalog(count, transform = (_index, value) => value) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [idFor(index), transform(index, exercise(index))]))
}

function fixture({ records = catalog(100), role = 'student', assignment = null } = {}) {
  const reads = { queries: [], documents: [] }
  const auth = { uid: 'actor', token: assignment ? { accessRole: assignment.accessRole, authzVersion: assignment.authzVersion } : { role } }
  const profile = { role }
  const doc = (path, value) => ({ id: path.split('/').at(-1), exists: value !== undefined, data: () => value })
  const query = (state = {}) => ({
    orderBy(field, direction) {
      assert.deepEqual(field, FieldPath.documentId())
      assert.equal(direction, 'asc')
      return query({ ...state, ordered: true })
    },
    limit(limit) {
      assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 80)
      return query({ ...state, limit })
    },
    startAfter(cursor) {
      assert.equal(state.ordered, true)
      assert.equal(typeof cursor, 'string')
      return query({ ...state, cursor })
    },
    async get() {
      assert.equal(state.ordered, true)
      assert.ok(state.limit > 0, 'unbounded catalog queries are forbidden')
      const ids = Object.keys(records).sort(compareId).filter(id => !state.cursor || compareId(id, state.cursor) > 0).slice(0, state.limit)
      const read = { limit: state.limit, cursor: state.cursor || '', ids, inspected: [] }
      reads.queries.push(read)
      const docs = ids.map(id => ({ id, data: () => { read.inspected.push(id); return records[id] } }))
      return { size: docs.length, docs }
    },
  })
  // No writes, transactions, external fetches or provider credentials exist in
  // this fixture: the real handler must remain a local, read-only catalog path.
  const db = {
    doc(path) { return { get: async () => {
      reads.documents.push(path)
      if (path === 'users/actor') return doc(path, profile)
      if (path === 'roleAssignments/actor') return doc(path, assignment || undefined)
      assert.ok(path.startsWith('exercises/'))
      return doc(path, records[path.slice('exercises/'.length)])
    } } },
    collection(name) { assert.equal(name, 'exercises'); return query() },
  }
  const functions = createExerciseCatalogFunctions({ db, onCall: (options, handler) => handler || options })
  return {
    records, reads, profile,
    run: (data = {}, requestAuth = auth) => functions.listExerciseCatalog({ auth: requestAuth, data }),
    detail: exerciseId => functions.getExerciseCatalogItem({ auth, data: { exerciseId } }),
  }
}

async function allPages(f, data, expectedIds) {
  let cursor = data.cursor || ''
  const seen = []
  const pages = []
  for (let index = 0; index < 100; index += 1) {
    const beforeQueries = f.reads.queries.length
    const result = await f.run({ ...data, cursor })
    const queries = f.reads.queries.slice(beforeQueries)
    const inspected = queries.flatMap(read => read.inspected)
    const budget = Math.max(result.pageSize, Math.min(240, Math.round(Number(data.scanLimit) || result.pageSize * 4)))
    assert.equal(result.scanned, inspected.length)
    assert.ok(result.scanned <= budget)
    assert.ok(queries.reduce((sum, read) => sum + read.ids.length, 0) <= budget, 'even fetched lookahead must fit scan budget')
    assert.ok(result.items.length <= result.pageSize)
    assert.equal(result.total, null)
    assert.equal(result.schemaVersion, 2)
    assert.deepEqual(result.items.map(item => item.nameVi), [...result.items.map(item => item.nameVi)].sort((a, b) => a.localeCompare(b, 'vi')))
    seen.push(...result.items.map(item => item.id))
    pages.push(result)
    if (!result.hasMore) {
      assert.equal(result.nextCursor, null)
      assert.deepEqual(seen.sort(compareId), expectedIds, 'hasMore=false cannot hide any matching item')
      assert.equal(new Set(seen).size, seen.length, 'cursor must not duplicate returned rows')
      return pages
    }
    assert.equal(result.nextCursor, inspected.at(-1), 'cursor is the last inspected document, never an unread lookahead')
    assert.ok(compareId(result.nextCursor, cursor) > 0, 'even an empty sparse page must advance')
    cursor = result.nextCursor
  }
  assert.fail('pagination did not terminate')
}

test('default dense browse reads 37 not 72, leaves lookahead uninspected and returns full coaching/media data', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.pageSize, 36)
  assert.equal(result.scanned, 36)
  assert.equal(result.items.length, 36)
  assert.equal(result.hasMore, true)
  assert.equal(result.nextCursor, idFor(35))
  assert.equal(f.reads.queries.length, 1)
  assert.equal(f.reads.queries[0].limit, 37)
  assert.equal(f.reads.queries[0].ids.length, 37)
  assert.equal(f.reads.queries[0].inspected.length, 36)
  assert.equal(f.reads.queries[0].inspected.includes(idFor(36)), false)
  const item = result.items.find(value => value.id === idFor(0))
  assert.deepEqual(item, (await f.detail(idFor(0))).item)
  assert.equal(item.media.images.length, 16)
  assert.deepEqual(item.instructionsVi, ['Bước một', 'Bước hai'])
  assert.deepEqual(item.defaultPrescription, { sets: 4, reps: '8–10', restSeconds: 75, rpe: 8 })
  const next = await f.run({ cursor: result.nextCursor })
  assert.ok(next.items.some(value => value.id === idFor(36)), 'the uninspected lookahead must appear on the next page')
})

test('all dense pages are complete and duplicate-free at page sizes 12, 36 and 60 with one-doc maximum overfetch', async () => {
  for (const pageSize of [12, 36, 60]) {
    const f = fixture({ records: catalog(95) })
    const pages = await allPages(f, { pageSize }, Object.keys(f.records).sort(compareId))
    const returnedReads = f.reads.queries.reduce((sum, read) => sum + read.ids.length, 0)
    assert.equal(returnedReads, 95 + pages.length - 1)
    assert.ok(f.reads.queries.every(read => read.limit <= pageSize + 1))
    if (pageSize === 36) assert.equal(returnedReads, 97, 'previous batches reread an unused tail: 72 + 59 + 23 = 154 docs')
  }
})

test('exact collection and scan-limit boundaries never falsely terminate before matching items', async () => {
  for (const count of [0, 1, 35, 36, 37, 72, 73, 108]) {
    for (const scanLimit of [undefined, 36, 37, 240]) {
      const f = fixture({ records: catalog(count) })
      await allPages(f, { pageSize: 36, scanLimit }, Object.keys(f.records).sort(compareId))
      if (count === 36 && scanLimit === undefined) assert.equal(f.reads.queries.length, 1)
    }
  }
})

test('staff includeReview default/all browse uses compact batches but never returns archived records', async () => {
  for (const status of [undefined, 'all', 'unknown']) {
    const records = catalog(100, (index, value) => ({ ...value, status: ['published', 'draft', 'review'][index % 3] }))
    records[idFor(99)].status = 'archived'
    const f = fixture({ records, role: 'trainer' })
    await allPages(f, { includeReview: true, status }, Object.keys(records).filter(id => records[id].status !== 'archived').sort(compareId))
    assert.equal(f.reads.queries[0].limit, 37)
  }
})

test('learner cannot reveal drafts, review items, archived records or private working-draft fields', async () => {
  const records = catalog(160, (index, value) => ({
    ...value, status: ['published', 'draft', 'review', 'archived'][index % 4],
    workingDraft: { nameVi: 'PRIVATE_DRAFT_TITLE', instructionsVi: ['PRIVATE_DRAFT_INSTRUCTIONS'] },
    workingDraftRevision: 8, workingDraftStatus: 'review',
  }))
  const f = fixture({ records })
  const pages = await allPages(f, { includeReview: true, status: 'draft' }, Object.keys(records).filter(id => records[id].status === 'published').sort(compareId))
  assert.ok(pages.flatMap(page => page.items).every(item => item.status === 'published'))
  assert.doesNotMatch(JSON.stringify(pages), /PRIVATE_DRAFT_/)
  assert.equal(f.reads.queries[0].limit, 37)
  assert.equal(f.reads.queries[1].limit, 72, 'low implicit visibility yield switches back to the existing batch size')
})

test('all explicit filters keep large sparse-search batches and preserve filter results across every cursor', async () => {
  const records = catalog(420, (index, value) => ({
    ...value, nameVi: index % 17 === 0 ? `Tìm tôi ${index}` : value.nameVi,
    bodyParts: [index % 13 === 0 ? 'back' : 'legs'], equipment: [index % 19 === 0 ? 'barbell' : 'dumbbell'],
    difficulty: index % 11 === 0 ? 'advanced' : 'beginner', environment: [index % 23 === 0 ? 'home' : 'gym'],
    status: index % 5 === 0 ? 'review' : 'published', popularForWomen: index % 7 === 0,
    ...(index % 3 === 0 ? { workingDraft: { nameVi: 'PRIVATE' } } : {}),
  }))
  const cases = [
    [{ query: ' TÌM TÔI ' }, row => row.nameVi.startsWith('Tìm tôi')],
    [{ bodyPart: 'BACK' }, row => row.bodyParts.includes('back')],
    [{ equipment: 'BARBELL' }, row => row.equipment.includes('barbell')],
    [{ difficulty: 'advanced' }, row => row.difficulty === 'advanced'],
    [{ environment: 'home' }, row => row.environment.includes('home')],
    [{ status: 'review' }, row => row.status === 'review'],
    [{ status: 'published' }, row => row.status === 'published'],
    [{ status: 'draft' }, row => row.status === 'draft'],
    [{ status: 'popular' }, row => row.popularForWomen],
    [{ status: 'working' }, row => Boolean(row.workingDraft)],
    [{ query: 'no-such-exercise', equipment: 'barbell' }, () => false],
  ]
  for (const [filter, predicate] of cases) {
    const f = fixture({ records, role: 'trainer' })
    await allPages(f, { ...filter, includeReview: true, scanLimit: 144 }, Object.keys(records).filter(id => predicate(records[id])).sort(compareId))
    assert.equal(f.reads.queries[0].limit, 72, JSON.stringify(filter))
    assert.ok(f.reads.queries.every(read => read.limit === 72), 'sparse explicit searches retain two 72-doc batches per scan window')
  }
})

test('near-full dense prefix followed by hidden records switches after one small failed batch, not dozens', async () => {
  const records = catalog(250, (index, value) => ({ ...value, status: index < 35 || index === 220 ? 'published' : 'archived' }))
  const f = fixture({ records })
  const result = await f.run()
  assert.equal(result.items.length, 35)
  assert.equal(result.scanned, 144)
  assert.equal(result.hasMore, true)
  assert.equal(result.nextCursor, idFor(143))
  assert.deepEqual(f.reads.queries.map(read => read.limit), [37, 2, 72, 33])
  assert.equal(f.reads.queries.length, 4)
  const remainder = await allPages(f, { cursor: result.nextCursor }, [idFor(220)])
  assert.equal(remainder.flatMap(page => page.items).length, 1)
})

test('all-hidden broad browse stays bounded and still advances over empty visible pages', async () => {
  const f = fixture({ records: catalog(610, (index, value) => ({ ...value, status: index % 2 ? 'archived' : 'draft' })) })
  await allPages(f, {}, [])
  assert.ok(f.reads.queries.every(read => read.limit >= 35), 'low-yield browse must not keep querying tiny remaining-slot batches')
  assert.ok(f.reads.queries.length <= Math.ceil(610 / 144) * 3)
})

test('unauthenticated, disabled, stale-assignment callers and invalid cursors read no catalog data', async () => {
  const unauthenticated = fixture()
  await assert.rejects(unauthenticated.run({}, null), { code: 'unauthenticated' })
  assert.deepEqual(unauthenticated.reads.documents, [])
  const disabled = fixture()
  disabled.profile.disabled = true
  await assert.rejects(disabled.run(), { code: 'permission-denied' })
  const stale = fixture({ assignment: { status: 'active', accessRole: 'staff', authzVersion: 2 } })
  await assert.rejects(stale.run({}, { uid: 'actor', token: { accessRole: 'staff', authzVersion: 1 } }), { code: 'permission-denied' })
  const invalid = fixture()
  await assert.rejects(invalid.run({ cursor: '../private' }), { code: 'invalid-argument' })
  for (const f of [unauthenticated, disabled, stale, invalid]) assert.deepEqual(f.reads.queries, [])
})

test('pagination reads current published content after edits without caching full catalog or financial data', async () => {
  const f = fixture({ records: catalog(20) })
  const before = await f.run()
  f.records[idFor(0)].nameVi = 'Đã cập nhật'
  f.records[idFor(1)].status = 'draft'
  const after = await f.run()
  assert.equal(before.items.length, 20)
  assert.equal(after.items.length, 19)
  assert.equal(after.items.find(item => item.id === idFor(0)).nameVi, 'Đã cập nhật')
  assert.equal(after.items.some(item => item.id === idFor(1)), false)
})
