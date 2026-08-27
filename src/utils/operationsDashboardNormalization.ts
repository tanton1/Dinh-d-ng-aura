export interface DashboardActionMetric {
  available: boolean
  totalCount: number
  actionCount: number
  overdueCount: number
  dueTodayCount: number
  warningCount: number
  amount: number
  truncated: boolean
}

export interface OperationsDashboardData {
  schemaVersion: 2
  range: { startAt: string; endAt: string; timeZone: string }
  branchId: string
  scope: { branchId: string; branchIds: string[]; unrestricted: boolean }
  permissions: {
    finance: boolean
    clients: boolean
    operations: boolean
    schedule: boolean
    renewals: boolean
    nutritionReviews: boolean
    academy: boolean
    payroll: boolean
    quality: boolean
  }
  actionSummary: {
    overdueReceivables: DashboardActionMetric
    dueRenewals: DashboardActionMetric
    pendingScheduleRequests: DashboardActionMetric
    overdueMealReviews: DashboardActionMetric
    missingContractEffectiveDate: DashboardActionMetric
  }
  today: {
    scheduledSessions: number
    completedSessions: number
    pendingRequests: number
    attendance: {
      charged: number
      confirmed: number
      present: number
      late: number
      noShow: number
      pendingConfirmation: number
      attendanceRate: number
      confirmationRate: number
    }
  }
  finance: { contractSales: number; cashCollected: number; refunds: number; reversals: number; adjustments: number; netCash: number; receivables: number }
  clients: { total: number; active: number; newInRange: number; activeContracts: number }
  operations: { sessions: number; attendanceEvents: number; sessionStatus: Record<string, number>; completionRate: number; activeTrainers: number; activeStaff: number; branches: number }
  quality: { completeness: 'complete' | 'partial'; missingContractEffectiveDate: number; truncated: boolean; canonicalFinanceSource: string; canonicalAttendanceSource: string }
  generatedAt: string
  cache: { hit: boolean; ttlSeconds: number }
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value))
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function metric(value: unknown): DashboardActionMetric {
  const source = record(value)
  return {
    available: source.available === true,
    totalCount: nonNegativeNumber(source.totalCount),
    actionCount: nonNegativeNumber(source.actionCount),
    overdueCount: nonNegativeNumber(source.overdueCount),
    dueTodayCount: nonNegativeNumber(source.dueTodayCount),
    warningCount: nonNegativeNumber(source.warningCount),
    amount: finiteNumber(source.amount),
    truncated: source.truncated === true,
  }
}

/**
 * Keeps a rolling Functions deployment (or a stale PWA response) from
 * crashing the dashboard when the previous schema is returned briefly.
 * Missing v2-only queues fail closed as unavailable; canonical v1 totals
 * remain readable until the next refresh reaches the current Function.
 */
export function normalizeOperationsDashboardData(value: unknown): OperationsDashboardData {
  const source = record(value)
  const schemaVersion = finiteNumber(source.schemaVersion)
  const range = record(source.range)
  const scope = record(source.scope)
  const permissions = record(source.permissions)
  const actionSummary = record(source.actionSummary)
  const today = record(source.today)
  const todayAttendance = record(today.attendance)
  const finance = record(source.finance)
  const clients = record(source.clients)
  const operations = record(source.operations)
  const sessionStatusSource = record(operations.sessionStatus)
  const quality = record(source.quality)
  const cache = record(source.cache)
  const branchId = text(source.branchId, 'all')
  const sessionStatus = Object.fromEntries(
    Object.entries(sessionStatusSource).map(([key, count]) => [key, nonNegativeNumber(count)]),
  )
  const sessionCount = nonNegativeNumber(operations.sessions)
  const completedCount = nonNegativeNumber(sessionStatus.completed) + nonNegativeNumber(sessionStatus.attended)
  const compatibilityPermission = (domainValue: unknown) => schemaVersion < 2 && Object.keys(record(domainValue)).length > 0

  return {
    schemaVersion: 2,
    range: {
      startAt: text(range.startAt),
      endAt: text(range.endAt),
      timeZone: text(range.timeZone, 'Asia/Ho_Chi_Minh'),
    },
    branchId,
    scope: {
      branchId: text(scope.branchId, branchId),
      branchIds: Array.isArray(scope.branchIds) ? scope.branchIds.filter((item): item is string => typeof item === 'string') : [],
      unrestricted: scope.unrestricted === true,
    },
    permissions: {
      finance: permissions.finance === true || compatibilityPermission(source.finance),
      clients: permissions.clients === true || compatibilityPermission(source.clients),
      operations: permissions.operations === true || compatibilityPermission(source.operations),
      schedule: permissions.schedule === true,
      renewals: permissions.renewals === true,
      nutritionReviews: permissions.nutritionReviews === true,
      academy: permissions.academy === true,
      payroll: permissions.payroll === true,
      quality: permissions.quality === true || compatibilityPermission(source.quality),
    },
    actionSummary: {
      overdueReceivables: metric(actionSummary.overdueReceivables),
      dueRenewals: metric(actionSummary.dueRenewals),
      pendingScheduleRequests: metric(actionSummary.pendingScheduleRequests),
      overdueMealReviews: metric(actionSummary.overdueMealReviews),
      missingContractEffectiveDate: metric(actionSummary.missingContractEffectiveDate),
    },
    today: {
      scheduledSessions: nonNegativeNumber(today.scheduledSessions),
      completedSessions: nonNegativeNumber(today.completedSessions),
      pendingRequests: nonNegativeNumber(today.pendingRequests),
      attendance: {
        charged: nonNegativeNumber(todayAttendance.charged),
        confirmed: nonNegativeNumber(todayAttendance.confirmed),
        present: nonNegativeNumber(todayAttendance.present),
        late: nonNegativeNumber(todayAttendance.late),
        noShow: nonNegativeNumber(todayAttendance.noShow),
        pendingConfirmation: nonNegativeNumber(todayAttendance.pendingConfirmation),
        attendanceRate: Math.max(0, Math.min(100, finiteNumber(todayAttendance.attendanceRate))),
        confirmationRate: Math.max(0, Math.min(100, finiteNumber(todayAttendance.confirmationRate))),
      },
    },
    finance: {
      contractSales: finiteNumber(finance.contractSales),
      cashCollected: finiteNumber(finance.cashCollected),
      refunds: finiteNumber(finance.refunds),
      reversals: finiteNumber(finance.reversals),
      adjustments: finiteNumber(finance.adjustments),
      netCash: finiteNumber(finance.netCash),
      receivables: finiteNumber(finance.receivables),
    },
    clients: {
      total: nonNegativeNumber(clients.total),
      active: nonNegativeNumber(clients.active),
      newInRange: nonNegativeNumber(clients.newInRange),
      activeContracts: nonNegativeNumber(clients.activeContracts),
    },
    operations: {
      sessions: sessionCount,
      attendanceEvents: nonNegativeNumber(operations.attendanceEvents),
      sessionStatus,
      completionRate: Number.isFinite(Number(operations.completionRate))
        ? Math.max(0, Math.min(100, finiteNumber(operations.completionRate)))
        : sessionCount > 0 ? Math.round(completedCount / sessionCount * 100) : 0,
      activeTrainers: nonNegativeNumber(operations.activeTrainers),
      activeStaff: nonNegativeNumber(operations.activeStaff),
      branches: nonNegativeNumber(operations.branches),
    },
    quality: {
      completeness: quality.completeness === 'partial' || schemaVersion < 2 ? 'partial' : 'complete',
      missingContractEffectiveDate: nonNegativeNumber(quality.missingContractEffectiveDate),
      truncated: quality.truncated === true,
      canonicalFinanceSource: text(quality.canonicalFinanceSource, 'ledgerEntries'),
      canonicalAttendanceSource: text(quality.canonicalAttendanceSource, 'attendanceEvents'),
    },
    generatedAt: text(source.generatedAt, new Date().toISOString()),
    cache: {
      hit: cache.hit === true,
      ttlSeconds: nonNegativeNumber(cache.ttlSeconds),
    },
  }
}
