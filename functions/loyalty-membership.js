'use strict'

const { isDeepStrictEqual } = require('node:util')
const { randomUUID } = require('node:crypto')
const { FieldPath } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { effectiveContractStatus } = require('./contract-status')

const todayKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now)
const dayAfter = date => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
function monthAfter(date) {
  const [year, month, day] = date.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

// Calendar dates own membership, using the same canonical contract status as
// scheduling. Historical wallets never constitute evidence of enrollment.
function deriveMembership({ student, contracts, previous = {}, startDate, today = todayKey() }) {
  const enabled = student && student.status !== 'inactive' && !student.accountDeletedAt
  const usable = contracts.filter(c => validDate(c.startDate) && validDate(c.endDate) && c.startDate <= c.endDate
    && !['cancelled', 'canceled', 'draft', 'inactive', 'archived'].includes(String(c.status || '').toLowerCase()))
  const active = enabled && usable.some(c => effectiveContractStatus(c, today) === 'active')
  const enrolledOn = previous.enrolledOn || (active && today >= startDate ? today : null)
  const currentOrPast = usable.filter(c => c.startDate <= today && c.endDate >= c.startDate && !(c.sourceContractId && c.handoverStatus === 'pending'))
  const lastEndDate = currentOrPast.map(c => String(c.endDate).slice(0, 10)).sort().at(-1) || null
  const manageUntil = enrolledOn && lastEndDate ? monthAfter(lastEndDate) : null
  const managed = Boolean(enabled && enrolledOn && (active || (manageUntil && today < manageUntil)))
  const state = active && enrolledOn ? 'active' : !enrolledOn ? 'unmanaged'
    : !managed ? 'archived' : lastEndDate >= today ? 'paused' : 'grace'
  const nextDates = []
  if (enabled) for (const contract of usable) {
    const status = effectiveContractStatus(contract, today)
    if (status === 'future' && contract.startDate > today) nextDates.push(contract.startDate.slice(0, 10))
    if (['active', 'frozen'].includes(status) && contract.endDate >= today) nextDates.push(dayAfter(contract.endDate.slice(0, 10)))
  }
  if (managed && manageUntil > today) nextDates.push(manageUntil)
  return { schemaVersion: 1, enrolledOn, state, active: state === 'active', managed,
    lastEndDate, activeUntil: active ? currentOrPast.filter(c => effectiveContractStatus(c, today) === 'active').map(c => c.endDate.slice(0, 10)).sort().at(-1) : null,
    manageUntil, nextCheckOn: nextDates.sort()[0] || null }
}

function activationWrite(transaction, db, studentId, previous, next) {
  if (next.active && !previous?.active) transaction.set(db.doc(`loyaltyMembershipActivations/${studentId}`), { pending: true, generation: randomUUID() })
}

function membershipIsActive(student, today = todayKey()) {
  const m = student?.loyaltyMembership
  return Boolean(m?.active && student.status !== 'inactive' && !student.accountDeletedAt && m.activeUntil >= today)
}
function membershipIsManaged(student, today = todayKey()) {
  const m = student?.loyaltyMembership
  return Boolean(m?.managed && student.status !== 'inactive' && !student.accountDeletedAt && (membershipIsActive(student, today) || m.manageUntil > today))
}

async function syncMembership({ db, studentId, today = todayKey(), startDate, enqueueActivation = true }) {
  if (typeof studentId !== 'string' || !studentId || studentId.includes('/')) return { changed: false }
  return db.runTransaction(async tx => {
    const ref = db.doc(`students/${studentId}`)
    const [student, settings] = await tx.getAll(ref, db.doc('loyaltySettings/current'))
    const start = startDate || settings.data()?.membershipStartDate
    if (!student.exists || !start) return { changed: false }
    const contracts = await tx.get(db.collection('contracts').where('studentId', '==', studentId))
    const previous = student.data().loyaltyMembership || {}
    const next = deriveMembership({ student: student.data(), contracts: contracts.docs.map(d => d.data()), previous, startDate: start, today })
    if (isDeepStrictEqual(previous, next)) return { changed: false, membership: next }
    // Metadata only: never initialize, wipe or modify a wallet/ledger here.
    tx.update(ref, { loyaltyMembership: next })
    if (enqueueActivation) activationWrite(tx, db, studentId, previous, next)
    return { changed: true, membership: next }
  })
}

// All new credits/first wallet creation pass this transactional gate. Existing
// source reversals and settlement bypass it in the caller so archival cannot
// strand reserved/pending points or prevent a refund correction.
async function readCreditMembership({ db, transaction, studentId, today = todayKey() }) {
  const [settings, student] = await Promise.all([transaction.get(db.doc('loyaltySettings/current')), transaction.get(db.doc(`students/${studentId}`))])
  const startDate = settings.data()?.membershipStartDate
  if (!startDate) return { allowed: true, write() {} } // staged rollout before cutover
  if (!student.exists) return { allowed: false, write() {} }
  const value = student.data()
  if (membershipIsManaged(value, today)) return { allowed: true, write() {} }
  const contracts = await transaction.get(db.collection('contracts').where('studentId', '==', studentId))
  const membership = deriveMembership({ student: value, contracts: contracts.docs.map(d => d.data()), previous: value.loyaltyMembership, startDate, today })
  return { allowed: membership.managed, write() {
    if (!isDeepStrictEqual(value.loyaltyMembership, membership)) transaction.update(student.ref || db.doc(`students/${studentId}`), { loyaltyMembership: membership })
    activationWrite(transaction, db, studentId, value.loyaltyMembership, membership)
  } }
}

async function requireManagedMember(db, transaction, studentId) {
  const membership = await readCreditMembership({ db, transaction, studentId })
  if (!membership.allowed) throw new HttpsError('failed-precondition', 'Học viên chưa tham gia hoặc đã kết thúc quản lý Aura Club. Cần hợp đồng đang hiệu lực để tham gia lại.')
  return membership
}

async function processDueMemberships({ db, today = todayKey(), limit = 200 }) {
  // Only indexed due transitions; never scan all historic profiles every day.
  let processed = 0
  for (let page = 0; page < 20; page++) {
    const due = await db.collection('students').where('loyaltyMembership.nextCheckOn', '<=', today)
      .where('loyaltyMembership.nextCheckOn', '>', '').orderBy('loyaltyMembership.nextCheckOn').orderBy(FieldPath.documentId()).limit(limit).get()
    if (due.empty) break
    for (const doc of due.docs) { await syncMembership({ db, studentId: doc.id, today }); processed++ }
    if (due.size < limit) break
  }
  return { processed }
}

async function processMembershipActivation({ db, studentId }) {
  const ref = db.doc(`loyaltyMembershipActivations/${studentId}`)
  const task = await ref.get()
  if (!task.exists || !task.data().pending) return { skipped: true }
  // Payments may predate a future contract's start. Activation replays those
  // idempotent sources, so a previously skipped payment is not lost. No launch
  // bonus is replayed, and historic inactive students never get an activation.
  const contracts = await db.collection('contracts').where('studentId', '==', studentId).get()
  const { reconcileContractSpend } = require('./loyalty')
  for (const contract of contracts.docs) await reconcileContractSpend({ db, contractId: contract.id })
  await db.runTransaction(async tx => {
    const current = await tx.get(ref)
    if (current.data()?.generation === task.data().generation) tx.update(ref, { pending: false })
  })
  return { processed: contracts.size }
}

const contractFields = ['studentId', 'status', 'startDate', 'endDate', 'sourceContractId', 'handoverStatus', 'renewalSupersededBy', 'renewedByContractId']
async function syncContractMembership({ db, event }) {
  const before = event.data?.before?.data() || {}
  const after = event.data?.after?.data() || {}
  if (contractFields.every(k => isDeepStrictEqual(before[k], after[k]))) return null
  for (const studentId of new Set([before.studentId, after.studentId].filter(Boolean))) await syncMembership({ db, studentId })
  return null
}

function createLoyaltyMembershipFunctions({ db, databaseId, onDocumentWritten, onSchedule }) {
  const options = { region: 'asia-southeast2', cpu: 0.1666, memory: '256MiB', minInstances: 0, maxInstances: 1, concurrency: 1, timeoutSeconds: 540 }
  return {
    syncLoyaltyContractMembership: onDocumentWritten({ ...options, document: 'contracts/{contractId}', database: databaseId, retry: true }, event => syncContractMembership({ db, event })),
    syncLoyaltyMembershipActivation: onDocumentWritten({ ...options, document: 'loyaltyMembershipActivations/{studentId}', database: databaseId, retry: true }, event => event.data?.after?.data()?.pending ? processMembershipActivation({ db, studentId: event.params.studentId }) : null),
    advanceLoyaltyMembershipsScheduled: onSchedule({ ...options, schedule: 'every 30 minutes', timeZone: 'Asia/Ho_Chi_Minh', retryCount: 3 }, () => processDueMemberships({ db })),
  }
}

module.exports = { todayKey, dayAfter, monthAfter, deriveMembership, membershipIsActive, membershipIsManaged,
  syncMembership, syncContractMembership, readCreditMembership, requireManagedMember, processDueMemberships, processMembershipActivation, createLoyaltyMembershipFunctions }
