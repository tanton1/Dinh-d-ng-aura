import { DEFAULT_EAT_CLEAN_CONFIG, EMPTY_EAT_CLEAN_SUMMARY } from '../../src/features/eat-clean/admin/types'
const state = () => (window as any).costState
export const reportClientIssue = (...args: unknown[]) => { (state().adminTelemetry ||= []).push(args) }
export async function listEatCleanAdminData() {
  const value = state()
  value.adminReads = (value.adminReads || 0) + 1
  const error = value.adminError
  const result = { schemaVersion: 1, orders: [], meals: [], inventory: [], config: { ...DEFAULT_EAT_CLEAN_CONFIG, acceptingOrders: true },
    summary: { ...EMPTY_EAT_CLEAN_SUMMARY, byStatus: { pending_confirmation: value.adminBadge || 7 } }, seeded: value.adminSeeded !== false }
  if (value.adminHold) await new Promise<void>(resolve => { (value.adminPending ||= []).push(resolve) })
  if (error) throw Object.assign(new Error(error), { code: error })
  return result
}
export const initializeEatCleanCatalog = async () => { state().adminInitializations = (state().adminInitializations || 0) + 1; state().adminSeeded = true }
export const saveEatCleanMeal = async ({ meal }: any) => meal
export const saveEatCleanInventory = async (value: any) => value
export const saveEatCleanConfig = async ({ config }: any) => config
export const updateEatCleanOrder = async (value: any) => value
export const recordEatCleanRefundOutcome = async () => {}
export const reverseEatCleanRefundOutcome = async () => {}
export const getEatCleanAdminErrorMessage = () => 'Fixture admin catalog unavailable'
