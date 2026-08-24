const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const renewalStages = new Set(['uncontacted', 'contacted', 'interested', 'quote_sent', 'follow_up', 'won', 'lost'])
const activeContractStatuses = new Set(['active', 'future', 'frozen', 'expired'])
const maximumContracts = 2000

function boundedString(value, label, maximum, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedString(value, label, 200)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function dateKey(value, label = 'Ngày') {
  const result = boundedString(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function optionalDateKey(value, label = 'Ngày') {
  if (value === null || value === undefined || value === '') return null
  return dateKey(value, label)
}

function safeMoney(value, label, allowZero = true) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 10_000_000_000) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return number
}

function safeInteger(value, label, minimum, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return number
}

function vietnamDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function dateOrdinal(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function addMonthsDateKey(value, months) {
  const source = dateKey(value, 'Ngày bắt đầu')
  const duration = safeInteger(months, 'Thời hạn gói', 1, 60)
  const [year, month, day] = source.split('-').map(Number)
  const targetMonthIndex = month - 1 + duration
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function serializeTimestamp(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  return typeof value === 'string' ? value : null
}

function normalizeInstallments(value, remainingAmount, startDate, endDate) {
  if (!remainingAmount) return []
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new HttpsError('invalid-argument', 'Cần lịch thanh toán cho phần công nợ còn lại.')
  }
  const installments = value.map((item, index) => {
    const date = dateKey(item?.date, `Ngày thanh toán kỳ ${index + 1}`)
    if (date < startDate || date > endDate) throw new HttpsError('invalid-argument', 'Ngày trả góp phải nằm trong thời hạn hợp đồng mới.')
    return {
      id: boundedString(item?.id || `installment-${index + 1}`, `Mã kỳ ${index + 1}`, 100),
      date,
      amount: safeMoney(item?.amount, `Số tiền kỳ ${index + 1}`, false),
      status: 'pending',
    }
  })
  const total = installments.reduce((sum, item) => sum + item.amount, 0)
  if (total !== remainingAmount) throw new HttpsError('invalid-argument', 'Tổng lịch trả góp không khớp công nợ còn lại.')
  return installments.sort((left, right) => left.date.localeCompare(right.date))
}

function renewalRisk(contract, today = vietnamDateKey()) {
  const totalSessions = Math.max(0, Number(contract.totalSessions || 0))
  const usedSessions = Math.max(0, Number(contract.usedSessions || 0))
  const sessionsLeft = Math.max(0, totalSessions - usedSessions)
  const daysLeft = dateOrdinal(contract.endDate) - dateOrdinal(today)
  if (sessionsLeft <= 0 && daysLeft >= 0) return { category: 'exhausted', daysLeft, sessionsLeft }
  if (daysLeft < 0 || contract.status === 'expired') return { category: 'expired', daysLeft, sessionsLeft }
  if (daysLeft <= 7 || sessionsLeft <= 1) return { category: 'critical', daysLeft, sessionsLeft }
  if (daysLeft <= 30 || sessionsLeft <= 3) return { category: 'upcoming', daysLeft, sessionsLeft }
  if (daysLeft <= 60 || sessionsLeft <= 5) return { category: 'early', daysLeft, sessionsLeft }
  return { category: 'healthy', daysLeft, sessionsLeft }
}

function latestContractsByStudent(contracts) {
  const result = new Map()
  for (const contract of contracts) {
    if (!contract.studentId || contract.status === 'cancelled') continue
    const current = result.get(contract.studentId)
    if (!current || String(contract.endDate || '').localeCompare(String(current.endDate || '')) > 0
      || (contract.endDate === current.endDate && String(contract.startDate || '').localeCompare(String(current.startDate || '')) > 0)) {
      result.set(contract.studentId, contract)
    }
  }
  return result
}

async function renewalActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'sales.operations.manage')
  return actor
}

function createContractRenewalFunctions({ db, onCall }) {
  const listContractRenewalPipeline = onCall(async (request) => {
    await renewalActor(request, db)
    const today = vietnamDateKey()
    const [contractsSnapshot, studentsSnapshot, packagesSnapshot, branchesSnapshot, casesSnapshot] = await Promise.all([
      db.collection('contracts').limit(maximumContracts + 1).get(),
      db.collection('students').limit(2000).get(),
      db.collection('packages').limit(500).get(),
      db.collection('branches').limit(100).get(),
      db.collection('contractRenewalCases').limit(maximumContracts).get(),
    ])
    const contracts = contractsSnapshot.docs.slice(0, maximumContracts).map((item) => ({ id: item.id, ...item.data() }))
    const students = new Map(studentsSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
    const packages = new Map(packagesSnapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
    const branches = new Map(branchesSnapshot.docs.map((item) => [item.id, item.data().name || 'Chi nhánh chưa đặt tên']))
    const cases = new Map(casesSnapshot.docs.map((item) => [item.id, item.data()]))
    const rows = []
    for (const contract of latestContractsByStudent(contracts).values()) {
      if (!contract.endDate || !activeContractStatuses.has(contract.status || 'active')) continue
      const risk = renewalRisk(contract, today)
      if (risk.category === 'healthy') continue
      const student = students.get(contract.studentId)
      if (!student || student.status === 'inactive') continue
      const pipeline = cases.get(contract.id) || {}
      const trainingPackage = packages.get(contract.packageId)
      rows.push({
        caseId: contract.id,
        student: {
          id: student.id,
          name: student.name || 'Chưa cập nhật tên',
          phone: student.phone || '',
          email: student.email || '',
        },
        contract: {
          id: contract.id,
          packageId: contract.packageId || '',
          packageName: contract.packageName || trainingPackage?.name || 'Gói tập Aura',
          startDate: contract.startDate || '',
          endDate: contract.endDate,
          status: contract.status || 'active',
          totalSessions: Number(contract.totalSessions || 0),
          usedSessions: Number(contract.usedSessions || 0),
          totalPrice: Number(contract.totalPrice || trainingPackage?.price || 0),
          paidAmount: Number(contract.paidAmount || 0),
          discount: Number(contract.discount || 0),
          branchId: contract.branchId || student.branchId || '',
          trainerId: contract.trainerId || '',
          trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds : [],
          nutritionPTIds: Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : [],
          revision: Number(contract.revision || 0),
        },
        branchName: branches.get(contract.branchId || student.branchId || '') || 'Chưa phân chi nhánh',
        risk,
        expectedValue: Math.max(0, Number(trainingPackage?.price || contract.totalPrice || 0)),
        stage: renewalStages.has(pipeline.stage) ? pipeline.stage : 'uncontacted',
        caseRevision: Number(pipeline.revision || 0),
        nextFollowUpAt: pipeline.nextFollowUpAt || null,
        lastContactAt: serializeTimestamp(pipeline.lastContactAt),
        note: typeof pipeline.note === 'string' ? pipeline.note.slice(0, 500) : '',
        renewedContractId: contract.renewedByContractId || pipeline.renewedContractId || null,
      })
    }
    const categoryRank = { expired: 0, exhausted: 1, critical: 2, upcoming: 3, early: 4 }
    rows.sort((left, right) => (categoryRank[left.risk.category] ?? 9) - (categoryRank[right.risk.category] ?? 9)
      || left.risk.daysLeft - right.risk.daysLeft
      || left.student.name.localeCompare(right.student.name, 'vi'))
    const stageCounts = Object.fromEntries([...renewalStages].map((stage) => [stage, 0]))
    const riskCounts = { expired: 0, exhausted: 0, critical: 0, upcoming: 0, early: 0 }
    let pipelineValue = 0
    for (const row of rows) {
      stageCounts[row.stage] += 1
      riskCounts[row.risk.category] += 1
      if (!['won', 'lost'].includes(row.stage)) pipelineValue += row.expectedValue
    }
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      today,
      rows,
      packages: [...packages.values()].filter((item) => item.status !== 'archived').map((item) => ({
        id: item.id, name: item.name || 'Gói tập Aura', price: Number(item.price || 0),
        totalSessions: Number(item.totalSessions || 0), durationMonths: Number(item.durationMonths || 0), branchId: item.branchId || '',
      })),
      stats: { total: rows.length, pipelineValue, stageCounts, riskCounts },
      truncated: contractsSnapshot.size > maximumContracts,
    }
  })

  const updateContractRenewalCase = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const sourceContractId = documentId(request.data?.sourceContractId, 'Hợp đồng nguồn')
    const stage = boundedString(request.data?.stage, 'Giai đoạn chăm sóc', 30)
    if (!renewalStages.has(stage)) throw new HttpsError('invalid-argument', 'Giai đoạn chăm sóc không hợp lệ.')
    if (stage === 'won') throw new HttpsError('failed-precondition', 'Giai đoạn đã tái ký chỉ được ghi nhận bởi giao dịch tái ký thành công.')
    const expectedRevision = safeInteger(request.data?.expectedRevision ?? 0, 'Phiên bản chăm sóc', 0, 1_000_000)
    const nextFollowUpAt = optionalDateKey(request.data?.nextFollowUpAt, 'Ngày chăm sóc tiếp theo')
    const note = boundedString(request.data?.note, 'Ghi chú', 500, false)
    const caseReference = db.doc(`contractRenewalCases/${sourceContractId}`)
    await db.runTransaction(async (transaction) => {
      const [contractSnapshot, caseSnapshot] = await Promise.all([
        transaction.get(db.doc(`contracts/${sourceContractId}`)), transaction.get(caseReference),
      ])
      if (!contractSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng cần chăm sóc.')
      const currentRevision = caseSnapshot.exists ? Number(caseSnapshot.data().revision || 0) : 0
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Thông tin chăm sóc đã được người khác cập nhật. Hãy tải lại.')
      transaction.set(caseReference, {
        schemaVersion: 1, sourceContractId, studentId: contractSnapshot.data().studentId || '',
        branchId: contractSnapshot.data().branchId || '', stage, nextFollowUpAt, note,
        revision: currentRevision + 1, lastContactAt: stage === 'uncontacted' ? null : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
        ...(caseSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }),
      }, { merge: true })
      transaction.create(db.collection('contractRenewalAuditLogs').doc(), {
        action: 'renewal_case.updated', sourceContractId, studentId: contractSnapshot.data().studentId || '',
        beforeStage: caseSnapshot.exists ? caseSnapshot.data().stage || 'uncontacted' : 'uncontacted',
        afterStage: stage, actorUid: actor.uid, createdAt: FieldValue.serverTimestamp(),
      })
    })
    return { sourceContractId, stage, revision: expectedRevision + 1 }
  })

  const renewPtContract = onCall(async (request) => {
    const actor = await renewalActor(request, db)
    const sourceContractId = documentId(request.data?.sourceContractId, 'Hợp đồng nguồn')
    const packageId = documentId(request.data?.packageId, 'Gói tập')
    const startDate = dateKey(request.data?.startDate, 'Ngày bắt đầu')
    const expectedSourceRevision = safeInteger(request.data?.expectedSourceRevision ?? 0, 'Phiên bản hợp đồng', 0, 1_000_000)
    const idempotencyKey = boundedString(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const carryOver = request.data?.carryOver === true
    const discount = safeMoney(request.data?.discount || 0, 'Giảm giá')
    const initialPayment = safeMoney(request.data?.initialPayment || 0, 'Thanh toán đầu kỳ')
    const paymentMethod = initialPayment ? boundedString(request.data?.paymentMethod, 'Phương thức thanh toán', 50) : ''
    const note = boundedString(request.data?.note, 'Ghi chú', 500, false)
    const trainerIds = Array.isArray(request.data?.trainerIds)
      ? [...new Set(request.data.trainerIds.map((item) => documentId(item, 'Huấn luyện viên')))].slice(0, 10) : []
    const nutritionPTIds = Array.isArray(request.data?.nutritionPTIds)
      ? [...new Set(request.data.nutritionPTIds.map((item) => documentId(item, 'PT dinh dưỡng')))].slice(0, 10) : []
    const sourceReference = db.doc(`contracts/${sourceContractId}`)
    const packageReference = db.doc(`packages/${packageId}`)
    const newContractReference = db.collection('contracts').doc()
    const paymentReference = db.collection('ledgerEntries').doc()
    const caseReference = db.doc(`contractRenewalCases/${sourceContractId}`)
    const paymentPeriodReference = db.doc(`financePeriods/${vietnamDateKey().slice(0, 7)}`)

    return db.runTransaction(async (transaction) => {
      const [sourceSnapshot, packageSnapshot, caseSnapshot, paymentPeriodSnapshot] = await Promise.all([
        transaction.get(sourceReference), transaction.get(packageReference), transaction.get(caseReference), transaction.get(paymentPeriodReference),
      ])
      if (!sourceSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng nguồn.')
      if (!packageSnapshot.exists || packageSnapshot.data().status === 'archived') throw new HttpsError('not-found', 'Gói tập không còn hiệu lực.')
      const source = sourceSnapshot.data()
      const trainingPackage = packageSnapshot.data()
      if (source.status === 'cancelled') throw new HttpsError('failed-precondition', 'Hợp đồng đã hủy không thể tái ký.')
      if (Number(source.revision || 0) !== expectedSourceRevision) throw new HttpsError('aborted', 'Hợp đồng nguồn vừa được thay đổi. Hãy tải lại.')
      if (source.renewalIdempotencyKey === idempotencyKey && source.renewedByContractId) {
        return { contractId: source.renewedByContractId, paymentEntryId: source.renewalPaymentEntryId || null, unchanged: true }
      }
      if (source.renewedByContractId) throw new HttpsError('already-exists', 'Hợp đồng này đã được tái ký.')
      if (trainingPackage.branchId && source.branchId && trainingPackage.branchId !== source.branchId) {
        throw new HttpsError('failed-precondition', 'Gói tập không thuộc chi nhánh của hợp đồng.')
      }
      const durationMonths = safeInteger(trainingPackage.durationMonths, 'Thời hạn gói', 1, 60)
      const packageSessions = safeInteger(trainingPackage.totalSessions, 'Số buổi gói', 1, 1000)
      const packagePrice = safeMoney(trainingPackage.price, 'Giá gói', false)
      if (discount > packagePrice) throw new HttpsError('invalid-argument', 'Giảm giá vượt giá gói.')
      const totalDue = packagePrice - discount
      if (initialPayment > totalDue) throw new HttpsError('invalid-argument', 'Thanh toán đầu kỳ vượt giá trị hợp đồng.')
      if (initialPayment > 0 && paymentPeriodSnapshot.exists && paymentPeriodSnapshot.data().status === 'locked') {
        throw new HttpsError('failed-precondition', 'Kỳ tài chính hiện tại đã khóa, không thể ghi khoản thu đầu kỳ.')
      }
      const remainingSessions = Math.max(0, Number(source.totalSessions || 0) - Number(source.usedSessions || 0))
      const carriedOverSessions = carryOver ? remainingSessions : 0
      const endDate = addMonthsDateKey(startDate, durationMonths)
      const remainingAmount = totalDue - initialPayment
      const installments = normalizeInstallments(request.data?.installments, remainingAmount, startDate, endDate)
      const today = vietnamDateKey()
      const status = startDate > today ? 'future' : 'active'
      const newContract = {
        schemaVersion: 2, studentId: source.studentId, trainerId: trainerIds[0] || source.trainerId || null,
        trainerIds: trainerIds.length ? trainerIds : (Array.isArray(source.trainerIds) ? source.trainerIds : source.trainerId ? [source.trainerId] : []),
        nutritionPTIds: nutritionPTIds.length ? nutritionPTIds : (Array.isArray(source.nutritionPTIds) ? source.nutritionPTIds : []),
        branchId: source.branchId || trainingPackage.branchId || null, packageId, packageName: trainingPackage.name || 'Gói tập Aura',
        startDate, endDate, originalEndDate: endDate, totalSessions: packageSessions + carriedOverSessions,
        packageSessions, carriedOverSessions, usedSessions: 0, totalPrice: packagePrice, discount,
        paidAmount: initialPayment, status, installments, nextPaymentDate: installments[0]?.date || null,
        sourceContractId, renewalType: 'renewal', revision: 0, note,
        createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.create(newContractReference, newContract)
      let paymentEntryId = null
      if (initialPayment > 0) {
        paymentEntryId = paymentReference.id
        transaction.create(paymentReference, {
          schemaVersion: 2, type: 'payment', eventClass: 'cash_collection', source: 'pt_gym',
          contractId: newContractReference.id, studentId: source.studentId || '', branchId: newContract.branchId || '',
          installmentId: null, cashAccountId: null, amount: initialPayment, cashImpact: initialPayment,
          revenueImpact: 0, receivableImpact: 0, deferredRevenueImpact: initialPayment,
          effectiveAt: Timestamp.fromDate(new Date()), createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
          paymentMethod, referenceCode: `THU-${paymentReference.id.slice(0, 8).toUpperCase()}`,
          idempotencyKey: `renewal-payment:${idempotencyKey}`, status: 'posted', note: `Thu đầu kỳ hợp đồng tái ký ${newContractReference.id}`,
        })
      }
      const sourceShouldExpire = source.endDate < today || Number(source.usedSessions || 0) >= Number(source.totalSessions || 0)
      transaction.update(sourceReference, {
        ...(sourceShouldExpire ? { status: 'expired' } : {}), renewalIdempotencyKey: idempotencyKey,
        renewedByContractId: newContractReference.id, renewalPaymentEntryId: paymentEntryId,
        renewedAt: FieldValue.serverTimestamp(), renewedBy: actor.uid, revision: expectedSourceRevision + 1,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(caseReference, {
        schemaVersion: 1, sourceContractId, studentId: source.studentId || '', branchId: source.branchId || '',
        stage: 'won', renewedContractId: newContractReference.id, revision: Number(caseSnapshot.data()?.revision || 0) + 1,
        wonAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
        ...(caseSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }),
      }, { merge: true })
      transaction.create(db.collection('contractRenewalAuditLogs').doc(), {
        action: 'contract.renewed', sourceContractId, newContractId: newContractReference.id,
        studentId: source.studentId || '', packageId, carriedOverSessions, initialPayment,
        actorUid: actor.uid, createdAt: FieldValue.serverTimestamp(),
      })
      return { contractId: newContractReference.id, paymentEntryId, unchanged: false }
    })
  })

  return { listContractRenewalPipeline, updateContractRenewalCase, renewPtContract }
}

module.exports = {
  createContractRenewalFunctions,
  addMonthsDateKey,
  normalizeInstallments,
  renewalRisk,
  latestContractsByStudent,
}
