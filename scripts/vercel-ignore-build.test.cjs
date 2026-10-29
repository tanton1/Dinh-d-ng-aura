'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { decide } = require('./vercel-ignore-build.cjs')

function repository(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aura-vercel-ignore-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (file, content = 'updated\n') => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), content)
  }
  const commit = (message = 'change') => { git('add', '--all'); git('commit', '-m', message); return git('rev-parse', 'HEAD') }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Build policy test')
  git('config', 'user.email', 'build-policy@example.invalid')
  git('config', 'core.autocrlf', 'false')
  write('package.json', JSON.stringify({ scripts: { build: 'tsc -b && vite build' } }))
  write('vercel.json', JSON.stringify({ ignoreCommand: 'node scripts/vercel-ignore-build.cjs' }))
  write('vite.config.ts', 'export default {}\n')
  write('src/main.ts', 'export const ready = true\n')
  write('functions/worker.js', 'module.exports = 1\n')
  write('functions/nutrition-core.mjs', 'export const version = 1\n')
  write('functions/nutrition-core.d.mts', 'export declare const version: number\n')
  write('functions/delivery-location-policy.json', '{}\n')
  write('docs/operations.md', 'Operations\n')
  const base = commit('initial')
  const env = () => ({ VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: git('rev-parse', 'HEAD') })
  const check = (overrides = {}) => decide({ cwd, env: { ...env(), ...overrides } })
  return { cwd, git, write, commit, base, env, check }
}

test('skips backend/documentation additions, edits and deletions without installing dependencies', (t) => {
  const repo = repository(t)
  repo.write('functions/worker.js', 'module.exports = 2\n')
  repo.write('functions/new-worker.test.js', 'test\n')
  repo.write('ops/cpu-observation.json', '{}\n')
  repo.write('docs/ghi chú.md', 'Documentation with spaces and Unicode\n')
  repo.git('rm', 'docs/operations.md')
  repo.commit()
  assert.equal(repo.check().skip, true)
})

test('compares all commits since the last successful deployment, including a merge', (t) => {
  const repo = repository(t)
  repo.git('checkout', '-b', 'frontend')
  repo.write('src/main.ts', 'export const ready = false\n')
  repo.commit('frontend not yet deployed')
  repo.git('checkout', 'main')
  repo.write('docs/operations.md', 'Only the newest commit is docs\n')
  repo.commit('docs')
  repo.git('merge', '--no-ff', 'frontend', '-m', 'merge frontend')
  assert.equal(repo.check().skip, false)
  assert.match(repo.check().reason, /src\/main.ts/)
})

test('shared functions, generated assets, content, public files and unknown paths always build', async (t) => {
  for (const file of ['functions/nutrition-core.mjs', 'functions/nutrition-core.d.mts',
    'functions/delivery-location-policy.json', 'functions/package.json', 'functions/generated/template.cjs',
    'content/academy/lesson.ts', 'public/banner.webp', 'scripts/build-academy-runtime-assets.cjs',
    '.github/workflows/ci.yml', 'new-config.json', 'functions/new-worker.wasm', 'docs/example.js']) {
    await t.test(file, (child) => {
      const repo = repository(child)
      repo.write(file)
      repo.commit()
      assert.equal(repo.check().skip, false)
    })
  }
})

test('renaming frontend content into an ignored path still builds', (t) => {
  const repo = repository(t)
  repo.git('mv', 'src/main.ts', 'functions/moved.js')
  repo.commit()
  assert.equal(repo.check().skip, false)
})

test('new browser dependencies inside ignored directories fail open on subsequent backend-only changes', async (t) => {
  for (const source of [
    "import '../functions/worker.js'\n",
    "export { x } from '../functions/worker'\n",
    "import text from '../docs/operations.md?raw'\n",
    "import '/functions/worker.js'\n",
    "const modules = import.meta.glob('../functions/*.js')\n",
    'const value = import(modulePath)\n',
    'const value = import(`../${folder}/${file}.js`)\n',
  ]) {
    await t.test(source.trim(), (child) => {
      const repo = repository(child)
      repo.write('src/main.ts', source)
      const deployed = repo.commit('shared dependency already deployed')
      repo.write('functions/worker.js', 'module.exports = 3\n')
      repo.commit()
      assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: deployed }).skip, false)
    })
  }
})

test('known shared modules are allowed as roots, but any new transitive backend dependency builds', (t) => {
  const repo = repository(t)
  repo.write('src/main.ts', "import '../functions/nutrition-core.mjs'\nimport '../functions/delivery-location-policy.json'\n")
  let deployed = repo.commit()
  repo.write('functions/worker.js', 'module.exports = 3\n')
  repo.commit()
  assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: deployed }).skip, true)
  repo.write('functions/nutrition-core.mjs', "import './worker.js'\n")
  deployed = repo.commit()
  repo.write('functions/worker.js', 'module.exports = 4\n')
  repo.commit()
  assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: deployed }).skip, false)
})

test('missing, invalid, unknown or mismatched deployment SHAs always build', (t) => {
  const repo = repository(t)
  repo.write('functions/worker.js')
  repo.commit()
  for (const previous of ['', 'HEAD^', '--help', 'a'.repeat(40), 'abc']) {
    assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: previous }).skip, false)
  }
  assert.equal(repo.check({ VERCEL_GIT_COMMIT_SHA: repo.base }).skip, false)
  assert.equal(repo.check({ VERCEL_GIT_COMMIT_SHA: '' }).skip, false)
})

test('divergent history after a force push builds', (t) => {
  const repo = repository(t)
  repo.git('checkout', '-b', 'previous-deployment')
  repo.write('docs/operations.md', 'Previously deployed\n')
  const previous = repo.commit()
  repo.git('checkout', 'main')
  repo.write('functions/worker.js')
  repo.commit()
  assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: previous }).skip, false)
})

test('shallow checkout without the last deployment builds without fetching', (t) => {
  const repo = repository(t)
  repo.write('functions/worker.js')
  const current = repo.commit()
  const parent = mkdtempSync(path.join(tmpdir(), 'aura-vercel-shallow-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const cwd = path.join(parent, 'checkout')
  execFileSync('git', ['clone', '--depth', '1', pathToFileURL(repo.cwd).href, cwd], { stdio: 'pipe' })
  assert.equal(decide({ cwd, env: { VERCEL_GIT_PREVIOUS_SHA: repo.base, VERCEL_GIT_COMMIT_SHA: current } }).skip, false)
})

test('same-commit or empty-commit redeploys and explicit force builds are preserved', (t) => {
  const repo = repository(t)
  assert.equal(repo.check().skip, false)
  repo.git('commit', '--allow-empty', '-m', 'environment rebuild')
  assert.equal(repo.check().skip, false)
  repo.write('functions/worker.js')
  repo.commit()
  assert.equal(repo.check({ AURA_VERCEL_FORCE_BUILD: '1' }).skip, false)
  assert.equal(decide({ cwd: repo.cwd, env: repo.env(), args: ['--force'] }).skip, false)
})

test('modified build hooks, malformed config, uncommitted files and nested roots build', (t) => {
  const repo = repository(t)
  repo.write('package.json', JSON.stringify({ scripts: { build: 'tsc -b && vite build', prebuild: 'node generator.js' } }))
  const deployed = repo.commit()
  repo.write('functions/worker.js')
  repo.commit()
  assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: deployed }).skip, false)
  repo.write('package.json', '{')
  const malformed = repo.commit()
  repo.write('functions/worker.js', 'next\n')
  repo.commit()
  assert.equal(repo.check({ VERCEL_GIT_PREVIOUS_SHA: malformed }).skip, false)
  repo.write('src/main.ts', 'uncommitted\n')
  assert.equal(repo.check().skip, false)
  assert.equal(decide({ cwd: path.join(repo.cwd, 'functions'), env: repo.env() }).skip, false)
})

test('CLI follows Vercel exit codes and emits a diagnostic reason', (t) => {
  const repo = repository(t)
  repo.write('functions/worker.js')
  repo.commit()
  const script = path.join(__dirname, 'vercel-ignore-build.cjs')
  const run = (extra = {}) => spawnSync(process.execPath, [script], {
    cwd: repo.cwd, env: { ...process.env, AURA_VERCEL_FORCE_BUILD: '', ...repo.env(), ...extra }, encoding: 'utf8',
  })
  const skipped = run()
  assert.equal(skipped.status, 0)
  assert.match(skipped.stdout, /\[aura-build\] SKIP/)
  const built = run({ AURA_VERCEL_FORCE_BUILD: '1' })
  assert.equal(built.status, 1)
  assert.match(built.stdout, /\[aura-build\] BUILD/)
})

test('the actual Aura build inputs retain a working backend-only skip path', (t) => {
  const repo = repository(t)
  const sourceRoot = path.resolve(__dirname, '..')
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: sourceRoot, encoding: 'utf8' }).split('\0')
    .filter((file) => /^(?:src|content)\//.test(file)
      || /^(?:vite\.config\.ts|tsconfig(?:\.[\w-]+)?\.json|index\.html|package\.json|vercel\.json)$/.test(file)
      || ['scripts/build-academy-runtime-assets.cjs', 'functions/nutrition-core.mjs',
        'functions/nutrition-core.d.mts', 'functions/delivery-location-policy.json'].includes(file))
  for (const file of files) repo.write(file, readFileSync(path.join(sourceRoot, file)))
  const deployed = repo.commit('actual frontend inputs')
  repo.write('functions/worker.js', 'module.exports = 2\n')
  repo.commit()
  const result = repo.check({ VERCEL_GIT_PREVIOUS_SHA: deployed })
  assert.equal(result.skip, true, result.reason)
})
