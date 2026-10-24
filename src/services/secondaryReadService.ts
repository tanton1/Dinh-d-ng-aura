import { httpsCallable, type Functions } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions, firebaseRegionalReadFunctions, firebaseStudent360Functions } from '../lib/firebaseFunctions'
import { createClientCorrelationId, reportClientIssue } from './clientTelemetryService'

const secondaryReads = {
  // Preserve the existing SDK timeout for money/catalog reads: a cold instance
  // must not trigger an early duplicate scan in Singapore while still running.
  listAccountingCatalog: { region: 'asia-east1', timeout: 70_000 },
  listCashAccounts: { region: 'asia-east1', timeout: 70_000 },
  listCashTransactions: { region: 'asia-east1', timeout: 70_000 },
  listExpenseVouchers: { region: 'asia-east1', timeout: 70_000 },
  listFinanceLedger: { region: 'asia-east1', timeout: 70_000 },
  listRenewalMessageTemplates: { region: 'asia-east1', timeout: 18_000 },
  listContractRenewalCases: { region: 'asia-east1', timeout: 70_000 },
  getContractRenewalCaseDetail: { region: 'asia-east1', timeout: 70_000 },
  listRenewalCalendar: { region: 'asia-east1', timeout: 70_000 },
  getRenewalAnalytics: { region: 'asia-east1', timeout: 70_000 },
  listLoyaltyAccounts: { region: 'asia-southeast2', timeout: 70_000 },
  listLoyaltyRedemptions: { region: 'asia-southeast2', timeout: 70_000 },
  listLoyaltyAdjustments: { region: 'asia-southeast2', timeout: 70_000 },
  listLoyaltyReconciliationIssues: { region: 'asia-southeast2', timeout: 70_000 },
  listExerciseCatalog: { region: 'asia-southeast2', timeout: 70_000 },
  getExerciseCatalogItem: { region: 'asia-southeast2', timeout: 70_000 },
  getInternalNutritionCatalogItem: { region: 'asia-southeast2', timeout: 30_000 },
} as const

type SecondaryReadName = keyof typeof secondaryReads

function codeOf(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  return typeof code === 'string' ? code.replace(/^functions\//, '') : ''
}

function isInfrastructureFailure(error: unknown) {
  return ['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted'].includes(codeOf(error))
}

function requireRegion(client: Functions | null, region: string) {
  if (!client || client.region !== region) {
    throw Object.assign(new Error('Dịch vụ đọc dữ liệu chưa sẵn sàng.'), { code: 'functions/failed-precondition' })
  }
  return client
}

/** Only the explicit read allowlist may cross regions. Never cache money reads. */
export async function callSecondaryRead<Input extends object, Output>(name: SecondaryReadName, input: Input): Promise<Output> {
  // Runtime allowlist also protects JavaScript callers and prototype property names.
  if (!Object.prototype.hasOwnProperty.call(secondaryReads, name)) {
    throw Object.assign(new Error('Thao tác không thuộc nhóm chỉ đọc.'), { code: 'functions/invalid-argument' })
  }
  const uid = firebaseAuth?.currentUser?.uid
  const requireSameUser = () => {
    if (!uid || firebaseAuth?.currentUser?.uid !== uid) {
      throw Object.assign(new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại dữ liệu.'), { code: 'functions/unauthenticated' })
    }
  }
  requireSameUser()
  const { region, timeout } = secondaryReads[name]
  const regional = region === 'asia-east1' ? firebaseStudent360Functions : firebaseRegionalReadFunctions
  const correlationId = createClientCorrelationId()
  const payload = { ...input, correlationId }
  const invoke = async (client: Functions, callableName: string) => {
    requireSameUser()
    const result = await httpsCallable<typeof payload, Output>(client, callableName, { timeout })(payload)
    requireSameUser()
    return result.data
  }

  try {
    if (!regional) return await invoke(requireRegion(firebaseFunctions, 'asia-southeast1'), name)
    // A misconfigured region is a deployment error, not a reason to duplicate traffic.
    const primary = requireRegion(regional, region)
    try {
      return await invoke(primary, `${name}Regional`)
    } catch (error) {
      requireSameUser()
      if (!isInfrastructureFailure(error) || !firebaseFunctions) throw error
      // One regional attempt + one Singapore fallback; no auth refresh or nested retry.
      return await invoke(requireRegion(firebaseFunctions, 'asia-southeast1'), name)
    }
  } catch (error) {
    try {
      reportClientIssue('firestore', error, {
        phase: `secondary_read_${name}`, correlationId, retryable: isInfrastructureFailure(error),
      })
    } catch {
      // Telemetry must not replace the original callable/authentication failure.
    }
    throw error
  }
}
