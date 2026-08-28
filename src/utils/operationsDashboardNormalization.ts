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
  schemaVersion: 6
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
    rows: Array<{
      id: string
      hour: number | null
      studentId: string
      studentName: string
      trainerId: string
      trainerName: string
      attendanceStatus: 'pending' | 'present' | 'late' | 'no_show'
      billingStatus: 'pending' | 'charged'
    }>
    truncated: boolean
  }
  finance: { contractSales: number; recognizedRevenue: number; cashCollected: number; refunds: number; reversals: number; adjustments: number; netCash: number; receivables: number; frozenReceivables: number }
  receivables: {
    summary: {
      overdue: { count: number; amount: number }
      dueThisWeek: { count: number; amount: number }
      dueThisMonth: { count: number; amount: number }
    }
    rows: Array<{
      id: string
      contractId: string
      studentId: string
      studentName: string
      phone: string
      packageName: string
      dueDate: string
      amount: number
      status: 'overdue' | 'due_this_week' | 'due_this_month'
    }>
    truncated: boolean
  }
  clients: { total: number; active: number; newInRange: number; activeContracts: number; preservedContracts: number; exhaustedContracts: number; expiringSoonContracts: number }
  analytics: {
    revenue: {
      granularity: 'day' | 'week' | 'month'
      points: Array<{ key: string; label: string; contractSales: number; recognizedRevenue: number; grossCash: number; netCash: number }>
    }
    packages: {
      totalActive: number
      preservedContracts: number
      items: Array<{ id: string; name: string; count: number; percent: number }>
    }
    off: {
      activeContracts: number
      approvedContracts: number
      activeWithoutOff: number
      approvedRequests: number
      pendingRequests: number
      preservationRequests: number
      preservedContracts: number
      rate: number
    }
  }
  operations: { sessions: number; attendanceEvents: number; sessionStatus: Record<string, number>; completionRate: number; activeTrainers: number; activeStaff: number; branches: number }
  quality: { completeness: 'complete' | 'partial'; missingContractEffectiveDate: number; truncated: boolean; canonicalFinanceSource: string; canonicalAttendanceSource: string }
  filters: { branches: Array<{ id: string; name: string }> }
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
  const receivables = record(source.receivables)
  const receivableSummary = record(receivables.summary)
  const clients = record(source.clients)
  const analytics = record(source.analytics)
  const revenue = record(analytics.revenue)
  const packages = record(analytics.packages)
  const off = record(analytics.off)
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
  const cashCollected = finiteNumber(finance.cashCollected)
  const refunds = nonNegativeNumber(finance.refunds)
  const reversals = nonNegativeNumber(finance.reversals)
  const adjustments = finiteNumber(finance.adjustments)
  const netCash = cashCollected - refunds - reversals + adjustments
  const revenuePoints = Array.isArray(revenue.points) ? revenue.points.slice(0, 60).map((item) => {
    const point = record(item)
    return {
      key: text(point.key),
      label: text(point.label),
      contractSales: finiteNumber(point.contractSales),
      recognizedRevenue: finiteNumber(point.recognizedRevenue),
      grossCash: finiteNumber(point.grossCash),
      netCash: finiteNumber(point.netCash),
    }
  }).filter((item) => item.key) : []
  const pointNetTotal = revenuePoints.reduce((total, item) => total + item.netCash, 0)
  if (revenuePoints.length && Math.abs(pointNetTotal - netCash) >= 1) {
    revenuePoints.forEach((item) => { item.netCash = item.grossCash })
    revenuePoints[revenuePoints.length - 1].netCash += netCash - revenuePoints.reduce((total, item) => total + item.grossCash, 0)
  }

  return {
    schemaVersion: 6,
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
      rows: Array.isArray(today.rows) ? today.rows.slice(0, 80).map((item) => {
        const row = record(item)
        const attendanceStatus = text(row.attendanceStatus)
        return {
          id: text(row.id),
          hour: row.hour !== null && row.hour !== undefined && Number.isFinite(Number(row.hour)) ? Number(row.hour) : null,
          studentId: text(row.studentId),
          studentName: text(row.studentName, 'Học viên chưa cập nhật tên'),
          trainerId: text(row.trainerId),
          trainerName: text(row.trainerName, 'PT chưa cập nhật tên'),
          attendanceStatus: (['present', 'late', 'no_show'].includes(attendanceStatus) ? attendanceStatus : 'pending') as 'pending' | 'present' | 'late' | 'no_show',
          billingStatus: row.billingStatus === 'charged' ? 'charged' as const : 'pending' as const,
        }
      }).filter((item) => item.id) : [],
      truncated: today.truncated === true,
    },
    finance: {
      contractSales: finiteNumber(finance.contractSales),
      recognizedRevenue: finiteNumber(finance.recognizedRevenue),
      cashCollected,
      refunds,
      reversals,
      adjustments,
      netCash,
      receivables: nonNegativeNumber(finance.receivables),
      frozenReceivables: nonNegativeNumber(finance.frozenReceivables),
    },
    receivables: {
      summary: {
        overdue: { count: nonNegativeNumber(record(receivableSummary.overdue).count), amount: nonNegativeNumber(record(receivableSummary.overdue).amount) },
        dueThisWeek: { count: nonNegativeNumber(record(receivableSummary.dueThisWeek).count), amount: nonNegativeNumber(record(receivableSummary.dueThisWeek).amount) },
        dueThisMonth: { count: nonNegativeNumber(record(receivableSummary.dueThisMonth).count), amount: nonNegativeNumber(record(receivableSummary.dueThisMonth).amount) },
      },
      rows: Array.isArray(receivables.rows) ? receivables.rows.slice(0, 60).map((item) => {
        const row = record(item)
        const status = text(row.status)
        return {
          id: text(row.id),
          contractId: text(row.contractId),
          studentId: text(row.studentId),
          studentName: text(row.studentName, 'Học viên chưa cập nhật tên'),
          phone: text(row.phone),
          packageName: text(row.packageName, 'Gói tập chưa cập nhật'),
          dueDate: text(row.dueDate),
          amount: nonNegativeNumber(row.amount),
          status: (['overdue', 'due_this_week'].includes(status) ? status : 'due_this_month') as 'overdue' | 'due_this_week' | 'due_this_month',
        }
      }).filter((item) => item.id) : [],
      truncated: receivables.truncated === true,
    },
    clients: {
      total: nonNegativeNumber(clients.total),
      active: nonNegativeNumber(clients.active),
      newInRange: nonNegativeNumber(clients.newInRange),
      activeContracts: nonNegativeNumber(clients.activeContracts),
      preservedContracts: nonNegativeNumber(clients.preservedContracts || packages.preservedContracts || off.preservedContracts),
      exhaustedContracts: nonNegativeNumber(clients.exhaustedContracts),
      expiringSoonContracts: nonNegativeNumber(clients.expiringSoonContracts),
    },
    analytics: {
      revenue: {
        granularity: revenue.granularity === 'week' || revenue.granularity === 'month' ? revenue.granularity : 'day',
        points: revenuePoints,
      },
      packages: {
        totalActive: nonNegativeNumber(packages.totalActive),
        preservedContracts: nonNegativeNumber(packages.preservedContracts || clients.preservedContracts || off.preservedContracts),
        items: Array.isArray(packages.items) ? packages.items.slice(0, 6).map((item) => {
          const value = record(item)
          return {
            id: text(value.id),
            name: text(value.name, 'Chưa xác định gói'),
            count: nonNegativeNumber(value.count),
            percent: Math.max(0, Math.min(100, finiteNumber(value.percent))),
          }
        }).filter((item) => item.id) : [],
      },
      off: {
        activeContracts: nonNegativeNumber(off.activeContracts),
        approvedContracts: nonNegativeNumber(off.approvedContracts),
        activeWithoutOff: nonNegativeNumber(off.activeWithoutOff),
        approvedRequests: nonNegativeNumber(off.approvedRequests),
        pendingRequests: nonNegativeNumber(off.pendingRequests),
        preservationRequests: nonNegativeNumber(off.preservationRequests),
        preservedContracts: nonNegativeNumber(off.preservedContracts || clients.preservedContracts || packages.preservedContracts),
        rate: Math.max(0, Math.min(100, finiteNumber(off.rate))),
      },
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
    filters: {
      branches: Array.isArray(record(source.filters).branches)
        ? (record(source.filters).branches as unknown[]).map((item) => {
          const branch = record(item)
          return { id: text(branch.id), name: text(branch.name, text(branch.id)) }
        }).filter((item) => item.id)
        : [],
    },
    generatedAt: text(source.generatedAt, new Date().toISOString()),
    cache: {
      hit: cache.hit === true,
      ttlSeconds: nonNegativeNumber(cache.ttlSeconds),
    },
  }
}
