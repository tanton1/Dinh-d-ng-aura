'use strict'

// A streamed query can outlive a server-aborted transaction and surface as
// INVALID_ARGUMENT instead of ABORTED. Retry that exact closed-transaction
// transport failure once, starting all reads again. Business errors never retry.
async function runPtTransaction(db, handler) {
  try { return await db.runTransaction(handler) }
  catch (error) {
    if (error.code !== 3 || error.details !== 'Transaction is invalid or closed.') throw error
    return db.runTransaction(handler)
  }
}
module.exports = { runPtTransaction }
