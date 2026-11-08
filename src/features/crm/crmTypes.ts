// Shapes returned by the crmQuery / crmCommand / crmIntegrationCommand
// callables (functions/crm-functions.js). Times are ISO strings or null.

export type CrmStage = 'new_inbox' | 'qualified' | 'consulting' | 'trial_booked' | 'trial_done' | 'quote_sent' | 'won' | 'lost' | 'nurture'
export type CrmLostReason = 'price' | 'distance' | 'schedule' | 'no_need' | 'competitor' | 'no_response' | 'other'
export type CrmPlatform = 'facebook' | 'instagram' | 'zalo' | 'tiktok' | 'whatsapp' | 'website' | 'other'
export type CrmInboxFilter = 'awaiting' | 'mine' | 'new' | 'all'
export type CrmActivityType = 'call' | 'zalo' | 'meeting' | 'note' | 'message'
export type CrmActivityOutcome = 'connected' | 'no_answer' | 'interested' | 'not_interested' | 'callback' | 'booked' | 'other'
export type CrmAppointmentKind = 'trial' | 'consult' | 'inbody'
export type CrmAppointmentStatus = 'booked' | 'attended' | 'no_show' | 'cancelled'
export type CrmStepKind = 'inbox_reply' | 'student_reply' | 'handover' | 'manual'

export interface CrmPhone {
  value: string
  display: string
}

export interface CrmConversation {
  key: string
  pageId: string
  pageName: string
  platform: CrmPlatform
  conversationId: string
  customerId: string
  displayName: string
  pancakeName: string
  customerStage: CrmStage
  ownerUid: string
  ownerName: string
  studentId: string
  preview: string
  lastMessageAt: string | null
  lastMessageFrom: 'customer' | 'page' | ''
  awaitingReply: boolean
  awaitingSince: string | null
  unread: boolean
  messageCount: number
  phoneHints: number
  pancakeUrl: string
}

export interface CrmCustomerCard {
  id: string
  displayName: string
  phone: string
  stage: CrmStage
  ownerName: string
  careOwnerName: string
  platform: CrmPlatform | ''
  goal: string
  studentId: string
  lastInboundAt: string | null
  nextStepAt: string | null
  openStepCount: number
  updatedAt: string | null
  revision: number
}

export interface CrmCustomer {
  id: string
  displayName: string
  phones: CrmPhone[]
  suggestedPhones: CrmPhone[]
  emails: string[]
  branchId: string | null
  stage: CrmStage
  stageLabel: string
  stageChangedAt: string | null
  ownerUid: string
  ownerName: string
  careOwnerUid: string
  careOwnerName: string
  careOwnerKind: 'customer_care' | 'trainer' | ''
  platform: CrmPlatform | ''
  pageName: string
  firstContactAt: string | null
  studentId: string
  wonAt: string | null
  quoteIds: string[]
  contractIds: string[]
  goal: string
  preferredSlots: string
  note: string
  lostReason: CrmLostReason | ''
  lostReasonLabel: string
  lostNote: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  lastActivityAt: string | null
  firstResponseSeconds: number | null
  nextStepAt: string | null
  openStepCount: number
  fromBackfill: boolean
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CrmStep {
  id: string
  customerId: string
  customerName: string
  studentId: string
  kind: CrmStepKind
  title: string
  note: string
  status: 'open' | 'done' | 'skipped'
  ownerUid: string
  ownerName: string
  ownerRole: string
  dueAt: string | null
  overdue: boolean
  escalatedAt: string | null
  outcome: string
  completedAt: string | null
  completedByName: string
  autoClosed: boolean
  sopCode: string
  branchId: string | null
  conversationKey: string
}

export interface CrmActivity {
  id: string
  type: string
  outcome: string
  note: string
  data: Record<string, unknown>
  actorName: string
  createdAt: string | null
}

export interface CrmAppointment {
  id: string
  kind: CrmAppointmentKind
  status: CrmAppointmentStatus
  startAt: string | null
  branchId: string | null
  note: string
  createdByName: string
}

export interface CrmMessage {
  id: string
  direction: 'in' | 'out'
  senderKind: 'customer' | 'page' | 'system'
  senderName: string
  text: string
  attachments: Array<{ type: string; url: string; name: string }>
  sentAt: string | null
}

export interface CrmCustomerAccess {
  manage: boolean
  presale: boolean
  postsale: boolean
  care: boolean
  assignCare: boolean
  erase: boolean
}

export interface CrmCustomerDetail {
  schemaVersion: 1
  mergedInto?: string
  customer: CrmCustomer
  access: CrmCustomerAccess
  conversations: CrmConversation[]
  openSteps: CrmStep[]
  doneSteps: CrmStep[]
  activities: CrmActivity[]
  appointments: CrmAppointment[]
  quotes: Array<{ id: string; code: string; packageName: string; finalPrice: number; status: string }>
  student: { id: string; name: string; branchId: string | null; status: string } | null
}

export interface CrmPage<T> {
  schemaVersion: 1
  rows: T[]
  hasMore: boolean
  nextCursor: string | null
}

export interface CrmMessagePage extends CrmPage<CrmMessage> {
  conversationKey: string
  hiddenBefore: string | null
  wonAt: string | null
}

export interface CrmPipeline {
  schemaVersion: 1
  columns: Array<{ stage: CrmStage; label: string; count: number; rows: CrmCustomerCard[] }>
}

export interface CrmStaffMember {
  uid: string
  name: string
  positions: string[]
}

export interface CrmCareAssignmentRow {
  studentId: string
  name: string
  phone: string
  careOwnerUid: string
  careOwnerName: string
}

export interface CrmPancakePage {
  pageId: string
  name: string
  platform: CrmPlatform
  branchId: string | null
  enabled: boolean
  status: 'active' | 'needs_reconnect' | 'disabled'
  tagMap: Partial<Record<CrmStage, string>>
  staffMap: Record<string, { uid: string; name: string }>
  pancakeTags: Array<{ id: string; text: string; color: string }>
  pancakeUsers: Array<{ id: string; name: string; email: string }>
  webhookLastReceivedAt: string | null
  webhookSuspectedDown: boolean
  webhookSecretHint: string
  lastReconcileAt: string | null
  lastReconcileSynced: number
  lastError: { message: string; at: string | null } | null
  backfill: { status: 'running' | 'done' | 'failed'; conversations: number; since: string | null; cursorUntil: string | null; startedAt: string | null; finishedAt: string | null } | null
  revision: number
  connectedAt: string | null
  updatedAt: string | null
}

export interface CrmIntegrationOverview {
  schemaVersion: 1
  webhookBaseUrl: string
  pages: CrmPancakePage[]
  branches: Array<{ id: string; name: string }>
  stages: Array<{ stage: CrmStage; label: string }>
}

export interface CrmLinkTarget {
  studentId: string
  name: string
  phone: string
  branchId: string | null
  linkedCustomerId: string
}

export interface CrmQuoteCandidate {
  id: string
  code: string
  customerName: string
  packageName: string
  finalPrice: number
  status: string
  linked: boolean
}

export interface CrmDuplicate {
  id: string
  displayName: string
  stage: CrmStage
  phone: string
}

export type CrmEndpoint = 'crmQuery' | 'crmCommand' | 'crmIntegrationCommand'
export type CrmTransport = <T>(endpoint: CrmEndpoint, data: Record<string, unknown>) => Promise<T>
