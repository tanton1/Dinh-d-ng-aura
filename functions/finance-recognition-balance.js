'use strict'

const { HttpsError } = require('firebase-functions/v2/https')

const MAX_CONTRACT_LEDGER_ENTRIES = 5000

// Cash settlement uses earned revenue already posted to the canonical ledger.
// Deduction and recognition are committed together; legacy usage still cannot
// substitute for posted evidence. Original reversed entries stay in the sum;
// their append-only corrections supply the opposite signed impact.
async function readContractLedger(transaction, db, contractId, fields) {
  const snapshot = await transaction.get(db.collection('ledgerEntries')
    .where('contractId', '==', contractId)
    .select(...fields)
    .limit(MAX_CONTRACT_LEDGER_ENTRIES + 1))
  if (snapshot.size > MAX_CONTRACT_LEDGER_ENTRIES) {
    throw new HttpsError('resource-exhausted', 'Hợp đồng có quá nhiều bút toán để đối soát doanh thu trong giao dịch này.')
  }
  return snapshot.docs
}

function revenueImpact(value) {
  if (!['posted', 'reversed'].includes(value.status)) return 0
  return value.revenueImpact !== undefined && value.revenueImpact !== null
    ? Number(value.revenueImpact)
    : value.type === 'revenue_recognition' ? Number(value.amount) : 0
}

function addRevenue(current, impact) {
  if (!Number.isSafeInteger(impact) || !Number.isSafeInteger(current + impact)) {
    throw new HttpsError('failed-precondition', 'Bút toán doanh thu của hợp đồng cần được đối soát trước khi thu hoặc hoàn tiền.')
  }
  return current + impact
}

async function readContractRecognizedRevenue(transaction, db, contractId) {
  const documents = await readContractLedger(transaction, db, contractId, ['type', 'status', 'revenueImpact', 'amount'])
  return documents.reduce((sum, document) => addRevenue(sum, revenueImpact(document.data())), 0)
}

// Identity balances are signed, just like the total: a reversed row alone is
// not erased, and its explicit negative correction releases that identity.
async function readContractRecognitionState(transaction, db, contractId) {
  const documents = await readContractLedger(transaction, db, contractId,
    ['type', 'status', 'revenueImpact', 'amount', 'sessionId', 'serviceOrdinal', 'reversedEntryId'])
  const byId = new Map(documents.map((document) => [document.id, document.data()]))
  const state = { recognizedRevenue: 0, revenueBySession: new Map(), revenueByOrdinal: new Map() }
  for (const document of documents) {
    const value = document.data()
    const impact = revenueImpact(value)
    state.recognizedRevenue = addRevenue(state.recognizedRevenue, impact)
    if (!impact) continue
    // Older reversals may carry only their source reference. Resolve within
    // this bounded contract scan; never assume an unlinked reversal cancels a
    // particular session's revenue.
    const original = impact < 0 ? byId.get(value.reversedEntryId) : null
    const sessionId = value.sessionId || original?.sessionId
    const ordinal = Number(value.serviceOrdinal ?? original?.serviceOrdinal)
    if (!sessionId) continue
    state.revenueBySession.set(sessionId, addRevenue(state.revenueBySession.get(sessionId) || 0, impact))
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) continue
    const sessions = state.revenueByOrdinal.get(ordinal) || new Map()
    sessions.set(sessionId, addRevenue(sessions.get(sessionId) || 0, impact))
    state.revenueByOrdinal.set(ordinal, sessions)
  }
  return state
}

module.exports = { MAX_CONTRACT_LEDGER_ENTRIES, readContractRecognizedRevenue, readContractRecognitionState }
