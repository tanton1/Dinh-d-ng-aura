'use strict'

const { createHash } = require('node:crypto')
const { FieldPath, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const RECEIPTS = ['receipt_voucher', 'receipt_voucher_reversal']
const EXPENSES = ['expense_voucher', 'expense_voucher_reversal']
const MAX_SOURCE_BATCHES = 4
const CURSOR_LIFETIME_MS = 15 * 60 * 1000
const validId = value => typeof value === 'string' && value.length > 0 && !value.includes('/') && Buffer.byteLength(value, 'utf8') <= 1500
const dataIssue = () => new HttpsError('failed-precondition', 'Cần kiểm tra ngày hoặc liên kết chứng từ trước khi tải tiếp sổ quỹ.', { reason: 'cashbook-record-invalid' })
const cursorIssue = () => new HttpsError('invalid-argument', 'Trang sổ quỹ không còn phù hợp với bộ lọc hoặc tài khoản hiện tại. Vui lòng tải lại.', { reason: 'cashbook-cursor-invalid' })

function position(document, field) {
  const value = document.data()[field]
  if (!(value instanceof Timestamp) || !validId(document.id)) throw dataIssue()
  return { seconds: value.seconds, nanos: value.nanoseconds, id: document.id }
}

function validPosition(value) {
  if (!value || !Number.isInteger(value.seconds) || !Number.isInteger(value.nanos) || !validId(value.id)) return false
  try { new Timestamp(value.seconds, value.nanos); return true } catch { return false }
}

function readTime(value) {
  if (!value || !Number.isInteger(value.seconds) || !Number.isInteger(value.nanos) || value.nanos % 1000 !== 0) throw cursorIssue()
  let result
  try { result = new Timestamp(value.seconds, value.nanos) } catch { throw cursorIssue() }
  const age = Date.now() - result.toMillis()
  if (age < -5000) throw cursorIssue()
  if (age > CURSOR_LIFETIME_MS) throw new HttpsError('failed-precondition', 'Phiên tải sổ quỹ đã hết hạn. Hãy tải lại để xem số liệu mới.', { reason: 'cashbook-cursor-expired' })
  return result
}

function input(data, kind, actor) {
  const accountId = typeof data?.accountId === 'string' ? data.accountId.trim() : ''
  if (accountId.length > 200) throw new HttpsError('invalid-argument', 'Tài khoản quỹ không hợp lệ.')
  const pageSize = Math.min(100, Math.max(1, Number.isInteger(data?.pageSize) ? data.pageSize : 50))
  const scope = createHash('sha256').update(JSON.stringify([kind, actor.uid, actor.accessRole, actor.authzVersion, [...(actor.positions || [])].sort(), [...(actor.branchIds || [])].sort(), accountId])).digest('hex')
  const count = kind === 'receipts' ? RECEIPTS.length + 1 : kind === 'expenses' ? EXPENSES.length : 1
  let streams = Array.from({ length: count }, () => ({ after: null, done: false }))
  let snapshotTime = null
  if (data?.cursor !== undefined && data.cursor !== null && data.cursor !== '') {
    try {
      if (typeof data.cursor !== 'string' || data.cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(data.cursor)) throw cursorIssue()
      const decoded = JSON.parse(Buffer.from(data.cursor, 'base64url').toString('utf8'))
      if (decoded.v !== 1 || decoded.kind !== kind || decoded.scope !== scope || !Array.isArray(decoded.streams) || decoded.streams.length !== count
        || decoded.streams.some(stream => !stream || typeof stream.done !== 'boolean' || (stream.after !== null && !validPosition(stream.after)))) throw cursorIssue()
      streams = decoded.streams.map(stream => ({ done: stream.done, after: stream.after === null ? null : { seconds: stream.after.seconds, nanos: stream.after.nanos, id: stream.after.id } }))
      snapshotTime = readTime(decoded.readTime)
    } catch (error) { if (error?.details?.reason === 'cashbook-cursor-expired') throw error; throw cursorIssue() }
  }
  return { accountId, pageSize, scope, kind, streams, readTime: snapshotTime }
}

function after(query, value) { return value ? query.startAfter(new Timestamp(value.seconds, value.nanos), value.id) : query }
function cursor(config, streams) { return Buffer.from(JSON.stringify({ v: 1, kind: config.kind, scope: config.scope, readTime: { seconds: config.readTime.seconds, nanos: config.readTime.nanoseconds }, streams })).toString('base64url') }
function envelope(config, streams, hasMore, rows, key, scanLimited = false) {
  return { [key]: rows, paginationVersion: 1, hasMore, nextCursor: hasMore ? cursor(config, streams) : null, scanLimited, asOf: config.readTime?.toDate().toISOString() || null }
}

// A receipt can materialize between page requests. Read both sources and their
// links at the first page's read time so that its legacy representation cannot
// disappear before the newly created document is reached. These are read-only
// transactions; the SDK uses readTime directly on subsequent pages. Current
// authorization is checked outside this historical snapshot by the caller.
function withSnapshot(db, config, action) {
  return db.runTransaction(transaction => action({
    get: async query => {
      const snapshot = await transaction.get(query)
      if (!config.readTime) config.readTime = snapshot.readTime
      return snapshot
    },
    getAll: (...references) => transaction.getAll(...references),
  }), { readOnly: true, ...(config.readTime ? { readTime: config.readTime } : {}) })
}

async function listCashTransactionsPage({ db, actor, data, serialize }) {
  const config = input(data, 'cash', actor)
  if (config.streams[0].done) return envelope(config, config.streams, false, [], 'transactions')
  let query = db.collection('cashTransactions')
  if (config.accountId) query = query.where('accountId', '==', config.accountId)
  query = after(query.orderBy('effectiveAt', 'desc').orderBy(FieldPath.documentId(), 'desc'), config.streams[0].after)
  return withSnapshot(db, config, async read => {
    const snapshot = await read.get(query.limit(config.pageSize + 1))
    const documents = snapshot.docs.slice(0, config.pageSize)
    const hasMore = snapshot.size > config.pageSize
    // Preserve timestamp nanoseconds and the ID so deleting the boundary row
    // cannot break the next page or skip rows sharing its timestamp.
    const next = documents.length ? position(documents.at(-1), 'effectiveAt') : config.streams[0].after
    return envelope(config, [{ after: next, done: !hasMore }], hasMore, documents.map(serialize), 'transactions')
  })
}

function before(left, right) {
  if (!right) return true
  const a = left.position, b = right.position
  const idOrder = Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))
  return a.seconds > b.seconds || (a.seconds === b.seconds && (a.nanos > b.nanos
    || (a.nanos === b.nanos && (idOrder > 0 || (idOrder === 0 && left.stream.index > right.stream.index)))))
}

// An IN over document types requires a whole-result sort on Enterprise.
// Each equality query follows its index; merge only bounded page candidates.
async function listExpenseVouchersPage({ db, actor, data, serialize }) {
  const config = input(data, 'expenses', actor)
  if (config.streams.every(stream => stream.done)) return envelope(config, config.streams, false, [], 'vouchers')
  return withSnapshot(db, config, async read => {
    const streams = await Promise.all(config.streams.map(async (state, index) => {
      const stream = { ...state, index, rows: [], offset: 0 }
      if (state.done) return stream
      let query = db.collection('accountingDocuments').where('documentType', '==', EXPENSES[index])
      if (config.accountId) query = query.where('accountId', '==', config.accountId)
      query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
      const snapshot = await read.get(after(query, state.after).limit(config.pageSize + 1))
      stream.rows = snapshot.docs.map(document => ({ document, position: position(document, 'createdAt'), stream }))
      return stream
    }))
    const selected = []
    while (selected.length < config.pageSize) {
      const candidates = streams.map(stream => stream.rows[stream.offset]).filter(Boolean)
      if (!candidates.length) break
      const row = candidates.reduce((best, candidate) => before(candidate, best) ? candidate : best)
      row.stream.after = row.position
      row.stream.offset += 1
      selected.push(serialize(row.document))
    }
    const next = streams.map(stream => ({ after: stream.after, done: stream.offset >= stream.rows.length }))
    return envelope(config, next, next.some(stream => !stream.done), selected, 'vouchers')
  })
}

function receiptIdentity(value) { return `${value.documentType}:${value.ledgerEntryId || value.id}` }

// The lookup crosses page boundaries. Looking only at the materialized receipt
// page would reintroduce an older receipt as a derived legacy payment.
async function linkedPayments(db, read, documents) {
  const linked = new Set()
  for (let start = 0; start < documents.length; start += 30) {
    const ids = documents.slice(start, start + 30).map(document => document.id)
    const maximum = ids.length * 4
    const snapshot = await read.get(db.collection('accountingDocuments').where('ledgerEntryId', 'in', ids)
      .orderBy('ledgerEntryId', 'asc').orderBy(FieldPath.documentId(), 'asc')
      .select('documentType', 'ledgerEntryId').limit(maximum + 1))
    if (snapshot.size > maximum) throw dataIssue()
    for (const document of snapshot.docs) {
      const value = document.data()
      if (RECEIPTS.includes(value.documentType) && ids.includes(value.ledgerEntryId)) linked.add(value.ledgerEntryId)
    }
  }
  // Some older receipts may have only the ledger's explicit document pointer.
  // Resolve those references only when the indexed reverse link did not match.
  const pointers = documents.filter(document => !linked.has(document.id) && document.data().accountingDocumentId)
  const ids = [...new Set(pointers.map(document => document.data().accountingDocumentId))]
  if (ids.some(id => !validId(id))) throw dataIssue()
  if (ids.length) {
    const snapshots = await read.getAll(...ids.map(id => db.doc(`accountingDocuments/${id}`)), { fieldMask: ['documentType', 'ledgerEntryId'] })
    const byId = new Map(snapshots.filter(document => document.exists).map(document => [document.id, document.data()]))
    for (const document of pointers) {
      const value = byId.get(document.data().accountingDocumentId)
      if (!value || !RECEIPTS.includes(value.documentType)) continue
      if (value.ledgerEntryId && value.ledgerEntryId !== document.id) throw dataIssue()
      linked.add(document.id)
    }
  }
  return linked
}

async function hydrateLegacy(db, read, documents) {
  const ids = field => [...new Set(documents.map(document => document.data()[field]).filter(validId))]
  const journalIds = ids('journalEntryId'), studentIds = ids('studentId')
  const [journals, students] = await Promise.all([
    journalIds.length ? read.getAll(...journalIds.map(id => db.doc(`journalEntries/${id}`))) : [],
    studentIds.length ? read.getAll(...studentIds.map(id => db.doc(`students/${id}`))) : [],
  ])
  return {
    journals: new Map(journals.filter(document => document.exists).map(document => [document.id, document.data()])),
    students: new Map(students.filter(document => document.exists).map(document => [document.id, document.data()])),
  }
}

async function listReceiptVouchersPage({ db, actor, data, serializeReceipt, serializeLegacy }) {
  const config = input(data, 'receipts', actor)
  return withSnapshot(db, config, read => receiptPage({ db, read, config, serializeReceipt, serializeLegacy }))
}

async function receiptPage({ db, read, config, serializeReceipt, serializeLegacy }) {
  const blocked = Symbol('source-needs-another-batch')
  const materialized = new Set()
  const streams = config.streams.map((state, index) => ({ ...state, index, legacy: index === RECEIPTS.length, rows: [], offset: 0, loads: 0 }))
  async function load(stream) {
    let query = db.collection(stream.legacy ? 'ledgerEntries' : 'accountingDocuments')
    query = stream.legacy ? query.where('type', '==', 'payment') : query.where('documentType', '==', RECEIPTS[stream.index])
    if (config.accountId) query = query.where(stream.legacy ? 'cashAccountId' : 'accountId', '==', config.accountId)
    query = after(query.orderBy('effectiveAt', 'desc').orderBy(FieldPath.documentId(), 'desc'), stream.after)
    const snapshot = await read.get(query.limit(config.pageSize + 1))
    stream.loads += 1
    stream.done = snapshot.size < config.pageSize + 1
    const positive = stream.legacy ? snapshot.docs.filter(document => Number(document.data().amount || 0) > 0) : []
    const linked = positive.length ? await linkedPayments(db, read, positive) : new Set()
    stream.rows = snapshot.docs.map(document => {
      const value = document.data()
      if (!stream.legacy && value.ledgerEntryId) materialized.add(value.ledgerEntryId)
      return { document, position: position(document, 'effectiveAt'), stream, eligible: !stream.legacy || (Number(value.amount || 0) > 0 && !linked.has(document.id)) }
    })
    stream.offset = 0
  }
  function consume(row) { row.stream.after = row.position; row.stream.offset += 1 }
  async function peek(stream) {
    for (;;) {
      if (stream.offset < stream.rows.length) {
        const row = stream.rows[stream.offset]
        if (row.eligible && !(stream.legacy && materialized.has(row.document.id))) return row
        consume(row)
        continue
      }
      if (stream.done) return null
      // Inspect one batch first. The other stream may already contain enough
      // newer rows, so scanning more excluded/linked payments would be wasted.
      if (stream.loads > 0) return blocked
      await load(stream)
    }
  }
  const selected = [], identities = new Map()
  let heads
  for (;;) {
    heads = await Promise.all(streams.map(peek))
    // A parallel materialized-source fetch may have completed after the
    // legacy peek. Apply that newly observed link before choosing the row.
    const legacyHead = heads[RECEIPTS.length]
    if (legacyHead && legacyHead !== blocked && materialized.has(legacyHead.document.id)) { consume(legacyHead); continue }
    if (heads.every(value => value === null)) break
    // One eligible lookahead already proves another page exists; its ordering
    // against an unread stream only matters when that page is requested.
    if (selected.length >= config.pageSize && heads.some(head => head !== blocked && head !== null)) break
    let chosen
    const pending = streams.filter(stream => heads[stream.index] === blocked)
    const available = heads.filter(head => head !== blocked && head !== null)
      .reduce((best, candidate) => before(candidate, best) ? candidate : best, null)
    if (pending.length) {
      // Every unread row in the pending stream sorts below its consumed
      // frontier. Emit a known newer row without forcing another source scan.
      if (available && pending.every(stream => stream.after && before(available, { position: stream.after, stream }))) chosen = available
      else {
        const reload = pending.filter(stream => stream.loads < MAX_SOURCE_BATCHES)
        if (!reload.length) break
        await Promise.all(reload.map(load))
        continue
      }
    } else chosen = available
    if (selected.length >= config.pageSize) break
    consume(chosen)
    const value = chosen.document.data()
    const identity = chosen.stream.legacy ? `receipt_voucher:${chosen.document.id}` : `${value.documentType}:${value.ledgerEntryId || chosen.document.id}`
    if (identities.has(identity)) {
      if (!chosen.stream.legacy && selected[identities.get(identity)].stream.legacy) selected[identities.get(identity)] = chosen
    } else { identities.set(identity, selected.length); selected.push(chosen) }
  }
  const hasMore = heads.some(value => value !== null)
  const legacy = selected.filter(row => row.stream.legacy).map(row => row.document)
  const related = await hydrateLegacy(db, read, legacy)
  const vouchers = selected.map(row => {
    const value = row.stream.legacy ? serializeLegacy(row.document, related) : serializeReceipt(row.document)
    return { ...value, listIdentity: receiptIdentity(value) }
  })
  const next = streams.map(stream => ({ after: stream.after, done: stream.done && stream.offset >= stream.rows.length }))
  return envelope(config, next, hasMore, vouchers, 'vouchers', heads.some((head, index) => head === blocked && streams[index].loads >= MAX_SOURCE_BATCHES))
}

module.exports = { listCashTransactionsPage, listExpenseVouchersPage, listReceiptVouchersPage }
