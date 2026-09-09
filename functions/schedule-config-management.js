'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const SCHEDULE_CONFIG_CAPABILITY = 'pt.operations.manage'
const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DAY_SET = new Set(DAYS)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function clean(value, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function integer(value, label, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpsError('invalid-argument', `${label} phải là số nguyên từ ${minimum} đến ${maximum}.`)
  }
  return parsed
}

function validIdempotencyKey(value) {
  const normalized = clean(value, 120)
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(normalized)) throw new HttpsError('invalid-argument', 'Mã chống ghi trùng không hợp lệ.')
  return normalized
}

function validDate(value, label) {
  const date = clean(value, 10)
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return date
}

function normalizeHolidayDetails(value) {
  if (!Array.isArray(value)) return []
  if (value.length > 100) throw new HttpsError('invalid-argument', 'Chỉ được cấu hình tối đa 100 ngày lễ.')
  const byDate = new Map()
  for (const item of value) {
    const date = validDate(item?.date, 'Ngày nghỉ lễ')
    const name = clean(item?.name, 100).replace(/\s+/g, ' ')
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Tên ngày nghỉ lễ phải có ít nhất 2 ký tự.')
    byDate.set(date, { date, name, paid: true })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

function normalizeBranchCapacity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value)
  if (entries.length > 100) throw new HttpsError('invalid-argument', 'Cấu hình công suất vượt quá số chi nhánh cho phép.')
  const normalized = {}
  for (const [rawBranchId, rawSlots] of entries) {
    const branchId = clean(rawBranchId, 200)
    if (!branchId || branchId.includes('/')) throw new HttpsError('invalid-argument', 'Mã chi nhánh trong cấu hình công suất không hợp lệ.')
    if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) continue
    const slotEntries = Object.entries(rawSlots)
    if (slotEntries.length > 150) throw new HttpsError('invalid-argument', 'Cấu hình công suất theo khung giờ vượt giới hạn.')
    const slots = {}
    for (const [rawSlotId, rawCapacity] of slotEntries) {
      const slotId = clean(rawSlotId, 30)
      if (slotId !== 'default' && !/^T[2-7]-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId)) throw new HttpsError('invalid-argument', 'Khung giờ công suất không hợp lệ.')
      if (rawCapacity === null || rawCapacity === undefined || rawCapacity === '') slots[slotId] = null
      else slots[slotId] = integer(rawCapacity, 'Công suất chi nhánh', 1, 500)
    }
    if (Object.keys(slots).length) normalized[branchId] = slots
  }
  return normalized
}

function normalizeScheduleConfig(value = {}) {
  const workingDays = [...new Set(Array.isArray(value.workingDays) ? value.workingDays : [])]
  if (!workingDays.length || workingDays.some((day) => !DAY_SET.has(day))) throw new HttpsError('invalid-argument', 'Cần chọn ít nhất một ngày làm việc hợp lệ.')
  const workingHours = [...new Set(Array.isArray(value.workingHours) ? value.workingHours.map(Number) : [])]
  if (!workingHours.length || workingHours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) throw new HttpsError('invalid-argument', 'Cần chọn ít nhất một khung giờ hoạt động hợp lệ.')
  const holidayDetails = normalizeHolidayDetails(value.holidayDetails)
  const holidayByDate = new Map(holidayDetails.map((item) => [item.date, item]))
  for (const rawDate of Array.isArray(value.holidays) ? value.holidays : []) {
    const date = validDate(rawDate, 'Ngày nghỉ lễ')
    if (!holidayByDate.has(date)) holidayByDate.set(date, { date, name: 'Ngày nghỉ lễ', paid: true })
  }
  const details = [...holidayByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  if (details.length > 100) throw new HttpsError('invalid-argument', 'Chỉ được cấu hình tối đa 100 ngày lễ.')
  return {
    workingDays: workingDays.sort((left, right) => DAYS.indexOf(left) - DAYS.indexOf(right)),
    workingHours: workingHours.sort((left, right) => left - right),
    isAutoLockEnabled: value.isAutoLockEnabled === true,
    lockDayOfWeek: integer(value.lockDayOfWeek ?? 6, 'Ngày chốt lịch', 0, 6),
    lockHour: integer(value.lockHour ?? 12, 'Giờ chốt lịch', 0, 23),
    holidays: details.map((item) => item.date),
    holidayDetails: details,
    branchCapacityBySlot: normalizeBranchCapacity(value.branchCapacityBySlot),
    complimentaryChangeCancelPerMonth: Number(value.complimentaryChangeCancelPerMonth) === 2 ? 2 : 1,
    sessionChangeDeadlineHours: integer(value.sessionChangeDeadlineHours ?? 12, 'Hạn đổi/hủy ca', 1, 168),
    offMaxDaysPerRequest: integer(value.offMaxDaysPerRequest ?? 14, 'Số ngày OFF tối đa', 1, 90),
    offRegistrationCutoffHour: integer(value.offRegistrationCutoffHour ?? 10, 'Giờ chốt đăng ký OFF', 0, 23),
    offLimitsByDuration: {
      threeMonths: integer(value.offLimitsByDuration?.threeMonths ?? 1, 'Hạn mức OFF gói 3 tháng', 0, 48),
      sixMonths: integer(value.offLimitsByDuration?.sixMonths ?? 3, 'Hạn mức OFF gói 6 tháng', 0, 48),
      twelveMonths: integer(value.offLimitsByDuration?.twelveMonths ?? 6, 'Hạn mức OFF gói 12 tháng', 0, 48),
    },
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function receiptId(actorUid, key) {
  return digest(`${actorUid}\n${key}`).slice(0, 48)
}

async function saveScheduleConfigCommand({ db, actor, data, correlationId }) {
  requireCapability(actor, SCHEDULE_CONFIG_CAPABILITY)
  const config = normalizeScheduleConfig(data.config || {})
  const expectedRevision = integer(data.expectedRevision ?? 0, 'Phiên bản cấu hình', 0, 1_000_000_000)
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const payloadHash = digest(JSON.stringify({ operation: 'save', expectedRevision, config }))
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const configReference = db.doc('settings/scheduleConfig')
  const receiptReference = db.doc(`scheduleConfigCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/schedule_config_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptReference)
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data() || {}
      if (receipt.payloadHash !== payloadHash || receipt.operation !== 'save') throw new HttpsError('already-exists', 'Mã chống ghi trùng đã được dùng cho nội dung khác.')
      return { ...receipt.result, unchanged: true }
    }
    const configSnapshot = await transaction.get(configReference)
    const currentRevision = Number.isInteger(configSnapshot.data()?.revision) ? configSnapshot.data().revision : 0
    if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Cấu hình lịch vừa được người khác cập nhật. Hãy tải lại dữ liệu.')
    for (const branchId of Object.keys(config.branchCapacityBySlot)) {
      const branchSnapshot = await transaction.get(db.doc(`branches/${branchId}`))
      if (!branchSnapshot.exists || branchSnapshot.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Cấu hình công suất chứa chi nhánh không còn hoạt động.')
    }
    const revision = currentRevision + 1
    const now = FieldValue.serverTimestamp()
    const next = { ...config, schemaVersion: 2, revision, updatedAt: now, updatedBy: actor.uid }
    transaction.set(configReference, next)
    const result = { schemaVersion: 1, revision, config: { ...config, schemaVersion: 2, revision }, unchanged: false }
    transaction.create(receiptReference, { schemaVersion: 1, operation: 'save', actorUid: actor.uid, payloadHash, result, createdAt: now })
    transaction.create(auditReference, { schemaVersion: 1, action: 'schedule_config.save', domain: 'schedule', sourceType: 'schedule_config', sourceId: 'scheduleConfig', revision, actorUid: actor.uid, correlationId: correlationId || null, createdAt: now })
    return result
  })
}

function createScheduleConfigManagementFunctions({ db, onCall, accessContextResolver = trustedAccessContext }) {
  const saveScheduleConfig = onCall(withFunctionTelemetry('saveScheduleConfig', async (request) => {
    const actor = await accessContextResolver(request, db)
    return saveScheduleConfigCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  return { saveScheduleConfig }
}

module.exports = { SCHEDULE_CONFIG_CAPABILITY, createScheduleConfigManagementFunctions, normalizeScheduleConfig, saveScheduleConfigCommand }
