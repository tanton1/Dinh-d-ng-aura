'use strict'

const { createHash } = require('node:crypto')
const { FieldPath, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { contractPausedOn, contractSchedulableOn, effectiveContractStatus } = require('./contract-status')
const { contractSchedulingRemaining } = require('./contract-scheduling')
const { canonicalUsageSummary, contractWithUsageView } = require('./contract-usage-view-core')
const { vietnamDateKey, dateKey, addDateDays } = require('./pt-policy')
const { reviewPage } = require('./scoped-review-pagination')

const STATUSES = new Set(['all', 'active', 'expiring_week', 'expiring_month', 'expired', 'paused', 'inactive', 'cancelled'])
const ATTENTION = new Set(['', 'stable', 'attention', 'action_required'])
const text = (value, maximum = 200) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
const fold = value => text(value, 1000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
const date = value => typeof value === 'string' ? value.slice(0, 10) : value?.toDate ? vietnamDateKey(value.toDate()) : ''
const joinedDate = value => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateKey(value) ? value : ''
  const instant = value?.toDate ? value.toDate() : new Date(value || '')
  return Number.isNaN(instant.getTime()) ? '' : vietnamDateKey(instant)
}
const errorCursor = () => new HttpsError('invalid-argument', 'Trang học viên không còn phù hợp với tài khoản hoặc bộ lọc. Hãy tải lại.')
function validDateKey(value) { try { return dateKey(value) === value } catch { return false } }
function mondayOfWeek(value) { const weekday = new Date(`${value}T12:00:00Z`).getUTCDay(); return addDateDays(value, weekday === 0 ? -6 : 1 - weekday) }

// The chain rule matches the frontend's contractSchedulableInChainOn and is
// regression-checked against it. Entitlement and pause rules use the backend
// contract modules shared with schedule publication.
function contractAvailable(contract, contracts, targetDate) {
  if (contract.status !== 'future' || !contract.sourceContractId) return contractSchedulableOn(contract, targetDate)
  const source = contracts.find(item => item.id === contract.sourceContractId && item.studentId === contract.studentId && item.branchId === contract.branchId)
  if (!source || ['cancelled', 'frozen'].includes(source.status) || source.renewalSupersededBy
    || contractPausedOn(source, targetDate) || contractPausedOn(contract, targetDate)
    || targetDate < source.startDate || targetDate > contract.endDate || (contract.signedDate && targetDate < contract.signedDate)) return false
  return contract.activationMode !== 'fixed_date' && contract.earlyHandoverRequested !== false
    ? targetDate > source.endDate || contractSchedulingRemaining(source) === 0
    : targetDate >= contract.startDate
}

function directoryWeekEligibility(student, contracts, weekId, referenceDate) {
  const empty = { eligible: false, eligibleContracts: [], validDates: [], pausedDates: [], remainingSessions: 0 }
  if (['inactive', 'archived', 'deleted'].includes(String(student.status || '').toLowerCase()) || !student.branchId) return empty
  const dates = Array.from({ length: 7 }, (_, index) => addDateDays(weekId, index)).filter(value => value >= referenceDate)
  const eligibleContracts = [], validDates = new Set(), pausedDates = new Set()
  let remainingSessions = 0
  for (const contract of contracts) {
    if (contract.studentId !== student.id || contract.branchId !== student.branchId || !date(contract.startDate) || !date(contract.endDate)) continue
    const remaining = contractSchedulingRemaining(contract)
    if (remaining < 1) continue
    let usable = false
    for (const targetDate of dates) {
      if (contractPausedOn(contract, targetDate)) {
        const unpaused = { ...contract, status: contract.status === 'frozen' ? 'active' : contract.status, pausePeriods: [] }
        if (contractAvailable(unpaused, contracts, targetDate)) pausedDates.add(targetDate)
        continue
      }
      if (!contractAvailable(contract, contracts, targetDate)) continue
      usable = true; validDates.add(targetDate)
    }
    if (usable) { eligibleContracts.push(contract); remainingSessions += remaining }
  }
  return { eligible: validDates.size > 0, eligibleContracts: eligibleContracts.sort((a, b) => a.endDate.localeCompare(b.endDate)), validDates: [...validDates].sort(), pausedDates: [...pausedDates].sort(), remainingSessions }
}

function basicMatch(student, filters) {
  if (filters.branchId && (filters.branchId === 'none' ? Boolean(student.branchId) : student.branchId !== filters.branchId)) return false
  if (filters.query) {
    const haystack = fold(`${student.name || ''} ${student.phone || ''} ${student.email || ''}`)
    if (!haystack.includes(filters.query) && !haystack.replace(/\s/g, '').includes(filters.query.replace(/\s/g, ''))) return false
  }
  if (filters.joinedFrom || filters.joinedTo) {
    const joined = joinedDate(student.joinDate)
    if (!joined || (filters.joinedFrom && joined < filters.joinedFrom) || (filters.joinedTo && joined > filters.joinedTo)) return false
  }
  return true
}

function directoryMatches(student, contracts, eligibility, projection, filters) {
  if (!basicMatch(student, filters)) return false
  if (filters.attention && projection?.health?.status !== filters.attention) return false
  const active = eligibility.eligibleContracts
  if (filters.trainerId && !(filters.trainerId === 'none'
    ? active.every(contract => !contract.trainerId && !contract.trainerIds?.length)
    : active.some(contract => contract.trainerId === filters.trainerId || contract.trainerIds?.includes(filters.trainerId)))) return false
  if (filters.nutritionPTId && !(filters.nutritionPTId === 'none'
    ? active.every(contract => !contract.nutritionPTIds?.length)
    : active.some(contract => contract.nutritionPTIds?.includes(filters.nutritionPTId)))) return false
  const latest = contracts[0]
  if (filters.contractStatus === 'all') return true
  if (filters.contractStatus === 'inactive') return student.status === 'inactive'
  if (filters.contractStatus === 'active') return eligibility.eligible
  if (filters.contractStatus === 'paused') return latest?.status === 'frozen' || Boolean(!eligibility.eligible && eligibility.pausedDates.length)
  if (filters.contractStatus === 'cancelled') return latest?.status === 'cancelled'
  if (filters.contractStatus === 'expiring_week' || filters.contractStatus === 'expiring_month') {
    const contract = active[0]
    if (!contract) return false
    const daysLeft = Math.ceil((Date.parse(`${date(contract.endDate)}T23:59:59+07:00`) - Date.parse(`${filters.referenceDate}T12:00:00+07:00`)) / 86400000)
    const remaining = Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0)
    return filters.contractStatus === 'expiring_week' ? daysLeft <= 7 || remaining <= 2 : daysLeft <= 31 || remaining <= 5
  }
  if (student.status === 'inactive' || !latest) return false
  if (latest.status === 'expired') return true
  return latest.status === 'active' && (date(latest.endDate) < filters.referenceDate || Number(latest.totalSessions || 0) - Number(latest.usedSessions || 0) <= 0)
}

function configFor(actor, data) {
  // This mode replaces the admin-only legacy CRM listener. Staff continue to
  // use the existing assignment-scoped projection directory, never a scan of
  // canonical profiles/contracts followed by a client-side scope filter.
  if (!['admin', 'super_admin'].includes(actor.accessRole)) throw new HttpsError('permission-denied', 'Danh bạ quản trị chỉ dành cho quản trị viên Aura.')
  const referenceDate = vietnamDateKey()
  const filters = {
    query: fold(text(data.query, 100)), branchId: data.branchId === 'all' ? '' : text(data.branchId),
    trainerId: data.trainerId === 'all' ? '' : text(data.trainerId), nutritionPTId: data.nutritionPTId === 'all' ? '' : text(data.nutritionPTId),
    attention: text(data.attention, 40), contractStatus: text(data.contractStatus, 30) || 'all',
    joinedFrom: text(data.joinedFrom, 10), joinedTo: text(data.joinedTo, 10),
    weekId: text(data.weekId, 10) || mondayOfWeek(referenceDate), referenceDate,
  }
  if (!STATUSES.has(filters.contractStatus) || !ATTENTION.has(filters.attention) || !validDateKey(filters.weekId)
    || (filters.joinedFrom && !validDateKey(filters.joinedFrom)) || (filters.joinedTo && !validDateKey(filters.joinedTo))
    || (filters.joinedFrom && filters.joinedTo && filters.joinedFrom > filters.joinedTo)) throw new HttpsError('invalid-argument', 'Bộ lọc học viên không hợp lệ.')
  const scope = createHash('sha256').update(JSON.stringify([actor.uid, actor.accessRole, actor.authzVersion, [...(actor.branchIds || [])].sort(), filters])).digest('hex')
  let after = '', matched = 0, scannedTotal = 0, readTime = null
  if (data.cursor) {
    try {
      if (typeof data.cursor !== 'string' || data.cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(data.cursor)) throw errorCursor()
      const cursor = JSON.parse(Buffer.from(data.cursor, 'base64url').toString('utf8'))
      if (cursor.v !== 2 || cursor.scope !== scope || typeof cursor.after !== 'string' || !cursor.after || cursor.after.includes('/') || Buffer.byteLength(cursor.after, 'utf8') > 1500
        || !Number.isSafeInteger(cursor.matched) || cursor.matched < 0 || !Number.isSafeInteger(cursor.scanned) || cursor.scanned < cursor.matched
        || !Number.isInteger(cursor.seconds) || !Number.isInteger(cursor.nanos) || cursor.nanos % 1000 !== 0) throw errorCursor()
      readTime = new Timestamp(cursor.seconds, cursor.nanos)
      if (Date.now() - readTime.toMillis() > 15 * 60 * 1000 || readTime.toMillis() > Date.now() + 5000) throw new HttpsError('failed-precondition', 'Phiên danh bạ đã hết hạn. Hãy tải lại danh sách học viên.')
      after = cursor.after; matched = cursor.matched; scannedTotal = cursor.scanned
    } catch (error) { if (error.code === 'failed-precondition') throw error; throw errorCursor() }
  }
  return { filters, scope, after, matched, scannedTotal, readTime, pageSize: Math.min(50, Math.max(1, Number.isInteger(data.pageSize) ? data.pageSize : 30)) }
}

async function listAdminStudentDirectory({ db, actor, data = {} }) {
  const config = configFor(actor, data)
  if (data.optionsOnly === true) {
    const page = reviewPage(actor, ['student_directory_trainers'], data.optionsCursor, 100, 100)
    let query = db.collection('trainers').orderBy(FieldPath.documentId(), 'asc')
    if (page.after) query = query.startAfter(page.after[0])
    const snapshot = await query.limit(101).get()
    const documents = snapshot.docs.slice(0, 100)
    return { schemaVersion: 2, mode: 'admin', rows: [], hasMore: false, nextCursor: null, totalMatched: null, scanned: 0, truncated: false,
      filterOptions: { trainers: documents.map(item => ({ id: item.id, name: item.data().name || 'Nhân sự Aura' })), hasMore: snapshot.size > 100, nextCursor: snapshot.size > 100 ? page.next([documents.at(-1).id]) : null },
    }
  }
  return db.runTransaction(async transaction => {
    const get = async query => {
      const snapshot = await transaction.get(query)
      if (!config.readTime) config.readTime = snapshot.readTime
      return snapshot
    }
    const rows = []
    let scanned = 0, after = config.after, sourceExhausted = false
    scan: while (rows.length < config.pageSize && scanned < 500) {
      let query = db.collection('students').orderBy(FieldPath.documentId(), 'asc')
      if (config.filters.branchId && config.filters.branchId !== 'none') query = query.where('branchId', '==', config.filters.branchId)
      if (after) query = query.startAfter(after)
      const limit = Math.min(30, 500 - scanned)
      const source = await get(query.limit(limit))
      if (source.empty) { sourceExhausted = true; break }
      const students = source.docs.map(item => ({ ...item.data(), id: item.id }))
      const candidates = students.filter(student => basicMatch(student, config.filters))
      const ids = candidates.map(student => student.id)
      const [contractsSnapshot, projectionSnapshots] = ids.length ? await Promise.all([
        get(db.collection('contracts').where('studentId', 'in', ids).limit(1001)),
        transaction.getAll(...ids.map(id => db.doc(`studentOperationalViews/${id}`))),
      ]) : [{ docs: [], size: 0 }, []]
      if (contractsSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Một nhóm học viên có quá nhiều hợp đồng để lọc an toàn. Hãy thu hẹp theo tên hoặc chi nhánh; danh sách chưa được tính đầy đủ.')
      const rawContracts = contractsSnapshot.docs.map(item => ({ ...item.data(), id: item.id }))
      const usageSnapshots = rawContracts.length ? await transaction.getAll(...rawContracts.map(contract => db.doc(`contractUsageViews/${contract.id}`))) : []
      const usages = new Map(usageSnapshots.filter(item => item.exists).map(item => [item.id, item.data()]))
      const contractsByStudent = new Map()
      rawContracts.forEach(contract => {
        const usage = usages.get(contract.id)
        const value = canonicalUsageSummary(usage, contract) ? contractWithUsageView(contract, usage) : contract
        const current = contractsByStudent.get(contract.studentId) || []
        current.push(value); contractsByStudent.set(contract.studentId, current)
      })
      contractsByStudent.forEach(contracts => contracts.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')) || a.id.localeCompare(b.id)))
      const projections = new Map(projectionSnapshots.filter(item => item.exists).map(item => [item.id, item.data()]))
      for (let index = 0; index < students.length; index++) {
        const student = students[index]
        after = student.id; scanned++
        if (!basicMatch(student, config.filters)) continue
        const contracts = contractsByStudent.get(student.id) || []
        const projection = projections.get(student.id)
        const eligibility = directoryWeekEligibility(student, contracts, config.filters.weekId, config.filters.referenceDate)
        if (!directoryMatches(student, contracts, eligibility, projection, config.filters)) continue
        const contract = eligibility.eligibleContracts[0] || contracts[0]
        const contractStatus = contract ? effectiveContractStatus(contract, config.filters.referenceDate) : 'invalid'
        const status = student.status === 'inactive' ? 'inactive' : ['active', 'future', 'frozen', 'expired', 'cancelled'].includes(contractStatus) ? contractStatus : 'invalid'
        rows.push({
          studentId: student.id, revision: Math.max(0, Number(student.revision || 0)), name: student.name || 'Học viên Aura', phone: student.phone || '', email: student.email || '', dob: student.dob || null,
          joinDate: joinedDate(student.joinDate) || null, sessionsPerWeek: Math.max(1, Number(student.sessionsPerWeek || 3)),
          branchId: student.branchId || '', branchName: projection?.assignments?.branchId && projection.assignments.branchId === student.branchId ? projection.assignments.branchName || '' : '',
          status, weeklyEligible: eligibility.eligible, healthAvailable: Boolean(projection?.health),
          health: projection?.health || { score: 0, status: 'attention', confidence: 'low', observedWeight: 0, components: [] },
          remainingSessions: contract ? contractSchedulingRemaining(contract) : null,
          daysRemaining: contract?.endDate ? Math.ceil((Date.parse(`${date(contract.endDate)}T00:00:00+07:00`) - Date.parse(`${config.filters.referenceDate}T00:00:00+07:00`)) / 86400000) : null,
          nextSession: projection?.schedule?.nextSession || null, sessionCount: Number(projection?.training?.sessionCount || 0), alertCount: projection?.alerts?.length || 0,
        })
        if (rows.length >= config.pageSize) {
          sourceExhausted = index === students.length - 1 && source.size < limit
          break scan
        }
      }
      if (source.size < limit) { sourceExhausted = true; break }
    }
    const branchIds = [...new Set(rows.map(row => row.branchId).filter(Boolean))]
    const branches = branchIds.length ? await transaction.getAll(...branchIds.map(id => db.doc(`branches/${id}`))) : []
    const branchNames = new Map(branches.filter(item => item.exists).map(item => [item.id, item.data().name || '']))
    const matched = config.matched + rows.length
    const scannedTotal = config.scannedTotal + scanned
    const hasMore = !sourceExhausted
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 2, scope: config.scope, after, matched, scanned: scannedTotal, seconds: config.readTime.seconds, nanos: config.readTime.nanoseconds })).toString('base64url') : null
    return { schemaVersion: 2, mode: 'admin', rows: rows.map(row => ({ ...row, branchName: branchNames.get(row.branchId) || row.branchName })),
      hasMore, nextCursor, totalMatched: sourceExhausted ? matched : null, matchedSoFar: matched, countComplete: sourceExhausted,
      scanned, scannedTotal, truncated: !sourceExhausted && scanned >= 500, asOf: config.readTime.toDate().toISOString(), weekId: config.filters.weekId,
    }
  }, { readOnly: true, ...(config.readTime ? { readTime: config.readTime } : {}) })
}

module.exports = { listAdminStudentDirectory, directoryWeekEligibility, directoryMatches, configFor }
