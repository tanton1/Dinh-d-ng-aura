'use strict'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
function contractSalesContribution(contract) {
  const snapshot = contract.salesCancellationSnapshot
  if (contract.status === 'cancelled') {
    if (snapshot?.schemaVersion !== 1 || !Number.isSafeInteger(snapshot.netAmount) || snapshot.netAmount < 0 || !snapshot.effectiveAt) return null
    return { amount: snapshot.netAmount, effectiveAt: snapshot.effectiveAt }
  }
  if (['draft', 'inactive', 'archived'].includes(contract.status)) return null
  return {
    amount: Math.max(0, finite(contract.totalPrice) - finite(contract.discount)),
    effectiveAt: contract.signedAt || contract.createdAt || contract.contractDate || contract.startDate || null,
  }
}

function contractSettlementBalance(contract) {
  const summary = contract.cancellationSettlement
  const verified = contract.status === 'cancelled'
    && summary?.schemaVersion === 1 && ['approved', 'settled'].includes(summary.status)
    && Number.isSafeInteger(summary.settlementAmount) && summary.settlementAmount >= 0
    && Number.isSafeInteger(summary.canonicalCash) && summary.canonicalCash >= 0
    && summary.canonicalCash === finite(contract.paidAmount)
  return {
    status: verified ? summary.status : 'review_required',
    verified,
    settlementAmount: verified ? summary.settlementAmount : null,
    receivable: verified ? Math.max(0, summary.settlementAmount - summary.canonicalCash) : 0,
    refundDue: verified ? Math.max(0, summary.canonicalCash - summary.settlementAmount) : 0,
  }
}

function collectibleContractDebt(contract) {
  if (contract.status === 'cancelled') return contractSettlementBalance(contract).receivable
  if (['draft', 'inactive', 'archived'].includes(contract.status)) return 0
  return Math.max(0, finite(contract.totalPrice) - finite(contract.discount) - Math.max(0, finite(contract.paidAmount)))
}

module.exports = { contractSalesContribution, contractSettlementBalance, collectibleContractDebt }
