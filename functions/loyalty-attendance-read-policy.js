'use strict'
const { isDeepStrictEqual } = require('node:util')

// Every input read by attendance eligibility, occurrence date, ownership and
// mission reconciliation. Keep timestamps intact (including nanoseconds).
const REWARD_FIELDS = ['sessionId', 'studentId', 'branchId', 'attendanceStatus', 'billingStatus', 'recognitionReviewRequired',
  'confirmationSource', 'scheduledAt', 'occurredAt', 'confirmedAt', 'createdAt']
function rewardValue(snapshot) {
  if (typeof snapshot?.exists !== 'boolean') throw new Error('Missing loyalty attendance event snapshot.')
  if (!snapshot.exists) return null
  const value = snapshot.data()
  return Object.fromEntries(REWARD_FIELDS.map(key => [key, value[key] ?? null]))
}
function attendanceRewardChanged(event) {
  return !isDeepStrictEqual(rewardValue(event?.data?.before), rewardValue(event?.data?.after))
}
module.exports = { attendanceRewardChanged, REWARD_FIELDS }
