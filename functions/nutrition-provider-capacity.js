'use strict'

const { randomInt, randomUUID } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

// Shared by both regions and all three nutrition AI features. This is below
// the provider account's 15-request cap; other apps on that account still count.
const PROVIDER_SLOTS = 12
const PROVIDER_LEASE_MS = 150_000

function createNutritionProviderCapacity({ db, now = Date.now, random = randomInt, token = randomUUID }) {
  const acquire = async () => {
    const start = random(PROVIDER_SLOTS)
    for (let offset = 0; offset < PROVIDER_SLOTS; offset++) {
      const reference = db.doc(`systemJobs/nutritionProviderCapacity/slots/${(start + offset) % PROVIDER_SLOTS}`)
      const owner = token()
      const acquired = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference)
        if (Number(snapshot.data()?.leaseUntil || 0) > now()) return false
        transaction.set(reference, { token: owner, leaseUntil: now() + PROVIDER_LEASE_MS })
        return true
      })
      if (acquired) return { reference, token: owner }
    }
    throw new HttpsError('resource-exhausted', 'AI đang xử lý các yêu cầu trước. Vui lòng chờ lượt.', {
      kind: 'nutrition_provider_capacity', retryAfterMs: 15_000,
    })
  }
  const release = lease => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(lease.reference)
    if (snapshot.data()?.token === lease.token) transaction.set(lease.reference, { token: null, leaseUntil: 0 })
  })
  const run = async operation => {
    const lease = await acquire()
    let ambiguous = false
    try { return await operation() } catch (error) {
      ambiguous = error?.details?.kind === 'nutrition_ai_outcome_unknown'
      throw error
    } finally {
      // A lost response can leave upstream work running. Keep its slot until
      // expiry rather than immediately admitting a replacement paid request.
      if (!ambiguous) await release(lease).catch(() => undefined)
    }
  }
  return { acquire, release, run }
}

module.exports = { PROVIDER_SLOTS, PROVIDER_LEASE_MS, createNutritionProviderCapacity }
