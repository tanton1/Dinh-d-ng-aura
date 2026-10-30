'use strict'

const { canonicalUsageSessions, sessionCountsTowardContract } = require('./contract-usage-core')

// Historical repair may reassign only an unposted service. Posted identities
// and their amounts remain immutable; the returned ordinal is an unused share
// of the same contract, not an additional entitlement.
function replacementServiceOrdinal({ sessionId, contract, sessions, billings, ledger, reserved = [] }) {
  const quota = Number(contract.totalSessions)
  if (!Number.isSafeInteger(quota) || quota < 1) throw Error('Invalid contract quota')
  const canonical = canonicalUsageSessions(sessions).filter(sessionCountsTowardContract)
  if (!canonical.some(row => row.id === sessionId)) throw Error('Noncanonical service requires evidence review')
  if (canonical.length !== Number(contract.usedSessions) || canonical.length > quota) throw Error('Incomplete or over-quota contract history')
  const billingBySession = new Map(billings.map(row => [row.sessionId || row.id, row]))
  const occupied = new Set(reserved)
  for (const [index, session] of canonical.entries()) {
    if (session.id === sessionId) continue
    const ordinal = Number(billingBySession.get(session.id)?.serviceOrdinal || session.serviceOrdinal || index + 1)
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > quota) throw Error('Historical service ordinal outside contract quota')
    occupied.add(ordinal)
  }
  for (const entry of ledger) {
    if (!['posted','reversed'].includes(entry.status)) continue
    const revenue = Number(entry.revenueImpact ?? (entry.type === 'revenue_recognition' ? entry.amount : 0))
    if (!Number.isSafeInteger(revenue)) throw Error('Invalid historical revenue')
    if (revenue <= 0) continue
    if (entry.sessionId === sessionId) throw Error('Service already has financial evidence')
    const ordinal = Number(entry.serviceOrdinal)
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > quota) throw Error('Unallocated historical revenue requires separate review')
    occupied.add(ordinal)
  }
  for(let ordinal=1;ordinal<=quota;ordinal++) if(!occupied.has(ordinal)) return ordinal
  throw Error('No unoccupied financial service share')
}

function nextServiceOrdinal({ usedSessions, totalSessions, billings, revenueOrdinals }) {
  const occupied = new Set(billings.map(row=>Number(row.serviceOrdinal)))
  for(const ordinal of revenueOrdinals) occupied.add(Number(ordinal))
  for(let ordinal=Math.max(1,Math.floor(Number(usedSessions||0))+1);ordinal<=Number(totalSessions);ordinal++) {
    if(!occupied.has(ordinal)) return ordinal
  }
  return null
}

module.exports = { replacementServiceOrdinal, nextServiceOrdinal }
