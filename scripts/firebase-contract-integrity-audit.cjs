'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const OUTPUT = path.resolve('.migration-private/firebase-contract-integrity-audit.json')

function firebaseCliAuth() {
  const cliDirectory = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliDirectory, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain Firebase access token.')
  return result.access_token
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore read failed (${response.status}): ${raw.slice(0, 300)}`)
  return raw ? JSON.parse(raw) : {}
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

async function collectionDocuments(token, collectionId) {
  const result = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ pageSize: '500', showMissing: 'false' })
    if (pageToken) params.set('pageToken', pageToken)
    const body = await requestJson(token, `${databaseBase()}/documents/${collectionId}?${params}`)
    for (const document of body.documents || []) result.push({
      id: document.name.split('/').at(-1),
      updateTime: document.updateTime || '',
      ...decodeFields(document.fields || {}),
    })
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return result
}

function dateKey(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function todayInHoChiMinh() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function contractAssigneeIds(contract) {
  return [...new Set([
    contract.trainerId,
    ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []),
    ...(Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : []),
  ].filter((value) => typeof value === 'string' && value))]
}

function issue(code, detail = {}) {
  return { code, ...detail }
}

async function main() {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Audit target points to the retired source project.')
  const token = await accessToken()
  const metadata = await requestJson(token, databaseBase())
  if (metadata.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Live database guard failed.')
  const [contracts, students, trainers, branches, packages] = await Promise.all([
    collectionDocuments(token, 'contracts'),
    collectionDocuments(token, 'students'),
    collectionDocuments(token, 'trainers'),
    collectionDocuments(token, 'branches'),
    collectionDocuments(token, 'packages'),
  ])
  const today = todayInHoChiMinh()
  const studentsById = new Map(students.map((item) => [item.id, item]))
  const trainersById = new Map(trainers.map((item) => [item.id, item]))
  const branchesById = new Map(branches.map((item) => [item.id, item]))
  const packagesById = new Map(packages.map((item) => [item.id, item]))
  const currentContracts = contracts.filter((contract) => {
    const status = String(contract.status || 'active').toLowerCase()
    return !['cancelled', 'inactive', 'archived', 'draft'].includes(status) && dateKey(contract.endDate) >= today
  })
  const overlappingByContract = new Map()
  const currentByStudent = new Map()
  currentContracts.filter((contract) => !['expired', 'cancelled', 'inactive', 'archived', 'draft'].includes(String(contract.status || 'active').toLowerCase())).forEach((contract) => {
    const rows = currentByStudent.get(contract.studentId) || []
    rows.push(contract)
    currentByStudent.set(contract.studentId, rows)
  })
  currentByStudent.forEach((studentContracts) => {
    for (let leftIndex = 0; leftIndex < studentContracts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < studentContracts.length; rightIndex += 1) {
        const left = studentContracts[leftIndex]
        const right = studentContracts[rightIndex]
        const overlapStart = [today, dateKey(left.startDate), dateKey(right.startDate)].sort().at(-1)
        const overlapEnd = [dateKey(left.endDate), dateKey(right.endDate)].sort()[0]
        if (overlapStart && overlapEnd && overlapStart <= overlapEnd) {
          overlappingByContract.set(left.id, [...(overlappingByContract.get(left.id) || []), right.id])
          overlappingByContract.set(right.id, [...(overlappingByContract.get(right.id) || []), left.id])
        }
      }
    }
  })
  const renewalSourceIds = new Set(contracts.map((contract) => contract.sourceContractId).filter(Boolean))
  const rows = currentContracts.map((contract) => {
    const student = studentsById.get(contract.studentId)
    const startDate = dateKey(contract.startDate)
    const endDate = dateKey(contract.endDate)
    const totalSessions = Number(contract.totalSessions)
    const usedSessions = Number(contract.usedSessions || 0)
    const problems = []
    if (!student) problems.push(issue('STUDENT_NOT_FOUND'))
    else if (!student.branchId) problems.push(issue('STUDENT_BRANCH_MISSING'))
    if (!startDate || !endDate || startDate > endDate) problems.push(issue('CONTRACT_DATE_INVALID', { startDate, endDate }))
    if (!contract.branchId) problems.push(issue('CONTRACT_BRANCH_MISSING'))
    else if (!branchesById.has(contract.branchId)) problems.push(issue('CONTRACT_BRANCH_NOT_FOUND', { branchId: contract.branchId }))
    if (student?.branchId && contract.branchId && student.branchId !== contract.branchId) problems.push(issue('STUDENT_BRANCH_MISMATCH', { studentBranchId: student.branchId, contractBranchId: contract.branchId }))
    if (!contract.packageId) problems.push(issue('PACKAGE_MISSING'))
    else if (!packagesById.has(contract.packageId)) problems.push(issue('PACKAGE_NOT_FOUND', { packageId: contract.packageId }))
    if (!Number.isFinite(totalSessions) || totalSessions <= 0) problems.push(issue('TOTAL_SESSIONS_INVALID', { totalSessions: contract.totalSessions ?? null }))
    if (!Number.isFinite(usedSessions) || usedSessions < 0 || (Number.isFinite(totalSessions) && usedSessions > totalSessions)) problems.push(issue('USED_SESSIONS_OUT_OF_RANGE', { usedSessions: contract.usedSessions ?? null, totalSessions: contract.totalSessions ?? null }))
    const storedStatus = String(contract.status || 'active').toLowerCase()
    const expectedStatus = startDate > today ? 'future' : storedStatus === 'frozen' ? 'frozen' : storedStatus === 'expired' ? 'expired' : 'active'
    if (storedStatus !== expectedStatus) problems.push(issue('STORED_STATUS_STALE', { storedStatus, expectedStatus }))
    if (storedStatus === 'expired' && startDate <= today && endDate >= today
      && usedSessions < totalSessions && !contract.renewalSupersededBy && !contract.renewedByContractId && !renewalSourceIds.has(contract.id)) {
      problems.push(issue('EXPIRED_WITH_REMAINING_RIGHTS', { remainingSessions: totalSessions - usedSessions }))
    }
    const overlappingContractIds = overlappingByContract.get(contract.id) || []
    if (overlappingContractIds.length) problems.push(issue('OVERLAPPING_CURRENT_CONTRACT', { overlappingContractIds }))
    for (const assigneeId of contractAssigneeIds(contract)) {
      const trainer = trainersById.get(assigneeId)
      if (!trainer) problems.push(issue('ASSIGNEE_NOT_FOUND', { assigneeId }))
      else {
        if (trainer.status === 'inactive') problems.push(issue('ASSIGNEE_INACTIVE', { assigneeId, assigneeName: trainer.name || trainer.displayName || '' }))
        if (contract.branchId && trainer.branchId && trainer.branchId !== contract.branchId) problems.push(issue('ASSIGNEE_BRANCH_MISMATCH', { assigneeId, assigneeName: trainer.name || trainer.displayName || '', assigneeBranchId: trainer.branchId }))
      }
    }
    return {
      contractId: contract.id,
      studentId: contract.studentId || '',
      studentName: student?.name || student?.displayName || 'Không tìm thấy học viên',
      packageName: contract.packageName || packagesById.get(contract.packageId)?.name || contract.packageId || 'Chưa có tên gói',
      branchId: contract.branchId || '',
      branchName: branchesById.get(contract.branchId)?.name || contract.branchId || 'Chưa có chi nhánh',
      status: storedStatus,
      startDate,
      endDate,
      totalSessions: Number.isFinite(totalSessions) ? totalSessions : null,
      usedSessions: Number.isFinite(usedSessions) ? usedSessions : null,
      packageSessions: Number.isFinite(Number(contract.packageSessions)) ? Number(contract.packageSessions) : null,
      carriedOverSessions: Number.isFinite(Number(contract.carriedOverSessions)) ? Number(contract.carriedOverSessions) : null,
      carryOverTransferredSessions: Number.isFinite(Number(contract.carryOverTransferredSessions)) ? Number(contract.carryOverTransferredSessions) : null,
      sourceContractId: contract.sourceContractId || null,
      renewalSupersededBy: contract.renewalSupersededBy || contract.renewedByContractId || null,
      issues: problems,
    }
  })
  const issueRows = rows.filter((row) => row.issues.length)
  const byCode = issueRows.flatMap((row) => row.issues).reduce((result, item) => {
    result[item.code] = (result[item.code] || 0) + 1
    return result
  }, {})
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    target: TARGET,
    today,
    collectionCounts: { contracts: contracts.length, students: students.length, trainers: trainers.length, branches: branches.length, packages: packages.length },
    summary: { currentContracts: rows.length, contractsNeedingReview: issueRows.length, cleanCurrentContracts: rows.length - issueRows.length, byCode },
    contractsNeedingReview: issueRows,
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ output: OUTPUT, ...report.summary }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
