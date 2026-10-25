'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { webcrypto } = require('node:crypto')
const ts = require('typescript')
function compile(file, dependencies, globals) {
  const source = ts.transpileModule(readFileSync(join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  runInNewContext(source, { exports, require: name => { if (!(name in dependencies)) throw Error('Unexpected import: ' + name); return dependencies[name] }, ...globals })
  return exports
}
function fixture() {
  const records = new Map(), receipts = new Map(), calls = [], auth = { currentUser: { uid: 'editor' } }
  let providers = 0, loseResponse = false
  const globals = { crypto: webcrypto, TextEncoder, setTimeout, window: { localStorage: {
    getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value),
  } } }
  const invoke = async input => {
    calls.push(JSON.parse(JSON.stringify(input)))
    const key = input.expectedOwnerUid + ':' + input.requestId
    if (input.action === 'request-status') {
      if (!receipts.has(key)) throw Object.assign(Error('Not started'), { code: 'functions/not-found', details: { kind: 'content_ai_not_started', requestId: input.requestId } })
      return { data: receipts.get(key) }
    }
    if (!receipts.has(key)) {
      providers++
      receipts.set(key, { action: input.action, data: { questions: [{ question: 'Original' }] }, receipt: { schemaVersion: 1, requestId: input.requestId, status: 'completed' } })
    }
    if (loseResponse) { loseResponse = false; throw Object.assign(Error('Lost result'), { code: 'functions/unavailable' }) }
    return { data: receipts.get(key) }
  }
  const load = () => compile('services/generativeAiService.ts', {
    'firebase/functions': { httpsCallable: (_functions, name, options) => { assert.equal(name, 'generateAuraContent'); assert.equal(options.timeout, 60000); return invoke } },
    '../lib/firebase': { firebaseAuth: auth }, '../lib/firebaseFunctions': { firebaseFunctions: {} },
    '../utils/singleFlight': compile('utils/singleFlight.ts', {}, globals),
    './contentAiRequest': compile('services/contentAiRequest.ts', {}, globals),
  }, globals)
  return { load, calls, auth, records, providers: () => providers, loseResponse: () => { loseResponse = true } }
}

test('the actual service coalesces clicks, recovers across module reloads and isolates owners', async () => {
  const f = fixture(), service = f.load(), payload = { lessonTitle: 'Private fixture', lessonSummary: 'Synthetic' }
  const first = await Promise.all([service.generateCourseQuiz(payload), service.generateCourseQuiz(payload)])
  assert.equal(f.calls.length, 1); assert.equal(f.providers(), 1)
  assert.equal(first[0].generationId, first[1].generationId)
  const replay = await f.load().generateCourseQuiz(payload)
  assert.equal(replay.generationId, first[0].generationId)
  assert.equal(f.calls[1].action, 'request-status'); assert.equal(f.providers(), 1)
  f.auth.currentUser = { uid: 'other' }
  const other = await service.generateCourseQuiz(payload)
  assert.notEqual(other.generationId, replay.generationId); assert.equal(f.providers(), 2)
  assert.ok([...f.records.values()].every(value => !value.includes('Private fixture')))
})

test('new-draft intent persists before invocation and becomes the next reload recovery target', async () => {
  const f = fixture(), payload = { lessonTitle: 'Fixture', lessonSummary: 'Synthetic' }
  const service = f.load(), first = await service.generateCourseQuiz(payload)
  const next = await service.generateCourseQuiz(payload, { newDraft: true })
  assert.notEqual(first.generationId, next.generationId); assert.equal(f.providers(), 2)
  const replay = await f.load().generateCourseQuiz(payload)
  assert.equal(replay.generationId, next.generationId); assert.equal(f.providers(), 2)
  assert.equal(f.calls.at(-1).action, 'request-status')
})

test('actual callable wiring recovers a lost response with the read-only action', async () => {
  const f = fixture(); f.loseResponse()
  const result = await f.load().generateCourseQuiz({ lessonTitle: 'Lost', lessonSummary: 'Response' })
  assert.match(result.generationId, /^content_[a-f0-9]{64}$/)
  assert.deepEqual(f.calls.map(call => call.action), ['course-quiz', 'request-status'])
  assert.equal(f.providers(), 1)
  assert.equal(f.calls[0].requestId, f.calls[1].requestId)
})
