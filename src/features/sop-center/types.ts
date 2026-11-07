export type SopKnowledgeKind =
  | 'sop'
  | 'skill'
  | 'script'
  | 'dialogue'
  | 'objection'
  | 'policy'
  | 'variable'
  | 'kpi'
  | 'escalation'
  | 'price'
  | 'promotion'
  | 'voice'

export type SopKnowledgeStatus = 'draft' | 'review' | 'approved' | 'live'

export type SopCenterSection =
  | 'overview'
  | 'lookup'
  | 'sops'
  | 'skills'
  | 'scripts'
  | 'policies'
  | 'training'
  | 'approvals'

export interface SopKnowledgeResource {
  id: string
  schemaVersion: 1
  kind: SopKnowledgeKind
  sourceId: string
  code: string
  title: string
  summary: string
  status: SopKnowledgeStatus
  version: string
  revision: number
  publishedVersionId?: string | null
  ownerRole: string
  audiences: string[]
  branchScope: string[]
  tags: string[]
  relatedSopIds: string[]
  relatedSkillIds: string[]
  contentMetrics: {
    phraseCount: number
    situationCount: number
    variantCount: number
  }
  searchText: string
  sortKey: string
  sourceSystem: string
  sourceReviewRequired: boolean
  updatedAt: string
  updatedBy: string
  payload: Record<string, unknown>
}

export interface SopKnowledgeSummary extends Omit<SopKnowledgeResource, 'payload' | 'searchText'> {
  payload?: never
}

export interface SopKnowledgeVersion {
  id: string
  version: string
  revision: number
  status: SopKnowledgeStatus
  note: string
  contentHash: string
  createdAt: string
  createdBy: string
  snapshot: SopKnowledgeResource
}

export interface SopCatalogEnvelope {
  schemaVersion: 1
  generatedAt: string
  source: {
    name: string
    purpose: string
    migrationBatchId: string
  }
  excludedScopes: string[]
  stats: {
    total: number
    byKind: Partial<Record<SopKnowledgeKind, number>>
    contentMetrics: {
      phraseCount: number
      situationCount: number
      variantCount: number
    }
  }
  resources: SopKnowledgeResource[]
}

export interface SopStepPayload {
  title?: string
  when?: string
  owner?: string
  skillId?: number | string
  goal?: string
  actions?: string[]
  say?: string[]
  avoid?: string[]
  crm?: string
  done?: string
  escalate?: string
  tools?: string[]
  cases?: Array<{ group?: string; when?: string; then?: string; say?: string[]; crm?: string }>
  quiz?: Array<{ question?: string; options?: string[]; answer?: number; why?: string }>
}

export interface SopPayload extends Record<string, unknown> {
  id?: string
  code?: string
  title?: string
  stage?: string
  goal?: string
  playbook?: SopStepPayload[]
  sections?: Array<{
    title?: string
    kind?: string
    items?: string[]
    rows?: Array<{ time?: string; action?: string; owner?: string }>
    text?: string
  }>
  kpis?: string[]
}

export interface SopCenterCapabilities {
  canRead: boolean
  canEdit: boolean
  canReview: boolean
  canPublish: boolean
  canManageTraining: boolean
  canReadAudit: boolean
}

export interface SopKnowledgeListResult {
  schemaVersion: 1
  rows: SopKnowledgeSummary[]
  total: number
  hasMore: boolean
  nextCursor: string | null
}
