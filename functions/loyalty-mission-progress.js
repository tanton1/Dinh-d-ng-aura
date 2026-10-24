'use strict'
const { isDeepStrictEqual } = require('node:util')
const { FieldValue } = require('firebase-admin/firestore')

async function writeMissionProgress(db, reference, value) {
  const { updatedAt, ...business } = value
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.exists ? snapshot.data() : {}
    if (snapshot.exists && Object.entries(business).every(([key, item]) => isDeepStrictEqual(current[key], item))) return false
    transaction.set(reference, { ...business, updatedAt: FieldValue.serverTimestamp(), revision: Number(current.revision || 0) + 1 }, { merge: true })
    return true
  })
}

module.exports = { writeMissionProgress }
