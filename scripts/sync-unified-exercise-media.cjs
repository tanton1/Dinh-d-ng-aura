'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  bucket: 'gen-lang-client-0815966909.firebasestorage.app',
})
const RELEASE = 'EXERCISE_MEDIA_UNIFIED_V1'
const CONFIRMATION = 'SYNC_EXERCISE_MEDIA_UNIFIED_V1'
const SOURCE_ATTRIBUTION = 'ExerciseDB Free · https://exercisedb.dev'
const SOURCE_CACHE = path.resolve('.migration-private', 'exercisedb-women-source-v1.json')
const REPORT = path.resolve('.migration-private', 'unified-exercise-media-report.json')
const FRAME_SCRIPT = path.resolve('scripts', 'extract-exercise-gif-frames.py')
// These mappings were reviewed against movement, equipment and target muscle.
// We intentionally leave an Aura exercise unmatched when V1 has no equivalent;
// it keeps its two Free Exercise DB stills instead of receiving a misleading GIF.
const VERIFIED_MATCHES = Object.freeze({
  aura_women_adductor_machine: 'oHsrypV',
  aura_women_alternate_hammer_curl: '6em2Dxj',
  aura_women_band_hip_extension: 'wSScovH',
  aura_women_cable_crossover: 'UKWTJWR',
  aura_women_close_grip_lat_pulldown: 'rkg41Fb',
  aura_women_dumbbell_split_squat: 'qx4fgX7',
  aura_women_dumbbell_step_ups: 'aXtJhlg',
  aura_women_hack_squat: 'Qa55kX1',
  aura_women_hammer_curl: 'slDvUAU',
  aura_women_leg_press: '10Z2DXU',
  aura_women_one_arm_dumbbell_row: 'C0MA9bC',
  aura_women_overhead_crunch: 'kjJ3VoQ',
  aura_women_pallof_press: '9pa4H5m',
  aura_women_platform_hamstring_slide: 'LNE3wfo',
  aura_women_romanian_deadlift: 'wQ2c4XD',
  aura_women_rope_overhead_triceps_extension: '2IxROQ1',
  aura_women_rope_triceps_pushdown: 'dU605di',
  aura_women_smith_machine_squat: 'jFtipLl',
  aura_women_standing_calf_raise: 'ykUOVze',
  aura_women_thigh_abductor_machine: 'CHpahtl',
  aura_women_walking_lunge: 'IZVHb27',
  aura_women_wide_grip_lat_pulldown: 'LEprlgG',
})
const DO_NOT_AUTO_MATCH = new Set([
  'aura_women_barbell_hip_thrust', 'aura_women_cable_glute_kickback', 'aura_women_cable_rear_delt_fly',
  'aura_women_cable_wood_chop', 'aura_women_face_pull', 'aura_women_plank', 'aura_women_single_leg_glute_bridge',
  'aura_women_stomach_vacuum', 'aura_women_superman',
])
// ExerciseDB still returns the deprecated records below, but their media files
// are 404. These replacements are the nearest live variants with the same
// equipment, target muscle and movement pattern, verified on 2026-09-01.
const DEPRECATED_MEDIA_REPLACEMENTS = Object.freeze({
  XE93sQZ: '76vfTdU',
  pgIdT6i: 'km0sQC0',
  Ul5OFSV: 'Y1MsI1l',
  ntjtCfu: 'BCs0G2F',
  vN5HB0s: 'jpgqxiS',
  CUmLRTA: 'WW95auq',
  cuC7529: 'C31LMnP',
  '8gQo5Ss': 'XU3ePuv',
  tuIZFDt: 'h1ezqSu',
  LzX8YEz: 'qBcKorM',
})

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function slug(value) { return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 120) }
function unique(values) { return [...new Set(values.filter(Boolean))] }

function isAnimatedImageUrl(url, mimeType = '') {
  return /^image\/gif$/i.test(mimeType) || /\.(?:gif)(?:$|[?#])/i.test(url)
}

function parseArgs() {
  const result = { mode: 'dry-run' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--bucket=')) result.bucket = argument.slice(9)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else if (argument.startsWith('--python=')) result.python = argument.slice(9)
    else if (argument.startsWith('--only=')) result.onlyExerciseIds = argument.slice(7).split(',').filter(Boolean)
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
  if (!response.ok) throw new Error(`Google API request failed (${response.status}): ${raw.slice(0, 600)}`)
  return raw ? JSON.parse(raw) : null
}

async function nextAvailableRevision(token, exerciseId, initialRevision) {
  let revision = Math.max(1, initialRevision)
  for (let attempt = 0; attempt < 50; attempt += 1, revision += 1) {
    const response = await fetch(`${firestoreBase()}/documents/exercises/${exerciseId}/revisions/${revision}`, { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 404) return revision
    if (!response.ok) throw new Error(`Unable to inspect revision ${exerciseId}/${revision} (${response.status}).`)
  }
  throw new Error(`No safe revision slot found for ${exerciseId}.`)
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
  const payload = await requestJson(token, `${firestoreBase()}/documents:runQuery`, {
    method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], limit: 500 } }),
  })
  return (payload || []).flatMap((row) => row.document ? [{
    id: row.document.name.split('/').pop(),
    updateTime: row.document.updateTime,
    data: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  }] : [])
}

function loadExerciseDbSource() {
  if (!fs.existsSync(SOURCE_CACHE)) throw new Error('ExerciseDB source cache is missing. Run the curated ExerciseDB dry-run first.')
  const payload = JSON.parse(fs.readFileSync(SOURCE_CACHE, 'utf8'))
  if (!Array.isArray(payload.rows) || payload.rows.length < 1_000) throw new Error('ExerciseDB source cache is incomplete.')
  return payload.rows.filter((entry) => entry?.exerciseId && entry?.name && entry?.gifUrl)
}

// This sync is intentionally conservative: Free Exercise DB owns the
// exercise and still images. ExerciseDB V1 is used only to add a GIF when the
// names are an exact normalized match or an explicitly reviewed mapping.
const aliases = Object.freeze({ one: 'single' })

function nameTokens(value) {
  return unique(String(value || '').toLowerCase().replace(/\((?:female|male)\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .map((token) => aliases[token] || token).filter(Boolean))
}

function canonicalNameKey(value) {
  return nameTokens(value).map((token) => token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token).sort().join(' ')
}

function matchScore(leftValue, rightValue) {
  const left = nameTokens(leftValue)
  const right = nameTokens(rightValue)
  if (!left.length || !right.length) return 0
  const leftKey = left.slice().sort().join(' ')
  const rightKey = right.slice().sort().join(' ')
  if (leftKey === rightKey) return 1
  const rightSet = new Set(right)
  const shared = left.filter((token) => rightSet.has(token)).length
  const union = new Set([...left, ...right]).size
  const coverage = shared / Math.max(1, left.length)
  const jaccard = shared / Math.max(1, union)
  return Number((coverage * 0.7 + jaccard * 0.3).toFixed(4))
}

function bestSourceMatch(item, source) {
  // Do not attach a second provider to an ExerciseDB-owned fallback item.
  // Those records already use ExerciseDB because Free Exercise DB has no
  // reviewed equivalent; the sync only enriches canonical Free Exercise DB
  // records with optional GIF media.
  if (item.data.source?.provider !== 'free-exercise-db') return null
  const directId = item.data.externalMedia?.provider === 'exercisedb' ? item.data.externalMedia.exerciseId
    : item.data.source?.provider === 'exercisedb' ? item.data.source.sourceExerciseId : ''
  if (directId) {
    const direct = source.find((entry) => entry.exerciseId === directId)
    return direct ? { source: direct, score: 1, method: 'source-id' } : null
  }
  const verifiedId = VERIFIED_MATCHES[item.id]
  if (verifiedId) {
    const verified = source.find((entry) => entry.exerciseId === verifiedId)
    return verified ? { source: verified, score: 1, method: 'verified-map' } : null
  }
  if (DO_NOT_AUTO_MATCH.has(item.id)) return null
  const searchNames = unique([item.data.nameEn, item.data.source?.sourceExerciseId].map((value) => String(value || '').replace(/_/g, ' ')))
  const keys = new Set(searchNames.map(canonicalNameKey).filter(Boolean))
  const candidates = source.filter((candidate) => keys.has(canonicalNameKey(candidate.name)))
  if (!candidates.length) return null
  return { source: candidates[0], score: 1, method: 'exact-normalized-name' }
}

function legacyImages(item) {
  const media = item.data.media || {}
  const existing = Array.isArray(media.images) ? media.images.filter((image) => image?.id && image?.url && !String(image.id).startsWith('exercisedb-frame-')) : []
  if (existing.length) return existing
  return [
    media.startImageUrl ? { id: 'legacy-start', url: media.startImageUrl, role: 'start', order: 0, alt: 'Tư thế bắt đầu', mimeType: media.mimeType || 'image/jpeg' } : null,
    media.endImageUrl && media.endImageUrl !== media.startImageUrl ? { id: 'legacy-end', url: media.endImageUrl, role: 'end', order: 1, alt: 'Tư thế kết thúc', mimeType: media.mimeType || 'image/jpeg' } : null,
  ].filter(Boolean)
}

function buildPlan(catalog, source) {
  const targets = catalog.filter((item) => item.data.status === 'published' && item.data.source?.provider === 'free-exercise-db')
  const matched = []
  const unmatched = []
  const entries = []
  targets.forEach((target) => {
    const match = bestSourceMatch(target, source)
    if (match) {
      const entry = { target, ...match }
      matched.push(entry); entries.push(entry)
    } else {
      unmatched.push({ id: target.id, nameEn: target.data.nameEn || '', sourceExerciseId: target.data.source?.sourceExerciseId || '' })
      entries.push({ target, source: null, score: 0, method: 'stills-only' })
    }
  })
  const digest = sha256(JSON.stringify(entries.map((entry) => ({ id: entry.target.id, updateTime: entry.target.updateTime, exerciseId: entry.source?.exerciseId || '', gifUrl: entry.source?.gifUrl || '' }))))
  return { targets, entries, matched, unmatched, digest }
}

function pythonExecutable(args) {
  if (args.python) return args.python
  if (process.env.AURA_PYTHON) return process.env.AURA_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function exerciseDbRequest(pathname) {
  let response
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`https://oss.exercisedb.dev/api/v1${pathname}`, { headers: { Accept: 'application/json', 'User-Agent': 'AuraFitnessExerciseMediaSync/1.0' } })
    if (response.status !== 429) break
    await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)))
  }
  if (!response?.ok) throw new Error(`ExerciseDB item refresh failed (${response?.status || 'network'}).`)
  return response.json()
}

async function fetchGifBytes(url) {
  const response = await fetch(url, { headers: { Accept: 'image/gif', 'User-Agent': 'AuraFitnessExerciseMediaSync/1.0' } })
  if (!response.ok) return { status: response.status, bytes: null }
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) }
}

async function downloadGif(source, destination) {
  // The free API may return a rotating CDN URL. The V1 media endpoint keyed by
  // exerciseId is stable and is also what the refreshed item resolves to.
  const mediaExerciseId = DEPRECATED_MEDIA_REPLACEMENTS[source.exerciseId] || source.exerciseId
  let gifUrl = `https://static.exercisedb.dev/media/${encodeURIComponent(mediaExerciseId)}.gif`
  let result = await fetchGifBytes(gifUrl)
  if (result.status === 404 || result.status === 403) {
    const refreshed = await exerciseDbRequest(`/exercises/${encodeURIComponent(mediaExerciseId)}`)
    gifUrl = refreshed?.data?.gifUrl || ''
    if (!gifUrl) throw new Error(`ExerciseDB no longer exposes GIF media for ${source.exerciseId}.`)
    result = await fetchGifBytes(gifUrl)
  }
  if (!result.bytes) throw new Error(`ExerciseDB GIF download failed (${result.status}) for ${source.exerciseId}: ${gifUrl}`)
  const bytes = result.bytes
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error(`Unexpected ExerciseDB GIF size: ${bytes.length}.`)
  fs.writeFileSync(destination, bytes)
  return gifUrl
}

async function uploadBuffer(token, objectName, bytes, contentType) {
  const encodedBucket = encodeURIComponent(TARGET.bucket)
  const encodedName = encodeURIComponent(objectName)
  let response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodedBucket}/o?uploadType=media&name=${encodedName}&ifGenerationMatch=0`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body: bytes,
  })
  if (response.status === 412) response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodedBucket}/o/${encodedName}`, { headers: { Authorization: `Bearer ${token}` } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}) for ${objectName}: ${raw.slice(0, 400)}`)
  const object = JSON.parse(raw)
  const existingToken = String(object.metadata?.firebaseStorageDownloadTokens || '').split(',').find(Boolean)
  const downloadToken = existingToken || crypto.randomUUID()
  if (!existingToken) {
    await requestJson(token, `https://storage.googleapis.com/storage/v1/b/${encodedBucket}/o/${encodedName}`, {
      method: 'PATCH', body: JSON.stringify({ metadata: { ...(object.metadata || {}), firebaseStorageDownloadTokens: downloadToken, source: SOURCE_ATTRIBUTION, release: RELEASE } }),
    })
  }
  return `https://firebasestorage.googleapis.com/v0/b/${TARGET.bucket}/o/${encodedName}?alt=media&token=${downloadToken}`
}

async function prepareSourceMedia(token, source, args, temporaryRoot) {
  const sourceDirectory = path.join(temporaryRoot, slug(source.exerciseId))
  fs.mkdirSync(sourceDirectory, { recursive: true })
  const gifPath = path.join(sourceDirectory, 'animation.gif')
  const startPath = path.join(sourceDirectory, 'start.webp')
  const endPath = path.join(sourceDirectory, 'end.webp')
  const gifUrl = await downloadGif(source, gifPath)
  const extraction = spawnSync(pythonExecutable(args), [FRAME_SCRIPT, gifPath, startPath, endPath], { encoding: 'utf8' })
  if (extraction.status !== 0) throw new Error(`Frame extraction failed for ${source.exerciseId}: ${(extraction.stderr || extraction.stdout || '').trim()}`)
  const prefix = `exercise-catalog/exercisedb/${slug(source.exerciseId)}`
  const [startUrl, endUrl] = await Promise.all([
    uploadBuffer(token, `${prefix}/start.webp`, fs.readFileSync(startPath), 'image/webp'),
    uploadBuffer(token, `${prefix}/end.webp`, fs.readFileSync(endPath), 'image/webp'),
  ])
  return { startUrl, endUrl, gifUrl }
}

function mergedMedia(entry, prepared) {
  const current = entry.target.data.media || {}
  // Do not preserve a legacy copy of the provider GIF as a still image. The
  // GIF remains in videos; the extracted WebP frames are the canonical stills.
  const existingImages = legacyImages(entry.target).filter((image) => !isAnimatedImageUrl(image.url, image.mimeType))
  const generatedImages = [
    { id: `exercisedb-frame-${entry.source.exerciseId}-start`, url: prepared.startUrl, storagePath: `exercise-catalog/exercisedb/${slug(entry.source.exerciseId)}/start.webp`, role: existingImages.length ? 'detail' : 'start', order: existingImages.length, alt: `Tư thế bắt đầu · ${entry.target.data.nameVi || entry.source.name}`, mimeType: 'image/webp' },
    { id: `exercisedb-frame-${entry.source.exerciseId}-end`, url: prepared.endUrl, storagePath: `exercise-catalog/exercisedb/${slug(entry.source.exerciseId)}/end.webp`, role: existingImages.length ? 'detail' : 'end', order: existingImages.length + 1, alt: `Tư thế kết thúc · ${entry.target.data.nameVi || entry.source.name}`, mimeType: 'image/webp' },
  ]
  const images = [...existingImages, ...generatedImages].map((image, order) => ({ ...image, order }))
  const existingVideos = Array.isArray(current.videos) ? current.videos.filter((video) => !(video?.provider === 'exercisedb' && video?.externalId === entry.source.exerciseId)) : []
  const gif = {
    id: `exercisedb-${entry.source.exerciseId}`, provider: 'exercisedb', externalId: entry.source.exerciseId,
    url: prepared.gifUrl, posterUrl: prepared.startUrl, tag: 'animation', presenter: /\(female\)/i.test(entry.source.name) ? 'female' : 'neutral', format: 'gif', isPrimary: existingVideos.length === 0,
  }
  const first = images.find((image) => image.role === 'start') || images[0]
  const end = images.find((image) => image.role === 'end') || images[images.length - 1]
  return {
    ...current, images, videos: [...existingVideos, gif], startImageUrl: first?.url || prepared.startUrl,
    endImageUrl: end?.url || prepared.endUrl, posterUrl: current.posterUrl || first?.url || prepared.startUrl,
    posterImageId: current.posterImageId || first?.id || '', animationUrl: prepared.gifUrl,
    mimeType: first?.mimeType || 'image/webp',
  }
}

function normalizedStillsOnlyMedia(entry, unavailableExerciseDbId = '') {
  const current = entry.target.data.media || {}
  const images = legacyImages(entry.target).map((image, order) => ({ ...image, order }))
  const first = images.find((image) => image.role === 'start') || images[0]
  const end = images.find((image) => image.role === 'end') || images[images.length - 1]
  const videos = Array.isArray(current.videos) ? current.videos.filter((video) => !(unavailableExerciseDbId && video?.provider === 'exercisedb' && video?.externalId === unavailableExerciseDbId)) : []
  return {
    ...current, images, videos, startImageUrl: first?.url || '', endImageUrl: end?.url || '', posterUrl: first?.url || '',
    posterImageId: first?.id || '', ...(unavailableExerciseDbId ? { animationUrl: '' } : {}),
  }
}

async function commitEntries(token, entries, preparedBySource) {
  let updated = 0
  for (let offset = 0; offset < entries.length; offset += 100) {
    const writes = []
    const page = entries.slice(offset, offset + 100)
    const revisionById = new Map(await Promise.all(page.map(async (entry) => [
      entry.target.id,
      await nextAvailableRevision(token, entry.target.id, Number(entry.target.data.revision || 1) + 1),
    ])))
    for (const entry of page) {
      const prepared = entry.source ? preparedBySource.get(entry.source.exerciseId) : null
      const media = entry.source && prepared ? mergedMedia(entry, prepared) : normalizedStillsOnlyMedia(entry, entry.source?.exerciseId || '')
      const revision = revisionById.get(entry.target.id)
      const sourceAttribution = entry.source && prepared ? unique([entry.target.data.sourceAttribution, SOURCE_ATTRIBUTION]).join(' · ') : entry.target.data.sourceAttribution
      const fields = {
        media, sourceAttribution, revision, updatedBy: RELEASE,
        ...(entry.source ? { externalMedia: prepared ? { provider: 'exercisedb', exerciseId: entry.source.exerciseId, syncedAt: new Date().toISOString().slice(0, 10) } : null } : {}),
      }
      const root = `${resourceBase()}/documents/exercises/${entry.target.id}`
      writes.push({ update: { name: root, fields: encodeFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { updateTime: entry.target.updateTime } })
      writes.push({ transform: { document: root, fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }, currentDocument: { exists: true } })
      writes.push({ update: { name: `${root}/revisions/${revision}`, fields: encodeFields({ ...entry.target.data, ...fields, exerciseId: entry.target.id, revisionType: 'media_sync', createdBy: RELEASE }) }, currentDocument: { exists: false } })
    }
    await requestJson(token, `${firestoreBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
    updated += page.length
  }
  const migrationRoot = `${resourceBase()}/documents/systemMigrations/${RELEASE}`
  await requestJson(token, `${firestoreBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [
    { update: { name: migrationRoot, fields: encodeFields({ release: RELEASE, updatedExercises: updated, sourceMediaCount: preparedBySource.size, status: 'complete' }) } },
    { transform: { document: migrationRoot, fieldTransforms: [{ fieldPath: 'completedAt', setToServerValue: 'REQUEST_TIME' }] }, currentDocument: { exists: true } },
  ] }) })
  return updated
}

async function commitSelectedEntries(token, entries, preparedBySource) {
  if (!entries.length) return 0
  return commitEntries(token, entries, preparedBySource)
}

function verification(catalog) {
  const target = catalog.filter((item) => item.data.status === 'published' && ['exercisedb', 'free-exercise-db'].includes(item.data.source?.provider))
  const canonical = target.filter((item) => item.data.source?.provider === 'free-exercise-db')
  const supplemental = target.filter((item) => item.data.source?.provider === 'exercisedb')
  const withImageGallery = target.filter((item) => Array.isArray(item.data.media?.images) && item.data.media.images.length >= 2)
  const withExerciseDbGif = target.filter((item) => Array.isArray(item.data.media?.videos) && item.data.media.videos.some((video) => video.provider === 'exercisedb' && video.format === 'gif'))
  const incompleteExerciseDb = supplemental.filter((item) => !withImageGallery.includes(item) || !withExerciseDbGif.includes(item))
  return {
    targetCount: target.length, imageGalleryCount: withImageGallery.length, exerciseDbGifCount: withExerciseDbGif.length,
    canonicalTargetCount: canonical.length,
    canonicalWithExerciseDbGifCount: canonical.filter((item) => withExerciseDbGif.includes(item)).length,
    canonicalWithoutExerciseDbGifCount: canonical.filter((item) => !withExerciseDbGif.includes(item)).length,
    exerciseDbItemCount: supplemental.length, incompleteExerciseDb: incompleteExerciseDb.map((item) => item.id),
    missingImageGallery: target.filter((item) => !withImageGallery.includes(item)).map((item) => item.id),
  }
}

async function main() {
  const args = parseArgs()
  const token = await accessToken()
  const catalog = await loadCatalog(token)
  const source = loadExerciseDbSource()
  const plan = buildPlan(catalog, source)
  const onlyExerciseIds = new Set(args.onlyExerciseIds || [])
  const selectedEntries = onlyExerciseIds.size ? plan.entries.filter((entry) => onlyExerciseIds.has(entry.source?.exerciseId)) : plan.entries
  const selectedMatched = selectedEntries.filter((entry) => entry.source)
  const report = {
    schemaVersion: 1, release: RELEASE, mode: args.mode, targetCount: plan.targets.length, matchedCount: plan.matched.length,
    unmatchedCount: plan.unmatched.length, unmatched: plan.unmatched,
    sourceMediaCount: new Set(plan.matched.map((entry) => entry.source.exerciseId)).size, planDigest: plan.digest, writesPerformed: false,
    // Keep the report compatible with the older `name` label while exposing
    // the actual matching method used by the conservative media resolver.
    nameMatches: plan.matched.filter((entry) => entry.method === 'exact-normalized-name' || entry.method === 'name').map((entry) => ({
      id: entry.target.id, exerciseId: entry.source.exerciseId, sourceName: entry.source.name, score: entry.score, method: entry.method,
    })),
  }
  if (args.mode === 'apply') {
    if (args.digest !== plan.digest) throw new Error('Live plan digest no longer matches the approved dry run.')
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-exercise-media-'))
    try {
      const preparedBySource = new Map()
      const distinctSources = [...new Map(selectedMatched.map((entry) => [entry.source.exerciseId, entry.source])).values()]
      const unavailableMedia = []
      for (const [index, sourceItem] of distinctSources.entries()) {
        try { preparedBySource.set(sourceItem.exerciseId, await prepareSourceMedia(token, sourceItem, args, temporaryRoot)) }
        catch (error) { unavailableMedia.push({ exerciseId: sourceItem.exerciseId, name: sourceItem.name, reason: error.message }) }
        process.stdout.write(`Prepared ${index + 1}/${distinctSources.length}: ${sourceItem.name}${preparedBySource.has(sourceItem.exerciseId) ? '' : ' · unavailable'}\n`)
      }
      report.unavailableMedia = unavailableMedia
      report.preparedSourceMedia = preparedBySource.size
      report.updatedExercises = await commitSelectedEntries(token, selectedEntries, preparedBySource)
      report.writesPerformed = true
    } finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }) }
  }
  if (args.mode === 'verify') Object.assign(report, verification(catalog))
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { RELEASE, buildPlan, matchScore, nameTokens, verification }
