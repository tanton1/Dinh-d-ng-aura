'use strict'

const { HttpsError } = require('firebase-functions/v2/https')

const MAX_CONTRACT_LEDGER_ENTRIES = 5000

// Cash settlement uses earned revenue already posted to the canonical ledger.
// Entitlement usage may include no-shows or unconfirmed service and is not a
// substitute for those entries. Original reversed entries stay in the sum;
// their append-only corrections supply the opposite signed impact.
async function readContractRecognizedRevenue(transaction, db, contractId) {
  const snapshot = await transaction.get(db.collection('ledgerEntries')
    .where('contractId', '==', contractId)
    .select('type', 'status', 'revenueImpact', 'amount')
    .limit(MAX_CONTRACT_LEDGER_ENTRIES + 1))
  if (snapshot.size > MAX_CONTRACT_LEDGER_ENTRIES) {
    throw new HttpsError('resource-exhausted', 'Hợp đồng có quá nhiều bút toán để đối soát doanh thu trong giao dịch này.')
  }
  let recognizedRevenue = 0
  for (const document of snapshot.docs) {
    const value = document.data()
    if (!['posted', 'reversed'].includes(value.status)) continue
    const impact = value.revenueImpact !== undefined && value.revenueImpact !== null
      ? Number(value.revenueImpact)
      : value.type === 'revenue_recognition' ? Number(value.amount) : 0
    if (!Number.isSafeInteger(impact) || !Number.isSafeInteger(recognizedRevenue + impact)) {
      throw new HttpsError('failed-precondition', 'Bút toán doanh thu của hợp đồng cần được đối soát trước khi thu hoặc hoàn tiền.')
    }
    recognizedRevenue += impact
  }
  return recognizedRevenue
}

module.exports = { MAX_CONTRACT_LEDGER_ENTRIES, readContractRecognizedRevenue }
