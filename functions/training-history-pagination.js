'use strict'

const { createHash } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

const MAX_SCAN_QUERIES = 4
const MAX_SCAN_WINDOW = 301
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const nextDay = value => new Date(Date.parse(value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)

function decodeHistoryCursor(value) {
  if (!value) return null
  try {
    if (typeof value !== 'string' || value.length > 1600) throw Error('Invalid cursor size')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!validDay(parsed.date)) throw Error('Invalid day')
    if (parsed.v === undefined && validId(parsed.id)) return { date: parsed.date, id: parsed.id }
    if (parsed.v !== 2 || !/^[a-f0-9]{64}$/.test(parsed.scope) || (parsed.id !== null && !validId(parsed.id))) throw Error('Invalid cursor')
    return { v: 2, scope: parsed.scope, date: parsed.date, id: parsed.id }
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ lịch sử không hợp lệ.')
  }
}

function historyCursorScope({ subjectType, subjectId, input, access }) {
  return createHash('sha256').update(JSON.stringify([
    subjectType, subjectId, access.actor.uid, access.scope,
    [...(access.actor.branchIds || [])].sort(), input.allTime,
    input.allTime ? '' : input.startDate, input.allTime ? '' : input.endDate, input.status,
  ])).digest('hex')
}

function rowDay(row) {
  const day = typeof row.date === 'string' ? row.date.slice(0, 10) : ''
  if (!validDay(day)) throw new HttpsError('failed-precondition', 'Có buổi tập thiếu ngày hợp lệ. Vui lòng đối soát ngày buổi tập trước khi tải tiếp lịch sử.')
  return day
}

function encodeHistoryCursor(date, id, scope) {
  return Buffer.from(JSON.stringify({ v: 2, scope, date, id }), 'utf8').toString('base64url')
}

// A canonical learner visit or teaching slot may have mirrors with different
// raw IDs, statuses and ISO timestamps. Only emit a calendar day after all of
// that day's source rows are present. A page split within a trainer's day
// resumes from the whole day and filters canonical IDs, never partial mirrors.
async function readCanonicalHistoryPage({ query, input, scope, canonicalize, accepts }) {
  const cursor = input.cursor
  if (cursor?.v === 2 && cursor.scope !== scope) throw new HttpsError('invalid-argument', 'Phạm vi lịch sử đã thay đổi. Vui lòng làm mới lịch sử.', { issue: 'HISTORY_SCOPE_CHANGED' })
  if (cursor) query = query.where('date', '<', cursor.id ? nextDay(cursor.date) : cursor.date)

  const documents = []
  let exhausted = false, completeRows = [], eligible = [], batches = 0
  let nextQuery = query
  for (; batches < MAX_SCAN_QUERIES; batches++) {
    const limit = batches === 0 ? Math.min(MAX_SCAN_WINDOW, input.pageSize * 3 + 1) : MAX_SCAN_WINDOW
    const snapshot = await nextQuery.limit(limit).get()
    documents.push(...snapshot.docs)
    exhausted = snapshot.size < limit
    const rows = documents.map(document => ({ ...document.data(), id: document.id }))
    const days = rows.map(rowDay)
    const unfinishedDay = exhausted ? null : days.at(-1)
    completeRows = unfinishedDay ? rows.filter((_, index) => days[index] !== unfinishedDay) : rows
    eligible = canonicalize(completeRows)
      .filter(row => !cursor?.id || rowDay(row) !== cursor.date || String(row.id).localeCompare(cursor.id) < 0)
      .filter(accepts)
    if (exhausted || eligible.length > input.pageSize) break
    const last = documents.at(-1)
    // Keep the exact raw value for the internal database cursor. Public
    // cursors use a complete calendar day, so ISO values cannot skip a day.
    nextQuery = query.startAfter(last.data().date, last.id)
  }
  const records = eligible.slice(0, input.pageSize)
  const hasMore = eligible.length > input.pageSize || !exhausted
  let nextCursor = null
  if (hasMore) {
    if (eligible.length > input.pageSize) {
      const last = records.at(-1), date = rowDay(last)
      nextCursor = encodeHistoryCursor(date, rowDay(eligible[input.pageSize]) === date ? last.id : null, scope)
    } else if (completeRows.length) {
      // Advance even when every completed day was excluded by visibility or
      // status. Never return hasMore with a null or non-advancing cursor.
      nextCursor = encodeHistoryCursor(rowDay(completeRows.at(-1)), null, scope)
    } else {
      // One abnormally dense day exceeded the bounded work budget. Returning
      // a partial day would silently choose the wrong visit or duplicate it.
      // This is a data precondition, not transient capacity: regional retry
      // must not repeat the same bounded scan against unchanged source rows.
      throw new HttpsError('failed-precondition', 'Một ngày có quá nhiều bản ghi buổi tập để đối chiếu. Vui lòng nhờ quản lý kiểm tra các bản ghi trùng.', { issue: 'HISTORY_DAY_SCAN_LIMIT' })
    }
  }
  return { records, hasMore, nextCursor, exhausted, snapshot: { docs: documents, size: documents.length, empty: documents.length === 0 } }
}

module.exports = { decodeHistoryCursor, historyCursorScope, readCanonicalHistoryPage, MAX_SCAN_QUERIES, MAX_SCAN_WINDOW }
