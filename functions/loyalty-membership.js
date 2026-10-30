'use strict'

// Activation replays spend only at the trigger boundary; membership rules never
// import the loyalty command module. Keep the historical facade for callers.
const core = require('./loyalty-membership-core')
const { syncContractMembership, processDueMemberships } = core

async function processMembershipActivation({ db, studentId }) {
  const ref = db.doc(`loyaltyMembershipActivations/${studentId}`)
  const task = await ref.get()
  if (!task.exists || !task.data().pending) return { skipped: true }
  // Payments may predate a future contract's start. Activation replays those
  // idempotent sources, so a previously skipped payment is not lost. No launch
  // bonus is replayed, and historic inactive students never get an activation.
  const contracts = await db.collection('contracts').where('studentId', '==', studentId).get()
  const { reconcileContractSpend } = require('./loyalty')
  for (const contract of contracts.docs) await reconcileContractSpend({ db, contractId: contract.id })
  await db.runTransaction(async tx => {
    const current = await tx.get(ref)
    if (current.data()?.generation === task.data().generation) tx.update(ref, { pending: false })
  })
  return { processed: contracts.size }
}

function createLoyaltyMembershipFunctions({ db, databaseId, onDocumentWritten, onSchedule }) {
  const options = { region: 'asia-southeast2', cpu: 0.1666, memory: '256MiB', minInstances: 0, maxInstances: 1, concurrency: 1, timeoutSeconds: 540 }
  return {
    syncLoyaltyContractMembership: onDocumentWritten({ ...options, document: 'contracts/{contractId}', database: databaseId, retry: true }, event => syncContractMembership({ db, event })),
    syncLoyaltyMembershipActivation: onDocumentWritten({ ...options, document: 'loyaltyMembershipActivations/{studentId}', database: databaseId, retry: true }, event => event.data?.after?.data()?.pending ? processMembershipActivation({ db, studentId: event.params.studentId }) : null),
    advanceLoyaltyMembershipsScheduled: onSchedule({ ...options, schedule: 'every 30 minutes', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 3 }, () => processDueMemberships({ db })),
  }
}

module.exports = { ...core, processMembershipActivation, createLoyaltyMembershipFunctions }
