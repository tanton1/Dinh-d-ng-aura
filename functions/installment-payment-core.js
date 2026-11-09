'use strict'

const { createHash } = require('node:crypto')

// Student transfer claims are a request for finance to verify a bank transfer.
// They never change a contract, installment or ledger by themselves; only the
// canonical finance payment command can mark an installment as paid.
const PAYMENT_CLAIM_COLLECTION = 'installmentPaymentClaims'
const OUTSTANDING_TARGET = 'outstanding'
const CLOSED_CONTRACT_STATUSES = new Set(['draft', 'cancelled', 'inactive', 'archived'])
const CLAIM_STATUSES = new Set(['submitted', 'withdrawn', 'rejected', 'confirmed'])
// Crockford base32 without I, L, O and U, so a code read aloud or typed from a
// screenshot is not confused with 1, 0 or V.
const TRANSFER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TRANSFER_FALLBACK_NAME = 'AURA'
// NAPAS caps the transfer memo (field 62-08) at 25 characters.
const MEMO_LENGTH = 25
// A student may pay part of an installment, or more than it, between this
// floor and the contract's remaining debt. Finance moves the difference to
// the following installments when it records the payment.
const MIN_PARTIAL_AMOUNT = 100_000
const MAX_INSTALLMENTS = 24
// Before, on and after the due date; once overdue, weekly for eight weeks
// until the learner pays or reports a transfer.
const REMINDER_OFFSETS = Object.freeze({
  before_3: 3, due: 0, after_3: -3, after_7: -7, after_14: -14, after_21: -21,
  after_28: -28, after_35: -35, after_42: -42, after_49: -49, after_56: -56,
})
// Transfer receipts the student attaches to a claim. Storage Rules let only
// the owner create them; finance reads them through short-lived signed URLs.
const PROOF_PREFIX = 'installment-proofs'
const PROOF_RESOURCE_KIND = 'installment-payment-proof'
const PROOF_MAX_BYTES = 8 * 1024 * 1024

function money(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function dateKey(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const millis = Date.parse(`${text}T12:00:00Z`)
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === text ? text : ''
}

function addDays(key, days) {
  const millis = Date.parse(`${key}T12:00:00Z`)
  return new Date(millis + days * 86_400_000).toISOString().slice(0, 10)
}

function dayDistance(from, to) {
  const start = Date.parse(`${from}T12:00:00Z`)
  const end = Date.parse(`${to}T12:00:00Z`)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : null
}

function vietnamDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(value)
}

function claimDigest(contractId, installmentId) {
  return createHash('sha256')
    .update('installment-payment-claim-v1\0')
    .update(String(contractId))
    .update('\0')
    .update(installmentId ? String(installmentId) : OUTSTANDING_TARGET)
    .digest()
}

// One deterministic document per payable target keeps lookups to a direct
// read and lets a resubmission replace the earlier claim instead of piling up.
function paymentClaimId(contractId, installmentId) {
  return `ipc_${claimDigest(contractId, installmentId).toString('hex').slice(0, 40)}`
}

// 40 bits of the same digest: stable for the installment, unique enough for a
// branch's receivables, and short enough to share the memo with a name.
function transferCode(contractId, installmentId) {
  const digest = claimDigest(contractId, installmentId)
  let value = 0n
  for (let index = 0; index < 5; index += 1) value = (value << 8n) | BigInt(digest[index])
  let code = ''
  for (let index = 0; index < 8; index += 1) {
    code = TRANSFER_ALPHABET[Number(value & 31n)] + code
    value >>= 5n
  }
  return code
}

// Bank statements show the memo, so finance recognises the student by name
// first; the code after it still pins the exact installment for matching.
// Long names keep their family and given names, then the given name alone.
function transferContent(studentName, contractId, installmentId) {
  const code = transferCode(contractId, installmentId)
  const room = MEMO_LENGTH - code.length - 1
  const words = asciiUpper(studentName).replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean)
  const fitting = [words, words.length > 2 ? [words[0], words.at(-1)] : [], words.length > 1 ? [words.at(-1)] : []]
    .map((parts) => parts.join(' '))
    .find((text) => text && text.length <= room)
  const name = fitting || (words.join(' ') || TRANSFER_FALLBACK_NAME).slice(0, room).trim()
  return `${name} ${code}`
}

function emvField(id, value) {
  const text = String(value)
  if (text.length > 99) throw new Error(`VietQR field ${id} is too long.`)
  return `${id}${String(text.length).padStart(2, '0')}${text}`
}

// CRC-16/CCITT-FALSE, as required by EMVCo merchant-presented QR (tag 63).
function crc16Ccitt(payload) {
  let crc = 0xffff
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// NAPAS VietQR "transfer to account" payload. Every banking app in Vietnam
// reads it and pre-fills bank, account, amount and memo; nothing leaves Aura.
function vietQrPayload({ bankBin, accountNumber, amount, content }) {
  if (!/^\d{6}$/.test(String(bankBin || ''))) throw new Error('VietQR requires a 6-digit bank BIN.')
  if (!/^[0-9A-Za-z]{4,19}$/.test(String(accountNumber || ''))) throw new Error('VietQR requires a valid account number.')
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('VietQR requires a positive integer amount.')
  if (!/^[A-Z0-9 ]{1,25}$/.test(String(content || ''))) throw new Error('VietQR memo must be upper-case ASCII.')
  const beneficiary = emvField('00', bankBin) + emvField('01', accountNumber)
  const merchant = emvField('00', 'A000000727') + emvField('01', beneficiary) + emvField('02', 'QRIBFTTA')
  const body = emvField('00', '01')
    + emvField('01', '12')
    + emvField('38', merchant)
    + emvField('53', '704')
    + emvField('54', String(amount))
    + emvField('58', 'VN')
    + emvField('62', emvField('08', content))
    + '6304'
  return body + crc16Ccitt(body)
}

function asciiUpper(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

class TransferProfileError extends Error {}

function normalizeTransferProfile(input = {}) {
  const bankBin = String(input.bankBin || '').trim()
  if (!/^\d{6}$/.test(bankBin)) throw new TransferProfileError('Mã ngân hàng (BIN) phải gồm đúng 6 chữ số.')
  const accountNumber = String(input.accountNumber || '').replace(/[\s.-]/g, '')
  if (!/^[0-9A-Za-z]{4,19}$/.test(accountNumber)) throw new TransferProfileError('Số tài khoản gồm 4–19 chữ hoặc số, không dấu cách.')
  const accountName = asciiUpper(input.accountName)
  if (!/^[A-Z0-9 .,&()-]{2,50}$/.test(accountName)) throw new TransferProfileError('Tên chủ tài khoản gồm 2–50 ký tự, viết như trên ứng dụng ngân hàng.')
  const bankName = String(input.bankName || '').trim()
  if (!bankName || bankName.length > 60) throw new TransferProfileError('Tên ngân hàng tối đa 60 ký tự.')
  return { schemaVersion: 1, enabled: input.enabled === true, bankBin, bankName, accountNumber: accountNumber.toUpperCase(), accountName }
}

function usableTransferProfile(profile) {
  if (!profile || profile.enabled !== true) return null
  try {
    return normalizeTransferProfile({ ...profile, enabled: true })
  } catch {
    return null
  }
}

function contractAmounts(contract = {}) {
  const total = Math.max(0, Number(contract.totalPrice || 0) - Number(contract.discount || 0))
  const paid = Math.max(0, Number(contract.paidAmount || 0))
  return { total, paid, outstanding: Math.max(0, total - paid) }
}

function scheduleRows(contract = {}) {
  return (Array.isArray(contract.installments) ? contract.installments : [])
    .filter((item) => item && typeof item.id === 'string' && dateKey(item.date) && money(item.amount) > 0)
    .map((item) => ({ id: item.id, date: dateKey(item.date), amount: money(item.amount), status: ['paid', 'cancelled'].includes(item.status) ? item.status : 'pending' }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

// Resolve what the student is allowed to pay now. Mirrors the finance command:
// an installment must still be pending; the student may pay between the
// partial floor and the remaining debt. A contract without a schedule pays
// against its outstanding balance. `later` lists the pending installments
// that absorb a shortfall or an excess, for the preview in the app.
function installmentPaymentTarget(contract, installmentId) {
  if (!contract || CLOSED_CONTRACT_STATUSES.has(contract.status)) return { error: 'closed' }
  const amounts = contractAmounts(contract)
  const rows = scheduleRows(contract)
  const limits = (amount) => ({ minAmount: Math.min(MIN_PARTIAL_AMOUNT, amount), maxAmount: amounts.outstanding })
  if (installmentId) {
    const index = rows.findIndex((item) => item.id === installmentId)
    if (index < 0) return { error: 'not_found', amounts }
    const row = rows[index]
    if (row.status === 'paid') return { error: 'paid', amounts, installmentId, amount: row.amount, dueDate: row.date, sequence: index + 1, count: rows.length }
    if (row.status === 'cancelled') return { error: 'cancelled', amounts }
    if (amounts.outstanding <= 0) return { error: 'settled', amounts }
    if (row.amount > amounts.outstanding) return { error: 'mismatch', amounts }
    const later = rows
      .map((item, position) => ({ id: item.id, date: item.date, amount: item.amount, sequence: position + 1, status: item.status }))
      .filter((item) => item.sequence > index + 1 && item.status === 'pending')
      .map(({ status, ...item }) => item)
    return { installmentId, amount: row.amount, dueDate: row.date, sequence: index + 1, count: rows.length, amounts, ...limits(row.amount), later }
  }
  if (amounts.outstanding <= 0) return { error: 'settled', amounts }
  if (rows.some((item) => item.status === 'pending')) return { error: 'installment_required', amounts }
  return { installmentId: null, amount: amounts.outstanding, dueDate: dateKey(contract.nextPaymentDate) || null, sequence: null, count: null, amounts, ...limits(amounts.outstanding), later: [] }
}

// Why a student-chosen amount cannot be claimed against the target.
function claimAmountIssue(target, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'invalid'
  if (amount < target.minAmount) return 'below_minimum'
  if (amount > target.maxAmount) return 'above_outstanding'
  if (amount < target.amount && target.installmentId && !target.later.length && target.count >= MAX_INSTALLMENTS) return 'schedule_full'
  return null
}

function amountIssueMessage(issue, target) {
  return {
    invalid: 'Số tiền không hợp lệ.',
    below_minimum: `Số tiền tối thiểu cho kỳ này là ${formatVnd(target.minAmount)}.`,
    above_outstanding: `Số tiền vượt công nợ còn lại ${formatVnd(target.maxAmount)}.`,
    schedule_full: 'Lịch trả góp đã đủ 24 kỳ nên không thể trả một phần kỳ cuối. Hãy liên hệ Aura.',
  }[issue] || 'Số tiền không hợp lệ.'
}

function targetErrorMessage(error) {
  return {
    closed: 'Hợp đồng này không còn nhận thanh toán trực tuyến. Hãy liên hệ Aura.',
    settled: 'Hợp đồng đã được thanh toán đủ.',
    not_found: 'Không tìm thấy kỳ thanh toán. Hãy tải lại trang hợp đồng.',
    paid: 'Kỳ này đã được ghi nhận thanh toán.',
    cancelled: 'Kỳ này đã được hủy khỏi lịch thanh toán.',
    mismatch: 'Số tiền kỳ này không khớp với công nợ hiện tại. Hãy liên hệ Aura để kiểm tra.',
    installment_required: 'Hãy chọn một kỳ trong lịch thanh toán.',
  }[error] || 'Chưa thể thanh toán kỳ này.'
}

// The patch the canonical payment transaction applies to a claim. Every way
// finance records the installment closes the claim, including a counter
// payment for a student who reported a transfer that never arrived.
function confirmedClaimPatch(claim, { amount, installmentId, ledgerEntryId, receiptVoucherNumber, actorUid, confirmedAt }) {
  if (!claim || !CLAIM_STATUSES.has(claim.status)) return null
  if (claim.status === 'confirmed' && claim.ledgerEntryId === ledgerEntryId) return null
  if (!installmentId && (claim.status !== 'submitted' || amount < money(claim.amount))) return null
  return {
    status: 'confirmed',
    ledgerEntryId,
    receiptVoucherNumber: receiptVoucherNumber || null,
    confirmedAmount: amount,
    confirmedBy: actorUid,
    confirmedAt,
    updatedAt: confirmedAt,
  }
}

// The only receipt path a student may attach to this claim; mirrors the
// Storage Rules match so a forged path never reaches a metadata read.
function proofPathValid(path, { uid, claimId }) {
  if (typeof path !== 'string' || path.length > 300) return false
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || '')) || !/^ipc_[0-9a-f]{40}$/.test(String(claimId || ''))) return false
  const prefix = `${PROOF_PREFIX}/${uid}/${claimId}/`
  return path.startsWith(prefix) && /^proof-\d{10,16}\.(jpg|png|webp)$/.test(path.slice(prefix.length))
}

// Metadata Storage reports for an uploaded receipt, checked again on the
// server because Rules only guard the upload itself.
function proofMetadataIssue(metadata, { uid, claimId }) {
  const custom = metadata?.metadata || {}
  if (custom.ownerUid !== uid || custom.claimId !== claimId || custom.resourceKind !== PROOF_RESOURCE_KIND) return 'metadata'
  if (!/^image\/(jpeg|png|webp)$/.test(String(metadata?.contentType || ''))) return 'type'
  const size = Number(metadata?.size || 0)
  if (!(size > 0) || size > PROOF_MAX_BYTES) return 'size'
  return null
}

// How the student sees their claim against the current contract state. The
// claim carries the amount the student chose, so any open claim counts.
function studentClaimState(claim, target) {
  if (target.error === 'paid') return 'paid'
  if (target.error) return 'unavailable'
  if (claim?.status === 'submitted') return 'submitted'
  if (claim?.status === 'rejected') return 'rejected'
  return 'open'
}

function reminderDates(today) {
  return Object.values(REMINDER_OFFSETS).map((offset) => addDays(today, offset))
}

function reminderMilestone(dueDate, today) {
  const distance = dayDistance(today, dueDate)
  return Object.entries(REMINDER_OFFSETS).find(([, offset]) => offset === distance)?.[0] || null
}

function formatVnd(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`
}

function formatDay(key) {
  const [year, month, day] = key.split('-')
  return `${day}/${month}/${year}`
}

function paymentActionUrl(contractId, installmentId) {
  return `#/schedule?tab=contract&pay=${encodeURIComponent(contractId)}~${encodeURIComponent(installmentId || OUTSTANDING_TARGET)}`
}

function reminderCopy(milestone, { packageName, amount, dueDate }) {
  const detail = `${packageName || 'Gói tập Aura'} · ${formatVnd(amount)} · hạn ${formatDay(dueDate)}`
  if (milestone === 'before_3') return { title: 'Kỳ thanh toán còn 3 ngày', message: `${detail}. Bạn có thể quét mã QR trong app để thanh toán.` }
  if (milestone === 'due') return { title: 'Kỳ thanh toán đến hạn hôm nay', message: `${detail}. Quét mã QR trong app để thanh toán trong 1 phút.` }
  const overdueDays = Math.abs(REMINDER_OFFSETS[milestone] ?? -3)
  return { title: `Kỳ thanh toán đã quá hạn ${overdueDays} ngày`, message: `${detail}. Nếu bạn đã chuyển khoản, hãy bấm "Tôi đã chuyển khoản" để Aura xác nhận.` }
}

// The notification page groups and highlights by kind; only the pre-due
// reminder can be muted by the learner.
function reminderKind(milestone) {
  if (milestone === 'before_3') return 'installment_due_soon'
  if (milestone === 'due') return 'installment_due'
  return 'installment_overdue'
}

// Pure planning step of the daily reminder job: given contracts whose next
// payment date hits a milestone, decide who receives which reminder.
function planInstallmentReminders({ contracts, students, claims, today }) {
  const deliveries = []
  for (const contract of contracts) {
    const value = contract.data
    if (!value || CLOSED_CONTRACT_STATUSES.has(value.status) || value.status === 'frozen') continue
    const dueDate = dateKey(value.nextPaymentDate)
    const milestone = dueDate ? reminderMilestone(dueDate, today) : null
    if (!milestone) continue
    const row = scheduleRows(value).find((item) => item.status === 'pending' && item.date === dueDate)
    const target = installmentPaymentTarget(value, row?.id || null)
    if (target.error) continue
    const student = students.get(value.studentId) || students.get(value.crmProfileId)
    const accountUid = typeof student?.accountUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(student.accountUid) ? student.accountUid : ''
    if (!accountUid || student.status === 'inactive' || student.accountStatus === 'disabled') continue
    const claimId = paymentClaimId(contract.id, target.installmentId)
    if (claims.get(claimId)?.status === 'submitted') continue
    const copy = reminderCopy(milestone, { packageName: value.packageName, amount: target.amount, dueDate })
    deliveries.push({
      userId: accountUid,
      dateString: today,
      category: 'payment',
      type: 'PAYMENT',
      dedupeKey: `installment-due-${claimId.slice(4, 28)}-${milestone}`,
      actionUrl: paymentActionUrl(contract.id, target.installmentId),
      kind: reminderKind(milestone),
      priority: milestone.startsWith('after_') ? 'high' : 'normal',
      ctaLabel: 'Thanh toán',
      entity: { contractId: contract.id, installmentId: target.installmentId || '' },
      expiresAt: new Date(`${addDays(today, 90)}T00:00:00+07:00`),
      ...copy,
    })
  }
  return deliveries
}

module.exports = {
  PAYMENT_CLAIM_COLLECTION,
  OUTSTANDING_TARGET,
  CLOSED_CONTRACT_STATUSES,
  MIN_PARTIAL_AMOUNT,
  PROOF_MAX_BYTES,
  PROOF_PREFIX,
  PROOF_RESOURCE_KIND,
  TransferProfileError,
  addDays,
  amountIssueMessage,
  asciiUpper,
  claimAmountIssue,
  confirmedClaimPatch,
  contractAmounts,
  crc16Ccitt,
  dateKey,
  dayDistance,
  formatVnd,
  installmentPaymentTarget,
  normalizeTransferProfile,
  paymentActionUrl,
  paymentClaimId,
  planInstallmentReminders,
  proofMetadataIssue,
  proofPathValid,
  reminderDates,
  reminderMilestone,
  studentClaimState,
  targetErrorMessage,
  transferCode,
  transferContent,
  usableTransferProfile,
  vietnamDateKey,
  vietQrPayload,
}
