'use strict'

/**
 * Idempotent, target-only migration for legacy progress-photo base64 values.
 *
 * apply never removes legacy values. It uploads checksum-addressed objects and
 * adds an `images` metadata array that Student 360 can exchange for short-lived
 * signed URLs. Cleanup is intentionally a separate release after verify and
 * all learner photo readers have moved to Storage metadata.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { deleteApp, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  storageBucket: 'gen-lang-client-0815966909.firebasestorage.app',
})
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:migrate-student360-progress-photos`
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const REPORT_PATH = path.join(PRIVATE_DIRECTORY, 'student360-progress-photo-migration.json')
const USAGE = [
  'Usage:',
  '  node scripts/firebase-student360-photo-migration.cjs dry-run',
  `  node scripts/firebase-student360-photo-migration.cjs apply --digest=<dry-run-sha256> --confirm=${CONFIRMATION}`,
  '  node scripts/firebase-student360-photo-migration.cjs verify --digest=<apply-sha256>',
].join('\n')

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function parseArguments(argv) {
  const mode = argv[0] || 'dry-run'
  const flags = Object.fromEntries(argv.slice(1).map((value) => {
    if (!value.startsWith('--') || !value.includes('=')) throw new Error(USAGE)
    const split = value.indexOf('=')
    return [value.slice(2, split), value.slice(split + 1)]
  }))
  if (!['dry-run', 'apply', 'verify'].includes(mode)) throw new Error(USAGE)
  if (mode !== 'dry-run' && !/^[a-f0-9]{64}$/.test(flags.digest || '')) throw new Error(`Mode ${mode} requires --digest.\n${USAGE}`)
  if (mode === 'apply' && flags.confirm !== CONFIRMATION) throw new Error(`Production confirmation is missing.\n${USAGE}`)
  return { mode, flags }
}

function firebaseCliAuth() {
  const candidates = []
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  try { candidates.push(require.resolve('firebase-tools/lib/auth.js')) } catch { /* global CLI is supported */ }
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!modulePath) throw new Error('Firebase CLI is required and must be signed in.')
  return require(modulePath)
}

async function accessToken() {
  const auth = firebaseCliAuth()
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function dataAsset(value, documentPath, source, index) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return null
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) return { invalid: true, documentPath, source, index, reason: 'unsupported_data_url' }
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64')
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return { invalid: true, documentPath, source, index, reason: 'invalid_size' }
  const checksum = sha256(buffer)
  const ownerUid = documentPath.split('/')[1]
  const photoId = documentPath.split('/').pop().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)
  const extension = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg'
  return {
    invalid: false,
    documentPath,
    ownerUid,
    source,
    index,
    checksum,
    contentType: match[1],
    buffer,
    storagePath: `users/${ownerUid}/progress-photos/legacy-${photoId}-${index}-${checksum.slice(0, 16)}.${extension}`,
  }
}

function assetsFromDocument(document) {
  const value = document.data() || {}
  const candidates = [
    ...(Array.isArray(value.photos) ? value.photos.map((item, index) => ({ item, source: 'photos', index })) : []),
    ...(Array.isArray(value.images) ? value.images.map((item, index) => ({ item: typeof item === 'string' ? item : item?.url, source: 'images', index })) : []),
    ...(!Array.isArray(value.photos) && !Array.isArray(value.images) && value.imageUrl ? [{ item: value.imageUrl, source: 'imageUrl', index: 0 }] : []),
  ]
  const unique = new Map()
  candidates.forEach(({ item, source, index }) => {
    const asset = dataAsset(item, document.ref.path, source, index)
    if (!asset) return
    const key = asset.invalid ? `${source}:${index}` : asset.checksum
    if (!unique.has(key)) unique.set(key, asset)
  })
  return [...unique.values()]
}

async function scan(db) {
  const snapshots = await Promise.all(['progress_photos', 'progressPhotos'].map((name) => db.collectionGroup(name).get()))
  const documents = snapshots.flatMap((snapshot) => snapshot.docs)
  const assets = documents.flatMap(assetsFromDocument)
  const valid = assets.filter((item) => !item.invalid).sort((left, right) => `${left.documentPath}:${left.checksum}`.localeCompare(`${right.documentPath}:${right.checksum}`))
  const invalid = assets.filter((item) => item.invalid)
  const planDigest = sha256(JSON.stringify(valid.map((item) => ({ documentPath: item.documentPath, checksum: item.checksum, storagePath: item.storagePath }))))
  return { documents, valid, invalid, planDigest }
}

function writeReport(value) {
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function publicReport(mode, scanResult, extra = {}) {
  return {
    mode,
    target: TARGET,
    generatedAt: new Date().toISOString(),
    planDigest: scanResult.planDigest,
    scannedDocuments: scanResult.documents.length,
    migratableAssets: scanResult.valid.length,
    invalidAssets: scanResult.invalid.length,
    uniqueOwners: new Set(scanResult.valid.map((item) => item.ownerUid)).size,
    totalBytes: scanResult.valid.reduce((sum, item) => sum + item.buffer.length, 0),
    ...extra,
  }
}

async function applyMigration(db, bucket, scanResult) {
  const byDocument = new Map()
  let uploaded = 0
  let reused = 0
  for (const asset of scanResult.valid) {
    const file = bucket.file(asset.storagePath)
    const [exists] = await file.exists()
    if (!exists) {
      await file.save(asset.buffer, { resumable: false, contentType: asset.contentType, metadata: { metadata: { ownerUid: asset.ownerUid, resourceKind: 'progress-photo', checksum: asset.checksum, migratedBy: 'student360-v1' } } })
      uploaded += 1
    } else {
      const [metadata] = await file.getMetadata()
      if (metadata.metadata?.checksum !== asset.checksum) throw new Error(`Checksum metadata mismatch at ${asset.storagePath}.`)
      reused += 1
    }
    const list = byDocument.get(asset.documentPath) || []
    list.push({ storagePath: asset.storagePath, checksum: asset.checksum, contentType: asset.contentType, legacySource: asset.source, legacyIndex: asset.index })
    byDocument.set(asset.documentPath, list)
  }
  for (const [documentPath, images] of byDocument) {
    const current = (await db.doc(documentPath).get()).data() || {}
    const existing = Array.isArray(current.images) ? current.images.filter((item) => item && typeof item === 'object' && item.storagePath) : []
    const merged = [...new Map([...existing, ...images].map((item) => [item.checksum || item.storagePath, item])).values()]
    await db.doc(documentPath).set({ images: merged, schemaVersion: 2, progressPhotoMigration: { status: 'dual-read', assetCount: images.length, verifiedAt: null, updatedAt: new Date().toISOString() } }, { merge: true })
  }
  return { uploaded, reused, updatedDocuments: byDocument.size, legacyValuesRemoved: 0 }
}

async function verifyMigration(db, bucket, scanResult) {
  let verified = 0
  const failures = []
  for (const asset of scanResult.valid) {
    const snapshot = await db.doc(asset.documentPath).get()
    const images = Array.isArray(snapshot.data()?.images) ? snapshot.data().images : []
    const metadataEntry = images.find((item) => item?.storagePath === asset.storagePath && item?.checksum === asset.checksum)
    const [exists] = await bucket.file(asset.storagePath).exists()
    if (!metadataEntry || !exists) failures.push(sha256(`${asset.documentPath}:${asset.storagePath}`).slice(0, 16))
    else verified += 1
  }
  return { verified, failureCount: failures.length, failureRefs: failures, legacyValuesRemoved: 0 }
}

async function main() {
  const { mode, flags } = parseArguments(process.argv.slice(2))
  const token = await accessToken()
  const app = initializeApp({ projectId: TARGET.projectId, storageBucket: TARGET.storageBucket, credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) } }, `student360-photo-${Date.now()}`)
  try {
    const db = getFirestore(app, TARGET.databaseId)
    const bucket = getStorage(app).bucket(TARGET.storageBucket)
    const result = await scan(db)
    if (mode !== 'dry-run' && result.planDigest !== flags.digest) throw new Error('Live photo plan changed after approval; run dry-run again.')
    const details = mode === 'apply' ? await applyMigration(db, bucket, result) : mode === 'verify' ? await verifyMigration(db, bucket, result) : { writesPerformed: false, legacyValuesRemoved: 0 }
    if (mode === 'verify' && details.failureCount) throw new Error(`Verification failed for ${details.failureCount} assets.`)
    const report = publicReport(mode, result, details)
    writeReport(report)
    console.log(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2))
  } finally {
    await deleteApp(app)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
