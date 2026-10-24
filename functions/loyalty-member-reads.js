'use strict'

const { AggregateField, FieldPath, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

async function readMemberDashboard({ db, studentId, weekId, monthId, compact = false }) {
  const missionIds = [`attendance_week_${weekId}`, `attendance_month_${monthId}`, `attendance_streak_${weekId}`,
    `nutrition_month_${monthId}`, `nutrition_streak_${weekId}`]
  const kudos = db.collection('sessionKudos').where('studentId', '==', studentId)
  const [missions, ambassador, recognition, recognitionTotals, redemptions] = await Promise.all([
    db.getAll(...missionIds.map(id => db.doc(`loyaltyMissionProgress/${studentId}_${id}`))),
    compact ? null : db.doc(`ambassadorProfiles/${studentId}`).get(),
    compact ? { docs: [] } : kudos.orderBy('createdAt', 'desc').limit(8).get(),
    compact ? null : kudos.aggregate({ count: AggregateField.count(), xp: AggregateField.sum('xp') }).get(),
    compact ? { docs: [] } : db.collection('loyaltyRedemptions').where('studentId', '==', studentId).orderBy('updatedAt', 'desc').limit(12).get(),
  ])
  return {
    missionSnapshot: { docs: missions.filter(doc => doc.exists) },
    ambassadorSnapshot: ambassador || { exists: false },
    kudosSnapshot: recognition,
    kudosTotals: recognitionTotals?.data() || { count: 0, xp: 0 },
    redemptionSnapshot: redemptions,
  }
}

function historyCursor(document, studentId) {
  const timestamp = document.data().createdAt
  return Buffer.from(JSON.stringify({ v: 1, studentId, id: document.id, seconds: timestamp.seconds, nanos: timestamp.nanoseconds })).toString('base64url')
}

function decodeHistoryCursor(value, studentId) {
  try {
    if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (cursor.v !== 1 || cursor.studentId !== studentId || typeof cursor.id !== 'string' || !cursor.id || cursor.id.includes('/')
      || Buffer.byteLength(cursor.id) > 1500 || !Number.isSafeInteger(cursor.seconds) || !Number.isSafeInteger(cursor.nanos)
      || cursor.nanos < 0 || cursor.nanos >= 1_000_000_000) throw new Error()
    return [new Timestamp(cursor.seconds, cursor.nanos), cursor.id]
  } catch {
    throw new HttpsError('invalid-argument', 'Mốc lịch sử điểm không hợp lệ. Hãy tải lại lịch sử.')
  }
}

async function readMemberHistory({ db, studentId, pageSize = 30, cursor = '', offset = 0 }) {
  const size = Math.min(100, Math.max(10, Number.isSafeInteger(pageSize) ? pageSize : 30))
  let query = db.collection('loyaltyLedgerEntries').where('studentId', '==', studentId)
    .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
  if (cursor) query = query.startAfter(...decodeHistoryCursor(cursor, studentId))
  // Only older cached web clients send an offset. New clients always send a
  // timestamp + ID cursor, with no skipped reads or 300-entry history ceiling.
  const legacyOffset = !cursor && Number.isSafeInteger(offset) ? Math.min(300, Math.max(0, offset)) : 0
  if (legacyOffset) query = query.offset(legacyOffset)
  const snapshot = await query.limit(size + 1).get()
  const docs = snapshot.docs.slice(0, size)
  const hasMore = snapshot.size > size
  return { docs, hasMore, nextCursor: hasMore ? historyCursor(docs.at(-1), studentId) : null,
    nextOffset: hasMore ? legacyOffset + size : null }
}

module.exports = { readMemberDashboard, readMemberHistory, historyCursor, decodeHistoryCursor }
