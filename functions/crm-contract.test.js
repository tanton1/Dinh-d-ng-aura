'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createMemoryFirestore } = require('./test-support/crm-memory-firestore')

const root = join(__dirname, '..')
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8')
const indexes = JSON.parse(readFileSync(join(root, 'firestore.indexes.json'), 'utf8'))
const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const shared = JSON.parse(readFileSync(join(root, 'shared', 'identity', 'identity-contract.json'), 'utf8'))
const deployable = require('./identity-contract.json')

const CRM_COLLECTIONS = ['crmCustomers', 'crmChannelLinks', 'crmConversations', 'crmMessages', 'crmCareSteps', 'crmActivities', 'crmAppointments', 'crmCareAssignments', 'crmPancakePages', 'crmPancakePageSecrets', 'crmInboundEvents', 'crmErasures']

test('every CRM collection is closed to browsers', () => {
  for (const collection of CRM_COLLECTIONS) {
    assert.match(rules, new RegExp(`match /${collection}/\\{[A-Za-z]+\\} \\{\\s+allow read, write: if false;`), collection)
  }
})

test('the entrypoint loads CRM outside narrow discovery scopes', () => {
  assert.match(indexSource, /if \(!isStudent360Discovery && !isExerciseCatalogDiscovery\) \{\s+const \{ createCrmRuntime \} = require\('\.\/crm-runtime'\)\s+Object\.assign\(exports, createCrmRuntime\(\{ db, databaseId, onCall: asiaEastOnCall, logger \}\)\)/)
})

test('deploy settings keep the webhook public and triggers free of retry storms', () => {
  process.env.GCLOUD_PROJECT = 'demo-aura'
  const { createCrmRuntime, crmWebhookBaseUrl } = require('./crm-runtime')
  const calls = []
  const runtime = createCrmRuntime({ db: createMemoryFirestore(), databaseId: 'aura-db', onCall: (options, handler) => { calls.push(options); return handler }, logger: console })
  assert.deepEqual(Object.keys(runtime).sort(), ['crmCommand', 'crmIntegrationCommand', 'crmQuery', 'pancakeWebhook', 'processCrmInboundEvent', 'runCrmMaintenanceScheduled', 'syncCrmCustomerFromContract'])
  assert.equal(crmWebhookBaseUrl('demo-aura'), 'https://asia-east1-demo-aura.cloudfunctions.net/pancakeWebhook')
  const [read, write, integration] = calls
  assert.equal(read.secrets, undefined, 'reads never need the token key')
  assert.deepEqual(write.secrets.map((secret) => secret.name), ['CRM_PANCAKE_TOKEN_KEY'])
  assert.equal(integration.maxInstances, 1)
  const webhook = runtime.pancakeWebhook.__endpoint
  assert.deepEqual(webhook.region, ['asia-east1'])
  assert.deepEqual(webhook.httpsTrigger.invoker, ['public'])
  assert.equal(webhook.secretEnvironmentVariables, undefined, 'the webhook stores events without decrypting tokens')
  for (const name of ['processCrmInboundEvent', 'syncCrmCustomerFromContract']) {
    const endpoint = runtime[name].__endpoint
    assert.equal(endpoint.eventTrigger.retry, false, name)
    assert.equal(endpoint.eventTrigger.eventFilters.database, 'aura-db', name)
    assert.deepEqual(endpoint.region, ['asia-southeast1'], name)
  }
  assert.equal(runtime.runCrmMaintenanceScheduled.__endpoint.scheduleTrigger.schedule, 'every 5 minutes')
})

function hasIndex(collectionGroup, fields) {
  return indexes.indexes.some((index) => index.collectionGroup === collectionGroup && index.queryScope === 'COLLECTION'
    && JSON.stringify(index.fields) === JSON.stringify(fields))
}

const asc = (fieldPath) => ({ fieldPath, order: 'ASCENDING' })
const desc = (fieldPath) => ({ fieldPath, order: 'DESCENDING' })
const contains = (fieldPath) => ({ fieldPath, arrayConfig: 'CONTAINS' })

test('composite indexes exist for the inbox, pipeline, steps and message queries', () => {
  const required = [
    ['crmConversations', [asc('branchId'), asc('awaitingReply'), asc('awaitingSince'), asc('__name__')]],
    ['crmConversations', [asc('branchId'), asc('ownerUid'), desc('lastMessageAt'), desc('__name__')]],
    ['crmConversations', [asc('branchId'), asc('customerStage'), desc('lastMessageAt'), desc('__name__')]],
    ['crmConversations', [asc('customerId'), desc('lastMessageAt')]],
    ['crmMessages', [asc('conversationKey'), desc('sentAt'), desc('__name__')]],
    ['crmCustomers', [asc('branchId'), asc('stage'), desc('updatedAt'), desc('__name__')]],
    ['crmCustomers', [asc('branchId'), asc('stage'), asc('ownerUid'), desc('updatedAt'), desc('__name__')]],
    ['crmCustomers', [asc('careOwnerUid'), desc('updatedAt')]],
    ['crmCustomers', [asc('branchId'), contains('searchTokens')]],
    ['crmCareSteps', [contains('ownerKeys'), asc('status'), asc('dueAt'), asc('__name__')]],
    ['crmCareSteps', [asc('status'), asc('dueAt'), asc('__name__')]],
    ['crmActivities', [asc('customerId'), desc('createdAt')]],
  ]
  for (const [collection, fields] of required) assert.ok(hasIndex(collection, fields), `${collection} ${fields.map((field) => field.fieldPath).join(',')}`)
  const ttl = indexes.fieldOverrides.find((item) => item.collectionGroup === 'crmInboundEvents' && item.fieldPath === 'expiresAt')
  assert.equal(ttl?.ttl, true)
  for (const [collectionGroup, fieldPath] of [['crmMessages', 'text'], ['crmInboundEvents', 'payloadJson']]) {
    assert.deepEqual(indexes.fieldOverrides.find((item) => item.collectionGroup === collectionGroup && item.fieldPath === fieldPath)?.indexes, [], fieldPath)
  }
})

test('customer care is a staff position whose legacy role opens no coaching rules', () => {
  assert.deepEqual(shared, deployable)
  assert.ok(shared.staffPositions.includes('customer_care'))
  assert.deepEqual(shared.positionCapabilities.customer_care, ['dashboard.view', 'crm.messages.postsale.read', 'crm.steps.assigned.manage'])
  for (const capability of ['crm.customers.branch.view', 'crm.customers.self.manage', 'crm.messages.presale.read']) {
    assert.ok(shared.positionCapabilities.sales.includes(capability), capability)
    assert.ok(shared.positionCapabilities.branch_manager.includes(capability), capability)
    assert.equal(shared.positionCapabilities.trainer_pt.includes(capability), false, `PT must not read pre-sale chats: ${capability}`)
  }
  assert.ok(shared.positionCapabilities.branch_manager.includes('crm.care_owner.assign'))
  assert.ok(shared.adminCapabilities.includes('crm.integration.manage'))
  assert.ok(shared.adminCapabilities.includes('crm.customers.erase'))
  const identity = readFileSync(join(__dirname, 'identity-access.js'), 'utf8')
  assert.match(identity, /positions\.includes\('customer_care'\) && !positions\.includes\('coach_online'\)\) return 'sales'/)
})
