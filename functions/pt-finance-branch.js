'use strict'
// "all" is a legacy schedule filter, never a real accounting branch.
// An unscoped legacy booking uses its linked contract's accounting branch.
function ptFinanceBranch(session = {}, contract = {}) {
  for (const value of [session?.branchId, contract?.branchId]) {
    if (typeof value === 'string' && value.trim() && value.trim() !== 'all') return value.trim()
  }
  return ''
}
module.exports = { ptFinanceBranch }
