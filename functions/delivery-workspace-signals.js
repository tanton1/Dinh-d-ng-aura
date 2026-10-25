'use strict'

const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FieldValue } = require('firebase-admin/firestore')
const { timestampVersion } = require('./workspace-change-signals')
const { HttpsError } = require('firebase-functions/v2/https')
const { ACTIVE_DELIVERY_STATUSES } = require('./delivery-status-policy')

const SHARED_PATH = 'eatCleanWorkspaceChanges/config'
const DISPATCH_PATH = 'eatCleanWorkspaceChanges/dispatch'
const SOURCES = new Set(['eatCleanOrders', 'eatCleanDeliveries', 'eatCleanShippers', 'system', 'users'])
const SECTION_PATHS = Object.freeze({ jobs: 'eatCleanWorkspaceChanges/jobs', roster: 'eatCleanWorkspaceChanges/roster', config: SHARED_PATH })
const SECTIONS = Object.freeze(['jobs', 'roster', 'config', 'signals'])
const activeStatuses = new Set(ACTIVE_DELIVERY_STATUSES)
const idOf = value => typeof value === 'string' && value.length <= 160 && value.trim() === value && value && !value.includes('/') && value !== '.' && value !== '..' ? value : ''
const valueOf = snapshot => snapshot?.exists ? snapshot.data() || {} : null
const versionOf = value => /^\d{12}\.\d{9}$/.test(value?.version || '') ? value.version : '0'
// Delivery updatedAt is a query ordering key: even a timestamp-only change
// can move a job into the displayed page. Other sources do not sort by it.
const pick = (value, fields) => value && Object.fromEntries(fields.map(key => [key, value[key] ?? null]))
const payload = (value, source) => source === 'eatCleanDeliveries' ? value
  : source === 'users' ? value?.role === 'shipper' ? pick(value, value.disabled === true
    ? ['role', 'disabled'] : ['role', 'disabled', 'displayName', 'phoneNumber', 'photoURL']) : null
    : source === 'eatCleanShippers' ? pick(value, ['available', 'lastSeenAt'])
      : value && Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt'))
const countedShipper = value => activeStatuses.has(value?.status) ? idOf(value.shipperId) : ''

/** Metadata only. Commit-time watermarks suppress replay writes. Old and new
 * assignees are addressed independently, including out-of-order moves. */
async function syncDeliveryWorkspaceChange({ db, event, source }) {
  const path = event.data?.after?.ref?.path || event.data?.before?.ref?.path || ''
  const [collection, id, extra] = path.split('/')
  if (!SOURCES.has(source) || collection !== source || !idOf(id) || extra || (source === 'system' && id !== 'eat_clean_config')) throw Error('DELIVERY_SIGNAL_INVALID_SOURCE')
  const before = valueOf(event.data?.before), after = valueOf(event.data?.after)
  if (isDeepStrictEqual(payload(before, source), payload(after, source))) return { changed: 0, skipped: 'unchanged' }
  // before.updateTime is not the deletion commit time.
  const version = timestampVersion(event.data?.after?.exists ? event.data.after.updateTime : event.time) || timestampVersion(event.time)
  if (!version) throw Error('DELIVERY_SIGNAL_MISSING_COMMIT_TIME')
  const paths = new Set(source === 'system' ? [SHARED_PATH] : source === 'users' ? [SECTION_PATHS.roster] : [DISPATCH_PATH])
  if (['eatCleanOrders', 'eatCleanDeliveries'].includes(source)) {
    paths.add(`eatCleanOrderChanges/${id}`)
    paths.add(SECTION_PATHS.jobs)
  }
  if (source === 'eatCleanShippers' || (source === 'eatCleanDeliveries' && countedShipper(before) !== countedShipper(after))) paths.add(SECTION_PATHS.roster)
  const addDriver = value => { const uid = idOf(value); if (uid) paths.add(`eatCleanDriverChanges/${uid}`) }
  if (source === 'eatCleanShippers') addDriver(id)
  if (source === 'eatCleanDeliveries') [before, after].forEach(value => addDriver(value?.shipperId))
  if (source === 'eatCleanOrders') {
    [before, after].forEach(value => addDriver(value?.assignedShipperId))
    // Legacy orders can omit assignedShipperId. Also include the current
    // assignee when an old order event arrives after a later reassignment.
    const current = await db.doc(`eatCleanDeliveries/${id}`).get()
    addDriver(current.data()?.shipperId)
  }
  const references = [...paths].sort().map(path => db.doc(path))
  const changed = await db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...references)
    let count = 0
    snapshots.forEach((snapshot, index) => {
      if (versionOf(snapshot.data()) >= version) return
      transaction.set(references[index], { schemaVersion: 1, version, updatedAt: FieldValue.serverTimestamp() })
      count++
    })
    return count
  })
  return { changed, targets: references.length, version }
}

/** Read BEFORE business hydration so a racing commit is never acknowledged
 * as included in a response that began before it. Missing markers are zero. */
async function readDeliveryWorkspaceState({ db, actorId, role }) {
  if (!idOf(actorId) || !['shipper', 'admin', 'super_admin'].includes(role)) throw Error('DELIVERY_SIGNAL_INVALID_ACTOR')
  const scope = role === 'shipper' ? 'shipper' : 'dispatch'
  const paths = [scope === 'shipper' ? `eatCleanDriverChanges/${actorId}` : DISPATCH_PATH, SHARED_PATH]
  const snapshots = await db.getAll(...paths.map(path => db.doc(path)))
  const userVersion = versionOf(snapshots[0].data()), policyVersion = versionOf(snapshots[1].data())
  const version = createHash('sha256').update(JSON.stringify([actorId, scope, userVersion, policyVersion])).digest('hex')
  return { schemaVersion: 1, accountId: actorId, scope, version, userVersion, policyVersion, branchVersions: {} }
}

function createDeliveryWorkspaceTriggers({ db, databaseId, onDocumentWritten }) {
  const register = (document, source) => onDocumentWritten({
    document, database: databaseId, region: 'asia-southeast1', cpu: 'gcf_gen1',
    minInstances: 0, maxInstances: 3, retry: true,
  }, event => syncDeliveryWorkspaceChange({ db, event, source }))
  return {
    syncEatCleanWorkspaceFromOrder: register('eatCleanOrders/{orderId}', 'eatCleanOrders'),
    syncEatCleanWorkspaceFromDelivery: register('eatCleanDeliveries/{orderId}', 'eatCleanDeliveries'),
    syncEatCleanWorkspaceFromShipper: register('eatCleanShippers/{shipperId}', 'eatCleanShippers'),
    syncEatCleanWorkspaceFromConfig: register('system/eat_clean_config', 'system'),
  }
}

async function readOrderTrackingState({ db, actorId, orderId }) {
  if (!idOf(actorId) || !idOf(orderId)) throw Error('DELIVERY_SIGNAL_INVALID_ACTOR')
  // Capture the watermark before hydrating business state, as for driver lists.
  const snapshot = await db.doc(`eatCleanOrderChanges/${orderId}`).get()
  return { schemaVersion: 1, accountId: actorId, orderId, version: versionOf(snapshot.data()) }
}

function dispatchSections(value) {
  if (value === undefined) return [...SECTIONS]
  if (!Array.isArray(value) || !value.length || value.length > SECTIONS.length
      || new Set(value).size !== value.length || value.some(section => !SECTIONS.includes(section))) {
    throw new HttpsError('invalid-argument', 'Nhóm dữ liệu điều phối không hợp lệ.')
  }
  return SECTIONS.filter(section => value.includes(section))
}

async function readDispatchWorkspaceState({ db, actorId, sections }) {
  if (!idOf(actorId)) throw Error('DELIVERY_SIGNAL_INVALID_ACTOR')
  const names = dispatchSections(sections).filter(section => SECTION_PATHS[section])
  const snapshots = names.length ? await db.getAll(...names.map(section => db.doc(SECTION_PATHS[section]))) : []
  // A response never acknowledges a section it did not hydrate.
  return { schemaVersion: 1, accountId: actorId,
    versions: Object.fromEntries(names.map((section, index) => [section, versionOf(snapshots[index].data())])) }
}

module.exports = { syncDeliveryWorkspaceChange, readDeliveryWorkspaceState, readOrderTrackingState, readDispatchWorkspaceState, dispatchSections, createDeliveryWorkspaceTriggers }
