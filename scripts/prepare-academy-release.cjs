'use strict'

// Local, create-only packaging. This command cannot deploy, publish content,
// provision review grants, alter the source Git index or run migration scripts.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sha256, functionImpact, sanitizeFunctionInventory, scanSecrets } = require('./academy-release-audit.cjs')
const PLAN = 'ops/academy-release-scope.json'
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function git(repo, ...args) { return execFileSync('git', ['-c', 'core.safecrlf=false', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }) }
function relativeFile(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)
      || value.split('/').some((part) => !part || part === '.' || part === '..')
      || /(^|\/)(?:\.git|\.tools|\.migration-private|node_modules|\.vercel|\.firebase)(\/|$)/.test(value)
      || /(^|\/)\.env(?:\.|$)/.test(value) && !['.env.e2e', '.env.example', 'functions/.env.example'].includes(value)
      || /(^|\/)(?:credentials|service-account|serviceAccount)[^/]*\.json$/i.test(value)) throw new Error(`Unsafe release path: ${String(value)}`)
  return value
}
function inside(root, target) {
  const relative = path.relative(root, target)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path must remain strictly inside the expected release directory')
  return target
}
function regular(root, name) {
  relativeFile(name)
  const target = inside(root, path.resolve(root, name))
  if (!fs.lstatSync(target).isFile() || !fs.statSync(target).isFile()) throw new Error(`Not a regular release file: ${name}`)
  inside(fs.realpathSync(root), fs.realpathSync(target))
  return fs.readFileSync(target)
}
function indexDelta(before, after) {
  if (!same(before.indexes, after.indexes)) throw new Error('Academy package cannot alter unrelated composite indexes')
  const key = (item) => `${item.collectionGroup}/${item.fieldPath}`
  const previous = new Map((before.fieldOverrides ?? []).map((item) => [key(item), item]))
  const current = new Map((after.fieldOverrides ?? []).map((item) => [key(item), item]))
  for (const [name, item] of previous) if (!same(item, current.get(name))) throw new Error(`Existing index policy changed: ${name}`)
  const allowed = new Set(['courses/modules', 'courses/chapterRefs', 'courses/publishedSnapshot.course', 'courses/academyReviewRequiredModuleIds', 'courseRevisions/course', 'courseRevisions/quizKeys'])
  const added = [...current].filter(([name]) => !previous.has(name)).map(([name, item]) => {
    if (!(item.collectionGroup.startsWith('academy') && item.fieldPath === '*' || allowed.has(name))
        || !same(Object.keys(item).sort(), ['collectionGroup', 'fieldPath', 'indexes']) || !same(item.indexes, [])) throw new Error(`Index exemption is outside Academy scope: ${name}`)
    return item
  })
  return { indexes: [], fieldOverrides: added, deletesExistingPolicies: false }
}
function inspect(repo = path.resolve(__dirname, '..')) {
  repo = fs.realpathSync(repo)
  const planBytes = regular(repo, PLAN), plan = JSON.parse(planBytes)
  const head = git(repo, 'rev-parse', 'HEAD').trim()
  if (plan.schemaVersion !== 1 || plan.baseCommit !== head || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Release baseline does not match current HEAD')
  if (git(repo, 'diff', '--cached', '--name-only').trim()) throw new Error('The source index must be empty; no staging is performed by this tool')
  if (!Array.isArray(plan.reviewedFiles) || !Array.isArray(plan.functions) || !plan.functions.length) throw new Error('Missing reviewed release scope')
  const overlays = new Map()
  for (const item of plan.reviewedFiles) {
    const name = relativeFile(item.path)
    if (overlays.has(name) || name === PLAN || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Duplicate or invalid reviewed file')
    const bytes = regular(repo, name)
    if (sha256(bytes) !== item.sha256) throw new Error(`Reviewed source changed: ${name}`)
    overlays.set(name, bytes)
  }
  overlays.set(PLAN, planBytes)
  const baseline = git(repo, 'ls-tree', '-rz', '--full-tree', head).split('\0').filter(Boolean).map((line) => {
    const [metadata, name] = line.split('\t')
    relativeFile(name)
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(metadata)) throw new Error(`Symlink or submodule is not allowed in a release: ${name}`)
    return name
  })
  const changed = [...new Set([...git(repo, 'diff', 'HEAD', '--name-only', '-z').split('\0'), ...git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split('\0')])].filter(Boolean)
  const excludedChanges = changed.filter((name) => !overlays.has(name)).sort()
  const runtimeFiles = [...new Set([...baseline, ...overlays.keys()])].filter((name) => name.startsWith('functions/') && /\.(?:c?js)$/.test(name) && !/\.test\.|test-support\//.test(name) && name !== 'functions/index.js')
  const oldFiles = {}, newFiles = {}
  for (const name of runtimeFiles) {
    const old = baseline.includes(name) ? git(repo, 'show', `${head}:${name}`) : undefined
    const current = overlays.has(name) ? overlays.get(name).toString('utf8') : old
    if (old !== undefined) oldFiles[name.slice('functions/'.length)] = old
    if (current !== undefined) newFiles[name.slice('functions/'.length)] = current
  }
  const before = git(repo, 'show', `${head}:functions/index.js`)
  const after = (overlays.get('functions/index.js') ?? Buffer.from(before)).toString('utf8')
  const impact = functionImpact(before, after, oldFiles, newFiles)
  const targets = plan.functions.map((item) => item.id).sort()
  if (new Set(targets).size !== targets.length || !same(targets, impact.affectedFunctions) || impact.removedFunctions.length) throw new Error(`Function scope mismatch: ${JSON.stringify(impact.affectedFunctions)}`)
  const target = plan.target
  const firebase = JSON.parse(git(repo, 'show', `${head}:firebase.json`)), firebaserc = JSON.parse(git(repo, 'show', `${head}:.firebaserc`))
  if (firebaserc.projects.default !== target?.projectId || !firebase.firestore.some((entry) => entry.database === target?.databaseId)) throw new Error('Firebase target differs from the reviewed named database')
  const beforeIndexes = JSON.parse(git(repo, 'show', `${head}:firestore.indexes.json`))
  const afterIndexes = JSON.parse((overlays.get('firestore.indexes.json') ?? Buffer.from(json(beforeIndexes))).toString('utf8'))
  const delta = indexDelta(beforeIndexes, afterIndexes)
  const fingerprint = sha256(json({ head, plan: sha256(planBytes), overlays: [...overlays].map(([name, bytes]) => [name, sha256(bytes)]).sort() }))
  return { repo, plan, overlays, baseline, head, impact, indexDelta: delta, excludedChanges, fingerprint }
}
function prepare(repo, inventoryPath) {
  const state = inspect(repo)
  const outputRoot = path.join(state.repo, '.tools', 'academy-releases')
  fs.mkdirSync(outputRoot, { recursive: true })
  inside(state.repo, fs.realpathSync(outputRoot))
  const output = fs.mkdtempSync(path.join(outputRoot, `candidate-${state.fingerprint.slice(0, 12)}-`))
  const source = path.join(output, 'source'); fs.mkdirSync(source)
  const archive = path.join(output, 'baseline-source.tar')
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, state.head], { cwd: state.repo })
  // Windows bsdtar may narrow Unicode command-line paths. Use an exact cwd
  // and ASCII-relative arguments; Node sets cwd through the Unicode API.
  execFileSync('tar', ['-xf', 'baseline-source.tar', '-C', 'source'], { cwd: output })
  for (const [name, bytes] of state.overlays) {
    const target = inside(source, path.resolve(source, name))
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: state.baseline.includes(name) ? 'w' : 'wx' })
  }
  const files = [...new Set([...state.baseline, ...state.overlays.keys()])].sort().map((name) => {
    const bytes = regular(source, name), findings = scanSecrets(name, bytes)
    if (findings.length) throw new Error(`Credential-like content excluded from release: ${JSON.stringify(findings)}; incomplete candidate is not deployable`)
    return { path: name, sha256: sha256(bytes), bytes: bytes.length, origin: state.overlays.has(name) ? 'reviewed-overlay' : state.head }
  })
  const live = inventoryPath ? sanitizeFunctionInventory(JSON.parse(fs.readFileSync(inventoryPath, 'utf8')), state.plan.functions.map((item) => item.id)) : null
  if (live && live.functions.some((item) => item.project !== state.plan.target.projectId || item.region !== state.plan.functions.find((target) => target.id === item.id)?.region)) throw new Error('Live function target differs from reviewed deployment regions')
  const fileList = path.join(output, 'source-files.txt'); fs.writeFileSync(fileList, files.map((item) => item.path).join('\n') + '\n', { flag: 'wx' })
  const candidateArchive = path.join(output, 'candidate-source.tar')
  execFileSync('tar', ['-cf', '../candidate-source.tar', '--null', '-T', '-'], { cwd: source, input: Buffer.from(files.map((item) => item.path).join('\0') + '\0') })
  const check = inspect(state.repo)
  if (state.fingerprint !== check.fingerprint || !same(state.excludedChanges, check.excludedChanges)) throw new Error('Source worktree changed during packaging; candidate must not be deployed')
  const receipt = {
    schemaVersion: 1, status: 'prepared-unverified-not-deployed', createdAt: new Date().toISOString(), baseCommit: state.head,
    sourceFingerprint: state.fingerprint, sourceRoot: 'source', planSha256: sha256(state.overlays.get(PLAN)), files,
    archive: { path: 'candidate-source.tar', sha256: sha256(fs.readFileSync(candidateArchive)) },
    baseline: { path: 'baseline-source.tar', sha256: sha256(fs.readFileSync(archive)), qualification: 'Local Git baseline, not a proven production rollback version; incompatible after chapter-storage migration.' },
    impact: state.impact, indexDelta: state.indexDelta, excludedWorkspaceChanges: state.excludedChanges, liveInventory: live,
    deployed: false, contentPublished: false, qualificationGrantsCreated: false,
  }
  fs.writeFileSync(path.join(output, 'release-manifest.json'), json(receipt), { flag: 'wx' })
  verify(output)
  return { output, sourceFingerprint: state.fingerprint, files: files.length, targets: state.impact.affectedFunctions,
    excludedWorkspaceChanges: state.excludedChanges, liveMissing: live?.missing ?? null, status: receipt.status }
}
function verify(output) {
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.sourceRoot !== 'source' || manifest.deployed !== false) throw new Error('Unexpected local release manifest')
  const source = path.join(output, 'source'), names = new Set()
  for (const item of manifest.files) {
    if (names.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid checksum manifest')
    names.add(item.path)
    const bytes = regular(source, item.path)
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256 || scanSecrets(item.path, bytes).length) throw new Error(`Candidate changed: ${item.path}`)
  }
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`Unexpected candidate link: ${name}`)
      if (entry.isDirectory()) {
        // Dependencies are installed separately from the sealed source archive.
        if (['node_modules', 'functions/node_modules'].includes(name)) continue
        walk(path.join(directory, entry.name), `${name}/`)
      } else if (!names.has(name)) throw new Error(`Unreviewed file in candidate source: ${name}`)
    }
  }
  walk(source)
  for (const [key, expected] of [['archive', 'candidate-source.tar'], ['baseline', 'baseline-source.tar']]) {
    if (manifest[key]?.path !== expected || sha256(fs.readFileSync(path.join(output, expected))) !== manifest[key].sha256) throw new Error(`Candidate ${key} checksum mismatch`)
  }
  if (sha256(regular(source, PLAN)) !== manifest.planSha256) throw new Error('Candidate plan changed')
  return { files: names.size, sourceFingerprint: manifest.sourceFingerprint, status: 'source-and-archive-checksums-verified-not-deployed' }
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2), mode = argv[0] ?? '--inspect'
    if (mode === '--inspect' && argv.length <= 1) {
      const state = inspect(); console.log(json({ baseCommit: state.head, sourceFingerprint: state.fingerprint,
        reviewedFiles: state.overlays.size, impact: state.impact, indexDelta: state.indexDelta, excludedWorkspaceChanges: state.excludedChanges }))
    } else if (mode === '--prepare' && argv.slice(1).every((arg) => arg.startsWith('--inventory=')) && argv.length <= 2) {
      const inventory = argv[1]?.slice('--inventory='.length)
      console.log(json(prepare(path.resolve(__dirname, '..'), inventory ? path.resolve(inventory) : undefined)))
    } else if (mode.startsWith('--verify=') && argv.length === 1) {
      const root = path.resolve(__dirname, '../.tools/academy-releases'), output = path.resolve(mode.slice('--verify='.length))
      inside(fs.realpathSync(root), fs.realpathSync(output)); console.log(json(verify(output)))
    } else throw new Error('Use --inspect, --prepare [--inventory=local-json], or --verify=local-candidate-directory. No deployment mode exists.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { relativeFile, indexDelta, inspect, prepare, verify }
