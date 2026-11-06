'use strict'

const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const RESOURCE_COLLECTION = 'operatingKnowledge'
const AUDIT_COLLECTION = 'sopAuditLogs'
const DEFAULT_DATABASE_ID = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const execFileAsync = promisify(execFile)

function argValue(name) {
  const inline = process.argv.find((item) => item.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : null
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function versionId(resource) {
  return resource.publishedVersionId || `migration-${String(resource.version || '1').replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

let cachedGcloudToken = null
let gcloudTokenExpiresAt = 0

async function gcloudAccessToken() {
  if (cachedGcloudToken && gcloudTokenExpiresAt > Date.now() + 60_000) return cachedGcloudToken
  const command = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token --quiet']]
    : ['gcloud', ['auth', 'print-access-token', '--quiet']]
  const { stdout } = await execFileAsync(command[0], command[1], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024,
  })
  const token = stdout.trim()
  if (!token) throw new Error('Không lấy được access token từ gcloud.')
  cachedGcloudToken = token
  gcloudTokenExpiresAt = Date.now() + 50 * 60 * 1000
  return cachedGcloudToken
}

function firestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Catalog chứa giá trị số không hợp lệ.')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'object') return { mapValue: { fields: firestoreFields(value) } }
  throw new Error(`Catalog chứa kiểu dữ liệu không được hỗ trợ: ${typeof value}`)
}

function firestoreFields(record) {
  return Object.fromEntries(Object.entries(record)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, firestoreValue(value)]))
}

function migrationDocuments(resource, catalog) {
  const publishedVersionId = versionId(resource)
  const importedAt = new Date(resource.updatedAt || catalog.generatedAt)
  if (Number.isNaN(importedAt.getTime())) throw new Error(`Ngày cập nhật không hợp lệ: ${resource.id}`)
  return [
    {
      path: `${RESOURCE_COLLECTION}/${resource.id}`,
      data: {
        ...resource,
        publishedVersionId,
        updatedAt: importedAt,
        createdAt: importedAt,
        createdBy: 'migration:sop-aura-v1',
        migrationBatchId: catalog.source.migrationBatchId,
        migrationDigest: digest(resource),
      },
    },
    {
      path: `${RESOURCE_COLLECTION}/${resource.id}/versions/${publishedVersionId}`,
      data: {
        resourceId: resource.id,
        versionId: publishedVersionId,
        version: resource.version,
        revision: resource.revision,
        status: resource.status,
        note: 'Nhập có kiểm soát từ SOP aura',
        contentHash: digest({
          kind: resource.kind,
          code: resource.code,
          title: resource.title,
          summary: resource.summary,
          ownerRole: resource.ownerRole,
          audiences: resource.audiences,
          branchScope: resource.branchScope,
          tags: resource.tags,
          payload: resource.payload,
        }),
        createdAt: importedAt,
        createdBy: 'migration:sop-aura-v1',
        snapshot: resource,
        migrationBatchId: catalog.source.migrationBatchId,
      },
    },
    {
      path: `${AUDIT_COLLECTION}/${resource.id}__${publishedVersionId}`,
      data: {
        schemaVersion: 1,
        resourceId: resource.id,
        resourceKind: resource.kind,
        revision: resource.revision,
        versionId: publishedVersionId,
        action: 'migration.created',
        status: resource.status,
        note: 'Nhập có kiểm soát từ SOP aura',
        actorUid: 'migration:sop-aura-v1',
        actorName: 'SOP aura migration',
        createdAt: importedAt,
        migrationBatchId: catalog.source.migrationBatchId,
      },
    },
  ]
}

async function gcloudFirestoreRequest(url, options) {
  const accessToken = await gcloudAccessToken()
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...options?.headers,
    },
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!response.ok) {
    let message = text.slice(0, 600)
    try { message = JSON.parse(text)?.error?.message || message } catch { /* Keep the bounded response body. */ }
    throw new Error(`Firestore REST ${response.status}: ${message}`)
  }
  return text ? JSON.parse(text) : null
}

async function applyCatalogWithGcloud(catalog, projectId, databaseId) {
  if (!projectId) throw new Error('--project là bắt buộc khi dùng --gcloud-auth.')
  const databaseName = `projects/${projectId}/databases/${databaseId}`
  const documentsRoot = `${databaseName}/documents`
  const endpoint = `https://firestore.googleapis.com/v1/${databaseName}`
  const existingNames = new Set()

  for (let offset = 0; offset < catalog.resources.length; offset += 200) {
    const documents = catalog.resources.slice(offset, offset + 200)
      .map((resource) => `${documentsRoot}/${RESOURCE_COLLECTION}/${resource.id}`)
    const result = await gcloudFirestoreRequest(`${endpoint}/documents:batchGet`, {
      method: 'POST',
      body: JSON.stringify({ documents }),
    })
    const responses = Array.isArray(result) ? result : [result]
    responses.forEach((item) => {
      if (item?.found?.name) existingNames.add(item.found.name)
    })
  }

  const createResources = catalog.resources.filter((resource) => (
    !existingNames.has(`${documentsRoot}/${RESOURCE_COLLECTION}/${resource.id}`)
  ))
  const skippedResources = catalog.resources.length - createResources.length
  let created = 0

  for (let offset = 0; offset < createResources.length; offset += 120) {
    const chunk = createResources.slice(offset, offset + 120)
    const writes = chunk.flatMap((resource) => migrationDocuments(resource, catalog)).map((document) => ({
      update: {
        name: `${documentsRoot}/${document.path}`,
        fields: firestoreFields(document.data),
      },
      currentDocument: { exists: false },
    }))
    await gcloudFirestoreRequest(`${endpoint}/documents:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes }),
    })
    created += chunk.length
    process.stdout.write(`Applied ${created}/${createResources.length} new resources\n`)
  }

  return { created, skipped: skippedResources, databaseId, projectId, auth: 'gcloud-rest' }
}

async function loadCatalog() {
  const path = resolve(argValue('--catalog') || 'src/features/sop-center/data/catalog.json')
  const catalog = JSON.parse(await readFile(path, 'utf8'))
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.resources)) throw new Error('Catalog SOP không hợp lệ.')
  const forbidden = ['lead_pipeline', 'member_360', 'renewal', 'prices', 'promotions', 'operational_records']
  if (!forbidden.every((scope) => catalog.excludedScopes?.includes(scope))) {
    throw new Error('Catalog chưa khai báo đầy đủ các phạm vi bị loại trừ.')
  }
  return { path, catalog }
}

async function applyCatalog(catalog) {
  const { initializeApp, applicationDefault } = require('firebase-admin/app')
  const { getFirestore, Timestamp } = require('firebase-admin/firestore')
  const projectId = argValue('--project') || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  const databaseId = argValue('--database') || process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID
  if (process.argv.includes('--gcloud-auth')) return applyCatalogWithGcloud(catalog, projectId, databaseId)
  const app = initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) }, `sop-migration-${Date.now()}`)
  const db = getFirestore(app, databaseId)
  const refs = catalog.resources.map((resource) => db.doc(`${RESOURCE_COLLECTION}/${resource.id}`))
  const existing = await db.getAll(...refs)
  const createResources = catalog.resources.filter((_, index) => !existing[index].exists)
  const skippedResources = catalog.resources.length - createResources.length
  let created = 0

  for (let offset = 0; offset < createResources.length; offset += 120) {
    const batch = db.batch()
    const chunk = createResources.slice(offset, offset + 120)
    chunk.forEach((resource) => {
      const resourceRef = db.doc(`${RESOURCE_COLLECTION}/${resource.id}`)
      const publishedVersionId = versionId(resource)
      const importedAt = Timestamp.fromDate(new Date(resource.updatedAt || catalog.generatedAt))
      const current = {
        ...resource,
        publishedVersionId,
        updatedAt: importedAt,
        createdAt: importedAt,
        createdBy: 'migration:sop-aura-v1',
        migrationBatchId: catalog.source.migrationBatchId,
        migrationDigest: digest(resource),
      }
      batch.create(resourceRef, current)
      batch.create(resourceRef.collection('versions').doc(publishedVersionId), {
        resourceId: resource.id,
        versionId: publishedVersionId,
        version: resource.version,
        revision: resource.revision,
        status: resource.status,
        note: 'Nhập có kiểm soát từ SOP aura',
        contentHash: digest({
          kind: resource.kind,
          code: resource.code,
          title: resource.title,
          summary: resource.summary,
          ownerRole: resource.ownerRole,
          audiences: resource.audiences,
          branchScope: resource.branchScope,
          tags: resource.tags,
          payload: resource.payload,
        }),
        createdAt: importedAt,
        createdBy: 'migration:sop-aura-v1',
        snapshot: resource,
        migrationBatchId: catalog.source.migrationBatchId,
      })
      batch.create(db.doc(`${AUDIT_COLLECTION}/${resource.id}__${publishedVersionId}`), {
        schemaVersion: 1,
        resourceId: resource.id,
        resourceKind: resource.kind,
        revision: resource.revision,
        versionId: publishedVersionId,
        action: 'migration.created',
        status: resource.status,
        note: 'Nhập có kiểm soát từ SOP aura',
        actorUid: 'migration:sop-aura-v1',
        actorName: 'SOP aura migration',
        createdAt: importedAt,
        migrationBatchId: catalog.source.migrationBatchId,
      })
    })
    await batch.commit()
    created += chunk.length
    process.stdout.write(`Applied ${created}/${createResources.length} new resources\n`)
  }

  return { created, skipped: skippedResources, databaseId, projectId: projectId || null }
}

async function main() {
  const { path, catalog } = await loadCatalog()
  const plan = {
    mode: process.argv.includes('--apply') ? 'apply' : 'plan',
    catalog: path,
    migrationBatchId: catalog.source.migrationBatchId,
    resourceCount: catalog.resources.length,
    byKind: catalog.stats.byKind,
    excludedScopes: catalog.excludedScopes,
    catalogDigest: digest(catalog),
    deleteCount: 0,
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (!process.argv.includes('--apply')) {
    process.stdout.write('Plan only. Pass --apply after reviewing this digest.\n')
    return
  }
  const result = await applyCatalog(catalog)
  process.stdout.write(`${JSON.stringify({ status: 'complete', ...result }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exitCode = 1
})
