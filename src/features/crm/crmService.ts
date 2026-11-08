import { httpsCallable } from 'firebase/functions'
import { firebaseCrmFunctions } from '../../lib/firebaseFunctions'
import type {
  CrmActivityOutcome,
  CrmActivityType,
  CrmAppointmentKind,
  CrmAppointmentStatus,
  CrmCareAssignmentRow,
  CrmConversation,
  CrmCustomerCard,
  CrmCustomerDetail,
  CrmDuplicate,
  CrmEndpoint,
  CrmInboxFilter,
  CrmIntegrationOverview,
  CrmLinkTarget,
  CrmLostReason,
  CrmMessagePage,
  CrmPage,
  CrmPancakePage,
  CrmPipeline,
  CrmQuoteCandidate,
  CrmStaffMember,
  CrmStage,
  CrmStep,
  CrmTransport,
} from './crmTypes'

const TIMEOUTS: Record<CrmEndpoint, number> = { crmQuery: 30_000, crmCommand: 90_000, crmIntegrationCommand: 60_000 }

export const firebaseCrmTransport: CrmTransport = async <T,>(endpoint: CrmEndpoint, data: Record<string, unknown>) => {
  if (!firebaseCrmFunctions) throw new Error('Dịch vụ CRM chưa sẵn sàng.')
  const callable = httpsCallable<Record<string, unknown>, T>(firebaseCrmFunctions, endpoint, { timeout: TIMEOUTS[endpoint] })
  return (await callable(data)).data
}

export function crmErrorMessage(cause: unknown, fallback = 'Chưa thực hiện được thao tác CRM.') {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' && cause.message.trim()) {
    const message = cause.message.replace(/^FirebaseError:\s*/, '').trim()
    return message === 'internal' ? fallback : message
  }
  return fallback
}

export function isRevisionConflict(cause: unknown) {
  return Boolean(cause && typeof cause === 'object' && 'code' in cause && String(cause.code).endsWith('aborted'))
}

export function createCrmService(transport: CrmTransport) {
  const query = <T,>(action: string, data: Record<string, unknown> = {}) => transport<T>('crmQuery', { action, ...data })
  const command = <T,>(action: string, data: Record<string, unknown> = {}) => transport<T>('crmCommand', { action, ...data })
  const integration = <T,>(action: string, data: Record<string, unknown> = {}) => transport<T>('crmIntegrationCommand', { action, ...data })
  return {
    inbox: (input: { branchId?: string; filter: CrmInboxFilter; cursor?: string | null; pageSize?: number }) => query<CrmPage<CrmConversation> & { filter: CrmInboxFilter }>('inbox', input),
    pipeline: (input: { branchId?: string; owner?: 'all' | 'me' }) => query<CrmPipeline>('pipeline', input),
    customers: (input: { branchId?: string; query?: string; stage?: CrmStage | ''; scope?: 'branch' | 'care'; cursor?: string | null }) => query<CrmPage<CrmCustomerCard>>('customers', input),
    customer: (customerId: string) => query<CrmCustomerDetail>('customer', { customerId }),
    messages: (input: { customerId: string; conversationKey?: string; cursor?: string | null }) => query<CrmMessagePage>('messages', input),
    steps: (input: { scope: 'mine' | 'branch'; status: 'open' | 'done'; branchId?: string; cursor?: string | null }) => query<CrmPage<CrmStep>>('steps', input),
    staff: (branchId: string) => query<{ schemaVersion: 1; staff: CrmStaffMember[] }>('staff', { branchId }),
    careAssignments: (input: { branchId: string; query?: string }) => query<{ schemaVersion: 1; rows: CrmCareAssignmentRow[]; truncated: boolean; careStaff: Array<{ uid: string; name: string }> }>('careAssignments', input),
    linkTargets: (queryText: string) => query<{ schemaVersion: 1; rows: CrmLinkTarget[] }>('linkTargets', { query: queryText }),
    quoteCandidates: (customerId: string) => query<{ schemaVersion: 1; rows: CrmQuoteCandidate[]; reason?: string }>('quoteCandidates', { customerId }),
    integrationOverview: () => query<CrmIntegrationOverview>('integration'),

    updateStage: (input: { customerId: string; expectedRevision: number; stage: CrmStage; lostReason?: CrmLostReason | ''; note?: string }) => command<{ customerId: string; revision: number; unchanged: boolean }>('updateStage', input),
    updateProfile: (input: { customerId: string; expectedRevision: number; displayName?: string; phones?: string[]; emails?: string[]; goal?: string; preferredSlots?: string; note?: string; branchId?: string }) => command<{ customerId: string; revision: number; duplicates: CrmDuplicate[] }>('updateProfile', input),
    assignOwner: (input: { customerId: string; expectedRevision: number; ownerUid: string }) => command<{ customerId: string; revision: number }>('assignOwner', input),
    recordActivity: (input: { customerId: string; type: CrmActivityType; outcome?: CrmActivityOutcome | ''; note?: string }) => command<{ recorded: boolean }>('recordActivity', input),
    createStep: (input: { customerId: string; title: string; dueAt: string; ownerUid?: string; note?: string }) => command<{ stepId: string }>('createStep', input),
    completeStep: (input: { stepId: string; status: 'done' | 'skipped'; note?: string }) => command<{ stepId: string; status: string }>('completeStep', input),
    createAppointment: (input: { customerId: string; kind: CrmAppointmentKind; startAt: string; note?: string }) => command<{ appointmentId: string; stage: CrmStage }>('createAppointment', input),
    updateAppointment: (input: { appointmentId: string; status: CrmAppointmentStatus; note?: string }) => command<{ appointmentId: string; stage: CrmStage }>('updateAppointment', input),
    linkStudent: (input: { customerId: string; expectedRevision: number; studentId: string }) => command<{ customerId: string; stage: CrmStage; contracts: number }>('linkStudent', input),
    linkQuote: (input: { customerId: string; quoteId: string }) => command<{ customerId: string; unchanged: boolean }>('linkQuote', input),
    merge: (input: { sourceCustomerId: string; targetCustomerId: string }) => command<{ targetCustomerId: string }>('merge', input),
    assignCareOwner: (input: { studentIds: string[]; careOwnerUid: string }) => command<{ schemaVersion: 1; assigned: number; results: Array<{ studentId: string; ok: boolean; reason?: string }> }>('assignCareOwner', input),
    erase: (input: { customerId: string; confirmation: string }) => command<{ erased: boolean; counts: Record<string, number> }>('erase', input),

    connectPage: (input: { pageId: string; pageAccessToken: string; branchId: string; name?: string; platform?: string }) => integration<{ page: CrmPancakePage; webhookUrl: string }>('connectPage', input),
    updatePage: (input: { pageId: string; expectedRevision: number; name?: string; enabled?: boolean; branchId?: string; tagMap?: Record<string, string>; staffMap?: Record<string, string> }) => integration<{ page: CrmPancakePage }>('updatePage', input),
    rotateWebhookSecret: (pageId: string) => integration<{ webhookUrl: string }>('rotateWebhookSecret', { pageId }),
    replaceToken: (input: { pageId: string; pageAccessToken: string }) => integration<{ page: CrmPancakePage }>('replaceToken', input),
    refreshPageMeta: (pageId: string) => integration<{ page: CrmPancakePage }>('refreshPageMeta', { pageId }),
    startBackfill: (input: { pageId: string; days: number }) => integration<{ page: CrmPancakePage }>('startBackfill', input),
    disconnectPage: (pageId: string) => integration<{ page: CrmPancakePage }>('disconnectPage', { pageId }),
  }
}

export type CrmService = ReturnType<typeof createCrmService>
