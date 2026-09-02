'use strict'

// Safe release plan for the learner exercise library.
//
// Free Exercise DB remains the canonical source for names, still images and
// source instructions. ExerciseDB V1 records are retained in Firestore as
// archived fallback data only; the media sync may add a GIF to a canonical
// record when an exact/approved match exists.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { targetGroup, scoreExercise } = require('./import-free-exercise-catalog.cjs')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RELEASE = 'free-exercise-catalog-120-v1'
const CONFIRMATION = 'ARCHIVE_EDB_AND_PUBLISH_FREE_2026_V1'
const TARGET_CANONICAL_COUNT = 120
const SOURCE_REPO = 'https://github.com/yuhonas/free-exercise-db'
const SOURCE_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const SOURCE_MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const SOURCE_CACHE = path.resolve('.migration-private', 'free-exercise-db-source.json')
const REPORT = path.resolve('.migration-private', 'free-exercise-catalog-release-report.json')

const groupVi = Object.freeze({
  glutes: 'Mông', legs: 'Chân', core: 'Core', back: 'Lưng', upper: 'Thân trên', mobility: 'Vận động & giãn cơ',
})

const muscleVi = Object.freeze({
  abdominals: 'Cơ bụng', abs: 'Cơ bụng', abductors: 'Cơ dạng hông', adductors: 'Cơ khép đùi', biceps: 'Tay trước',
  calves: 'Bắp chân', chest: 'Ngực', deltoids: 'Vai', delts: 'Vai', glutes: 'Mông', hamstrings: 'Đùi sau',
  lats: 'Cơ xô', lower_back: 'Lưng dưới', middle_back: 'Lưng giữa', neck: 'Cổ', pectorals: 'Ngực', quadriceps: 'Đùi trước',
  quads: 'Đùi trước', shoulders: 'Vai', traps: 'Cơ thang', triceps: 'Tay sau', forearms: 'Cẳng tay', hip_flexors: 'Cơ gập hông',
})

const equipmentVi = Object.freeze({
  'body only': 'Trọng lượng cơ thể', dumbbell: 'Tạ đơn', barbell: 'Tạ đòn', cable: 'Máy cáp', machine: 'Máy tập',
  bands: 'Dây kháng lực', band: 'Dây kháng lực', kettlebells: 'Tạ chuông', 'exercise ball': 'Bóng tập', 'foam roll': 'Con lăn',
})

// These movements are valid Free Exercise DB rows but are not appropriate for
// a first women-focused learner catalog (high-risk/technical or non-training
// drills). They remain available in the source cache and are not deleted.
const excludedMovement = /(olympic|clean|snatch|jerk|muscle\s*up|windmill|spell\s*caster|landmine|jump|hop|sprint|drag|stone|bicycl|treadmill|elliptical|conan|smr|wrist|neck|foot|ankle|tibial|balance board|turkish|pistol|behind the neck|heavy bag|throw|judo|inchworm|anti-gravity|calf-machine|cable incline pushdown)/i

// The first release intentionally favours the movements most useful to Aura's
// women-focused programmes: mông/đùi first, then core and posture, with a
// small amount of upper-body balance. These quotas add up to the 50 new
// records needed to extend the existing 70 canonical records to 120.
const selectionQuotas = Object.freeze({ glutes: 18, legs: 14, core: 12, back: 4, upper: 2 })

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function slug(value) { return String(value || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 120) }
function unique(values) { return [...new Set(values.filter(Boolean))] }
function text(value) { return String(value || '').trim() }

function parseArgs() {
  const result = { mode: 'dry-run' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else if (argument === '--refresh-source') result.refreshSource = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  })
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode === 'apply') {
    if (result.projectId !== TARGET.projectId || result.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact approved production target.')
    if (result.confirm !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
    if (!/^[a-f0-9]{64}$/.test(result.digest || '')) throw new Error('Apply requires the dry-run plan digest.')
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
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}: ${raw.slice(0, 500)}`)
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
function encodeFields(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) }

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

async function loadCatalog(token) {
  const payload = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'exercises' }], limit: 500 } }) })
  return (payload || []).flatMap((row) => row.document ? [{
    id: row.document.name.split('/').pop(), updateTime: row.document.updateTime,
    data: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  }] : [])
}

async function loadSource(refresh = false) {
  if (!refresh && fs.existsSync(SOURCE_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(SOURCE_CACHE, 'utf8'))
    if (Array.isArray(cached) && cached.length >= 800) return { raw: JSON.stringify(cached), rows: cached }
  }
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Free Exercise DB source failed (${response.status}).`)
  const raw = await response.text()
  const rows = JSON.parse(raw)
  if (!Array.isArray(rows) || rows.length < 800) throw new Error(`Free Exercise DB source is incomplete (${rows?.length || 0}).`)
  fs.mkdirSync(path.dirname(SOURCE_CACHE), { recursive: true })
  fs.writeFileSync(SOURCE_CACHE, raw)
  return { raw, rows }
}

function translateMuscles(values) {
  return unique((Array.isArray(values) ? values : []).map((value) => muscleVi[String(value).toLowerCase()] || text(value)).filter(Boolean))
}

function translateEquipment(value) {
  const raw = Array.isArray(value) ? value : [value]
  return unique(raw.map((item) => equipmentVi[String(item).toLowerCase()] || text(item)).filter(Boolean))
}

function translateName(name) {
  const source = text(name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\s+with\s+/gi, ' với ').trim()
  const knownNames = Object.freeze({
    'Flutter Kicks': 'Đá chân luân phiên', 'Leg Lift': 'Nâng chân', 'Air Bike': 'Đạp xe trên không',
    'Alternate Heel Touchers': 'Chạm gót luân phiên', 'Alternating Floor Press': 'Đẩy ngực sàn luân phiên',
    'Barbell Side Bend': 'Nghiêng thân với tạ đòn', 'Bent Knee Hip Raise': 'Nâng hông gập gối',
    'Bottoms Up': 'Nâng hông', 'Butt Ups': 'Nâng hông kiểu mông', '90 90 Hamstring': 'Giãn đùi sau 90/90',
    'Back Flyes With Bands': 'Mở lưng với dây kháng lực', 'Band Pull Apart': 'Kéo mở dây kháng lực',
    'Barbell Rear Delt Row': 'Kéo vai sau với tạ đòn', 'Barbell Shrug': 'Nhún vai với tạ đòn',
    'Barbell Shrug Behind The Back': 'Nhún vai sau lưng với tạ đòn', 'Hip Flexion with Band': 'Gập hông với dây kháng lực',
    'Bosu Ball Cable Crunch With Side Bends': 'Gập bụng nghiêng với cáp trên bóng Bosu',
    'Cable Russian Twists': 'Xoay bụng với cáp', 'Cable Seated Crunch': 'Gập bụng ngồi với cáp',
    Cocoons: 'Gập bụng cuộn người', 'Alternate Incline Dumbbell Curl': 'Cuốn tay trước ghế dốc luân phiên với tạ đơn',
    'Alternating Cable Shoulder Press': 'Đẩy vai cáp luân phiên với cáp',
  })
  if (knownNames[source]) return knownNames[source]
  const lower = source.toLowerCase().replace(/\b(raises|curls|lunges|squats|deadlifts|crunches|rows|presses)\b/g, (word) => word.slice(0, -1))
  const modifiers = []
  if (/single[- ]?leg|one[- ]leg/i.test(lower)) modifiers.push('một chân')
  if (/one[- ]arm/i.test(lower)) modifiers.push('một tay')
  if (/alternate|alternating/i.test(lower)) modifiers.push('luân phiên')
  if (/seated/i.test(lower)) modifiers.push('ngồi')
  else if (/standing/i.test(lower)) modifiers.push('đứng')
  else if (/lying|prone|supine/i.test(lower)) modifiers.push('nằm')
  const base = lower.includes('hip thrust') ? 'Đẩy hông'
    : lower.includes('glute bridge') || lower.includes('butt lift') ? 'Cầu mông'
      : lower.includes('deadlift') || lower.includes('good morning') ? 'Deadlift'
        : lower.includes('squat') ? 'Squat'
          : lower.includes('lunge') ? 'Chùng chân'
            : lower.includes('step up') || lower.includes('step-up') ? 'Bước bục'
              : lower.includes('kickback') || lower.includes('hip extension') ? 'Đá mông'
                : lower.includes('abductor') || lower.includes('abduction') ? 'Dạng hông'
                  : lower.includes('adductor') || lower.includes('adduction') ? 'Khép hông'
                    : lower.includes('leg press') ? 'Đạp đùi'
                      : lower.includes('leg extension') ? 'Duỗi đùi trước'
                        : lower.includes('leg curl') ? 'Cuốn đùi sau'
                          : lower.includes('calf') ? 'Nhón bắp chân'
                            : lower.includes('pulldown') || lower.includes('pull up') || lower.includes('chin up') ? 'Kéo xô'
                              : lower.includes('row') ? 'Kéo lưng'
                                : lower.includes('shrug') ? 'Nhún vai'
                                  : lower.includes('shoulder press') || lower.includes('overhead press') ? 'Đẩy vai'
                                    : lower.includes('lateral raise') || lower.includes('deltoid raise') ? 'Nâng vai ngang'
                                      : lower.includes('front raise') ? 'Nâng vai trước'
                                        : lower.includes('bench press') || lower.includes('chest press') || lower.includes('push up') ? 'Đẩy ngực'
                                          : lower.includes('fly') ? 'Ép ngực'
                                            : lower.includes('triceps') || lower.includes('skull crusher') ? 'Duỗi tay sau'
                                              : lower.includes('curl') ? 'Cuốn tay trước'
                                                : lower.includes('crunch') || lower.includes('sit up') || lower.includes('leg lift') ? 'Gập bụng'
                                                  : lower.includes('plank') ? 'Plank'
                                                    : lower.includes('stretch') || lower.includes('circles') ? 'Giãn cơ'
                                                      : source
  const equipment = /dumbbell/i.test(lower) ? ' với tạ đơn' : /barbell/i.test(lower) ? ' với tạ đòn' : /cable|pulley/i.test(lower) ? ' với cáp' : /band/i.test(lower) ? ' với dây kháng lực' : ''
  const result = `${modifiers.join(' ')} ${base}${equipment}`.replace(/\s+/g, ' ').trim()
  return result.charAt(0).toLocaleUpperCase('vi') + result.slice(1)
}

function coaching(group, targetMuscles, equipment) {
  const target = targetMuscles.join(' và ') || groupVi[group]
  const tool = equipment.join(', ') || 'dụng cụ phù hợp'
  const byGroup = {
    glutes: [`Chuẩn bị ${tool} chắc chắn và đặt chân ở tư thế cân bằng.`, 'Siết bụng, giữ hông hướng thẳng và cột sống trung lập.', `Thực hiện chuyển động bằng ${target}, không dùng quán tính.`, 'Dừng ngắn ở điểm co cơ rồi trở về chậm, vẫn giữ kiểm soát.'],
    legs: [`Điều chỉnh ${tool} vừa tầm và đặt cả bàn chân vững trên sàn hoặc bàn đạp.`, 'Giữ gối cùng hướng mũi chân, bụng siết và thân người ổn định.', `Hạ hoặc gập chân có kiểm soát để cảm nhận ${target}.`, 'Đẩy đều qua bàn chân và không khóa khớp đột ngột.'],
    core: [`Vào tư thế với ${tool}, giữ lưng và xương chậu ở vị trí trung lập.`, 'Thở ra để siết bụng trước khi bắt đầu pha dùng lực.', `Di chuyển chậm từ thân giữa, không kéo bằng cổ hoặc dùng đà.`, 'Hạ về vị trí đầu có kiểm soát và dừng nếu xuất hiện đau nhói.'],
    back: [`Nắm ${tool} chắc, hạ vai khỏi tai và giữ thân người ổn định.`, 'Giữ cột sống trung lập, bắt đầu kéo bằng khuỷu tay.', `Kéo về phía thân để siết ${target}, không giật tải.`, 'Duỗi tay hoặc thả tải về chậm để giữ lực căng.'],
    upper: [`Chuẩn bị ${tool}, đặt chân vững và giữ cổ tay thẳng.`, 'Siết bụng, hạ vai và cố định cánh tay trên khi cần.', `Thực hiện pha dùng lực bằng ${target} với nhịp đều.`, 'Hạ tải chậm, không khóa khớp hoặc nảy người.'],
  }
  const instructionsVi = byGroup[group] || byGroup.upper
  return {
    instructionsVi,
    cuesVi: ['Giữ tư thế ổn định', 'Di chuyển chậm và có kiểm soát', 'Thở đều, không nín thở'],
    commonMistakesVi: ['Chọn mức tạ quá nặng', 'Dùng quán tính thay vì cơ mục tiêu', 'Tiếp tục khi xuất hiện đau nhói'],
    breathingVi: 'Hít vào khi hạ hoặc trở về; thở ra ở pha dùng lực chính.',
  }
}

function staticMedia(exercise) {
  const images = Array.isArray(exercise.images) ? exercise.images.filter(Boolean) : []
  const startPath = images[0]
  const endPath = images[1] || images[0]
  const url = (value) => `${SOURCE_MEDIA_BASE}${String(value || '').split('/').map(encodeURIComponent).join('/')}`
  const startImageUrl = url(startPath)
  const endImageUrl = url(endPath)
  return {
    startImageUrl, endImageUrl, posterUrl: startImageUrl, animationUrl: '', mimeType: 'image/jpeg', checksum: '',
    images: [
      { id: 'free-start', url: startImageUrl, role: 'start', order: 0, alt: 'Tư thế bắt đầu', mimeType: 'image/jpeg' },
      { id: 'free-end', url: endImageUrl, role: 'end', order: 1, alt: 'Tư thế kết thúc', mimeType: 'image/jpeg' },
    ], videos: [],
  }
}

function buildItem(exercise, index) {
  const group = targetGroup(exercise)
  const targetMuscles = translateMuscles(exercise.primaryMuscles)
  const secondaryMuscles = translateMuscles(exercise.secondaryMuscles)
  const equipment = translateEquipment(exercise.equipment || 'body only')
  const coachingContent = coaching(group, targetMuscles, equipment)
  const id = `fedb_release_2026_${slug(exercise.id)}`
  const item = {
    id, schemaVersion: 1, revision: 1, status: 'published', catalogRelease: RELEASE, sortPriority: 100 + index,
    popularForWomen: ['glutes', 'legs', 'core'].includes(group),
    nameVi: translateName(exercise.name), nameEn: text(exercise.name), aliasesVi: [], bodyParts: [groupVi[group] || 'Toàn thân'],
    targetMuscles: targetMuscles.length ? targetMuscles : [groupVi[group] || 'Toàn thân'], secondaryMuscles,
    equipment: equipment.length ? equipment : ['Trọng lượng cơ thể'],
    environment: String(exercise.equipment || '').toLowerCase() === 'body only' ? ['home', 'gym'] : ['gym'],
    difficulty: ['beginner', 'intermediate', 'advanced'].includes(exercise.level) ? exercise.level : 'beginner',
    goals: ['Săn chắc vóc dáng', 'Tăng sức mạnh', 'Kiểm soát kỹ thuật'], ...coachingContent,
    sourceInstructionsEn: (exercise.instructions || []).slice(0, 20), media: staticMedia(exercise),
    defaultPrescription: { sets: 3, reps: group === 'core' ? '10–15 hoặc 30–45 giây' : '10–12', restSeconds: group === 'glutes' || group === 'legs' ? 75 : 60, rpe: 7 },
    source: { provider: 'free-exercise-db', sourceExerciseId: exercise.id, sourceVersion: 'main-2026-09-02', license: 'Unlicense' },
    sourceAttribution: `Free Exercise DB · Unlicense · ${SOURCE_REPO}`,
  }
  return { ...item, contentDigest: sha256(JSON.stringify(item)) }
}

function selectAdditional(source, existingFree) {
  const needed = Math.max(0, TARGET_CANONICAL_COUNT - existingFree.length)
  if (needed === 0) return []
  const existingIds = new Set(existingFree.map((item) => item.data?.source?.sourceExerciseId).filter(Boolean))
  const sourceById = new Map(source.map((item) => [item.id, item]))
  const curated = source.filter((item) => item?.id && item?.name && Array.isArray(item.images) && item.images.length)
    .filter((item) => !existingIds.has(item.id) && !excludedMovement.test(item.name))
    .sort((a, b) => scoreExercise(b) - scoreExercise(a) || a.name.localeCompare(b.name))
  const selected = []
  for (const [group, quota] of Object.entries(selectionQuotas)) {
    for (const item of curated.filter((candidate) => targetGroup(candidate) === group)) {
      if (selected.filter((entry) => targetGroup(entry) === group).length >= quota) break
      if (selected.some((entry) => entry.id === item.id)) continue
      selected.push(item)
    }
  }
  if (selected.length !== needed) {
    const remaining = curated.filter((item) => !selected.some((entry) => entry.id === item.id))
    for (const item of remaining) {
      if (selected.length >= needed) break
      selected.push(item)
    }
  }
  if (selected.length !== needed) throw new Error(`Không đủ bài Free Exercise DB hợp lệ để đạt ${TARGET_CANONICAL_COUNT} bài canonical (chọn được ${selected.length}).`)
  // Keep this lookup in the plan code so a source refresh cannot silently make
  // a selected ID point to a missing record.
  if (selected.some((item) => !sourceById.has(item.id))) throw new Error('Selected Free Exercise DB row disappeared from source index.')
  return selected
}

function archiveData(document) {
  const current = { ...document.data }
  const archived = {
    ...current,
    status: 'archived',
    previousStatus: current.status || 'published',
    previousCatalogRelease: current.catalogRelease || '',
    catalogRelease: `${RELEASE}-archive`,
    archivedReason: 'Đã chuẩn hoá thư viện học viên về Free Exercise DB canonical; giữ lại để tra cứu/khôi phục.',
    archivedBy: RELEASE,
    contentDigest: sha256(JSON.stringify({ ...current, status: 'archived', catalogRelease: `${RELEASE}-archive` })),
  }
  return archived
}

function buildPlan(source, documents) {
  const freePublished = documents.filter((item) => item.data?.status === 'published' && item.data?.source?.provider === 'free-exercise-db')
  const edbPublished = documents.filter((item) => item.data?.status === 'published' && item.data?.source?.provider === 'exercisedb')
  if (freePublished.length > TARGET_CANONICAL_COUNT) throw new Error(`Safety stop: production đã có ${freePublished.length} canonical Free bài, vượt mục tiêu ${TARGET_CANONICAL_COUNT}.`)
  const selected = selectAdditional(source, freePublished)
  const items = selected.map((item, index) => buildItem(item, freePublished.length + index))
  const existing = new Map(documents.map((document) => [document.id, document]))
  const conflicts = items.filter((item) => existing.has(item.id) && existing.get(item.id).data.contentDigest !== item.contentDigest)
  if (conflicts.length) throw new Error(`Safety stop: ID release đã tồn tại khác dữ liệu: ${conflicts.map((item) => item.id).join(', ')}`)
  const create = items.filter((item) => !existing.has(item.id))
  const archive = edbPublished.map((document) => ({ ...document, next: archiveData(document), nextRevision: Math.max(2, Number(document.data?.revision || 1) + 1) }))
  const digestInput = {
    release: RELEASE,
    freePublished: freePublished.map(({ id, updateTime }) => ({ id, updateTime })),
    create: create.map(({ id, contentDigest, source }) => ({ id, contentDigest, sourceId: source.sourceExerciseId })),
    archive: archive.map(({ id, updateTime, data, nextRevision }) => ({ id, updateTime, revision: data.revision || 1, nextRevision })),
  }
  return { freePublished, edbPublished, selected, items, create, archive, digest: sha256(JSON.stringify(digestInput)) }
}

function validateRelease(plan) {
  if (plan.freePublished.length + plan.create.length !== TARGET_CANONICAL_COUNT) throw new Error('Release count is not exactly 120 canonical items.')
  for (const item of plan.items) {
    if (item.status !== 'published' || item.source.provider !== 'free-exercise-db') throw new Error(`Invalid source/status: ${item.id}`)
    if (!item.media.startImageUrl || !item.media.endImageUrl || item.media.images.length < 2) throw new Error(`Missing still image coverage: ${item.id}`)
    if (item.instructionsVi.length < 4 || item.cuesVi.length < 3 || item.commonMistakesVi.length < 3) throw new Error(`Missing coaching content: ${item.id}`)
    if (!item.nameVi || !item.targetMuscles.length || !item.equipment.length) throw new Error(`Missing identity/classification: ${item.id}`)
  }
}

function writesForPlan(plan) {
  const writes = []
  for (const item of plan.create) {
    const { id, ...fields } = item
    const root = `${resourceBase()}/documents/exercises/${id}`
    writes.push({ update: { name: root, fields: encodeFields(fields) }, currentDocument: { exists: false } })
    writes.push({ update: { name: `${root}/revisions/1`, fields: encodeFields({ ...fields, exerciseId: id, revision: 1, revisionType: 'catalog_import', createdBy: RELEASE }) }, currentDocument: { exists: false } })
  }
  for (const document of plan.archive) {
    const root = `${resourceBase()}/documents/exercises/${document.id}`
    writes.push({ update: { name: root, fields: encodeFields(document.next) }, currentDocument: { updateTime: document.updateTime } })
    writes.push({ update: { name: `${root}/revisions/${document.nextRevision}`, fields: encodeFields({ ...document.next, exerciseId: document.id, revision: document.nextRevision, revisionType: 'catalog_archive', createdBy: RELEASE }) }, currentDocument: { exists: false } })
  }
  if (writes.length > 450) throw new Error(`Safety stop: ${writes.length} Firestore writes exceeds the release limit.`)
  return writes
}

async function main() {
  const args = parseArgs()
  const { raw, rows: source } = await loadSource(args.refreshSource)
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Connected database is not the approved target.')
  const documents = await loadCatalog(token)
  const plan = buildPlan(source, documents)
  validateRelease(plan)
  const report = {
    schemaVersion: 1, release: RELEASE, mode: args.mode, sourceUrl: SOURCE_URL, sourceCount: source.length, sourceDigest: sha256(raw),
    currentPublished: documents.filter((document) => document.data?.status === 'published').length,
    currentFreeCanonical: plan.freePublished.length, currentExerciseDbFallback: plan.edbPublished.length,
    targetPublished: TARGET_CANONICAL_COUNT, selectedNewCanonical: plan.create.length, archiveExerciseDb: plan.archive.length,
    selected: plan.items.map((item) => ({ id: item.id, nameVi: item.nameVi, nameEn: item.nameEn, group: item.bodyParts[0], sourceExerciseId: item.source.sourceExerciseId, stillImages: item.media.images.length })),
    planDigest: plan.digest, writesPerformed: false,
  }
  if (args.mode === 'apply') {
    if (args.digest !== plan.digest) throw new Error('Live release plan digest no longer matches the approved dry run.')
    const writes = writesForPlan(plan)
    await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
    report.writeCount = writes.length
    report.writesPerformed = true
  }
  const after = args.mode === 'apply' ? await loadCatalog(token) : documents
  report.afterPublished = after.filter((document) => document.data?.status === 'published').length
  report.afterFreeCanonical = after.filter((document) => document.data?.status === 'published' && document.data?.source?.provider === 'free-exercise-db').length
  report.afterExerciseDbFallback = after.filter((document) => document.data?.status === 'published' && document.data?.source?.provider === 'exercisedb').length
  report.archivedExerciseDb = after.filter((document) => document.data?.status === 'archived' && document.data?.source?.provider === 'exercisedb').length
  report.allSelectedPresent = plan.items.every((item) => after.some((document) => document.id === item.id && document.data?.status === 'published' && document.data?.contentDigest === item.contentDigest))
  if (args.mode === 'verify' && (!report.allSelectedPresent || report.afterFreeCanonical !== TARGET_CANONICAL_COUNT || report.afterExerciseDbFallback !== 0)) process.exitCode = 2
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })

module.exports = { RELEASE, CONFIRMATION, TARGET_CANONICAL_COUNT, buildItem, selectAdditional, validateRelease, buildPlan, translateName, coaching }
