'use strict'

const { FieldValue } = require('firebase-admin/firestore')

/** Resume after the last completely processed page. A partial delete failure
 * leaves the checkpoint on that page, so failed objects are retried instead
 * of being skipped. Persistent meal photos use another prefix entirely. */
async function cleanupNutritionImages({ db, bucket, now = Date.now(), pageSize = 500, maxPages = 10 }) {
  const reference = db.doc('systemJobs/nutritionImageCleanup')
  const state = await reference.get()
  let pageToken = typeof state.data()?.pageToken === 'string' ? state.data().pageToken : ''
  let scannedImages = 0, deletedImages = 0, pages = 0
  while (pages < maxPages) {
    let result
    try {
      result = await bucket.getFiles({ prefix: 'nutrition-scans/', maxResults: pageSize, autoPaginate: false, ...(pageToken ? { pageToken } : {}) })
    } catch (error) {
      // An old listing token can expire between scheduled runs. Restart one
      // sweep; the age/purpose checks make already processed pages harmless.
      if (pageToken && [400, 410].includes(Number(error?.code))) {
        pageToken = ''
        await reference.set({ pageToken: '', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        result = await bucket.getFiles({ prefix: 'nutrition-scans/', maxResults: pageSize, autoPaginate: false })
      } else throw error
    }
    const [files, nextQuery] = result
    scannedImages += files.length
    const stale = files.filter(file => {
      const purpose = file.metadata?.metadata?.purpose
      const created = Date.parse(file.metadata?.timeCreated || file.metadata?.updated || '')
      return file.name?.startsWith('nutrition-scans/') && ['food-analysis', 'ai-coach-body', 'ai-coach-meal'].includes(purpose)
        && Number.isFinite(created) && created <= now - 86_400_000
    })
    for (let offset = 0; offset < stale.length; offset += 20) {
      const outcomes = await Promise.allSettled(stale.slice(offset, offset + 20).map(file => file.delete({ ignoreNotFound: true })))
      deletedImages += outcomes.filter(item => item.status === 'fulfilled').length
      const failure = outcomes.find(item => item.status === 'rejected')
      if (failure) throw failure.reason
    }
    pages++
    pageToken = typeof nextQuery?.pageToken === 'string' ? nextQuery.pageToken : ''
    await reference.set({ pageToken, updatedAt: FieldValue.serverTimestamp(), ...(pageToken ? {} : { completedAt: FieldValue.serverTimestamp() }) }, { merge: true })
    if (!pageToken) break
  }
  return { scannedImages, deletedImages, pages, hasMore: Boolean(pageToken) }
}

module.exports = { cleanupNutritionImages }
