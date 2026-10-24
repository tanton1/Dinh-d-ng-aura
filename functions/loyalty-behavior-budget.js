'use strict'
const { FieldValue } = require('firebase-admin/firestore')
const { sourceDocumentId } = require('./loyalty-core')

// This document is server-only. Reading it in the same transaction as the
// wallet makes the monthly ceiling safe across simultaneous PT/Coach writes.
async function allocateBehaviorBudget({ db, transaction, studentId, sourceType, previousSource, requestedPoints, caps }) {
  if (!caps || !/^\d{4}-\d{2}$/.test(caps.monthId)) return null
  const month = caps.monthId
  const previousMonth = previousSource.budgetMonthId || month
  const oldPoints = Math.max(0, Number(previousSource.budgetedPoints || 0))
  const isNutrition = sourceType === 'nutrition'
  const ref = id => db.doc(`loyaltyBehaviorBudgets/${sourceDocumentId(`${studentId}:${id}`)}`)
  const nextRef = ref(month), oldRef = previousMonth === month ? nextRef : ref(previousMonth)
  const snapshots = await Promise.all([transaction.get(nextRef), ...(previousMonth === month ? [] : [transaction.get(oldRef)])])
  const normalize = snapshot => ({ totalPoints: 0, nutritionPoints: 0, ...(snapshot.exists ? snapshot.data() : {}) })
  const next = normalize(snapshots[0]), old = previousMonth === month ? next : normalize(snapshots[1])
  old.totalPoints = Math.max(0, Number(old.totalPoints) - oldPoints)
  if (isNutrition) old.nutritionPoints = Math.max(0, Number(old.nutritionPoints) - oldPoints)
  const totalRemaining = Math.max(0, Number(caps.total) - Number(next.totalPoints))
  const nutritionRemaining = isNutrition ? Math.max(0, Number(caps.nutrition) - Number(next.nutritionPoints)) : Infinity
  const points = Math.min(requestedPoints, totalRemaining, nutritionRemaining)
  next.totalPoints += points
  if (isNutrition) next.nutritionPoints += points
  return {
    points,
    metadata: { budgetMonthId: month, budgetedPoints: points },
    changed: oldPoints !== points || previousMonth !== month,
    write() {
      const write = (reference, value, monthId) => transaction.set(reference, { ...value, studentId, monthId, updatedAt: FieldValue.serverTimestamp() })
      write(nextRef, next, month)
      if (previousMonth !== month) write(oldRef, old, previousMonth)
    },
  }
}

module.exports = { allocateBehaviorBudget }
