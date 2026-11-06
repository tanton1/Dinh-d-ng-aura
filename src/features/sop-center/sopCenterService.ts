import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import type {
  SopKnowledgeKind,
  SopKnowledgeListResult,
  SopKnowledgeResource,
  SopKnowledgeStatus,
  SopKnowledgeVersion,
} from './types'

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Dịch vụ Trung tâm SOP chưa sẵn sàng.')
  return firebaseFunctions
}

export async function listSopKnowledge(input: {
  query?: string
  kinds?: SopKnowledgeKind[]
  statuses?: SopKnowledgeStatus[]
  cursor?: string | null
  pageSize?: number
} = {}) {
  const callable = httpsCallable<typeof input, SopKnowledgeListResult>(functionsOrThrow(), 'listSopKnowledge', { timeout: 20_000 })
  return (await callable(input)).data
}

export async function getSopKnowledge(resourceId: string) {
  const callable = httpsCallable<
    { resourceId: string },
    { schemaVersion: 1; resource: SopKnowledgeResource; versions: SopKnowledgeVersion[] }
  >(functionsOrThrow(), 'getSopKnowledge', { timeout: 20_000 })
  return (await callable({ resourceId })).data
}

export async function saveSopKnowledgeDraft(input: {
  resourceId?: string
  expectedRevision: number
  idempotencyKey: string
  note: string
  resource: Pick<SopKnowledgeResource, 'kind' | 'code' | 'title' | 'summary' | 'ownerRole' | 'audiences' | 'branchScope' | 'tags' | 'relatedSopIds' | 'relatedSkillIds' | 'contentMetrics' | 'payload'>
}) {
  const callable = httpsCallable<typeof input, { schemaVersion: 1; resource: SopKnowledgeResource }>(
    functionsOrThrow(), 'saveSopKnowledgeDraft', { timeout: 30_000 },
  )
  return (await callable(input)).data
}

export async function transitionSopKnowledge(input: {
  resourceId: string
  expectedRevision: number
  idempotencyKey: string
  targetStatus: SopKnowledgeStatus
  note: string
}) {
  const callable = httpsCallable<typeof input, { schemaVersion: 1; resource: SopKnowledgeResource }>(
    functionsOrThrow(), 'transitionSopKnowledge', { timeout: 30_000 },
  )
  return (await callable(input)).data
}

export async function restoreSopKnowledgeVersion(input: {
  resourceId: string
  versionId: string
  expectedRevision: number
  idempotencyKey: string
  note: string
}) {
  const callable = httpsCallable<typeof input, { schemaVersion: 1; resource: SopKnowledgeResource }>(
    functionsOrThrow(), 'restoreSopKnowledgeVersion', { timeout: 30_000 },
  )
  return (await callable(input)).data
}
