'use strict'

// Deployable CRM endpoints. Callables and the webhook run in asia-east1 to
// stay out of the saturated asia-southeast1 callable pool; Firestore
// triggers and the schedule stay next to the database.

const { defineSecret } = require('firebase-functions/params')
const { onRequest } = require('firebase-functions/v2/https')
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { createPancakeWebhookHandler } = require('./crm-pancake-webhook')
const { createCrmSync, createPageResolver } = require('./crm-sync')
const { createCrmFunctions } = require('./crm-functions')

// Encrypts Pancake page tokens stored in Firestore. Create it once before the
// first deploy: firebase functions:secrets:set CRM_PANCAKE_TOKEN_KEY
const CRM_PANCAKE_TOKEN_KEY = defineSecret('CRM_PANCAKE_TOKEN_KEY')
const WEBHOOK_REGION = 'asia-east1'

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || ''
  } catch {
    return ''
  }
}

function crmWebhookBaseUrl(project = projectId()) {
  return `https://${WEBHOOK_REGION}-${project}.cloudfunctions.net/pancakeWebhook`
}

function createCrmRuntime({ db, databaseId, onCall, logger }) {
  const tokenKey = () => CRM_PANCAKE_TOKEN_KEY.value()
  const pages = createPageResolver({ db, tokenKey })
  const sync = createCrmSync({ db, pages, logger })
  const resource = { cpu: 'gcf_gen1', maxInstances: 2, concurrency: 1 }
  const secrets = [CRM_PANCAKE_TOKEN_KEY]

  const callables = createCrmFunctions({
    db,
    onCall,
    sync,
    pages,
    tokenKey,
    webhookBaseUrl: crmWebhookBaseUrl(),
    readOptions: { ...resource, timeoutSeconds: 30 },
    writeOptions: { ...resource, timeoutSeconds: 120, secrets },
    integrationOptions: { ...resource, maxInstances: 1, timeoutSeconds: 60, secrets },
  })

  const pancakeWebhook = onRequest({
    region: WEBHOOK_REGION,
    cpu: 'gcf_gen1',
    memory: '256MiB',
    maxInstances: 4,
    timeoutSeconds: 30,
    invoker: 'public',
  }, createPancakeWebhookHandler({ db, logger }))

  const processCrmInboundEvent = onDocumentCreated({
    document: 'crmInboundEvents/{eventId}',
    database: databaseId,
    region: 'asia-southeast1',
    cpu: 'gcf_gen1',
    memory: '256MiB',
    maxInstances: 3,
    timeoutSeconds: 120,
    // Failures are recorded on the event; the maintenance job reconciles.
    retry: false,
    secrets,
  }, async (event) => {
    if (!event.data?.exists) return { skipped: true }
    return sync.processInboundEvent(event.params.eventId, event.data.data())
  })

  const syncCrmCustomerFromContract = onDocumentWritten({
    document: 'contracts/{contractId}',
    database: databaseId,
    region: 'asia-southeast1',
    cpu: 'gcf_gen1',
    memory: '256MiB',
    maxInstances: 2,
    timeoutSeconds: 60,
    retry: false,
    secrets,
  }, async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null
    const after = event.data?.after?.exists ? event.data.after.data() : null
    try {
      return await sync.syncContract(event.params.contractId, before, after)
    } catch (error) {
      logger.warn('crm_contract_sync_failed', { contractId: event.params.contractId, message: String(error?.message || error).slice(0, 200) })
      return { failed: true }
    }
  })

  const runCrmMaintenanceScheduled = onSchedule({
    schedule: 'every 5 minutes',
    region: 'asia-southeast1',
    timeZone: 'Asia/Ho_Chi_Minh',
    timeoutSeconds: 300,
    memory: '256MiB',
    maxInstances: 1,
    retryCount: 0,
    secrets,
  }, async () => {
    const summary = await sync.runMaintenance()
    logger.info('crm_maintenance_completed', summary)
  })

  return {
    ...callables,
    pancakeWebhook,
    processCrmInboundEvent,
    syncCrmCustomerFromContract,
    runCrmMaintenanceScheduled,
  }
}

module.exports = { CRM_PANCAKE_TOKEN_KEY, createCrmRuntime, crmWebhookBaseUrl }
