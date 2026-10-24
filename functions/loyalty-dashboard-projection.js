'use strict'

const { isDeepStrictEqual } = require('node:util')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { normalizeAccount, sourceDocumentId } = require('./loyalty-core')

const VERSION = 1
const SHARDS = 4
const COLLECTIONS = ['students', 'loyaltyAccounts', 'loyaltyRedemptions', 'memberReferrals', 'ambassadorProfiles']
const METRICS = ['memberCount', 'walletCount', 'availablePoints', 'pendingPoints', 'reservedPoints', 'debtPoints',
  'lifetimeRedeemedPoints', 'pendingRedemptions', 'fulfilledRedemptions', 'qualifiedReferrals', 'approvedAmbassadors',
  'tier_member', 'tier_silver', 'tier_gold', 'tier_diamond']
const FIELDS = {
  students: ['branchId'],
  loyaltyAccounts: ['availablePoints', 'pendingPoints', 'reservedPoints', 'debtPoints', 'lifetimeRedeemedPoints', 'tierQualifyingValue'],
  loyaltyRedemptions: ['studentId', 'branchId', 'status'],
  memberReferrals: ['referrerStudentId', 'status'],
  ambassadorProfiles: ['studentId', 'status'],
}
const emptyMetrics = () => Object.fromEntries(METRICS.map(key => [key, 0]))
const branchScope = branches => `branches:${JSON.stringify([...new Set(branches)].sort())}`
const summaryId = (scope, shard) => `${sourceDocumentId(scope)}_${shard}`

function relevantValue(collection, value) {
  if (value == null) return null
  return Object.fromEntries(FIELDS[collection].map(key => [key, value[key] ?? null]))
}

function contributionFor(collection, id, value, student) {
  const metrics = emptyMetrics()
  if (!value) return { scopes: [], metrics }
  if (collection === 'students') metrics.memberCount = 1
  if (collection === 'loyaltyAccounts') {
    const account = normalizeAccount(value)
    metrics.walletCount = 1
    for (const key of ['availablePoints', 'pendingPoints', 'reservedPoints', 'debtPoints', 'lifetimeRedeemedPoints']) metrics[key] = account[key]
    metrics[`tier_${account.tier}`] = 1
  }
  if (collection === 'loyaltyRedemptions') {
    metrics.pendingRedemptions = Number(value.status === 'pending')
    metrics.fulfilledRedemptions = Number(value.status === 'fulfilled')
  }
  if (collection === 'memberReferrals') metrics.qualifiedReferrals = Number(['qualified', 'vested'].includes(value.status))
  if (collection === 'ambassadorProfiles') metrics.approvedAmbassadors = Number(value.status === 'approved')
  const profile = collection === 'students' ? value : student
  const scopes = ['all']
  if (typeof profile?.branchId === 'string' && profile.branchId) {
    // A cross-branch redemption requires BOTH the current student's branch
    // and the redemption's stored branch, preserving the existing dashboard.
    const branches = [profile.branchId]
    if (collection === 'loyaltyRedemptions' && value.branchId) branches.push(value.branchId)
    scopes.push(branchScope(branches))
  }
  return { scopes, metrics }
}

async function syncLoyaltyDashboardRecord({ db, collection, id }) {
  if (!COLLECTIONS.includes(collection) || typeof id !== 'string' || !id || id.includes('/')) throw new Error('Invalid loyalty dashboard source.')
  const sourceRef = db.doc(`${collection}/${id}`)
  const key = sourceDocumentId(sourceRef.path)
  const contributionRef = db.doc(`loyaltyDashboardContributions/${key}`)
  const shard = parseInt(key.slice(0, 8), 16) % SHARDS
  return db.runTransaction(async transaction => {
    // Read current source state in the same transaction as the previous
    // contribution. Duplicate/out-of-order events and operator backfills all
    // converge; no event payload can overwrite newer balances or branch scope.
    const [source, previous] = await transaction.getAll(sourceRef, contributionRef)
    const value = source.exists ? source.data() : null
    const studentId = ['students', 'loyaltyAccounts'].includes(collection) ? id
      : collection === 'memberReferrals' ? value?.referrerStudentId : value?.studentId
    let student = null
    if (collection !== 'students' && typeof studentId === 'string' && studentId && !studentId.includes('/')) {
      const snapshot = await transaction.get(db.doc(`students/${studentId}`))
      student = snapshot.exists ? snapshot.data() : null
    }
    const next = contributionFor(collection, id, value, student)
    const old = previous.exists ? previous.data() : { scopes: [], metrics: emptyMetrics() }
    if (previous.exists && old.schemaVersion !== VERSION) throw new Error('Unsupported loyalty dashboard contribution version.')
    if (isDeepStrictEqual(old.scopes, next.scopes) && isDeepStrictEqual(old.metrics, next.metrics)) return { changed: false }
    for (const scope of new Set([...old.scopes, ...next.scopes])) {
      const changes = {}
      for (const metric of METRICS) {
        const delta = (next.scopes.includes(scope) ? next.metrics[metric] : 0) - (old.scopes.includes(scope) ? old.metrics[metric] : 0)
        if (delta) changes[metric] = FieldValue.increment(delta)
      }
      if (Object.keys(changes).length) transaction.set(db.doc(`loyaltyDashboardSummaries/${summaryId(scope, shard)}`), {
        schemaVersion: VERSION, scope, shard, metrics: changes, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    transaction.set(contributionRef, { schemaVersion: VERSION, sourcePath: sourceRef.path, ...next, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true }
  })
}

async function syncStudentDependents(db, studentId) {
  await syncLoyaltyDashboardRecord({ db, collection: 'loyaltyAccounts', id: studentId })
  for (const [collection, field] of [['loyaltyRedemptions', 'studentId'], ['memberReferrals', 'referrerStudentId'], ['ambassadorProfiles', 'studentId']]) {
    let cursor
    do {
      let query = db.collection(collection).where(field, '==', studentId).orderBy(FieldPath.documentId()).select().limit(200)
      if (cursor) query = query.startAfter(cursor)
      const page = await query.get()
      // Bounded pages; no 500/1,000-document cutoff on a branch move/delete.
      for (const doc of page.docs) await syncLoyaltyDashboardRecord({ db, collection, id: doc.id })
      cursor = page.size === 200 ? page.docs.at(-1).id : null
    } while (cursor)
  }
}

async function syncLoyaltyDashboardEvent({ db, collection, event }) {
  const before = event.data?.before
  const after = event.data?.after
  if (typeof before?.exists !== 'boolean' || typeof after?.exists !== 'boolean') throw new Error('Missing loyalty dashboard event snapshots.')
  if (isDeepStrictEqual(relevantValue(collection, before.exists ? before.data() : null), relevantValue(collection, after.exists ? after.data() : null))) return { changed: false }
  const id = event.params.documentId
  const result = await syncLoyaltyDashboardRecord({ db, collection, id })
  if (collection === 'students') await syncStudentDependents(db, id)
  return result
}

function allowedScopes(actor) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return ['all']
  if (actor.accessRole !== 'staff') throw new HttpsError('permission-denied', 'Bạn không có quyền xem tổng quan Aura Club.')
  const branches = [...new Set(actor.branchIds || [])]
  if (branches.length > 20) throw new HttpsError('failed-precondition', 'Phạm vi chi nhánh vượt giới hạn được hỗ trợ.')
  const scopes = branches.map(branch => branchScope([branch]))
  for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) scopes.push(branchScope([branches[i], branches[j]]))
  return scopes
}

async function readLoyaltyDashboardSummary({ db, actor }) {
  const scopes = allowedScopes(actor)
  const state = await db.doc('loyaltyDashboardState/current').get()
  if (!state.exists || state.data().schemaVersion !== VERSION || state.data().status !== 'ready' || state.data().shards !== SHARDS) {
    throw new HttpsError('unavailable', 'Số liệu Aura Club đang được đồng bộ. Vui lòng thử lại sau.')
  }
  const metrics = emptyMetrics()
  let updatedAt = ''
  const pages = []
  if (scopes[0] === 'all') {
    pages.push(await db.getAll(...Array.from({ length: SHARDS }, (_, shard) => db.doc(`loyaltyDashboardSummaries/${summaryId('all', shard)}`))))
  } else {
    for (let offset = 0; offset < scopes.length; offset += 30) {
      // At most four shards per permitted scope, independent of member count.
      // Query sparse branch pairs rather than billing missing document gets.
      const page = await db.collection('loyaltyDashboardSummaries').where('scope', 'in', scopes.slice(offset, offset + 30)).get()
      pages.push(page.docs)
    }
  }
  for (const doc of pages.flat()) {
    if (!doc.exists) continue
    const value = doc.data()
    if (value.schemaVersion !== VERSION || !scopes.includes(value.scope)) throw new Error('Invalid loyalty dashboard summary scope/version.')
    for (const key of METRICS) metrics[key] += Number(value.metrics?.[key] || 0)
    const date = value.updatedAt?.toDate?.().toISOString() || ''
    if (date > updatedAt) updatedAt = date
  }
  return { metrics, updatedAt }
}

function createLoyaltyDashboardProjectionFunctions({ db, databaseId, onDocumentWritten }) {
  const register = collection => onDocumentWritten({
    document: `${collection}/{documentId}`, database: databaseId, region: 'asia-southeast2',
    cpu: 0.1666, memory: '256MiB', minInstances: 0, maxInstances: 2, concurrency: 1, timeoutSeconds: 540, retry: true,
  }, event => syncLoyaltyDashboardEvent({ db, collection, event }))
  return {
    syncLoyaltyDashboardStudent: register('students'),
    syncLoyaltyDashboardAccount: register('loyaltyAccounts'),
    syncLoyaltyDashboardRedemption: register('loyaltyRedemptions'),
    syncLoyaltyDashboardReferral: register('memberReferrals'),
    syncLoyaltyDashboardAmbassador: register('ambassadorProfiles'),
  }
}

module.exports = { VERSION, SHARDS, COLLECTIONS, METRICS, emptyMetrics, branchScope, summaryId, relevantValue, contributionFor,
  allowedScopes, readLoyaltyDashboardSummary, syncLoyaltyDashboardRecord, syncLoyaltyDashboardEvent, createLoyaltyDashboardProjectionFunctions }
