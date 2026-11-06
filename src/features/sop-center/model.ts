import type {
  SopCenterSection,
  SopKnowledgeKind,
  SopKnowledgeResource,
  SopKnowledgeStatus,
  SopPayload,
  SopStepPayload,
} from './types'

export const kindLabels: Record<SopKnowledgeKind, string> = {
  sop: 'SOP',
  skill: 'Kỹ năng',
  script: 'Kịch bản',
  dialogue: 'Hội thoại mẫu',
  objection: 'Xử lý băn khoăn',
  policy: 'Chính sách',
  variable: 'Biến chính sách',
  kpi: 'KPI',
  escalation: 'Escalation',
}

export const statusLabels: Record<SopKnowledgeStatus, string> = {
  draft: 'Bản nháp',
  review: 'Chờ duyệt',
  approved: 'Đã duyệt',
  live: 'Đang áp dụng',
}

export const sectionKinds: Record<Exclude<SopCenterSection, 'overview' | 'training' | 'approvals'>, SopKnowledgeKind[]> = {
  sops: ['sop'],
  skills: ['skill'],
  scripts: ['script', 'dialogue', 'objection'],
  policies: ['policy', 'variable', 'kpi', 'escalation'],
}

export function normalizeSopSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function filterSopResources(
  resources: SopKnowledgeResource[],
  section: SopCenterSection,
  query: string,
) {
  const normalizedQuery = normalizeSopSearch(query)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  return resources.filter((resource) => {
    if (section === 'approvals' && resource.status !== 'review') return false
    if (section !== 'overview' && section !== 'training' && section !== 'approvals') {
      if (!sectionKinds[section].includes(resource.kind)) return false
    }
    if (!tokens.length) return true
    const haystack = resource.searchText || normalizeSopSearch([
      resource.code, resource.title, resource.summary, resource.ownerRole, ...resource.tags,
    ].join(' '))
    return tokens.every((token) => haystack.includes(token))
  })
}

export function resourceSection(resource: Pick<SopKnowledgeResource, 'kind'>): SopCenterSection {
  if (resource.kind === 'sop') return 'sops'
  if (resource.kind === 'skill') return 'skills'
  if (['script', 'dialogue', 'objection'].includes(resource.kind)) return 'scripts'
  return 'policies'
}

const transitions: Record<SopKnowledgeStatus, SopKnowledgeStatus[]> = {
  draft: ['review'],
  review: ['draft', 'approved'],
  approved: ['draft', 'live'],
  live: ['draft'],
}

export function canTransitionSopStatus(from: SopKnowledgeStatus, to: SopKnowledgeStatus) {
  return transitions[from].includes(to)
}

export function sopSteps(resource: SopKnowledgeResource): SopStepPayload[] {
  if (resource.kind !== 'sop') return []
  const payload = resource.payload as SopPayload
  return Array.isArray(payload.playbook) ? payload.playbook : []
}

export function lineItems(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function formatSopTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date)
}

export function statusActionLabel(from: SopKnowledgeStatus, to: SopKnowledgeStatus) {
  if (from === 'draft' && to === 'review') return 'Gửi duyệt'
  if (from === 'review' && to === 'draft') return 'Yêu cầu chỉnh sửa'
  if (from === 'review' && to === 'approved') return 'Phê duyệt'
  if (from === 'approved' && to === 'live') return 'Xuất bản'
  if (to === 'draft') return 'Tạo bản nháp mới'
  return statusLabels[to]
}

