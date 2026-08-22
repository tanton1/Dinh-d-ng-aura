const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const SOURCE_REPO = 'https://github.com/yuhonas/free-exercise-db'
const SOURCE_MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRMATION = 'IMPORT_FREE_EXERCISE_CATALOG_V1'
const REPORT = path.resolve('.migration-private', 'free-exercise-catalog-report.json')
const SOURCE_CACHE = path.resolve('.migration-private', 'free-exercise-db-source.json')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function slug(value) { return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 120) }
function parseArgs() {
  const result = { mode: 'dry-run' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  })
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode === 'apply') {
    if (result.projectId !== TARGET.projectId || result.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact approved target project and database.')
    if (result.confirm !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
    if (!/^[a-f0-9]{64}$/.test(result.digest || '')) throw new Error('Apply requires the dry-run digest.')
  }
  return result
}

function firebaseCliAuth() {
  const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain Firebase access token.')
  return result.access_token
}

function firestoreBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

function firestoreResourceBase() {
  return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${firestoreBase()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } }
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]))
}

const nameTerms = [
  [/(barbell)/gi, 'đòn tạ'], [/(dumbbell)/gi, 'tạ đơn'], [/(cable)/gi, 'cáp'], [/(bodyweight)/gi, 'trọng lượng cơ thể'],
  [/(squat)/gi, 'squat'], [/(deadlift)/gi, 'deadlift'], [/(lunge)/gi, 'chùng chân'], [/(hip thrust)/gi, 'đẩy hông'],
  [/(glute bridge)/gi, 'cầu mông'], [/(leg press)/gi, 'đạp đùi'], [/(leg curl)/gi, 'gập đùi sau'], [/(leg extension)/gi, 'duỗi đùi'],
  [/(row)/gi, 'kéo lưng'], [/(pulldown)/gi, 'kéo xô'], [/(pull-up)/gi, 'hít xà'], [/(push-up)/gi, 'chống đẩy'],
  [/(crunch)/gi, 'gập bụng'], [/(plank)/gi, 'plank'], [/(raise)/gi, 'nâng'], [/(extension)/gi, 'duỗi'],
  [/(lying)/gi, 'nằm'], [/(seated)/gi, 'ngồi'], [/(standing)/gi, 'đứng'], [/(single-leg)/gi, 'một chân'],
]

function draftVietnameseName(name) {
  let result = String(name || '')
  nameTerms.forEach(([pattern, replacement]) => { result = result.replace(pattern, replacement) })
  return result.replace(/\s+/g, ' ').trim().replace(/^./, (letter) => letter.toLocaleUpperCase('vi'))
}

function targetGroup(exercise) {
  const muscles = [...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])].map((item) => String(item).toLowerCase())
  if (muscles.some((item) => item.includes('glute'))) return 'glutes'
  if (muscles.some((item) => item.includes('quadriceps') || item.includes('hamstring') || item.includes('calves'))) return 'legs'
  if (muscles.some((item) => item.includes('abdominal'))) return 'core'
  if (muscles.some((item) => ['lats', 'middle back', 'lower back', 'traps'].includes(item))) return 'back'
  if (exercise.category === 'stretching') return 'mobility'
  return 'upper'
}

function scoreExercise(exercise) {
  let score = exercise.level === 'beginner' ? 30 : exercise.level === 'intermediate' ? 20 : 0
  if (Array.isArray(exercise.images) && exercise.images.length >= 2) score += 25
  if (Array.isArray(exercise.instructions) && exercise.instructions.length >= 3) score += 15
  if (['body only', 'dumbbell', 'cable', 'machine', 'bands', 'barbell', 'kettlebells'].includes(exercise.equipment)) score += 15
  if (exercise.category === 'strength') score += 10
  return score
}

function curate(source) {
  const quotas = { glutes: 30, legs: 25, core: 20, back: 20, upper: 15, mobility: 10 }
  const excluded = /(olympic|clean and jerk|snatch|neck press|behind the neck|muscle up)/i
  const candidates = source.filter((item) => item?.id && item?.name && Array.isArray(item.images) && item.images.length && !excluded.test(item.name))
    .sort((a, b) => scoreExercise(b) - scoreExercise(a) || a.name.localeCompare(b.name))
  const selected = []
  const seen = new Set()
  for (const [group, quota] of Object.entries(quotas)) {
    const matching = candidates.filter((item) => targetGroup(item) === group)
    for (const item of matching) {
      if (selected.filter((entry) => entry.group === group).length >= quota) break
      const key = slug(item.name)
      if (seen.has(key)) continue
      seen.add(key)
      selected.push({ group, item })
    }
  }
  if (selected.length !== 120) throw new Error(`Curation produced ${selected.length} exercises instead of 120.`)
  return selected.map(({ group, item }, index) => {
    const id = `fedb_${slug(item.id)}`
    const startPath = item.images[0]
    const endPath = item.images[1] || item.images[0]
    return {
      id,
      schemaVersion: 1,
      revision: 1,
      status: 'review',
      sortPriority: index + 1,
      nameEn: item.name,
      nameVi: draftVietnameseName(item.name),
      aliasesVi: [],
      bodyParts: [group],
      targetMuscles: item.primaryMuscles || [],
      secondaryMuscles: item.secondaryMuscles || [],
      equipment: item.equipment ? [item.equipment] : ['body only'],
      environment: item.equipment && item.equipment !== 'body only' ? ['gym'] : ['home', 'gym'],
      difficulty: ['beginner', 'intermediate', 'advanced'].includes(item.level) ? item.level : 'beginner',
      goals: group === 'mobility' ? ['mobility', 'recovery'] : ['strength', 'body-shaping'],
      instructionsVi: [],
      sourceInstructionsEn: (item.instructions || []).slice(0, 20),
      cuesVi: [], commonMistakesVi: [], breathingVi: '',
      media: {
        startImageUrl: `${SOURCE_MEDIA_BASE}${startPath.split('/').map(encodeURIComponent).join('/')}`,
        endImageUrl: `${SOURCE_MEDIA_BASE}${endPath.split('/').map(encodeURIComponent).join('/')}`,
        posterUrl: `${SOURCE_MEDIA_BASE}${startPath.split('/').map(encodeURIComponent).join('/')}`,
        animationUrl: '', mimeType: 'image/jpeg', checksum: '',
      },
      defaultPrescription: { sets: 3, reps: group === 'mobility' ? '30–45 giây' : '10–12', restSeconds: group === 'mobility' ? 30 : 60, rpe: 7 },
      source: { provider: 'free-exercise-db', sourceExerciseId: item.id, sourceVersion: 'main-2026-08-22', license: 'Unlicense' },
      sourceAttribution: `Free Exercise DB · Unlicense · ${SOURCE_REPO}`,
    }
  })
}

async function loadSource() {
  fs.mkdirSync(path.dirname(SOURCE_CACHE), { recursive: true })
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Source download failed (${response.status}).`)
  const raw = await response.text()
  fs.writeFileSync(SOURCE_CACHE, raw)
  return { raw, data: JSON.parse(raw) }
}

async function existingIds(token) {
  const response = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], select: { fields: [{ fieldPath: '__name__' }] }, limit: 500 } }) })
  return new Set((response || []).flatMap((item) => item.document?.name ? [item.document.name.split('/').pop()] : []))
}

async function writeBatches(token, items, existing) {
  let written = 0
  let skipped = 0
  for (let offset = 0; offset < items.length; offset += 200) {
    const writes = items.slice(offset, offset + 200).flatMap((item) => {
      if (existing.has(item.id)) { skipped += 1; return [] }
      const { id, ...fields } = item
      return [{ update: { name: `${firestoreResourceBase()}/documents/exercises/${id}`, fields: encodeFields(fields) }, currentDocument: { exists: false } }]
    })
    if (writes.length) {
      await requestJson(token, '/documents:batchWrite', { method: 'POST', body: JSON.stringify({ writes }) })
      written += writes.length
    }
  }
  return { written, skipped }
}

async function main() {
  const args = parseArgs()
  const { raw, data } = await loadSource()
  const items = curate(data)
  const planDigest = sha256(JSON.stringify(items))
  const report = { schemaVersion: 1, mode: args.mode, sourceCount: data.length, selectedCount: items.length, sourceDigest: sha256(raw), planDigest, statusCounts: { review: items.length }, writesPerformed: false }
  if (args.mode === 'apply') {
    if (args.digest !== planDigest) throw new Error('Live plan digest no longer matches the approved dry run.')
    const token = await accessToken()
    const metadata = await requestJson(token, '')
    if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Connected database is not the approved target.')
    const existing = await existingIds(token)
    const result = await writeBatches(token, items, existing)
    Object.assign(report, result, { writesPerformed: result.written > 0 })
  }
  if (args.mode === 'verify') {
    const token = await accessToken()
    const existing = await existingIds(token)
    report.present = items.filter((item) => existing.has(item.id)).length
    report.missing = items.length - report.present
    if (report.missing) process.exitCode = 2
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
