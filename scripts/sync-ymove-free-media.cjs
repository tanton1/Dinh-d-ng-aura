'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  bucket: 'gen-lang-client-0815966909.firebasestorage.app',
})
const SOURCE_URL = 'https://ymove.app/free-exercise-videos'
const CONFIRMATION = 'SYNC_YMOVE_FREE_MEDIA_V1'
const RELEASE = 'YMOVE_FREE_MEDIA_V1'
const REPORT = path.resolve('.migration-private', 'ymove-free-media-report.json')
const MATCHES = Object.freeze({
  'Hammer Curls': 'aura_women_hammer_curl',
  'Single Arm Dumbbell Row - Legs apart': 'aura_women_one_arm_dumbbell_row',
  'Dumbbell Goblet Squat': 'aura_women_goblet_squat',
  'Goblet Squat with Kettlebell': 'aura_women_goblet_squat',
  'Lat Pulldown with V-Grip': 'aura_women_close_grip_lat_pulldown',
  'Seated Cable Row Neutral Grip': 'aura_women_seated_cable_row',
  'Cable Tricep Pushdown': 'aura_women_rope_triceps_pushdown',
  'Overhead Cable Rope Extension': 'aura_women_rope_overhead_triceps_extension',
  'Leg Extension': 'aura_women_leg_extension',
  'Hack Squat': 'aura_women_hack_squat',
  'Lying Leg Curl': 'aura_women_lying_leg_curl',
  'Cable Woodchop (High to Low)': 'aura_women_cable_wood_chop',
})

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function slug(value) { return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 120) }
function parseArgs() {
  const result = { mode: 'dry-run' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--bucket=')) result.bucket = argument.slice(9)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  })
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode === 'apply') {
    if (result.projectId !== TARGET.projectId || result.databaseId !== TARGET.databaseId || result.bucket !== TARGET.bucket) throw new Error('Apply requires the exact approved Firebase target.')
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
async function requestJson(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
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

async function loadFreeLibrary() {
  const response = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'AuraFitnessExerciseCatalog/1.0' } })
  if (!response.ok) throw new Error(`YMove free library failed (${response.status}).`)
  const html = await response.text()
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('YMove free library format changed.')
  const exercises = JSON.parse(match[1])?.props?.pageProps?.exercises
  if (!Array.isArray(exercises) || exercises.length !== 25) throw new Error(`Safety stop: expected 25 free videos, found ${exercises?.length || 0}.`)
  return exercises.map((exercise) => ({
    id: exercise.id,
    title: exercise.title,
    slug: exercise.slug || slug(exercise.title),
    muscleGroup: exercise.muscleGroup || '',
    equipment: exercise.equipment || '',
    thumbnailUrl: exercise.thumbnailUrl,
    videoUrl: exercise.videoUrl,
  }))
}

async function loadCatalog(token) {
  const payload = await requestJson(token, `${firestoreBase()}/documents:runQuery`, {
    method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], limit: 500 } }),
  })
  return (payload || []).flatMap((row) => row.document ? [{
    id: row.document.name.split('/').pop(),
    updateTime: row.document.updateTime,
    data: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  }] : [])
}

function createPlan(exercises, catalog) {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const matched = exercises.flatMap((exercise) => {
    const exerciseId = MATCHES[exercise.title]
    if (!exerciseId) return []
    const target = byId.get(exerciseId)
    if (!target || target.data.status !== 'published') throw new Error(`Safety stop: target ${exerciseId} is missing or not published.`)
    return [{ exercise, target }]
  })
  const grouped = new Map()
  matched.forEach((entry) => grouped.set(entry.target.id, [...(grouped.get(entry.target.id) || []), entry]))
  const digestInput = {
    source: exercises.map(({ id, title, videoUrl }) => ({ id, title, videoUrl })),
    targets: [...grouped].map(([id, entries]) => ({ id, updateTime: entries[0].target.updateTime, sourceIds: entries.map((entry) => entry.exercise.id) })),
  }
  return { exercises, matched, grouped, unmatched: exercises.filter((exercise) => !MATCHES[exercise.title]), digest: sha256(JSON.stringify(digestInput)) }
}

async function uploadObject(token, bucket, objectName, sourceUrl, contentType) {
  const source = await fetch(sourceUrl)
  if (!source.ok) throw new Error(`Media download failed (${source.status}) for ${objectName}.`)
  const bytes = Buffer.from(await source.arrayBuffer())
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error(`Unexpected media size for ${objectName}: ${bytes.length}.`)
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=0`
  let response = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': source.headers.get('content-type') || contentType }, body: bytes })
  if (response.status === 412) {
    response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`, { headers: { Authorization: `Bearer ${token}` } })
  }
  const raw = await response.text()
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}) for ${objectName}: ${raw.slice(0, 300)}`)
  const object = JSON.parse(raw)
  const existingToken = String(object.metadata?.firebaseStorageDownloadTokens || '').split(',').find(Boolean)
  const downloadToken = existingToken || crypto.randomUUID()
  if (!existingToken) {
    await requestJson(token, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`, {
      method: 'PATCH', body: JSON.stringify({ metadata: { ...(object.metadata || {}), firebaseStorageDownloadTokens: downloadToken, source: 'YMove Free Library', license: 'Free commercial use; no library redistribution' } }),
    })
  }
  return {
    bytes: Number(object.size || bytes.length),
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media&token=${downloadToken}`,
  }
}

async function uploadLibrary(token, plan) {
  const media = new Map()
  let totalBytes = 0
  for (const [index, exercise] of plan.exercises.entries()) {
    const prefix = `exercise-catalog/ymove-free/${String(index + 1).padStart(2, '0')}-${slug(exercise.title)}`
    const [video, thumbnail] = await Promise.all([
      uploadObject(token, TARGET.bucket, `${prefix}.mp4`, exercise.videoUrl, 'video/mp4'),
      uploadObject(token, TARGET.bucket, `${prefix}.jpg`, exercise.thumbnailUrl, 'image/jpeg'),
    ])
    totalBytes += video.bytes + thumbnail.bytes
    media.set(exercise.id, { videoUrl: video.url, thumbnailUrl: thumbnail.url, storagePrefix: prefix })
    process.stdout.write(`Uploaded ${index + 1}/25: ${exercise.title}\n`)
  }
  return { media, totalBytes }
}

async function applyCatalogLinks(token, plan, uploaded) {
  const writes = []
  for (const [exerciseId, entries] of plan.grouped) {
    const target = entries[0].target
    const currentVideos = Array.isArray(target.data.media?.videos) ? target.data.media.videos.filter((video) => video.provider !== 'ymove_free') : []
    const videos = entries.map(({ exercise }, index) => {
      const media = uploaded.media.get(exercise.id)
      return {
        id: `ymove-free-${exercise.id}`,
        provider: 'ymove_free', externalId: exercise.id, url: media.videoUrl, posterUrl: media.thumbnailUrl,
        tag: 'white-background', presenter: 'neutral', orientation: 'portrait', format: 'mp4', isPrimary: currentVideos.length === 0 && index === 0,
      }
    })
    const revision = Number(target.data.revision || 1) + 1
    const media = { ...(target.data.media || {}), videos: [...currentVideos, ...videos] }
    const sourceAttribution = [target.data.sourceAttribution, 'Video: YMove Free Library · commercial use allowed'].filter(Boolean).join(' · ')
    const fields = { media, sourceAttribution, revision, updatedBy: RELEASE }
    const root = `${resourceBase()}/documents/exercises/${exerciseId}`
    writes.push({ update: { name: root, fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: target.updateTime } })
    writes.push({ transform: { document: root, fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }, currentDocument: { exists: true } })
    writes.push({ update: { name: `${root}/revisions/${revision}`, fields: encodeFields({ ...target.data, ...fields, exerciseId, revisionType: 'media_sync', createdBy: RELEASE }) }, currentDocument: { exists: false } })
  }
  writes.push({ update: { name: `${resourceBase()}/documents/systemMigrations/${RELEASE}`, fields: encodeFields({ release: RELEASE, sourceCount: 25, linkedExerciseCount: plan.grouped.size, planDigest: plan.digest, status: 'complete' }) }, currentDocument: { exists: false } })
  writes.push({ transform: { document: `${resourceBase()}/documents/systemMigrations/${RELEASE}`, fieldTransforms: [{ fieldPath: 'completedAt', setToServerValue: 'REQUEST_TIME' }] }, currentDocument: { exists: true } })
  await requestJson(token, `${firestoreBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
  return writes.length
}

async function verify(token, exercises) {
  const catalog = await loadCatalog(token)
  const linked = catalog.filter((item) => Array.isArray(item.data.media?.videos) && item.data.media.videos.some((video) => video.provider === 'ymove_free'))
  const storage = await requestJson(token, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(TARGET.bucket)}/o?prefix=${encodeURIComponent('exercise-catalog/ymove-free/')}&maxResults=100`)
  return { linkedExercises: linked.map((item) => item.id).sort(), storageObjects: (storage.items || []).length, expectedVideos: exercises.length }
}

async function main() {
  const args = parseArgs()
  const exercises = await loadFreeLibrary()
  const token = await accessToken()
  const catalog = await loadCatalog(token)
  const plan = createPlan(exercises, catalog)
  const report = {
    schemaVersion: 1, mode: args.mode, sourceCount: exercises.length, matchedVideos: plan.matched.length,
    linkedExerciseCount: plan.grouped.size, unmatchedCount: plan.unmatched.length, unmatchedTitles: plan.unmatched.map((item) => item.title),
    planDigest: plan.digest, writesPerformed: false,
  }
  if (args.mode === 'apply') {
    if (args.digest !== plan.digest) throw new Error('Live plan digest no longer matches the approved dry run.')
    const uploaded = await uploadLibrary(token, plan)
    report.totalUploadedBytes = uploaded.totalBytes
    report.firestoreWrites = await applyCatalogLinks(token, plan, uploaded)
    report.writesPerformed = true
  }
  if (args.mode === 'verify') Object.assign(report, await verify(token, exercises))
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
