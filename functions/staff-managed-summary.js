'use strict'

const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')

const activeContractStatuses = new Set(['active', 'future', 'frozen'])
const STAFF_SUMMARY_VERSION = 2
const STAFF_SUMMARY_MAX_AGE_MS = 6 * 60 * 60 * 1000
const CONTRACT_PAGE_SIZE = 250
const REFRESH_VERSION = 1
const assignmentFields = [
  ['trainerId', '=='], ['secondaryTrainerId', '=='], ['trainerIds', 'array-contains'],
  ['nutritionTrainerId', '=='], ['nutritionTrainerIds', 'array-contains'], ['nutritionPTIds', 'array-contains'],
]
const contractFields = ['status', ...assignmentFields.map(([field]) => field)]

function staffIdsFromContract(contract = {}) {
  const value = contract && typeof contract === 'object' ? contract : {}
  return [...new Set([
    value.trainerId, value.secondaryTrainerId, value.nutritionTrainerId,
    ...(Array.isArray(value.trainerIds) ? value.trainerIds : []),
    ...(Array.isArray(value.nutritionTrainerIds) ? value.nutritionTrainerIds : []),
    ...(Array.isArray(value.nutritionPTIds) ? value.nutritionPTIds : []),
  ].filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)))]
}

// Preserve the existing contract-count definition; changing it to unique
// learners is a separate business decision, not part of this repair.
function managedClientCountsFromContracts(uid, contracts) {
  const counts = { main: 0, secondary: 0, nutrition: 0 }
  for (const contract of contracts) {
    if (!contract || !activeContractStatuses.has(contract.status)) continue
    const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds : []
    if (contract.trainerId === uid || trainerIds[0] === uid) counts.main++
    if (contract.secondaryTrainerId === uid || trainerIds.slice(1).includes(uid)) counts.secondary++
    if (contract.nutritionTrainerId === uid
      || (Array.isArray(contract.nutritionTrainerIds) && contract.nutritionTrainerIds.includes(uid))
      || (Array.isArray(contract.nutritionPTIds) && contract.nutritionPTIds.includes(uid))) counts.nutrition++
  }
  return counts
}

function staffSummaryIsStale(value, now = Date.now()) {
  const generatedAt = value?.generatedAt?.toMillis?.() || 0
  return value?.schemaVersion !== STAFF_SUMMARY_VERSION || !value?.managedClientCounts
    || !generatedAt || generatedAt < now - STAFF_SUMMARY_MAX_AGE_MS
}

function publicStaffManagedCounts(value, now = Date.now()) {
  if (!value?.managedClientCounts) return null
  const count = (key) => {
    const number = Number(value.managedClientCounts[key])
    return Number.isFinite(number) ? Math.max(0, number) : 0
  }
  return {
    main: count('main'), secondary: count('secondary'), nutrition: count('nutrition'),
    stale: staffSummaryIsStale(value, now),
    truncated: value.truncated === true || value.managedClientCounts.truncated === true,
  }
}

function staffManagedContractQueries(db, uid) {
  // Enterprise currently plans the combined OR as a broad status scan even
  // with assignment indexes. Separate aliases select their narrow indexes;
  // the reader deduplicates contracts across all aliases at one source time.
  return assignmentFields.map(([field, operation]) => db.collection('contracts')
    .where(field, operation, uid).where('status', 'in', [...activeContractStatuses])
    .orderBy('status').orderBy(FieldPath.documentId()))
}

async function readStaffManagedClientCounts(db, uid) {
  // Even an empty first alias establishes the source time. Every later alias
  // and continuation uses that same snapshot without locking source writers.
  let sourceReadTime
  const readSnapshot = query => db.runTransaction(transaction => transaction.get(query), { readOnly: true, readTime: sourceReadTime })
  const seen = new Set()
  const counts = { main: 0, secondary: 0, nutrition: 0 }
  let contractsRead = 0, queryPages = 0
  for (const alias of staffManagedContractQueries(db, uid)) {
    const query = alias.select(...contractFields).limit(CONTRACT_PAGE_SIZE)
    let page = sourceReadTime ? await readSnapshot(query) : await query.get()
    if (!sourceReadTime) {
      sourceReadTime = page.readTime
      if (!(sourceReadTime instanceof Timestamp)) throw new Error('Staff summary source time is unavailable')
    }
    while (true) {
      const unique = page.docs.filter(document => {
        if (seen.has(document.id)) return false
        seen.add(document.id)
        return true
      })
      const part = managedClientCountsFromContracts(uid, unique.map(document => document.data()))
      for (const role of Object.keys(counts)) counts[role] += part[role]
      contractsRead += page.size
      queryPages++
      if (page.size < CONTRACT_PAGE_SIZE) break
      page = await readSnapshot(query.startAfter(page.docs.at(-1)))
    }
  }
  // A failed/incomplete scan throws before publishing any partial count.
  return { counts, sourceReadTime, contractsRead, uniqueContractsRead: seen.size, queryPages }
}

function completeFencedSummary(value) {
  return value?.schemaVersion === STAFF_SUMMARY_VERSION && value.refreshVersion === REFRESH_VERSION
    && value.sourceReadTime instanceof Timestamp && value.truncated === false
    && ['main', 'secondary', 'nutrition'].every(role => Number.isSafeInteger(value.managedClientCounts?.[role]) && value.managedClientCounts[role] >= 0)
}

function atLeastAsRecent(left, right) {
  return left.seconds > right.seconds || (left.seconds === right.seconds && left.nanoseconds >= right.nanoseconds)
}

async function refreshStaffManagedClientSummary(db, uid) {
  const { counts, sourceReadTime } = await readStaffManagedClientCounts(db, uid)
  const reference = db.doc(`staffOperationalSummaries/${uid}`)
  return db.runTransaction(async transaction => {
    const current = (await transaction.get(reference)).data()
    if (completeFencedSummary(current) && atLeastAsRecent(current.sourceReadTime, sourceReadTime)) return publicStaffManagedCounts(current)
    // Advance the watermark even if counts are equal: an older A→B refresh
    // must not overwrite a newer B→A result that happens to match stored A.
    transaction.set(reference, {
      schemaVersion: STAFF_SUMMARY_VERSION, refreshVersion: REFRESH_VERSION,
      staffUid: uid, managedClientCounts: counts, source: 'contracts',
      sourceReadTime, truncated: false, generatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ...counts, stale: false, truncated: false }
  })
}

async function syncStaffManagedClientSummary({ db, event, staffIds: suppliedStaffIds, refresh = refreshStaffManagedClientSummary }) {
  const before = event.data?.before?.exists ? event.data.before.data() || {} : {}
  const after = event.data?.after?.exists ? event.data.after.data() || {} : {}
  const affected = [...new Set(suppliedStaffIds || [...staffIdsFromContract(before), ...staffIdsFromContract(after)])]
    .filter((uid) => JSON.stringify(managedClientCountsFromContracts(uid, [before]))
      !== JSON.stringify(managedClientCountsFromContracts(uid, [after])))
  // Process all affected staff, including removed assignments. Never silently
  // drop IDs with slice(0, 20), or fan out refreshes for every PT at once.
  // Financial/usage-only updates do not need any staff-summary reads.
  for (const uid of affected) await refresh(db, uid)
  return { refreshed: affected.length }
}

async function reconcileStaffManagedClientSummaries({ db, logger = console, batchSize = 10, now = Date.now(), refresh = refreshStaffManagedClientSummary }) {
  const stateRef = db.doc('systemJobs/staffManagedClientSummaryReconciliation')
  const state = await stateRef.get()
  const cursor = typeof state.data()?.cursor === 'string' ? state.data().cursor : ''
  const size = Math.max(1, Math.min(25, Number.isFinite(batchSize) ? Math.floor(batchSize) : 10))
  const query = () => db.collection('roleAssignments').where('accessRole', '==', 'staff').orderBy(FieldPath.documentId()).limit(size)
  let page = await (cursor ? query().startAfter(cursor) : query()).get()
  if (page.empty && cursor) page = await query().get()
  const summaries = page.empty ? [] : await db.getAll(...page.docs.map((item) => db.doc(`staffOperationalSummaries/${item.id}`)))
  let refreshed = 0
  for (let index = 0; index < page.docs.length; index++) {
    const value = summaries[index]?.data()
    if (completeFencedSummary(value) && !staffSummaryIsStale(value, now)) continue
    await refresh(db, page.docs[index].id)
    refreshed++
  }
  // Advance only after successful processing. A failed batch can safely retry.
  const nextCursor = page.docs.at(-1)?.id || ''
  await stateRef.set({ cursor: nextCursor, checkedAt: FieldValue.serverTimestamp(), checked: page.size, refreshed }, { merge: true })
  logger.info('staff_summary_reconciled', { checked: page.size, refreshed })
  return { checked: page.size, refreshed, cursor: nextCursor }
}

module.exports = {
  staffIdsFromContract, managedClientCountsFromContracts, refreshStaffManagedClientSummary,
  publicStaffManagedCounts, staffSummaryIsStale, syncStaffManagedClientSummary, reconcileStaffManagedClientSummaries,
  staffManagedContractQueries, readStaffManagedClientCounts,
}
