const fs = require('node:fs')
const path = require('node:path')

const SOURCE = {
  projectId: 'gen-lang-client-0246058381',
  databaseId: 'aura-fitness-db',
  bucketHint: 'gen-lang-client-0246058381.firebasestorage.app',
}

const TARGET = {
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
  bucketHint: 'gen-lang-client-0815966909.firebasestorage.app',
}

const STAGING = {
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'aura-migration-staging-20260819',
}

const KNOWN_COLLECTION_GROUPS = [
  'academyNotes',
  'academyReviewItems',
  'activityLogs',
  'aiFoodVisionCache',
  'aiRateLimits',
  'auditLogs',
  'bodyMeasurements',
  'bodyMetrics',
  'branches',
  'coachClients',
  'coachingPrograms',
  'coachingWorkoutLogs',
  'contracts',
  'courseLessonProofs',
  'courseRevisions',
  'courses',
  'dailyCheckins',
  'devices',
  'eatCleanAddresses',
  'eatCleanDeliveries',
  'eatCleanIdempotency',
  'eatCleanInventory',
  'eatCleanMeals',
  'eatCleanOrders',
  'eatCleanQuoteRateLimits',
  'eatCleanQuotes',
  'eatCleanShippers',
  'enrollments',
  'events',
  'exercises',
  'favoriteMeals',
  'gamification',
  'leaveRequests',
  'mealLogs',
  'mealPlanAssignments',
  'mealPlans',
  'mealReviews',
  'media',
  'notificationSettings',
  'notifications',
  'nutritionCatalog',
  'packages',
  'payments',
  'productEventRateLimits',
  'productEvents',
  'programAssignmentCycles',
  'programAssignments',
  'programs',
  'progress',
  'progressPhotos',
  'progress_photos',
  'quizAttemptCounters',
  'quizAttempts',
  'quizKeys',
  'recipes',
  'scheduleEvents',
  'schedules',
  'sessionRequests',
  'sessions',
  'staff',
  'students',
  'system',
  'trainers',
  'users',
  'versions',
  'waterLogs',
  'weightLogs',
  'workoutLogs',
]

function firebaseCliAuth() {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('APPDATA is unavailable.')
  const cliLib = path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) {
    throw new Error('Firebase CLI is not signed in.')
  }
  return { auth, account }
}

async function getAccessToken() {
  const { auth, account } = firebaseCliAuth()
  const token = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new Error('Unable to obtain an OAuth access token.')
  return token.access_token
}

async function requestJson(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 500) } }
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.raw || response.statusText
    throw new Error(`${response.status} ${url}: ${message}`)
  }
  return body
}

function firestoreBase(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${encodeURIComponent(config.databaseId)}`
}

async function databaseMetadata(token, config) {
  const body = await requestJson(token, firestoreBase(config))
  return {
    name: body.name,
    uid: body.uid,
    createTime: body.createTime,
    updateTime: body.updateTime,
    locationId: body.locationId,
    type: body.type,
    edition: body.edition,
    deleteProtectionState: body.deleteProtectionState,
    pointInTimeRecoveryEnablement: body.pointInTimeRecoveryEnablement,
    earliestVersionTime: body.earliestVersionTime,
    versionRetentionPeriod: body.versionRetentionPeriod,
    realtimeUpdatesMode: body.realtimeUpdatesMode,
    firestoreDataAccessMode: body.firestoreDataAccessMode,
  }
}

async function listRootCollections(token, config) {
  const ids = new Set()
  let pageToken = ''
  do {
    const body = await requestJson(token, `${firestoreBase(config)}/documents:listCollectionIds`, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    })
    for (const id of body?.collectionIds || []) ids.add(id)
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return [...ids].sort()
}

async function countCollectionGroup(token, config, collectionId) {
  const body = await requestJson(token, `${firestoreBase(config)}/documents:runAggregationQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
        },
        aggregations: [{ alias: 'total', count: {} }],
      },
    }),
  })
  const rows = Array.isArray(body) ? body : [body]
  const integerValue = rows.find((row) => row?.result?.aggregateFields?.total)?.result?.aggregateFields?.total?.integerValue
  return Number(integerValue || 0)
}

async function firestoreInventory(token, config) {
  const metadata = await databaseMetadata(token, config)
  const rootCollections = await listRootCollections(token, config)
  const collectionGroups = [...new Set([...rootCollections, ...KNOWN_COLLECTION_GROUPS])].sort()
  const counts = {}
  const errors = {}
  for (const collectionId of collectionGroups) {
    try {
      const count = await countCollectionGroup(token, config, collectionId)
      if (count > 0 || rootCollections.includes(collectionId)) counts[collectionId] = count
    } catch (error) {
      errors[collectionId] = String(error.message || error)
    }
  }
  return { metadata, rootCollections, collectionGroupCounts: counts, countErrors: errors }
}

async function storageInventory(token, bucket) {
  let pageToken = ''
  let objectCount = 0
  let totalBytes = 0
  const prefixes = {}
  const manifest = []
  do {
    const query = new URLSearchParams({
      maxResults: '1000',
      fields: 'items(name,size,md5Hash,crc32c,updated,contentType,metadata),nextPageToken',
      ...(pageToken ? { pageToken } : {}),
    })
    const body = await requestJson(token, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`)
    for (const object of body?.items || []) {
      const size = Number(object.size || 0)
      const prefix = object.name.includes('/') ? object.name.split('/')[0] : '(root)'
      objectCount += 1
      totalBytes += size
      prefixes[prefix] = (prefixes[prefix] || 0) + 1
      manifest.push({
        name: object.name,
        size,
        md5Hash: object.md5Hash || null,
        crc32c: object.crc32c || null,
        updated: object.updated || null,
        contentType: object.contentType || null,
        hasFirebaseDownloadToken: Boolean(object.metadata?.firebaseStorageDownloadTokens),
      })
    }
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return { bucket, objectCount, totalBytes, prefixes, manifest }
}

async function projectStorageInventory(token, projectId, bucketHint) {
  const query = new URLSearchParams({ project: projectId, maxResults: '1000' })
  const body = await requestJson(token, `https://storage.googleapis.com/storage/v1/b?${query}`)
  const buckets = []
  for (const bucket of body?.items || []) {
    try {
      const inventory = await storageInventory(token, bucket.name)
      buckets.push({
        ...inventory,
        location: bucket.location || null,
        storageClass: bucket.storageClass || null,
        versioningEnabled: Boolean(bucket.versioning?.enabled),
        uniformBucketLevelAccess: Boolean(bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled),
      })
    } catch (error) {
      buckets.push({ bucket: bucket.name, error: String(error.message || error) })
    }
  }
  return {
    bucketHint,
    hintExists: buckets.some((bucket) => bucket.bucket === bucketHint),
    buckets,
  }
}

async function authConfig(token, projectId) {
  const body = await requestJson(token, `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`)
  const signIn = body.signIn || {}
  return {
    authorizedDomains: body.authorizedDomains || [],
    emailEnabled: Boolean(signIn.email?.enabled),
    emailPasswordRequired: Boolean(signIn.email?.passwordRequired),
    phoneEnabled: Boolean(signIn.phoneNumber?.enabled),
    testPhoneNumberCount: Object.keys(signIn.phoneNumber?.testPhoneNumbers || {}).length,
    providerIds: (body.signIn?.hashConfig ? ['password'] : []),
    mfaState: body.mfa?.state || null,
    quota: body.quota || null,
    monitoring: body.monitoring || null,
  }
}

async function rtdbInstances(token, projectId) {
  try {
    const body = await requestJson(token, `https://firebasedatabase.googleapis.com/v1beta/projects/${projectId}/locations/-/instances`)
    return (body.instances || []).map((instance) => ({
      name: instance.name,
      project: instance.project,
      databaseUrl: instance.databaseUrl,
      type: instance.type,
      state: instance.state,
    }))
  } catch (error) {
    return { error: String(error.message || error) }
  }
}

async function run() {
  const token = await getAccessToken()
  const outputDirectory = path.resolve('.migration-private')
  fs.mkdirSync(outputDirectory, { recursive: true })
  const generatedAt = new Date().toISOString()
  const report = {
    generatedAt,
    mode: 'read-only-inventory',
    source: {
      config: SOURCE,
      firestore: await firestoreInventory(token, SOURCE),
      storage: await projectStorageInventory(token, SOURCE.projectId, SOURCE.bucketHint),
      auth: await authConfig(token, SOURCE.projectId),
      rtdb: await rtdbInstances(token, SOURCE.projectId),
    },
    target: {
      config: TARGET,
      firestore: await firestoreInventory(token, TARGET),
      storage: await projectStorageInventory(token, TARGET.projectId, TARGET.bucketHint),
      auth: await authConfig(token, TARGET.projectId),
      rtdb: await rtdbInstances(token, TARGET.projectId),
    },
    staging: {
      config: STAGING,
      firestore: await firestoreInventory(token, STAGING),
    },
  }
  const fileName = `inventory-${generatedAt.replace(/[:.]/g, '-')}.json`
  const outputPath = path.join(outputDirectory, fileName)
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  const sourceDocs = Object.values(report.source.firestore.collectionGroupCounts).reduce((sum, value) => sum + value, 0)
  const targetDocs = Object.values(report.target.firestore.collectionGroupCounts).reduce((sum, value) => sum + value, 0)
  const stagingDocs = Object.values(report.staging.firestore.collectionGroupCounts).reduce((sum, value) => sum + value, 0)
  const sourceStorageObjects = report.source.storage.buckets.reduce((sum, bucket) => sum + (bucket.objectCount || 0), 0)
  const sourceStorageBytes = report.source.storage.buckets.reduce((sum, bucket) => sum + (bucket.totalBytes || 0), 0)
  const targetStorageObjects = report.target.storage.buckets.reduce((sum, bucket) => sum + (bucket.objectCount || 0), 0)
  const targetStorageBytes = report.target.storage.buckets.reduce((sum, bucket) => sum + (bucket.totalBytes || 0), 0)
  console.log(JSON.stringify({
    outputPath,
    source: {
      rootCollections: report.source.firestore.rootCollections.length,
      countedCollectionGroups: Object.keys(report.source.firestore.collectionGroupCounts).length,
      countedDocuments: sourceDocs,
      storageBuckets: report.source.storage.buckets.length,
      storageObjects: sourceStorageObjects,
      storageBytes: sourceStorageBytes,
      rtdbInstances: Array.isArray(report.source.rtdb) ? report.source.rtdb.length : null,
    },
    target: {
      rootCollections: report.target.firestore.rootCollections.length,
      countedCollectionGroups: Object.keys(report.target.firestore.collectionGroupCounts).length,
      countedDocuments: targetDocs,
      storageBuckets: report.target.storage.buckets.length,
      storageObjects: targetStorageObjects,
      storageBytes: targetStorageBytes,
      rtdbInstances: Array.isArray(report.target.rtdb) ? report.target.rtdb.length : null,
    },
    staging: {
      rootCollections: report.staging.firestore.rootCollections.length,
      countedCollectionGroups: Object.keys(report.staging.firestore.collectionGroupCounts).length,
      countedDocuments: stagingDocs,
    },
  }, null, 2))
}

run().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
