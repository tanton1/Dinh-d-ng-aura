const REFERRAL_COMMISSION_MIN_RATE = 2
const REFERRAL_COMMISSION_MAX_RATE = 10
const REFERRAL_LEDGER_TYPES = new Set(['payment', 'refund', 'reversal'])
const REFERRAL_LEDGER_STATUSES = new Set(['posted', 'reversed'])

function dataOf(value) {
  return typeof value?.data === 'function' ? value.data() || {} : value || {}
}

function idOf(value) {
  return typeof value?.id === 'string' ? value.id : String(dataOf(value).id || '')
}

function normalizeReferralCode(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '').toUpperCase() : ''
}

function referralCommissionRate(value) {
  const rate = Number(value || 0)
  if (rate === 0) return 0
  return Number.isFinite(rate) && rate >= REFERRAL_COMMISSION_MIN_RATE && rate <= REFERRAL_COMMISSION_MAX_RATE
    ? rate
    : null
}

function referralCashImpact(value) {
  const entry = dataOf(value)
  if (!REFERRAL_LEDGER_TYPES.has(entry.type) || !REFERRAL_LEDGER_STATUSES.has(entry.status)) return 0
  const direct = Number(entry.cashImpact)
  const amount = Number(entry.amount)
  const result = Number.isFinite(direct) ? direct : Number.isFinite(amount) ? amount : 0
  return Number.isSafeInteger(result) ? result : 0
}

function calculateReferralCommissions({ ledgerEntries = [], contracts = [], staffRecords = [] } = {}) {
  const contractById = new Map(contracts.map((value) => [idOf(value), dataOf(value)]).filter(([id]) => id))
  const staffById = new Map()
  const staffIdsByCode = new Map()
  staffRecords.forEach((value) => {
    const record = dataOf(value)
    const id = idOf(value)
    if (!id || record.status === 'inactive') return
    staffById.set(id, { id, ...record })
    const code = normalizeReferralCode(record.employeeCode)
    if (!code) return
    const current = staffIdsByCode.get(code) || []
    if (!current.includes(id)) current.push(id)
    staffIdsByCode.set(code, current)
  })

  const rawByStaff = new Map()
  const diagnostic = {
    eligibleEntryCount: 0,
    unresolvedEntryCount: 0,
    ambiguousCodeEntryCount: 0,
    invalidRateEntryCount: 0,
  }

  ledgerEntries.forEach((value) => {
    const entry = dataOf(value)
    const cashImpact = referralCashImpact(entry)
    if (!cashImpact) return
    const contract = contractById.get(String(entry.contractId || '')) || {}
    const referralCode = normalizeReferralCode(entry.referralCode || contract.referralCode)
    const requestedStaffId = String(entry.referralStaffId || contract.referralStaffId || '')
    let candidates = requestedStaffId && staffById.has(requestedStaffId)
      ? [requestedStaffId]
      : referralCode ? (staffIdsByCode.get(referralCode) || []) : []
    candidates = [...new Set(candidates)]
    if (!referralCode && !requestedStaffId) return
    if (!candidates.length) {
      diagnostic.unresolvedEntryCount += 1
      return
    }
    if (candidates.length !== 1) {
      diagnostic.ambiguousCodeEntryCount += 1
      return
    }
    const staffId = candidates[0]
    const staff = staffById.get(staffId) || {}
    const snapshotValue = entry.referralCommissionRate ?? contract.referralCommissionRate
    const hasSnapshotRate = snapshotValue !== undefined && snapshotValue !== null && snapshotValue !== ''
    const snapshottedRate = hasSnapshotRate ? referralCommissionRate(snapshotValue) : 0
    const currentRate = referralCommissionRate(staff.commissionRate)
    const rate = hasSnapshotRate ? snapshottedRate : currentRate
    if (rate === null || rate === 0) {
      if (Number(entry.referralCommissionRate ?? contract.referralCommissionRate ?? staff.commissionRate ?? 0) !== 0) {
        diagnostic.invalidRateEntryCount += 1
      }
      return
    }
    const commissionImpact = Math.round(cashImpact * rate / 100)
    const current = rawByStaff.get(staffId) || {
      staffId,
      referralCode,
      rate,
      cashCollectedAmount: 0,
      cashReversedAmount: 0,
      netCashAmount: 0,
      commissionImpact: 0,
      contractIds: new Set(),
      evidence: [],
    }
    current.cashCollectedAmount += Math.max(0, cashImpact)
    current.cashReversedAmount += Math.abs(Math.min(0, cashImpact))
    current.netCashAmount += cashImpact
    current.commissionImpact += commissionImpact
    current.contractIds.add(String(entry.contractId || ''))
    if (current.evidence.length < 200) current.evidence.push({
      ledgerEntryId: idOf(value),
      contractId: String(entry.contractId || ''),
      cashImpact,
      rate,
      commissionImpact,
    })
    rawByStaff.set(staffId, current)
    diagnostic.eligibleEntryCount += 1
  })

  const byStaff = new Map([...rawByStaff].map(([staffId, value]) => [staffId, {
    staffId,
    referralCode: value.referralCode,
    rate: value.rate,
    cashCollectedAmount: value.cashCollectedAmount,
    cashReversedAmount: value.cashReversedAmount,
    netCashAmount: value.netCashAmount,
    commissionAmount: Math.max(0, value.commissionImpact),
    reversalAmount: Math.max(0, -value.commissionImpact),
    contractCount: value.contractIds.size,
    evidence: value.evidence,
  }]))
  return { byStaff, ...diagnostic }
}

module.exports = {
  REFERRAL_COMMISSION_MIN_RATE,
  REFERRAL_COMMISSION_MAX_RATE,
  normalizeReferralCode,
  referralCommissionRate,
  referralCashImpact,
  calculateReferralCommissions,
}
