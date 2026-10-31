'use strict'
const { createHash } = require('node:crypto')
function zeroValueEvidenceKey({ sessionId, contractId, serviceOrdinal, allocation }) {
  return createHash('sha256').update(JSON.stringify([sessionId, contractId, serviceOrdinal,
    allocation.contractId, allocation.serviceOrdinal, allocation.contract.studentId,
    allocation.contract.totalPrice, allocation.contract.discount ?? 0, allocation.contract.totalSessions])).digest('hex')
}
module.exports = { zeroValueEvidenceKey }
