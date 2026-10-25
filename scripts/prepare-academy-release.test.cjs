'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { sha256, functionImpact, sanitizeFunctionInventory, scanSecrets } = require('./academy-release-audit.cjs')
const { relativeFile, indexDelta, inspect, prepare, verify } = require('./prepare-academy-release.cjs')

test('dependency audit covers indirect read aliases, without touching unchanged PT behavior', () => {
  const before = "const { db } = require('sdk'); function shared(){return 1}; exports.reader=onCall(()=>shared()); exports.alias=onCall(exports.reader.run); exports.pt=onCall(()=>2);"
  const after = before.replace('{ db }', '{ db, Filter }').replace('return 1', 'return 3')
  const impact = functionImpact(before, after)
  assert.deepEqual(impact.affectedFunctions, ['alias', 'reader'])
  assert.ok(!impact.changedBindings.includes('db'))
  assert.deepEqual(impact.removedFunctions, [])
})
test('dependency audit follows changed module dependencies even when entrypoint declarations are unchanged', () => {
  const index = "const { build } = require('./helper'); exports.reader=onCall(build()); exports.other=onCall(()=>0);"
  const oldFiles = { 'helper.js': "const deep=require('./deep'); exports.build=()=>deep.value", 'deep.js': 'exports.value=1' }
  assert.deepEqual(functionImpact(index, index, oldFiles, { ...oldFiles, 'deep.js': 'exports.value=2' }).affectedFunctions, ['reader'])
  assert.deepEqual(functionImpact(index, index.replace('exports.reader=onCall(build());', ''), oldFiles, oldFiles).removedFunctions, ['reader'])
})
test('live inventory is target-scoped and strips secrets; omitted warm settings remain unknown', () => {
  const result = sanitizeFunctionInventory({ status: 'success', result: [{ id: 'a', project: 'demo', region: 'asia-east1',
    environmentVariables: { SECRET: 'do-not-copy-this' }, uri: 'https://example.test?token=do-not-copy-this',
    source: { storageSource: { bucket: 'source', object: 'archive.zip' }, secret: 'do-not-copy-this' } }, { id: 'outside' }] }, ['a', 'new'])
  assert.equal(result.functions.length, 1)
  assert.equal(result.functions[0].minInstances, null)
  assert.deepEqual(result.missing, ['new'])
  assert.equal(JSON.stringify(result).includes('do-not-copy-this'), false)
  assert.throws(() => sanitizeFunctionInventory({ status: 'error', result: [] }, []), /successful/)
})
test('packaging rejects path traversal, runtime credentials and runtime dependency directories', () => {
  for (const value of ['../secret', '/root/file', 'C:/secret', 'folder\\file', 'x/../file', '.env.production', 'functions/.env', 'x/node_modules/y', '.git/config', 'line\nbreak', 'service-account.json']) assert.throws(() => relativeFile(value), /Unsafe/)
  for (const value of ['src/app.tsx', '.env.e2e', '.env.example', 'functions/.env.example']) assert.equal(relativeFile(value), value)
})
test('only additive Academy index exemptions are allowed; unrelated indexes and existing overrides stay unchanged', () => {
  const before = { indexes: [{ collectionGroup: 'students' }], fieldOverrides: [{ collectionGroup: 'existing', fieldPath: 'field', indexes: [] }] }
  const exemption = { collectionGroup: 'academyChapterVersions', fieldPath: '*', indexes: [] }
  assert.deepEqual(indexDelta(before, { ...before, fieldOverrides: [...before.fieldOverrides, exemption] }).fieldOverrides, [exemption])
  assert.throws(() => indexDelta(before, { ...before, indexes: [] }), /composite/)
  assert.throws(() => indexDelta(before, { ...before, fieldOverrides: [] }), /Existing/)
  assert.throws(() => indexDelta(before, { ...before, fieldOverrides: [...before.fieldOverrides, { ...exemption, collectionGroup: 'students' }] }), /outside/)
})
test('credential scan redacts values in findings and does not accept real tokens as examples', () => {
  const token = 'sk-or-v1-' + 'A'.repeat(32)
  const findings = scanSecrets('file.txt', token)
  assert.deepEqual(findings, [{ file: 'file.txt', label: 'provider-key' }])
  assert.equal(JSON.stringify(findings).includes(token), false)
  assert.ok(scanSecrets('x', 'GEMINI_API_KEY=not-an-example').length)
  assert.deepEqual(scanSecrets('.env.example', 'GEMINI_API_KEY=your_key'), [])
})

function fixture(t, unicode = false) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `aura-academy-release-test-${unicode ? 'Dưỡng-' : ''}`))
  const write = (name, value) => { const target = path.join(repo, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value) }
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--initial-branch=codex/academy-release-test')
  write('.gitignore', '.tools/\n')
  write('firebase.json', JSON.stringify({ firestore: [{ database: 'academy-test' }] }))
  write('.firebaserc', JSON.stringify({ projects: { default: 'demo-aura-fitness' } }))
  write('firestore.indexes.json', JSON.stringify({ indexes: [], fieldOverrides: [] }))
  write('functions/index.js', 'exports.reader=onCall(()=>1);')
  write('unrelated.txt', 'baseline unrelated work')
  git('add', '.'); git('-c', 'user.name=Local fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Local release packaging fixture')
  write('functions/index.js', 'exports.reader=onCall(()=>2);')
  write('unrelated.txt', 'pending unrelated edit must stay in the original workspace')
  write('new-unrelated.txt', 'not part of this release')
  const plan = { schemaVersion: 1, baseCommit: git('rev-parse', 'HEAD').trim(),
    target: { projectId: 'demo-aura-fitness', databaseId: 'academy-test' },
    functions: [{ id: 'reader', region: 'asia-east1' }],
    reviewedFiles: [{ path: 'functions/index.js', sha256: sha256(fs.readFileSync(path.join(repo, 'functions/index.js'))) }] }
  const savePlan = () => write('ops/academy-release-scope.json', JSON.stringify(plan))
  savePlan()
  t.after(() => {
    const resolved = fs.realpathSync(repo)
    if (!path.basename(resolved).startsWith('aura-academy-release-test-') || path.dirname(resolved).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase()) throw new Error('Refuse cleanup outside the exact test-created temp directory')
    fs.rmSync(resolved, { recursive: true })
  })
  return { repo, write, git, plan, savePlan }
}
test('isolated archive includes reviewed source and baseline only, preserving the original index and unrelated edits', (t) => {
  const f = fixture(t), beforeStatus = f.git('status', '--porcelain')
  const result = prepare(f.repo), source = path.join(result.output, 'source')
  assert.equal(fs.readFileSync(path.join(source, 'functions/index.js'), 'utf8'), 'exports.reader=onCall(()=>2);')
  assert.equal(fs.readFileSync(path.join(source, 'unrelated.txt'), 'utf8'), 'baseline unrelated work')
  assert.equal(fs.existsSync(path.join(source, 'new-unrelated.txt')), false)
  assert.deepEqual(result.excludedWorkspaceChanges, ['new-unrelated.txt', 'unrelated.txt'])
  assert.equal(f.git('status', '--porcelain'), beforeStatus)
  assert.equal(f.git('diff', '--cached', '--name-only'), '')
  assert.equal(verify(result.output).status, 'source-and-archive-checksums-verified-not-deployed')
  const manifest = JSON.parse(fs.readFileSync(path.join(result.output, 'release-manifest.json'), 'utf8'))
  assert.equal(manifest.deployed, false); assert.equal(manifest.contentPublished, false)
})
test('changed approved source, changed baseline, or a missing impacted alias fails before packaging', (t) => {
  const f = fixture(t)
  f.write('functions/index.js', 'exports.reader=onCall(()=>3);')
  assert.throws(() => inspect(f.repo), /Reviewed source changed/)
  f.write('functions/index.js', 'exports.reader=onCall(()=>2);')
  f.plan.functions = []; f.savePlan(); assert.throws(() => inspect(f.repo), /Missing reviewed/)
  f.plan.functions = [{ id: 'other', region: 'asia-east1' }]; f.savePlan(); assert.throws(() => inspect(f.repo), /Function scope mismatch/)
  f.plan.baseCommit = 'a'.repeat(40); f.savePlan(); assert.throws(() => inspect(f.repo), /baseline/)
})
test('candidate source or archive tampering fails verification without touching the original tree', (t) => {
  const f = fixture(t), result = prepare(f.repo)
  const target = path.join(result.output, 'source/functions/index.js')
  fs.writeFileSync(target, 'changed')
  assert.throws(() => verify(result.output), /Candidate changed/)
  fs.writeFileSync(target, 'exports.reader=onCall(()=>2);')
  fs.appendFileSync(path.join(result.output, 'candidate-source.tar'), 'tampered')
  assert.throws(() => verify(result.output), /checksum mismatch/)
  assert.equal(fs.readFileSync(path.join(f.repo, 'functions/index.js'), 'utf8'), 'exports.reader=onCall(()=>2);')
})
test('an already staged unrelated change blocks packaging and the tool never unstages it', (t) => {
  const f = fixture(t); f.git('add', 'unrelated.txt')
  assert.throws(() => inspect(f.repo), /index must be empty/)
  assert.equal(f.git('diff', '--cached', '--name-only').trim(), 'unrelated.txt')
})
test('extra source files or injected environment configuration cannot pass candidate verification', (t) => {
  const f = fixture(t), result = prepare(f.repo)
  fs.writeFileSync(path.join(result.output, 'source/.env.production'), 'VITE_FORCE_DEMO=true')
  assert.throws(() => verify(result.output), /Unreviewed file/)
})
test('Windows-compatible archives preserve source in Unicode workspace directories', (t) => {
  const f = fixture(t, true), result = prepare(f.repo)
  assert.equal(verify(result.output).files, 7)
})
test('captured Cloud Run traffic is selected by the actual service, with no annotation or environment leakage', () => {
  const raw = { status: 'success', result: [{ id: 'reader', runServiceId: 'actual-reader', project: 'demo', region: 'asia-east1' }],
    cloudRun: [{ project: 'demo', region: 'asia-east1', services: [{ metadata: { name: 'actual-reader', annotations: { secret: 'do-not-copy', 'run.googleapis.com/minScale': '0' } },
      status: { latestReadyRevisionName: 'actual-reader-00001', traffic: [{ revisionName: 'actual-reader-00001', percent: 100 }] },
      spec: { template: { metadata: { annotations: { 'autoscaling.knative.dev/minScale': '0' } }, spec: { env: 'do-not-copy' } } } }] }] }
  const safe = sanitizeFunctionInventory(raw, ['reader'])
  assert.equal(safe.cloudRunServices[0].traffic[0].revision, 'actual-reader-00001')
  assert.equal(safe.cloudRunServices[0].serviceMinScale, '0')
  assert.equal(JSON.stringify(safe).includes('do-not-copy'), false)
  raw.cloudRun[0].region = 'wrong'; assert.throws(() => sanitizeFunctionInventory(raw, ['reader']), /target mismatch/)
})
test('local release commands contain no deploy or implicit content mutation capability', () => {
  const source = fs.readFileSync(require.resolve('./prepare-academy-release.cjs'), 'utf8')
  assert.doesNotMatch(source, /https?:\/\/|fetch\(|firebase.*deploy|vercel.*deploy|execFileSync\([^\n]*['"](?:add|commit|push)['"]/)
  assert.match(source, /No deployment mode exists/)
})
