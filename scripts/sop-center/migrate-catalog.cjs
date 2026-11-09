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

function migrationActor(catalog) {
  return `migration:${catalog.source.migrationBatchId}`
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

function plainFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return value.timestampValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(plainFirestoreValue)
  if ('mapValue' in value) return plainFirestoreFields(value.mapValue.fields || {})
  return null
}

function plainFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, plainFirestoreValue(value)]))
}

// The migration owns what it created from the catalog, whether the entry came
// from the SOP aura reference import or from in-repo authoring, for as long as
// nobody edits it in the SOP centre (an edit records the editor as updatedBy).
const MANAGED_SOURCE_SYSTEMS = new Set(['sop-aura-reference', 'sop-center-authoring'])

function isManagedMigrationDocument(value) {
  return MANAGED_SOURCE_SYSTEMS.has(value?.sourceSystem)
    && /^migration:sop-aura-v\d+$/.test(String(value?.createdBy || ''))
    && /^migration:sop-aura-v\d+$/.test(String(value?.updatedBy || ''))
}

// Only documents the migration still owns and whose catalog entry changed get a
// new revision; untouched entries keep their history as it is.
function needsManagedRefresh(existing, resource) {
  return isManagedMigrationDocument(existing) && existing.migrationDigest !== digest(resource)
}

function migrationDocuments(resource, catalog, existing = null) {
  const actor = migrationActor(catalog)
  const revision = existing ? Math.max(1, Number(existing.revision || 1)) + 1 : Math.max(1, Number(resource.revision || 1))
  const version = existing ? `2.${revision}` : String(resource.version || '1.0')
  const publishedVersionId = `migration-${catalog.source.migrationBatchId}-r${String(revision).padStart(6, '0')}`
  const importedAt = new Date(resource.updatedAt || catalog.generatedAt)
  if (Number.isNaN(importedAt.getTime())) throw new Error(`Ngày cập nhật không hợp lệ: ${resource.id}`)
  const current = {
    ...resource,
    version,
    revision,
    publishedVersionId: resource.status === 'live' ? publishedVersionId : (existing?.publishedVersionId || publishedVersionId),
    updatedAt: importedAt,
    updatedBy: actor,
    createdAt: existing?.createdAt ? new Date(existing.createdAt) : importedAt,
    createdBy: existing?.createdBy || actor,
    migrationBatchId: catalog.source.migrationBatchId,
    migrationDigest: digest(resource),
  }
  return [
    {
      path: `${RESOURCE_COLLECTION}/${resource.id}`,
      data: current,
    },
    {
      path: `${RESOURCE_COLLECTION}/${resource.id}/versions/${publishedVersionId}`,
      data: {
        resourceId: resource.id,
        versionId: publishedVersionId,
        version,
        revision,
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
        createdBy: actor,
        snapshot: current,
        migrationBatchId: catalog.source.migrationBatchId,
      },
    },
    {
      path: `${AUDIT_COLLECTION}/${resource.id}__${publishedVersionId}`,
      data: {
        schemaVersion: 1,
        resourceId: resource.id,
        resourceKind: resource.kind,
        revision,
        versionId: publishedVersionId,
        action: existing ? 'migration.refreshed' : 'migration.created',
        status: resource.status,
        note: 'Nhập có kiểm soát từ SOP aura',
        actorUid: actor,
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

async function applyCatalogWithGcloud(catalog, projectId, databaseId, { planOnly = false } = {}) {
  if (!projectId) throw new Error('--project là bắt buộc khi dùng --gcloud-auth.')
  const databaseName = `projects/${projectId}/databases/${databaseId}`
  const documentsRoot = `${databaseName}/documents`
  const endpoint = `https://firestore.googleapis.com/v1/${databaseName}`
  const existingDocuments = new Map()

  for (let offset = 0; offset < catalog.resources.length; offset += 200) {
    const documents = catalog.resources.slice(offset, offset + 200)
      .map((resource) => `${documentsRoot}/${RESOURCE_COLLECTION}/${resource.id}`)
    const result = await gcloudFirestoreRequest(`${endpoint}/documents:batchGet`, {
      method: 'POST',
      body: JSON.stringify({ documents }),
    })
    const responses = Array.isArray(result) ? result : [result]
    responses.forEach((item) => {
      if (!item?.found?.name) return
      const id = item.found.name.split('/').pop()
      existingDocuments.set(id, {
        data: plainFirestoreFields(item.found.fields),
        updateTime: item.found.updateTime,
      })
    })
  }

  const refreshManaged = process.argv.includes('--refresh-managed')
  const createResources = catalog.resources.filter((resource) => !existingDocuments.has(resource.id))
  const updateResources = refreshManaged
    ? catalog.resources.filter((resource) => needsManagedRefresh(existingDocuments.get(resource.id)?.data, resource))
    : []
  const skippedResources = catalog.resources.length - createResources.length - updateResources.length
  const verifiedResources = catalog.resources.filter((resource) => (
    existingDocuments.get(resource.id)?.data?.migrationDigest === digest(resource)
  ))
  const driftedManagedResources = catalog.resources.filter((resource) => {
    const value = existingDocuments.get(resource.id)?.data
    return value && isManagedMigrationDocument(value) && value.migrationDigest !== digest(resource)
  })
  const summary = {
    created: createResources.length,
    updated: updateResources.length,
    skipped: skippedResources,
    verified: verifiedResources.length,
    driftedManaged: driftedManagedResources.length,
    deleteCount: 0,
    databaseId,
    projectId,
    auth: 'gcloud-rest',
  }
  if (planOnly) return summary
  let created = 0
  let updated = 0

  const commitResources = async (items, mode) => {
    for (let offset = 0; offset < items.length; offset += 120) {
      const chunk = items.slice(offset, offset + 120)
      const writes = chunk.flatMap((resource) => {
        const existing = existingDocuments.get(resource.id)
        return migrationDocuments(resource, catalog, mode === 'update' ? existing.data : null).map((document, documentIndex) => ({
          update: {
            name: `${documentsRoot}/${document.path}`,
            fields: firestoreFields(document.data),
          },
          currentDocument: mode === 'update' && documentIndex === 0
            ? { updateTime: existing.updateTime }
            : { exists: false },
        }))
      })
      await gcloudFirestoreRequest(`${endpoint}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes }),
      })
      if (mode === 'update') {
        updated += chunk.length
        process.stdout.write(`Refreshed ${updated}/${items.length} managed resources\n`)
      } else {
        created += chunk.length
        process.stdout.write(`Applied ${created}/${items.length} new resources\n`)
      }
    }
  }

  await commitResources(createResources, 'create')
  await commitResources(updateResources, 'update')
  return { created, updated, skipped: skippedResources, deleteCount: 0, databaseId, projectId, auth: 'gcloud-rest' }
}

async function loadCatalog() {
  const path = resolve(argValue('--catalog') || 'src/features/sop-center/data/catalog.json')
  const catalog = JSON.parse(await readFile(path, 'utf8'))
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.resources)) throw new Error('Catalog SOP không hợp lệ.')
  const forbidden = ['lead_pipeline', 'member_360', 'renewal_operations', 'operational_records']
  if (!forbidden.every((scope) => catalog.excludedScopes?.includes(scope))) {
    throw new Error('Catalog chưa khai báo đầy đủ các phạm vi bị loại trừ.')
  }
  return { path, catalog }
}

async function applyCatalog(catalog) {
  const { initializeApp, applicationDefault } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const projectId = argValue('--project') || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  const databaseId = argValue('--database') || process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID
  if (process.argv.includes('--gcloud-auth')) return applyCatalogWithGcloud(catalog, projectId, databaseId)
  const app = initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) }, `sop-migration-${Date.now()}`)
  const db = getFirestore(app, databaseId)
  const refs = catalog.resources.map((resource) => db.doc(`${RESOURCE_COLLECTION}/${resource.id}`))
  const existing = await db.getAll(...refs)
  const createResources = catalog.resources.filter((_, index) => !existing[index].exists)
  const existingById = new Map(existing.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]))
  const updateResources = process.argv.includes('--refresh-managed')
    ? catalog.resources.filter((resource) => needsManagedRefresh(existingById.get(resource.id), resource))
    : []
  const skippedResources = catalog.resources.length - createResources.length - updateResources.length
  let created = 0
  let updated = 0

  const commitResources = async (items, mode) => {
    for (let offset = 0; offset < items.length; offset += 120) {
      const batch = db.batch()
      const chunk = items.slice(offset, offset + 120)
      chunk.forEach((resource) => {
        const documents = migrationDocuments(resource, catalog, mode === 'update' ? existingById.get(resource.id) : null)
        documents.forEach((document, index) => {
          const ref = db.doc(document.path)
          if (mode === 'update' && index === 0) batch.set(ref, document.data)
          else batch.create(ref, document.data)
        })
      })
      await batch.commit()
      if (mode === 'update') updated += chunk.length
      else created += chunk.length
    }
  }

  await commitResources(createResources, 'create')
  await commitResources(updateResources, 'update')

  return { created, updated, skipped: skippedResources, deleteCount: 0, databaseId, projectId: projectId || null }
}

async function main() {
  const { path, catalog } = await loadCatalog()
  const projectId = argValue('--project') || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  const databaseId = argValue('--database') || process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID
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
  if (process.argv.includes('--gcloud-auth')) {
    plan.remote = await applyCatalogWithGcloud(catalog, projectId, databaseId, { planOnly: true })
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
