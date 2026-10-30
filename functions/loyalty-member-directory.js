'use strict'

const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { normalizeAccount } = require('./loyalty-core')

const DIRECTORY_VERSION = 2
const DIRECTORY_COLLECTION = 'loyaltyMemberDirectory'
const DIRECTORY_STATE = 'loyaltyDirectoryState/current'
const TIERS = ['member', 'silver', 'gold', 'diamond']
const FIELDS = {
  students: ['name', 'displayName', 'phone', 'branchId', 'status', 'accountDeletedAt', 'loyaltyMembership'],
  loyaltyAccounts: ['tierQualifyingValue'],
}

function foldMemberSearch(value) {
  const text = String(value || '').trim()
  if (/^[+\d\s().-]+$/.test(text) && /\d/.test(text)) return text.replace(/[^0-9+]/g, '')
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
}

function memberSearchPrefixes(student) {
  const result = new Set()
  // Every word-start phrase supports both "mai" and "pham mai". Prefixes are
  // bounded, accent-insensitive and indexable; no collection scan on typing.
  const name = foldMemberSearch(student.name || student.displayName).slice(0, 200)
  const words = name.split(' ').filter(Boolean).slice(0, 30)
  const phrases = words.map((_, index) => words.slice(index).join(' '))
  const phone = String(student.phone || '').replace(/[^0-9+]/g, '').slice(0, 40)
  if (phone) phrases.push(phone)
  for (const phrase of phrases) for (let length = 1; length <= Math.min(80, phrase.length); length++) result.add(phrase.slice(0, length))
  return [...result].sort()
}

function directorySourceChanged(collection, before, after) {
  if (!FIELDS[collection]) return false
  if (collection === 'students' && !before?.loyaltyMembership?.managed && !after?.loyaltyMembership?.managed) return false
  const select = value => value ? Object.fromEntries(FIELDS[collection].map(key => [key, value[key] ?? null])) : null
  return !isDeepStrictEqual(select(before), select(after))
}

function directoryValue(studentId, student, wallet) {
  // Lifecycle transitions already materialize managed membership. Never let a
  // historic wallet alone enroll someone or use the current clock in a delta.
  if (!student?.loyaltyMembership?.managed || student.status === 'inactive' || student.accountDeletedAt) return null
  return {
    schemaVersion: DIRECTORY_VERSION, studentId,
    studentName: student.name || student.displayName || 'Học viên Aura',
    branchId: student.branchId || '',
    tier: normalizeAccount(wallet || {}).tier,
    membershipState: student.loyaltyMembership.state || 'active',
    searchPrefixes: memberSearchPrefixes(student),
  }
}

async function syncLoyaltyMemberDirectory({ db, studentId }) {
  if (typeof studentId !== 'string' || !studentId || studentId.includes('/')) throw new Error('Invalid member directory identity.')
  const ref = db.doc(`${DIRECTORY_COLLECTION}/${studentId}`)
  return db.runTransaction(async transaction => {
    const [student, wallet, previous] = await transaction.getAll(db.doc(`students/${studentId}`), db.doc(`loyaltyAccounts/${studentId}`), ref)
    const next = directoryValue(studentId, student.exists ? student.data() : null, wallet.exists ? wallet.data() : null)
    if (!next) {
      if (previous.exists) transaction.delete(ref)
      return { changed: previous.exists, present: false }
    }
    const { updatedAt: _updatedAt, ...old } = previous.exists ? previous.data() : {}
    if (isDeepStrictEqual(old, next)) return { changed: false, present: true }
    transaction.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, present: true }
  })
}

function normalizeDirectoryInput(data, actor) {
  const size = Number(data.pageSize ?? 30)
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new HttpsError('invalid-argument', 'Số thành viên mỗi trang không hợp lệ.')
  const tier = data.tier || 'all'
  if (tier !== 'all' && !TIERS.includes(tier)) throw new HttpsError('invalid-argument', 'Hạng thành viên không hợp lệ.')
  if (data.query != null && (typeof data.query !== 'string' || data.query.length > 200)) throw new HttpsError('invalid-argument', 'Tên hoặc số điện thoại tìm kiếm quá dài.')
  const query = foldMemberSearch(data.query)
  if (query.length > 80) throw new HttpsError('invalid-argument', 'Nhập tối đa 80 ký tự để tìm thành viên.')
  const branches = ['admin', 'super_admin'].includes(actor.accessRole) ? null : [...new Set(actor.branchIds || [])].sort()
  if (branches && branches.length > 20) throw new HttpsError('failed-precondition', 'Phạm vi chi nhánh vượt giới hạn được hỗ trợ.')
  const scope = createHash('sha256').update(JSON.stringify([DIRECTORY_VERSION, actor.uid, actor.accessRole, actor.authzVersion ?? null, branches, tier, query])).digest('hex')
  let after = ''
  if (data.cursor) {
    try {
      if (typeof data.cursor !== 'string' || data.cursor.length > 4096) throw new Error()
      const parsed = JSON.parse(Buffer.from(data.cursor, 'base64url').toString('utf8'))
      if (parsed.v !== DIRECTORY_VERSION || parsed.scope !== scope || typeof parsed.id !== 'string' || !parsed.id || !parsed.id.isWellFormed() || parsed.id.includes('/') || ['.', '..'].includes(parsed.id) || /^__.*__$/.test(parsed.id) || Buffer.byteLength(parsed.id) > 1500) throw new Error()
      after = parsed.id
    } catch { throw new HttpsError('invalid-argument', 'Bộ lọc đã thay đổi. Hãy tải lại trang thành viên đầu tiên.') }
  }
  return { size, tier, query, branches, scope, after, includeTotal: data.includeTotal !== false }
}

async function readLoyaltyMemberPage({ db, actor, data }) {
  const input = normalizeDirectoryInput(data, actor)
  const state = await db.doc(DIRECTORY_STATE).get()
  if (state.data()?.schemaVersion !== DIRECTORY_VERSION || state.data()?.status !== 'ready') {
    throw new HttpsError('unavailable', 'Danh sách thành viên đang được đồng bộ. Vui lòng thử lại sau.')
  }
  const groups = input.branches === null ? [null] : Array.from({ length: Math.ceil(input.branches.length / 10) }, (_, i) => input.branches.slice(i * 10, i * 10 + 10))
  const scopes = groups.map(group => {
    let query = db.collection(DIRECTORY_COLLECTION).where('schemaVersion', '==', DIRECTORY_VERSION)
    if (group) query = query.where('branchId', group.length === 1 ? '==' : 'in', group.length === 1 ? group[0] : group)
    if (input.query) query = query.where('searchPrefixes', 'array-contains', input.query)
    return query
  })
  const pages = await Promise.all(scopes.map(async scope => {
    let query = input.tier === 'all' ? scope : scope.where('tier', '==', input.tier)
    query = query.orderBy(FieldPath.documentId()).limit(input.size + 1)
    if (input.after) query = query.startAfter(input.after)
    const [page, counts] = await Promise.all([
      query.get(),
      input.includeTotal ? Promise.all(TIERS.map(async tier => Number((await scope.where('tier', '==', tier).count().get()).data().count || 0))) : null,
    ])
    return { docs: page.docs, counts }
  }))
  const candidates = pages.flatMap(page => page.docs).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
  const selected = candidates.slice(0, input.size)
  const hasMore = candidates.length > input.size
  const tierCounts = input.includeTotal ? Object.fromEntries(TIERS.map((tier, i) => [tier, pages.reduce((sum, page) => sum + page.counts[i], 0)])) : undefined
  return {
    schemaVersion: DIRECTORY_VERSION,
    ids: selected.map(doc => doc.id),
    projectedTiers: new Map(selected.map(doc => [doc.id, doc.data().tier])),
    hasMore,
    nextCursor: hasMore ? Buffer.from(JSON.stringify({ v: DIRECTORY_VERSION, scope: input.scope, id: selected.at(-1).id })).toString('base64url') : null,
    totalCount: tierCounts ? input.tier === 'all' ? Object.values(tierCounts).reduce((a, b) => a + b, 0) : tierCounts[input.tier] : null,
    ...(tierCounts ? { tierCounts } : {}),
  }
}

module.exports = { DIRECTORY_VERSION, DIRECTORY_COLLECTION, DIRECTORY_STATE, TIERS, foldMemberSearch, memberSearchPrefixes, directorySourceChanged, directoryValue, normalizeDirectoryInput, syncLoyaltyMemberDirectory, readLoyaltyMemberPage }
