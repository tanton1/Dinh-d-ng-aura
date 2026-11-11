'use strict'

const { Timestamp } = require('firebase-admin/firestore')

// An idempotency receipt only answers a retry of the same command, and a
// client retries within seconds. Schedule receipts keep the whole command
// result (about 29 KB for a draft command, 46 KB for an Admin edit) and were
// never deleted: 2,387 of them held about 78 MB, a fifth of the database, and
// about 1,300 more arrived every week (measured 11/11/2026).
// Thirty days is the retention the SOP centre receipts already use. The field
// alone deletes nothing: Firestore removes a receipt some time after expiresAt
// only while the TTL policy of its collection is enabled. A receipt that is
// still stored after its expiry is replayed exactly as before.
const COMMAND_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function commandReceiptExpiresAt(now = Date.now()) {
  return Timestamp.fromMillis(now + COMMAND_RECEIPT_RETENTION_MS)
}

module.exports = { COMMAND_RECEIPT_RETENTION_MS, commandReceiptExpiresAt }
