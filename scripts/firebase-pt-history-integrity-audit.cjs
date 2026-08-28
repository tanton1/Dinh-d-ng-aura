'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { sessionCountsTowardContract } = require('../functions/contract-usage')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATH = path.join(PRIVATE_DIR, 'firebase-pt-history-integrity-audit.json')
const LINKABLE_STATUSES = new Set(['active', 'expired', 'frozen'])

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function parseArguments(argv) {
  const result = { name: '' }
  for (const argument of argv) {
    if (argument.startsWith('--name=')) result.name = argument.slice('--name='.length)
    else if (argument === '--help' || argument === '-h') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  return result
}

function firebaseCliAuth() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${databaseBase()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

async function readCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: false }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
  })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    fields: decodeFields(row.document.fields || {}),
  }))
}

function dateKey(value) {
  const result = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : ''
}

function countBy(values, selector) {
  return values.reduce((result, value) => {
    const key = String(selector(value) || 'missing')
    result[key] = Number(result[key] || 0) + 1
    return result
  }, {})
}

function normalizedContact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function coveringContracts(contractsByStudent, studentId, sessionDate) {
  return (contractsByStudent.get(studentId) || []).filter((contract) => LINKABLE_STATUSES.has(String(contract.fields.status || ''))
    && dateKey(contract.fields.startDate) <= sessionDate
    && dateKey(contract.fields.endDate) >= sessionDate)
}

function approvedHistoricalLink(session, contract) {
  return contract
    && String(contract.fields.studentId || '') === String(session.fields.studentId || '')
    && Number(session.fields.contractLinkVersion || 0) >= 2
    && String(session.fields.contractLinkedBy || '') === 'migration:pt-history-priority-v2'
    && ['exact_contract_window', 'overlap_latest_contract_start', 'nearest_contract_date_gap', 'historical_cancelled_contract'].includes(String(session.fields.contractLinkReason || ''))
}

function linkState(session, contractsById, contractsByStudent) {
  const studentId = String(session.fields.studentId || '')
  const sessionDate = dateKey(session.fields.date)
  const contractId = String(session.fields.contractId || '')
  if (!studentId || !sessionDate) return { state: 'invalid_session', candidates: [] }
  if (contractId) {
    const contract = contractsById.get(contractId)
    const standardValid = contract
      && String(contract.fields.studentId || '') === studentId
      && LINKABLE_STATUSES.has(String(contract.fields.status || ''))
      && dateKey(contract.fields.startDate) <= sessionDate
      && dateKey(contract.fields.endDate) >= sessionDate
    const valid = standardValid || approvedHistoricalLink(session, contract)
    return { state: valid ? 'linked_valid' : 'linked_invalid', candidates: valid ? [contract] : [] }
  }
  const candidates = coveringContracts(contractsByStudent, studentId, sessionDate)
  return { state: candidates.length === 1 ? 'missing_deterministic' : candidates.length > 1 ? 'missing_ambiguous' : 'missing_unmatched', candidates }
}

function dateDistance(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`)
  const rightTime = Date.parse(`${right}T00:00:00.000Z`)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.round(Math.abs(leftTime - rightTime) / 86400000) : null
}

function nearestContractGap(session, contractsByStudent) {
  const sessionDate = dateKey(session.fields.date)
  const contracts = (contractsByStudent.get(String(session.fields.studentId || '')) || [])
    .filter((contract) => LINKABLE_STATUSES.has(String(contract.fields.status || '')))
  const ranked = contracts.flatMap((contract) => {
    const startDate = dateKey(contract.fields.startDate)
    const endDate = dateKey(contract.fields.endDate)
    if (!sessionDate || !startDate || !endDate) return []
    const gap = sessionDate < startDate ? dateDistance(sessionDate, startDate) : dateDistance(endDate, sessionDate)
    return gap === null ? [] : [{ contract, gap }]
  }).sort((left, right) => left.gap - right.gap || left.contract.id.localeCompare(right.contract.id))
  if (!ranked.length) return { gap: null, uniqueNearest: false, contract: null }
  return {
    gap: ranked[0].gap,
    uniqueNearest: ranked.length === 1 || ranked[0].gap < ranked[1].gap,
    contract: ranked[0].contract,
  }
}

function contractIsWithinDate(contract, targetDate) {
  const status = String(contract?.fields?.status || '')
  return LINKABLE_STATUSES.has(status)
    && Boolean(dateKey(contract?.fields?.startDate))
    && dateKey(contract.fields.startDate) <= targetDate
    && dateKey(contract.fields.endDate) >= targetDate
}

function contractIsEffective(contract, targetDate) {
  return String(contract?.fields?.status || '') === 'active'
    && contractIsWithinDate(contract, targetDate)
    && Math.max(0, Number(contract?.fields?.totalSessions || 0) - Number(contract?.fields?.usedSessions || 0)) > 0
}

function gapBucket(value) {
  if (value === null) return 'no_contract'
  if (value <= 1) return 'one_day'
  if (value <= 7) return 'two_to_seven_days'
  if (value <= 30) return 'eight_to_thirty_days'
  if (value <= 60) return 'thirty_one_to_sixty_days'
  return 'over_sixty_days'
}

function contractSummary(contract, sessions) {
  const startDate = dateKey(contract.fields.startDate)
  const endDate = dateKey(contract.fields.endDate)
  const linkedChargeableSessions = sessions.filter((session) => sessionCountsTowardContract(session.fields)
    && session.fields.contractId === contract.id)
  const linkedWithinContractWindow = linkedChargeableSessions.filter((session) => {
    const sessionDate = dateKey(session.fields.date)
    return Boolean(sessionDate && startDate && endDate && sessionDate >= startDate && sessionDate <= endDate)
  }).length
  const linkedChargeable = linkedChargeableSessions.length
  const stored = Math.max(0, Number(contract.fields.usedSessions || 0))
  return {
    contractHash: sha256(`contracts/${contract.id}`),
    packageName: String(contract.fields.packageName || 'Gói tập Aura'),
    status: String(contract.fields.status || ''),
    startDate,
    endDate,
    totalSessions: Math.max(0, Number(contract.fields.totalSessions || 0)),
    storedUsedSessions: stored,
    linkedChargeableSessions: linkedChargeable,
    linkedChargeableWithinContractWindow: linkedWithinContractWindow,
    linkedChargeableOutsideContractWindow: linkedChargeable - linkedWithinContractWindow,
    projectionDelta: stored - linkedChargeable,
  }
}

function buildAudit(students, contracts, sessions, requestedName) {
  const contractsById = new Map(contracts.map((item) => [item.id, item]))
  const contractsByStudent = new Map()
  contracts.forEach((contract) => {
    const studentId = String(contract.fields.studentId || '')
    const list = contractsByStudent.get(studentId) || []
    list.push(contract)
    contractsByStudent.set(studentId, list)
  })
  const sessionsByStudent = new Map()
  sessions.forEach((session) => {
    const studentId = String(session.fields.studentId || '')
    const list = sessionsByStudent.get(studentId) || []
    list.push(session)
    sessionsByStudent.set(studentId, list)
  })
  const classified = sessions.map((session) => ({ session, ...linkState(session, contractsById, contractsByStudent) }))
  const chargeable = classified.filter((item) => sessionCountsTowardContract(item.session.fields))
  const unmatchedChargeable = chargeable.filter((item) => item.state === 'missing_unmatched')
  const ambiguousChargeable = chargeable.filter((item) => item.state === 'missing_ambiguous')
  const studentsWithHistory = students.filter((student) => (sessionsByStudent.get(student.id) || []).length > 0)
  const studentsWithoutHistory = students.filter((student) => (sessionsByStudent.get(student.id) || []).length === 0)
  const studentsWithChargeableHistory = students.filter((student) => (sessionsByStudent.get(student.id) || []).some((session) => sessionCountsTowardContract(session.fields)))
  const studentsWithContracts = students.filter((student) => (contractsByStudent.get(student.id) || []).length > 0)
  const studentUsageComparisons = students.map((student) => {
    const stored = (contractsByStudent.get(student.id) || []).reduce((sum, contract) => sum + Math.max(0, Number(contract.fields.usedSessions || 0)), 0)
    const history = (sessionsByStudent.get(student.id) || []).filter((session) => sessionCountsTowardContract(session.fields)).length
    return { studentId: student.id, stored, history, delta: stored - history }
  })
  const historyBearingIdentityKeys = new Set(studentsWithHistory.flatMap((student) => [
    normalizedContact(student.fields.phone), normalizedContact(student.fields.email), normalizeText(student.fields.name),
  ].filter((value) => value && value.length >= 5)))
  const duplicateNoHistoryProfiles = studentsWithoutHistory.filter((student) => [
    normalizedContact(student.fields.phone), normalizedContact(student.fields.email), normalizeText(student.fields.name),
  ].some((value) => value && value.length >= 5 && historyBearingIdentityKeys.has(value)))
  const contractUsageComparisons = contracts.map((contract) => {
    const linked = (sessionsByStudent.get(String(contract.fields.studentId || '')) || []).filter((session) => session.fields.contractId === contract.id && sessionCountsTowardContract(session.fields)).length
    const stored = Math.max(0, Number(contract.fields.usedSessions || 0))
    return {
      stored,
      linked,
      delta: stored - linked,
      total: Math.max(0, Number(contract.fields.totalSessions || 0)),
      status: String(contract.fields.status || 'missing'),
      startDate: dateKey(contract.fields.startDate),
      endDate: dateKey(contract.fields.endDate),
    }
  })
  const targetNeedle = normalizeText(requestedName)
  const targets = targetNeedle ? students.filter((student) => normalizeText(student.fields.name || student.fields.displayName || student.fields.fullName).includes(targetNeedle)) : []
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const missingChargeable = chargeable.filter((item) => item.state !== 'linked_valid')
  const missingWithCurrentDatedContract = missingChargeable.filter((item) => (contractsByStudent.get(String(item.session.fields.studentId || '')) || [])
    .some((contract) => contractIsWithinDate(contract, today)))
  const missingWithActiveDatedContract = missingChargeable.filter((item) => (contractsByStudent.get(String(item.session.fields.studentId || '')) || [])
    .some((contract) => String(contract.fields.status || '') === 'active' && contractIsWithinDate(contract, today)))
  const missingWithFrozenDatedContract = missingChargeable.filter((item) => (contractsByStudent.get(String(item.session.fields.studentId || '')) || [])
    .some((contract) => String(contract.fields.status || '') === 'frozen' && contractIsWithinDate(contract, today)))
  const missingWithExpiredDatedContract = missingChargeable.filter((item) => (contractsByStudent.get(String(item.session.fields.studentId || '')) || [])
    .some((contract) => String(contract.fields.status || '') === 'expired' && contractIsWithinDate(contract, today)))
  const missingWithEffectiveContract = missingChargeable.filter((item) => (contractsByStudent.get(String(item.session.fields.studentId || '')) || [])
    .some((contract) => contractIsEffective(contract, today)))
  const missingAffectedStudentIds = [...new Set(missingChargeable.map((item) => String(item.session.fields.studentId || '')).filter(Boolean))]
  const missingStudentsWithCurrentDatedContract = missingAffectedStudentIds.filter((studentId) => (contractsByStudent.get(studentId) || [])
    .some((contract) => contractIsWithinDate(contract, today)))
  const missingStudentsWithEffectiveContract = missingAffectedStudentIds.filter((studentId) => (contractsByStudent.get(studentId) || [])
    .some((contract) => contractIsEffective(contract, today)))
  const unmatchedNearestCurrent = unmatchedChargeable.filter((item) => {
    const nearest = nearestContractGap(item.session, contractsByStudent)
    return nearest.uniqueNearest && contractIsWithinDate(nearest.contract, today)
  })
  const renewalContracts = contracts.filter((contract) => String(contract.fields.sourceContractId || ''))
  const renewalSourceIds = new Set(renewalContracts.map((contract) => String(contract.fields.sourceContractId || '')).filter(Boolean))
  const renewalSourceCandidateAnomalies = missingChargeable.filter((item) => item.candidates.some((candidate) => renewalSourceIds.has(candidate.id)))
  const renewalSourceNearestAnomalies = unmatchedChargeable.filter((item) => {
    const nearest = nearestContractGap(item.session, contractsByStudent)
    return nearest.uniqueNearest && renewalSourceIds.has(String(nearest.contract?.id || ''))
  })
  const dueFutureRenewals = renewalContracts.filter((contract) => String(contract.fields.status || '') === 'future'
    && dateKey(contract.fields.startDate) <= today)
  const activatedRenewals = renewalContracts.filter((contract) => ['active', 'frozen', 'expired'].includes(String(contract.fields.status || ''))
    && dateKey(contract.fields.startDate) <= today
    && contract.fields.carryOverPending !== true)
  const handoverTotalMismatches = activatedRenewals.filter((contract) => {
    const packageSessions = Math.max(0, Number(contract.fields.packageSessions || 0))
    const carriedOverSessions = Math.max(0, Number(contract.fields.carriedOverSessions || 0))
    return packageSessions > 0 && Number(contract.fields.totalSessions || 0) !== packageSessions + carriedOverSessions
  })
  const handoverSourceMismatches = activatedRenewals.filter((contract) => {
    const source = contractsById.get(String(contract.fields.sourceContractId || ''))
    return !source
      || String(source.fields.renewalSupersededBy || '') !== contract.id
      || Number(source.fields.carryOverTransferredSessions || 0) !== Number(contract.fields.carriedOverSessions || 0)
  })
  const anomalyCases = missingAffectedStudentIds.map((studentId) => {
    const studentAnomalies = missingChargeable.filter((item) => String(item.session.fields.studentId || '') === studentId)
    const studentContracts = contractsByStudent.get(studentId) || []
    return {
      studentHash: sha256(`students/${studentId}`),
      anomalySessions: studentAnomalies.map((item) => {
        const nearest = nearestContractGap(item.session, contractsByStudent)
        return {
          sessionHash: sha256(`sessions/${item.session.id}`),
          date: dateKey(item.session.fields.date),
          state: item.state,
          candidateContractHashes: item.candidates.map((contract) => sha256(`contracts/${contract.id}`)),
          nearestContractHash: nearest.contract ? sha256(`contracts/${nearest.contract.id}`) : null,
          nearestGapDays: nearest.gap,
          uniqueNearest: nearest.uniqueNearest,
        }
      }).sort((left, right) => left.date.localeCompare(right.date) || left.sessionHash.localeCompare(right.sessionHash)),
      contracts: studentContracts.map((contract) => contractSummary(contract, sessionsByStudent.get(studentId) || []))
        .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.contractHash.localeCompare(right.contractHash)),
    }
  }).sort((left, right) => left.studentHash.localeCompare(right.studentHash))
  const last30Start = new Date(`${today}T00:00:00.000Z`)
  last30Start.setUTCDate(last30Start.getUTCDate() - 29)
  const rangeStart = last30Start.toISOString().slice(0, 10)
  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    target: TARGET,
    formulaVersion: 'contract-usage-v2',
    inventory: { students: students.length, contracts: contracts.length, sessions: sessions.length },
    students: {
      byStatus: countBy(students, (item) => item.fields.status || 'missing'),
      withAnyHistory: studentsWithHistory.length,
      withoutAnyHistory: students.length - studentsWithHistory.length,
      withoutAnyHistoryByStatus: countBy(studentsWithoutHistory, (item) => item.fields.status || 'missing'),
      withoutAnyHistoryWithContract: studentsWithoutHistory.filter((student) => (contractsByStudent.get(student.id) || []).length > 0).length,
      withoutAnyHistoryPotentialDuplicateProfile: duplicateNoHistoryProfiles.length,
      withChargeableHistory: studentsWithChargeableHistory.length,
      withoutChargeableHistory: students.length - studentsWithChargeableHistory.length,
      withContracts: studentsWithContracts.length,
      withoutContracts: students.length - studentsWithContracts.length,
      sessionOrphanStudentIds: [...sessionsByStudent.keys()].filter((studentId) => studentId && !students.some((student) => student.id === studentId)).length,
      packageVsChargeableHistory: {
        matched: studentUsageComparisons.filter((item) => item.delta === 0).length,
        packageAhead: studentUsageComparisons.filter((item) => item.delta > 0).length,
        historyAhead: studentUsageComparisons.filter((item) => item.delta < 0).length,
      },
    },
    contracts: {
      matchedToLinkedEvidence: contractUsageComparisons.filter((item) => item.delta === 0 && item.stored <= item.total).length,
      projectionAhead: contractUsageComparisons.filter((item) => item.delta > 0 && item.stored <= item.total).length,
      linkedEvidenceAhead: contractUsageComparisons.filter((item) => item.delta < 0 && item.linked <= item.total).length,
      overEntitlement: contractUsageComparisons.filter((item) => item.stored > item.total || item.linked > item.total).length,
      projectionAheadByStatus: countBy(contractUsageComparisons.filter((item) => item.delta > 0), (item) => item.status),
      projectionAheadSessions: contractUsageComparisons.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0),
      projectionAheadCurrentlyDated: contractUsageComparisons.filter((item) => item.delta > 0 && item.startDate <= today && item.endDate >= today).length,
      projectionAheadCurrentlyEffective: contractUsageComparisons.filter((item) => item.delta > 0 && item.status === 'active' && item.startDate <= today && item.endDate >= today && item.linked < item.total).length,
    },
    links: {
      allSessions: countBy(classified, (item) => item.state),
      chargeableSessions: countBy(chargeable, (item) => item.state),
      affectedStudents: countBy([...new Set(chargeable.filter((item) => item.state !== 'linked_valid').map((item) => item.session.fields.studentId))], () => 'total').total || 0,
      unmatchedNearestGap: countBy(unmatchedChargeable, (item) => gapBucket(nearestContractGap(item.session, contractsByStudent).gap)),
      unmatchedWithUniqueNearestContract: unmatchedChargeable.filter((item) => nearestContractGap(item.session, contractsByStudent).uniqueNearest).length,
      ambiguousCandidateCount: countBy(ambiguousChargeable, (item) => item.candidates.length),
      currentContractContext: {
        asOf: today,
        definitionCurrentDated: 'status active/expired/frozen and startDate <= today <= endDate',
        definitionEffective: 'status active, within date, and totalSessions > usedSessions',
        unlinkedChargeableSessions: missingChargeable.length,
        sessionsWhoseStudentHasCurrentDatedContract: missingWithCurrentDatedContract.length,
        sessionsWhoseStudentHasActiveDatedContract: missingWithActiveDatedContract.length,
        sessionsWhoseStudentHasFrozenDatedContract: missingWithFrozenDatedContract.length,
        sessionsWhoseStudentHasExpiredButDatedContract: missingWithExpiredDatedContract.length,
        sessionsWhoseStudentHasEffectiveContract: missingWithEffectiveContract.length,
        affectedStudentsWithCurrentDatedContract: missingStudentsWithCurrentDatedContract.length,
        affectedStudentsWithEffectiveContract: missingStudentsWithEffectiveContract.length,
        unmatchedSessionsWhoseUniqueNearestContractIsCurrentDated: unmatchedNearestCurrent.length,
        sessionsInsideContractWindowAtTrainingDate: missingChargeable.filter((item) => item.candidates.length > 0).length,
      },
    },
    renewals: {
      contractsWithSourceLink: renewalContracts.length,
      byStatus: countBy(renewalContracts, (contract) => contract.fields.status || 'missing'),
      futurePendingHandover: renewalContracts.filter((contract) => String(contract.fields.status || '') === 'future' && contract.fields.carryOverPending === true).length,
      dueFutureNotActivated: dueFutureRenewals.length,
      activatedWithCompletedHandover: activatedRenewals.length,
      activatedTotalFormulaMismatches: handoverTotalMismatches.length,
      activatedSourceLinkMismatches: handoverSourceMismatches.length,
      unlinkedChargeableSessionsInsideSourceWindow: renewalSourceCandidateAnomalies.length,
      unmatchedChargeableSessionsWhoseUniqueNearestIsSource: renewalSourceNearestAnomalies.length,
    },
    anomalyCases,
    matchedTargets: targets.map((student) => {
      const studentSessions = sessionsByStudent.get(student.id) || []
      const studentContracts = contractsByStudent.get(student.id) || []
      const anomalies = studentSessions
        .map((session) => ({ session, ...linkState(session, contractsById, contractsByStudent) }))
        .filter((item) => item.state !== 'linked_valid')
        .map((item) => ({
          sessionHash: sha256(`sessions/${item.session.id}`),
          date: dateKey(item.session.fields.date),
          status: String(item.session.fields.status || ''),
          billingStatus: String(item.session.fields.billingStatus || ''),
          chargeable: sessionCountsTowardContract(item.session.fields),
          linkState: item.state,
          candidateContractHashes: item.candidates.map((contract) => sha256(`contracts/${contract.id}`)),
        }))
      return {
        studentHash: sha256(`students/${student.id}`),
        displayName: String(student.fields.name || student.fields.displayName || student.fields.fullName || 'Học viên Aura'),
        status: String(student.fields.status || ''),
        historySessions: studentSessions.length,
        chargeableSessions: studentSessions.filter((session) => sessionCountsTowardContract(session.fields)).length,
        chargeableLast30Days: studentSessions.filter((session) => dateKey(session.fields.date) >= rangeStart && dateKey(session.fields.date) <= today && sessionCountsTowardContract(session.fields)).length,
        linkStates: countBy(studentSessions.map((session) => ({ session, ...linkState(session, contractsById, contractsByStudent) })), (item) => item.state),
        contracts: studentContracts.map((contract) => contractSummary(contract, studentSessions)),
        anomalies,
      }
    }),
    piiPolicy: 'Only the explicitly requested display name is returned; IDs are SHA-256 hashed and contact details are omitted.',
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) {
    console.log('node scripts/firebase-pt-history-integrity-audit.cjs [--name=<student display name>]')
    return
  }
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Firestore target mismatch.')
  const [students, contracts, sessions] = await Promise.all([
    readCollection(token, 'students'), readCollection(token, 'contracts'), readCollection(token, 'sessions'),
  ])
  const report = buildAudit(students, contracts, sessions, arguments_.name)
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PT history integrity audit failed.')
  process.exitCode = 1
})
