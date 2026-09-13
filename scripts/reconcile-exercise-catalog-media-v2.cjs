const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RELEASE = 'EXERCISE_CATALOG_MEDIA_V2'
const CONFIRMATION = 'RECONCILE_EXERCISE_CATALOG_MEDIA_V2'
const REPORT = path.resolve('.migration-private', 'exercise-catalog-media-v2-report.json')
const SOURCE_ATTRIBUTION = 'Free Exercise DB · Unlicense · https://github.com/yuhonas/free-exercise-db · ExerciseDB Free · https://exercisedb.dev'
const { ITEMS: CORE_WOMEN_ITEMS } = require('./import-aura-women-exercise-catalog.cjs')
const { ITEMS: SPECIALIZED_WOMEN_ITEMS } = require('./import-aura-women-specialized-catalog.cjs')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function unique(values) { return [...new Set(values.filter(Boolean))] }

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
    if (result.projectId !== TARGET.projectId || result.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact production target.')
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

function firestoreBase() { return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}` }
function resourceBase() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${firestoreBase()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Google API request failed (${response.status}): ${raw.slice(0, 500)}`)
  return raw ? JSON.parse(raw) : null
}

function decodeValue(value) {
  if (!value) return null
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, entry]) => [key, decodeValue(entry)]))
  return null
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)])) } }
}

function encodeFields(value) { return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)])) }

async function loadCatalog(token) {
  const payload = await requestJson(token, '/documents:runQuery', {
    method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], limit: 500 } }),
  })
  return (payload || []).flatMap((row) => row.document ? [{
    id: row.document.name.split('/').pop(),
    updateTime: row.document.updateTime,
    data: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  }] : [])
}

async function nextAvailableRevision(token, exerciseId, initialRevision) {
  for (let revision = Math.max(1, initialRevision), attempt = 0; attempt < 50; revision += 1, attempt += 1) {
    const response = await fetch(`${firestoreBase()}/documents/exercises/${exerciseId}/revisions/${revision}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 404) return revision
    if (!response.ok) throw new Error(`Unable to inspect revision ${exerciseId}/${revision} (${response.status}).`)
  }
  throw new Error(`No safe revision slot found for ${exerciseId}.`)
}

function withoutGeneratedFrames(media = {}) {
  const images = (Array.isArray(media.images) ? media.images : [])
    .filter((image) => image?.id && image?.url && !String(image.id).startsWith('exercisedb-frame-'))
    .map((image, order) => ({ ...image, order }))
  const first = images.find((image) => image.role === 'start') || images[0]
  const end = images.find((image) => image.role === 'end') || images[images.length - 1]
  const videos = Array.isArray(media.videos) ? media.videos.map((video) => ({
    ...video,
    posterUrl: video.provider === 'exercisedb' ? first?.url || video.posterUrl : video.posterUrl,
  })) : []
  return {
    ...media,
    images,
    videos,
    startImageUrl: first?.url || media.startImageUrl || '',
    endImageUrl: end?.url || media.endImageUrl || first?.url || '',
    posterUrl: first?.url || media.posterUrl || '',
    posterImageId: first?.id || media.posterImageId || '',
    mimeType: first?.mimeType || media.mimeType || 'image/jpeg',
  }
}

function normalizedAttribution(value) {
  const parts = unique(String(value || '').split(' · ').map((part) => part.trim()))
  if (parts.includes('ExerciseDB Free') || parts.includes('https://exercisedb.dev')) return SOURCE_ATTRIBUTION
  return value || SOURCE_ATTRIBUTION
}

function buildPlan(catalog) {
  const sourceContentDigests = new Map([...CORE_WOMEN_ITEMS, ...SPECIALIZED_WOMEN_ITEMS].map((item) => [item.id, sha256(JSON.stringify(item))]))
  const published = catalog.filter((item) => item.data.status === 'published' && item.data.source?.provider === 'free-exercise-db')
  const changes = published.flatMap((item) => {
    const media = withoutGeneratedFrames(item.data.media)
    const oldImages = Array.isArray(item.data.media?.images) ? item.data.media.images : []
    const fields = {}
    const reasons = []
    if (oldImages.some((image) => String(image?.id || '').startsWith('exercisedb-frame-'))) {
      fields.media = media
      reasons.push('remove_generated_gif_frames')
    }
    if (normalizedAttribution(item.data.sourceAttribution) !== item.data.sourceAttribution) {
      fields.sourceAttribution = normalizedAttribution(item.data.sourceAttribution)
      reasons.push('normalize_attribution')
    }
    if (item.id === 'aura_women_dumbbell_split_squat') {
      Object.assign(fields, {
        nameVi: 'Bulgarian Split Squat với tạ đơn', nameEn: 'Bulgarian Split Squat with Dumbbells',
        aliasesVi: ['Split Squat với tạ đơn', 'Squat một chân kê sau'], difficulty: 'intermediate',
        equipment: ['Tạ đơn', 'Ghế tập'],
        instructionsVi: ['Đặt một ghế thấp phía sau, đứng chân trước chân sau và đặt mu bàn chân sau lên ghế.', 'Cầm hai tạ dọc hai bên thân, giữ chân trước bám chắc và hông hướng thẳng.', 'Hạ gối sau hướng xuống sàn, nghiêng thân nhẹ; gối trước đi cùng hướng mũi chân.', 'Đẩy qua cả bàn chân trước để đứng lên, giữ hông cân bằng rồi đổi bên.'],
        cuesVi: ['Chân trước chịu lực chính', 'Mu bàn chân sau chỉ tựa ghế', 'Gối trước theo mũi chân'],
        commonMistakesVi: ['Ghế quá cao hoặc quá xa', 'Dùng chân sau đẩy mạnh', 'Gối trước đổ vào trong'],
        breathingVi: 'Hít vào khi hạ, thở ra khi đẩy người lên.',
        defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 75, rpe: 8 },
      })
      reasons.push('correct_bulgarian_content')
    }
    if (item.id === 'aura_women_bulgarian_split_squat') {
      Object.assign(fields, {
        nameVi: 'Split Squat sang bên với tạ đòn', nameEn: 'Barbell Side Split Squat',
        aliasesVi: ['Squat sang ngang với tạ đòn', 'Lateral Split Squat'], difficulty: 'beginner',
        targetMuscles: ['Đùi trước'], secondaryMuscles: ['Đùi trong', 'Mông', 'Đùi sau'], equipment: ['Tạ đòn'],
        instructionsVi: ['Đứng thẳng, đặt tạ đòn trên vai và mở chân rộng hơn vai; mũi chân hơi chếch.', 'Hạ người về phía chân đang chếch sang bên bằng cách gập gối và hông; chân còn lại chỉ hơi chùng.', 'Giữ lưng trung lập, trọng tâm ở gót chân và đầu gối hướng theo mũi chân.', 'Đẩy qua gót chân của chân bên để trở lại tư thế đứng rồi đổi bên sau số lần lặp.'],
        cuesVi: ['Chân làm việc mở sang bên', 'Lưng giữ trung lập', 'Đầu gối theo mũi chân'],
        commonMistakesVi: ['Đứng chân quá hẹp', 'Gập lưng khi hạ', 'Đổ gối vào trong'],
        breathingVi: 'Hít vào khi hạ sang bên, thở ra khi đẩy trở lại.',
        defaultPrescription: { sets: 3, reps: '8–12 mỗi bên', restSeconds: 75, rpe: 7 },
      })
      reasons.push('correct_side_split_squat_content')
    }
    if (sourceContentDigests.has(item.id) && sourceContentDigests.get(item.id) !== item.data.contentDigest) {
      fields.contentDigest = sourceContentDigests.get(item.id)
      reasons.push('refresh_content_digest')
    }
    if (!reasons.length) return []
    return [{ item, fields, reasons }]
  })
  const digest = sha256(JSON.stringify(changes.map(({ item, fields, reasons }) => ({ id: item.id, updateTime: item.updateTime, fields, reasons }))))
  return { published, changes, digest }
}

async function applyPlan(token, plan) {
  let updated = 0
  for (let offset = 0; offset < plan.changes.length; offset += 100) {
    const page = plan.changes.slice(offset, offset + 100)
    const writes = []
    for (const change of page) {
      const revision = await nextAvailableRevision(token, change.item.id, Number(change.item.data.revision || 1) + 1)
      const fields = { ...change.fields, revision, updatedBy: RELEASE }
      const root = `${resourceBase()}/documents/exercises/${change.item.id}`
      writes.push({ update: { name: root, fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: change.item.updateTime } })
      writes.push({ transform: { document: root, fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }, currentDocument: { exists: true } })
      writes.push({ update: { name: `${root}/revisions/${revision}`, fields: encodeFields({ ...change.item.data, ...fields, exerciseId: change.item.id, revisionType: 'catalog_media_reconcile', createdBy: RELEASE, reasons: change.reasons }) }, currentDocument: { exists: false } })
    }
    await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
    updated += page.length
  }
  return updated
}

function verification(catalog) {
  const published = catalog.filter((item) => item.data.status === 'published' && item.data.source?.provider === 'free-exercise-db')
  const generatedFrames = published.flatMap((item) => (item.data.media?.images || []).filter((image) => String(image?.id || '').startsWith('exercisedb-frame-')).map(() => item.id))
  const bulgarian = published.find((item) => item.id === 'aura_women_dumbbell_split_squat')
  const sideSplitSquat = published.find((item) => item.id === 'aura_women_bulgarian_split_squat')
  return {
    publishedCanonical: published.length,
    withTwoOrMoreStills: published.filter((item) => (item.data.media?.images || []).length >= 2).length,
    generatedFrameCount: generatedFrames.length,
    generatedFrameExerciseIds: unique(generatedFrames),
    bulgarianCorrect: bulgarian?.data.nameVi === 'Bulgarian Split Squat với tạ đơn'
      && bulgarian?.data.source?.sourceExerciseId === 'Split_Squat_with_Dumbbells'
      && bulgarian?.data.externalMedia?.exerciseId === 'qx4fgX7',
    sideSplitSquatCorrect: sideSplitSquat?.data.nameEn === 'Barbell Side Split Squat'
      && sideSplitSquat?.data.source?.sourceExerciseId === 'Barbell_Side_Split_Squat',
  }
}

async function main() {
  const args = parseArgs()
  const token = await accessToken()
  const catalog = await loadCatalog(token)
  const plan = buildPlan(catalog)
  const report = {
    schemaVersion: 1, release: RELEASE, mode: args.mode, planDigest: plan.digest,
    publishedCanonical: plan.published.length, plannedUpdates: plan.changes.length,
    reasonCounts: plan.changes.flatMap((change) => change.reasons).reduce((counts, reason) => ({ ...counts, [reason]: (counts[reason] || 0) + 1 }), {}),
    plannedIds: plan.changes.map((change) => change.item.id), writesPerformed: false,
  }
  if (args.mode === 'apply') {
    if (args.digest !== plan.digest) throw new Error('Live plan digest no longer matches the approved dry run.')
    report.updated = await applyPlan(token, plan)
    report.writesPerformed = report.updated > 0
    Object.assign(report, verification(await loadCatalog(token)))
  }
  if (args.mode === 'verify') Object.assign(report, verification(catalog))
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (args.mode !== 'dry-run' && (report.publishedCanonical !== 120 || report.generatedFrameCount || !report.bulgarianCorrect || !report.sideSplitSquatCorrect)) process.exitCode = 2
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { RELEASE, buildPlan, verification, withoutGeneratedFrames }
