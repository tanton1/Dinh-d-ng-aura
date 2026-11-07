import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileClock,
  FilePlus2,
  History,
  LibraryBig,
  ListTree,
  MessageSquareText,
  PencilLine,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import ResourceContent from './ResourceContent'
import ResourceEditor, { type SopDraftSubmission } from './ResourceEditor'
import { loadDemoSopCatalog, saveDemoSopResource } from './demoCatalog'
import {
  canTransitionSopStatus,
  filterSopResources,
  formatSopTimestamp,
  kindLabels,
  normalizeSopSearch,
  resourceSection,
  sectionKinds,
  sopSteps,
  statusActionLabel,
  statusLabels,
} from './model'
import {
  getSopKnowledge,
  listSopKnowledge,
  restoreSopKnowledgeVersion,
  saveSopKnowledgeDraft,
  transitionSopKnowledge,
} from './sopCenterService'
import type {
  SopCatalogEnvelope,
  SopCenterCapabilities,
  SopCenterSection,
  SopKnowledgeResource,
  SopKnowledgeKind,
  SopKnowledgeStatus,
  SopKnowledgeVersion,
  SopStepPayload,
} from './types'
import './sop-center.css'

// The tree is the front door; the four libraries behind it hold what the
// tree links to; the review queue only matters while something waits in it.
const sections: Array<{ id: SopCenterSection; label: string; icon: typeof LibraryBig }> = [
  { id: 'lookup', label: 'Tra cứu', icon: ListTree },
  { id: 'sops', label: 'SOP', icon: BookOpenCheck },
  { id: 'skills', label: 'Kỹ năng', icon: Sparkles },
  { id: 'scripts', label: 'Mẫu câu', icon: MessageSquareText },
  { id: 'policies', label: 'Tham chiếu', icon: ShieldCheck },
  { id: 'approvals', label: 'Chờ duyệt', icon: FileClock },
]

const sectionSet = new Set(sections.map((item) => item.id))

// The lookup tree keeps its selected SOP and skill, and an SOP page its step,
// in the address, so a reload, Back or a shared link reopens the same place.
interface LookupSelection { sop?: string | null; skill?: string | null; step?: number | null }

function locationState() {
  const [, rawQuery = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(rawQuery)
  const rawSection = params.get('section') as SopCenterSection | null
  return {
    // Older links to the former overview land on the tree.
    section: rawSection && sectionSet.has(rawSection) ? rawSection : 'lookup' as SopCenterSection,
    resourceId: params.get('resource'),
    sop: params.get('sop'),
    skill: params.get('skill'),
    step: params.get('step'),
  }
}

function featureHash(section: SopCenterSection, resourceId?: string | null, lookup?: LookupSelection) {
  const params = new URLSearchParams()
  params.set('section', section)
  if (resourceId) params.set('resource', resourceId)
  // Path first, then the detail inside it: sop, step, skill.
  if (lookup?.sop) params.set('sop', lookup.sop)
  if (typeof lookup?.step === 'number') params.set('step', String(lookup.step))
  if (lookup?.skill) params.set('skill', lookup.skill)
  return `#/admin-sop?${params.toString()}`
}

const customerKinds: SopKnowledgeKind[] = ['script', 'dialogue', 'objection']
const stringIds = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : []
const pad = (value: number) => String(value).padStart(2, '0')

function makeIdempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

function initialVersion(resource: SopKnowledgeResource): SopKnowledgeVersion {
  return {
    id: resource.publishedVersionId || `migration-${resource.version.replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
    version: resource.version,
    revision: resource.revision,
    status: resource.status,
    note: 'Nhập có kiểm soát từ SOP aura',
    contentHash: 'migration',
    createdAt: resource.updatedAt,
    createdBy: resource.updatedBy,
    snapshot: resource,
  }
}

function safeError(error: unknown) {
  const value = error as { message?: string; code?: string }
  const message = value?.message?.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/i, '')
  return message || 'Không thể hoàn tất thao tác. Vui lòng thử lại.'
}

function resourceSearchText(resource: Pick<SopKnowledgeResource, 'code' | 'title' | 'summary' | 'ownerRole' | 'tags' | 'payload'>) {
  return normalizeSopSearch([resource.code, resource.title, resource.summary, resource.ownerRole, ...resource.tags, JSON.stringify(resource.payload)].join(' ')).slice(0, 45_000)
}

function ResourceRow({ resource, onOpen }: { resource: SopKnowledgeResource; onOpen: () => void }) {
  return <button type="button" className="sop-center-resource-row" title={resource.summary || undefined} onClick={onOpen}>
    <span className={`sop-center-kind-mark sop-center-kind-mark--${resource.kind}`}>{kindLabels[resource.kind]}</span>
    <span className="sop-center-resource-copy"><strong>{resource.title}</strong>{resource.summary && <small>{resource.summary}</small>}</span>
    {resource.status !== 'live' && <span className={`sop-center-status sop-center-status--${resource.status}`}>{statusLabels[resource.status]}</span>}
    <ChevronRight size={18} aria-hidden="true" />
  </button>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="sop-center-empty"><LibraryBig size={28} /><h2>{title}</h2><p>{body}</p></div>
}

function LoadingState() {
  return <div className="sop-center-loading" role="status"><span /><span /><span /><p>Đang tải kho tri thức…</p></div>
}

export default function AdminSopCenterPage({
  isDemo,
  actorId,
  capabilities,
}: {
  isDemo: boolean
  actorId: string
  capabilities: SopCenterCapabilities
}) {
  const [routeState, setRouteState] = useState(locationState)
  const [resources, setResources] = useState<SopKnowledgeResource[]>([])
  const [catalog, setCatalog] = useState<SopCatalogEnvelope | null>(null)
  const [versions, setVersions] = useState<Record<string, SopKnowledgeVersion[]>>({})
  const [loadedDetails, setLoadedDetails] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<SopKnowledgeKind | 'all'>('all')
  const [sopFilter, setSopFilter] = useState('all')
  const [remoteMatches, setRemoteMatches] = useState<{ query: string; ids: Set<string> } | null>(null)
  const [remoteSearching, setRemoteSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [activeStep, setActiveStep] = useState(0)
  const [detailTab, setDetailTab] = useState<'content' | 'history'>('content')
  const [editorOpen, setEditorOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const detailRequestRef = useRef(0)

  const navigateFeature = useCallback((section: SopCenterSection, resourceId?: string | null, lookup?: LookupSelection) => {
    const next = { section, resourceId: resourceId || null, sop: lookup?.sop || null, skill: lookup?.skill || null, step: typeof lookup?.step === 'number' ? String(lookup.step) : null }
    setRouteState(next)
    window.history.pushState(null, '', featureHash(section, resourceId, lookup))
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  // Opening a branch inside the tree replaces the entry, so Back leaves the tree.
  const selectLookup = useCallback((lookup: LookupSelection) => {
    const step = typeof lookup.step === 'number' ? String(lookup.step) : null
    setRouteState((current) => ({ ...current, section: 'lookup', resourceId: null, sop: lookup.sop || null, skill: lookup.skill || null, step }))
    window.history.replaceState(null, '', featureHash('lookup', null, lookup))
  }, [])

  const selectStep = useCallback((index: number) => {
    setActiveStep(index)
    window.history.replaceState(null, '', featureHash(routeState.section, routeState.resourceId, { step: index }))
  }, [routeState.resourceId, routeState.section])

  useEffect(() => {
    const syncLocation = () => setRouteState(locationState())
    window.addEventListener('hashchange', syncLocation)
    window.addEventListener('popstate', syncLocation)
    return () => {
      window.removeEventListener('hashchange', syncLocation)
      window.removeEventListener('popstate', syncLocation)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        if (isDemo) {
          const result = await loadDemoSopCatalog()
          if (cancelled) return
          setCatalog(result.catalog)
          setResources(result.resources)
          setVersions(result.versions)
          setLoadedDetails(new Set(result.resources.map((item) => item.id)))
          return
        }
        const rows: SopKnowledgeResource[] = []
        let cursor: string | null = null
        let page = 0
        do {
          const result = await listSopKnowledge({ cursor, pageSize: 100 })
          rows.push(...result.rows.map((item) => ({ ...item, payload: {}, searchText: '' })))
          cursor = result.nextCursor
          page += 1
        } while (cursor && page < 10)
        if (!cancelled) setResources(rows)
      } catch (loadError) {
        if (!cancelled) setError(safeError(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isDemo])

  const selectedResource = useMemo(
    () => resources.find((item) => item.id === routeState.resourceId) ?? null,
    [resources, routeState.resourceId],
  )

  useEffect(() => {
    setActiveStep(Math.max(0, Number(routeState.step) || 0))
    setDetailTab('content')
  }, [routeState.resourceId, routeState.step])

  useEffect(() => {
    const resourceId = routeState.resourceId
    if (!resourceId || isDemo || loadedDetails.has(resourceId)) return
    const request = ++detailRequestRef.current
    setDetailLoading(true)
    setError('')
    void getSopKnowledge(resourceId).then((result) => {
      if (request !== detailRequestRef.current) return
      setResources((current) => current.map((item) => item.id === resourceId ? result.resource : item))
      setVersions((current) => ({ ...current, [resourceId]: result.versions }))
      setLoadedDetails((current) => new Set(current).add(resourceId))
    }).catch((detailError) => {
      if (request === detailRequestRef.current) setError(safeError(detailError))
    }).finally(() => {
      if (request === detailRequestRef.current) setDetailLoading(false)
    })
  }, [isDemo, loadedDetails, routeState.resourceId])

  const sopList = useMemo(
    () => resources.filter((item) => item.kind === 'sop').sort((left, right) => left.code.localeCompare(right.code, 'vi')),
    [resources],
  )
  const lookupSop = sopList.find((item) => item.sourceId === routeState.sop) ?? sopList[0] ?? null

  // In production the list carries no payload, so the tree reads the chosen
  // SOP once to show its steps.
  useEffect(() => {
    if (isDemo || routeState.section !== 'lookup' || routeState.resourceId || !lookupSop || loadedDetails.has(lookupSop.id)) return
    let cancelled = false
    void getSopKnowledge(lookupSop.id).then((result) => {
      if (cancelled) return
      setResources((current) => current.map((item) => item.id === result.resource.id ? result.resource : item))
      setVersions((current) => ({ ...current, [result.resource.id]: result.versions }))
      setLoadedDetails((current) => new Set(current).add(result.resource.id))
    }).catch(() => {
      // Without the steps the tree still lists the SOP's skills and content.
    })
    return () => { cancelled = true }
  }, [isDemo, loadedDetails, lookupSop, routeState.resourceId, routeState.section])

  // The production list omits each document's full text, so phrases inside a
  // script are matched on the server, which keeps that text.
  useEffect(() => {
    const term = query.trim()
    if (isDemo || normalizeSopSearch(term).length < 2) {
      setRemoteMatches(null)
      return
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setRemoteSearching(true)
      void (async () => {
        const ids = new Set<string>()
        let cursor: string | null = null
        let page = 0
        do {
          const result = await listSopKnowledge({ query: term, cursor, pageSize: 100 })
          result.rows.forEach((row) => ids.add(row.id))
          cursor = result.nextCursor
          page += 1
        } while (cursor && page < 3)
        if (!cancelled) setRemoteMatches({ query: term, ids })
      })().catch(() => {
        // Title and tag matches stay on screen when the full-text search fails.
      }).finally(() => {
        if (!cancelled) setRemoteSearching(false)
      })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [isDemo, query])

  // A skill page lists the SOP steps that apply it; in production that needs
  // the payload of each SOP the skill belongs to.
  useEffect(() => {
    if (isDemo || selectedResource?.kind !== 'skill') return
    const sopIds = selectedResource.relatedSopIds ?? []
    const missing = resources.filter((item) => item.kind === 'sop' && sopIds.includes(item.sourceId) && !loadedDetails.has(item.id))
    if (!missing.length) return
    let cancelled = false
    void Promise.all(missing.map((sop) => getSopKnowledge(sop.id))).then((results) => {
      if (cancelled) return
      setResources((current) => current.map((item) => results.find((result) => result.resource.id === item.id)?.resource ?? item))
      setVersions((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.resource.id, result.versions])) }))
      setLoadedDetails((current) => {
        const next = new Set(current)
        results.forEach((result) => next.add(result.resource.id))
        return next
      })
    }).catch(() => {
      // The skill page still shows its SOPs and content without the step list.
    })
    return () => { cancelled = true }
  }, [isDemo, loadedDetails, resources, selectedResource])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const matchesSopFilter = useCallback((resource: SopKnowledgeResource) => {
    if (sopFilter === 'all') return true
    return resource.kind === 'sop' ? resource.sourceId === sopFilter : (resource.relatedSopIds ?? []).includes(sopFilter)
  }, [sopFilter])
  const matchesControlFilters = useCallback((resource: SopKnowledgeResource) => {
    if (kindFilter !== 'all' && resource.kind !== kindFilter) return false
    return matchesSopFilter(resource)
  }, [kindFilter, matchesSopFilter])
  // The section's rows before the kind chips narrow them: the chips count these.
  const sectionPool = useMemo(
    () => filterSopResources(resources, routeState.section, '').filter(matchesSopFilter),
    [matchesSopFilter, resources, routeState.section],
  )
  const sectionResources = useMemo(
    () => sectionPool.filter((item) => kindFilter === 'all' || item.kind === kindFilter),
    [kindFilter, sectionPool],
  )
  const searchResults = useMemo(() => {
    const term = query.trim()
    if (!term) return []
    const local = new Set(filterSopResources(resources, 'lookup', query).map((item) => item.id))
    const remote = remoteMatches?.query === term ? remoteMatches.ids : null
    return resources.filter((item) => (local.has(item.id) || remote?.has(item.id)) && matchesControlFilters(item))
  }, [matchesControlFilters, query, remoteMatches, resources])
  const steps = selectedResource ? sopSteps(selectedResource) : []
  const resourceVersions = selectedResource
    ? [
      ...(versions[selectedResource.id] ?? []),
      ...((versions[selectedResource.id] ?? []).some((item) => item.revision === 1) ? [] : [initialVersion(selectedResource)]),
    ].sort((left, right) => right.revision - left.revision)
    : []

  const counts = useMemo(() => ({
    sops: resources.filter((item) => item.kind === 'sop').length,
    skills: resources.filter((item) => item.kind === 'skill').length,
    scripts: resources.filter((item) => sectionKinds.scripts.includes(item.kind)).length,
    policies: resources.filter((item) => sectionKinds.policies.includes(item.kind)).length,
    review: resources.filter((item) => item.status === 'review').length,
  }), [resources])
  const visibleSections = sections.filter((item) => item.id !== 'approvals' || counts.review > 0 || capabilities.canReview)

  function replaceResource(next: SopKnowledgeResource) {
    setResources((current) => {
      const found = current.some((item) => item.id === next.id)
      return found ? current.map((item) => item.id === next.id ? next : item) : [next, ...current]
    })
    setLoadedDetails((current) => new Set(current).add(next.id))
  }

  function demoMutation(resource: SopKnowledgeResource, note: string, action: string) {
    const version: SopKnowledgeVersion = {
      id: `demo-r${String(resource.revision).padStart(6, '0')}`,
      version: resource.version,
      revision: resource.revision,
      status: resource.status,
      note: `${action}: ${note}`,
      contentHash: `demo-${resource.revision}`,
      createdAt: resource.updatedAt,
      createdBy: actorId || 'demo-admin',
      snapshot: resource,
    }
    const batchId = catalog?.source.migrationBatchId ?? 'sop-aura-v1'
    const nextVersions = saveDemoSopResource(batchId, resource, version)
    setVersions((current) => ({ ...current, [resource.id]: nextVersions }))
    replaceResource(resource)
    return resource
  }

  async function refreshResourceHistory(resourceId: string) {
    if (isDemo) return
    const result = await getSopKnowledge(resourceId)
    replaceResource(result.resource)
    setVersions((current) => ({ ...current, [resourceId]: result.versions }))
  }

  async function saveDraft(submission: SopDraftSubmission) {
    setBusy(true)
    setError('')
    try {
      const current = creating ? null : selectedResource
      let saved: SopKnowledgeResource
      if (isDemo) {
        const revision = (current?.revision ?? 0) + 1
        const now = new Date().toISOString()
        const id = current?.id ?? `${submission.resource.kind}__demo-${crypto.randomUUID().slice(0, 12)}`
        saved = {
          id,
          schemaVersion: 1,
          sourceId: current?.sourceId ?? id,
          status: 'draft',
          version: `1.${revision}`,
          revision,
          publishedVersionId: current?.publishedVersionId ?? null,
          sourceSystem: current?.sourceSystem ?? 'aura-admin',
          sourceReviewRequired: current?.sourceReviewRequired ?? false,
          updatedAt: now,
          updatedBy: actorId || 'demo-admin',
          sortKey: `${submission.resource.kind}:${normalizeSopSearch(submission.resource.title)}`,
          searchText: resourceSearchText(submission.resource),
          ...submission.resource,
        }
        demoMutation(saved, submission.note, 'Lưu bản nháp')
      } else {
        const result = await saveSopKnowledgeDraft({
          resourceId: current?.id,
          expectedRevision: current?.revision ?? 0,
          idempotencyKey: makeIdempotencyKey('sop-save'),
          note: submission.note,
          resource: submission.resource,
        })
        saved = result.resource
        replaceResource(saved)
        await refreshResourceHistory(saved.id)
      }
      setEditorOpen(false)
      setCreating(false)
      setToast('Đã lưu bản nháp mới.')
      navigateFeature(resourceSection(saved), saved.id)
    } catch (saveError) {
      setError(safeError(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(targetStatus: SopKnowledgeStatus) {
    if (!selectedResource || !canTransitionSopStatus(selectedResource.status, targetStatus)) return
    const defaultNote = targetStatus === 'review'
      ? 'Gửi tài liệu để rà soát nội dung'
      : targetStatus === 'approved'
        ? 'Nội dung đáp ứng tiêu chuẩn vận hành'
        : targetStatus === 'live'
          ? 'Xuất bản để áp dụng'
          : 'Yêu cầu cập nhật nội dung'
    const note = window.prompt('Ghi chú cho lần chuyển trạng thái này:', defaultNote)
    if (note === null) return
    setBusy(true)
    setError('')
    try {
      let saved: SopKnowledgeResource
      if (isDemo) {
        const revision = selectedResource.revision + 1
        saved = {
          ...selectedResource,
          status: targetStatus,
          revision,
          version: `1.${revision}`,
          publishedVersionId: targetStatus === 'live' ? `demo-r${String(revision).padStart(6, '0')}` : selectedResource.publishedVersionId,
          updatedAt: new Date().toISOString(),
          updatedBy: actorId || 'demo-admin',
        }
        demoMutation(saved, note || defaultNote, statusActionLabel(selectedResource.status, targetStatus))
      } else {
        const result = await transitionSopKnowledge({
          resourceId: selectedResource.id,
          expectedRevision: selectedResource.revision,
          idempotencyKey: makeIdempotencyKey('sop-transition'),
          targetStatus,
          note: note || defaultNote,
        })
        saved = result.resource
        replaceResource(saved)
        await refreshResourceHistory(saved.id)
      }
      setToast(`Đã chuyển sang “${statusLabels[targetStatus]}”.`)
    } catch (transitionError) {
      setError(safeError(transitionError))
    } finally {
      setBusy(false)
    }
  }

  async function restoreVersion(version: SopKnowledgeVersion) {
    if (!selectedResource) return
    setBusy(true)
    setError('')
    try {
      if (isDemo) {
        const revision = selectedResource.revision + 1
        const saved: SopKnowledgeResource = {
          ...version.snapshot,
          id: selectedResource.id,
          status: 'draft',
          revision,
          version: `1.${revision}`,
          publishedVersionId: selectedResource.publishedVersionId,
          updatedAt: new Date().toISOString(),
          updatedBy: actorId || 'demo-admin',
          searchText: resourceSearchText(version.snapshot),
        }
        demoMutation(saved, `Khôi phục từ ${version.version}`, 'Khôi phục phiên bản')
      } else {
        await restoreSopKnowledgeVersion({
          resourceId: selectedResource.id,
          versionId: version.id,
          expectedRevision: selectedResource.revision,
          idempotencyKey: makeIdempotencyKey('sop-restore'),
          note: `Khôi phục từ ${version.version}`,
        })
        await refreshResourceHistory(selectedResource.id)
      }
      setDetailTab('content')
      setToast('Đã tạo bản nháp từ phiên bản đã chọn.')
    } catch (restoreError) {
      setError(safeError(restoreError))
    } finally {
      setBusy(false)
    }
  }

  function contentRow(item: SopKnowledgeResource) {
    return <button type="button" key={item.id} onClick={() => navigateFeature(resourceSection(item), item.id)}><span className={`sop-center-kind-mark sop-center-kind-mark--${item.kind}`}>{kindLabels[item.kind]}</span><span><strong>{item.title}</strong>{item.summary && <small>{item.summary}</small>}</span><ChevronRight size={16} /></button>
  }

  // One skill's branch inside the tree: the skill, then its ready-to-use
  // content for this SOP.
  function renderSkillBranch(sop: SopKnowledgeResource, skill: SopKnowledgeResource | undefined, content: SopKnowledgeResource[]) {
    if (!skill) return <p className="sop-center-path-empty">Bước này chưa gắn kỹ năng.</p>
    return <>
      <button type="button" className="sop-center-path-skill" onClick={() => navigateFeature('skills', skill.id)}><span>Kỹ năng áp dụng</span><strong>{skill.title}</strong><small>{skill.code}</small><ArrowRight size={16} /></button>
      {content.length
        ? <div className="sop-center-path-rows" aria-label={`Nội dung dùng ngay của ${skill.title}`}>{content.map(contentRow)}</div>
        : <p className="sop-center-path-empty">{skill.title} chưa có mẫu câu riêng trong {sop.code}.</p>}
    </>
  }

  function renderLookup() {
    const activeSop = lookupSop
    if (!activeSop) return <EmptyState title="Chưa có SOP để tra cứu" body="Hãy nhập bộ SOP trước khi sử dụng cây tri thức." />
    const sopId = activeSop.sourceId
    const steps = sopSteps(activeSop)
    const stepsLoaded = isDemo || loadedDetails.has(activeSop.id)
    const skillById = new Map(resources.filter((item) => item.kind === 'skill').map((item) => [item.sourceId, item]))
    const sopById = new Map(sopList.map((sop) => [sop.sourceId, sop]))
    const sopSkills = resources
      .filter((item) => item.kind === 'skill' && (item.relatedSopIds ?? []).includes(sopId))
      .sort((left, right) => Number(left.sourceId) - Number(right.sourceId))
    const stepSkillIds = steps.map((step) => String(step.skillId ?? ''))
    const stepSupportIds = steps.map((step) => stringIds(step.supportSkillIds))
    const wiredSkillIds = new Set([...stepSkillIds, ...stepSupportIds.flat()].filter(Boolean))
    const unwiredSkills = stepsLoaded ? sopSkills.filter((skill) => !wiredSkillIds.has(skill.sourceId)) : []
    const isKnowledge = (item: SopKnowledgeResource) => item.kind !== 'sop' && item.kind !== 'skill'
    const sopContent = resources.filter((item) => isKnowledge(item) && (item.relatedSopIds ?? []).includes(sopId))
    const useNow = sopContent.filter((item) => customerKinds.includes(item.kind))
    const reference = sopContent.filter((item) => !customerKinds.includes(item.kind))
    const shared = resources.filter((item) => isKnowledge(item) && !(item.relatedSopIds ?? []).length)
    const contentForSkill = (skillId: string) => useNow.filter((item) => (item.relatedSkillIds ?? []).includes(skillId))
    const groupByKind = (items: SopKnowledgeResource[], kinds: SopKnowledgeKind[]) => kinds
      .map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) }))
      .filter((group) => group.items.length > 0)
    const referenceGroups = groupByKind(reference, ['policy', 'kpi', 'price', 'promotion', 'variable'])
    const sharedGroups = groupByKind(shared, ['voice', 'escalation'])
    // The open branch comes from the address: a step, with one of its skills
    // chosen; or a skill alone, which opens the first step that applies it,
    // then the first step that works with it. A skill no step touches opens
    // under its own heading.
    const requestedStep = routeState.step === null ? Number.NaN : Number(routeState.step)
    const skillParam = routeState.skill
    let openStep: number | null = Number.isInteger(requestedStep) && steps[requestedStep] ? requestedStep : null
    let chosenSkill: string | null = null
    if (openStep === null && skillParam) {
      const primaryIndex = stepSkillIds.indexOf(skillParam)
      const supportIndex = stepSupportIds.findIndex((ids) => ids.includes(skillParam))
      if (primaryIndex >= 0) openStep = primaryIndex
      else if (supportIndex >= 0) { openStep = supportIndex; chosenSkill = skillParam }
    } else if (openStep !== null && skillParam && stepSupportIds[openStep].includes(skillParam)) {
      chosenSkill = skillParam
    }
    const openUnwiredSkill = openStep === null && skillParam && unwiredSkills.some((skill) => skill.sourceId === skillParam) ? skillParam : null
    const toggleStep = (index: number) => selectLookup({ sop: sopId, step: openStep === index ? null : index })
    const toggleSkill = (skillId: string) => selectLookup({ sop: sopId, skill: openUnwiredSkill === skillId ? null : skillId })
    // "Tiếp theo" opens the next step below the current panel, so bring it up.
    const revealStep = (index: number) => window.requestAnimationFrame(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document.getElementById(`sop-path-step-${index}`)?.parentElement?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    })
    const stage = typeof activeSop.payload.stage === 'string' ? activeSop.payload.stage : ''
    const renderGroups = (groups: Array<{ kind: SopKnowledgeKind; items: SopKnowledgeResource[] }>) => <div className="sop-center-path-groups">{groups.map((group) => <details key={group.kind}><summary>{kindLabels[group.kind]} <small>{group.items.length}</small></summary><div className="sop-center-path-rows">{group.items.map(contentRow)}</div></details>)}</div>

    return <section className="sop-center-lookup">
      <div className="sop-center-path-layout">
        <nav className="sop-center-path-rail" aria-label="Chọn SOP">
          <ol>{sopList.map((sop) => <li key={sop.id}><button type="button" aria-current={sop.sourceId === sopId ? 'true' : undefined} className={sop.sourceId === sopId ? 'is-active' : ''} onClick={() => selectLookup({ sop: sop.sourceId })}><span>{sop.code}</span><strong>{sop.title}</strong></button></li>)}</ol>
        </nav>
        <div className="sop-center-path">
          <header className="sop-center-path-head">
            <div><span>{activeSop.code}{stage ? ` · ${stage}` : ''}</span><h2>{activeSop.title}</h2>{activeSop.summary && <p>{activeSop.summary}</p>}</div>
            <button type="button" onClick={() => navigateFeature('sops', activeSop.id)}>Mở SOP <ArrowRight size={15} /></button>
          </header>
          <dl className="sop-center-path-facts" aria-label={`Số liệu của ${activeSop.code}`}>
            <div><dd>{stepsLoaded ? steps.length : '…'}</dd><dt>Bước</dt></div>
            <div><dd>{sopSkills.length}</dd><dt>Kỹ năng</dt></div>
            <div><dd>{useNow.length}</dd><dt>Dùng ngay</dt></div>
            <div><dd>{reference.length}</dd><dt>Tham chiếu</dt></div>
          </dl>

          <section className="sop-center-path-section" aria-label="Các bước">
            {!stepsLoaded
              ? <div className="sop-center-path-loading" role="status" aria-label="Đang tải các bước"><span /><span /><span /></div>
              : steps.length
                ? <ol className="sop-center-path-steps">{steps.map((step, index) => {
                  const skillId = stepSkillIds[index]
                  const skill = skillId ? skillById.get(skillId) : undefined
                  const supports = stepSupportIds[index].map((id) => skillById.get(id)).filter((item): item is SopKnowledgeResource => Boolean(item))
                  const open = openStep === index
                  const shownSkill = open && chosenSkill ? skillById.get(chosenSkill) ?? skill : skill
                  const content = shownSkill ? contentForSkill(shownSkill.sourceId) : []
                  const firstUse = skillId ? stepSkillIds.indexOf(skillId) : index
                  const next = steps[index + 1]
                  const handoffs = (Array.isArray(step.handoffs) ? step.handoffs : []).map((handoff) => ({ ...handoff, sop: handoff.sopId ? sopById.get(handoff.sopId) : undefined })).filter((handoff) => handoff.sop)
                  return <li key={`${index}-${step.title}`} className={open ? 'is-open' : ''}>
                    <button type="button" aria-expanded={open} aria-controls={`sop-path-step-${index}`} onClick={() => toggleStep(index)}>
                      <i>{pad(index + 1)}</i>
                      <span className="sop-center-path-step-copy">
                        <strong>{step.title || `Bước ${index + 1}`}</strong>
                        {(step.when || step.owner) && <small>{[step.when, step.owner].filter(Boolean).join(' · ')}</small>}
                        <span className="sop-center-path-step-tags">{skill ? <em className="is-primary">{skill.title}</em> : <em className="is-missing">Chưa gắn kỹ năng</em>}{supports.map((item) => <em key={item.id} className="is-support">{item.title}</em>)}{skill && contentForSkill(skill.sourceId).length > 0 && <b>{contentForSkill(skill.sourceId).length} nội dung</b>}</span>
                      </span>
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                    {open && <div id={`sop-path-step-${index}`} className="sop-center-path-detail">
                      {step.goal && <p className="sop-center-path-goal">{step.goal}</p>}
                      {step.done && <p className="sop-center-path-done"><CheckCircle2 size={15} aria-hidden="true" /><span>Hoàn thành khi: {step.done}</span></p>}
                      {skill && firstUse < index && <p className="sop-center-path-note">Cùng kỹ năng với bước {pad(firstUse + 1)}.</p>}
                      {skill && supports.length > 0 && <div className="sop-center-path-skill-tabs" role="group" aria-label="Kỹ năng của bước này">
                        <button type="button" aria-pressed={!chosenSkill} className={!chosenSkill ? 'is-active' : ''} onClick={() => selectLookup({ sop: sopId, step: index })}>{skill.title} <small>{contentForSkill(skill.sourceId).length}</small></button>
                        {supports.map((item) => <button type="button" key={item.id} aria-pressed={chosenSkill === item.sourceId} className={chosenSkill === item.sourceId ? 'is-active' : ''} onClick={() => selectLookup({ sop: sopId, step: index, skill: item.sourceId })}>{item.title} <small>{contentForSkill(item.sourceId).length}</small></button>)}
                      </div>}
                      {renderSkillBranch(activeSop, shownSkill, content)}
                      {handoffs.length > 0 && <ul className="sop-center-path-handoffs" aria-label="Chuyển sang SOP khác">
                        {handoffs.map((handoff) => <li key={`${handoff.sopId}-${handoff.when}`}><button type="button" onClick={() => { selectLookup({ sop: handoff.sopId }); window.scrollTo({ top: 0, behavior: 'auto' }) }}><span>{handoff.sop?.code}</span><strong>{handoff.sop?.title}</strong>{handoff.when && <small>{handoff.when}</small>}<ArrowRight size={14} /></button></li>)}
                      </ul>}
                      <div className="sop-center-path-links">
                        <button type="button" onClick={() => navigateFeature('sops', activeSop.id, { step: index })}>Xem đầy đủ bước {pad(index + 1)} · {step.say?.length ?? 0} câu nói · {step.cases?.length ?? 0} tình huống <ArrowRight size={14} /></button>
                        {next && <button type="button" className="is-next" onClick={() => { toggleStep(index + 1); revealStep(index + 1) }}>Tiếp theo · Bước {pad(index + 2)}: {next.title || `Bước ${index + 2}`} <ArrowRight size={14} /></button>}
                      </div>
                    </div>}
                  </li>
                })}</ol>
                : <p className="sop-center-path-empty">SOP này chưa có bước nào.</p>}
          </section>

          {unwiredSkills.length > 0 && <section className="sop-center-path-section" aria-labelledby="sop-path-support-title">
            <h3 id="sop-path-support-title">Kỹ năng khác của {activeSop.code}</h3>
            <ul className="sop-center-path-skills">{unwiredSkills.map((skill) => {
              const content = contentForSkill(skill.sourceId)
              const open = openUnwiredSkill === skill.sourceId
              return <li key={skill.id} className={open ? 'is-open' : ''}>
                <button type="button" aria-expanded={open} aria-controls={`sop-path-skill-${skill.sourceId}`} onClick={() => toggleSkill(skill.sourceId)}><span className="sop-center-path-step-copy"><strong>{skill.title}</strong><small>{skill.code}{content.length ? ` · ${content.length} nội dung` : ' · chưa có mẫu câu riêng'}</small></span><ChevronDown size={18} aria-hidden="true" /></button>
                {open && <div id={`sop-path-skill-${skill.sourceId}`} className="sop-center-path-detail">{renderSkillBranch(activeSop, skill, content)}</div>}
              </li>
            })}</ul>
          </section>}

          {referenceGroups.length > 0 && <section className="sop-center-path-section" aria-labelledby="sop-path-reference-title">
            <h3 id="sop-path-reference-title">Quy định & số liệu của {activeSop.code}</h3>
            {renderGroups(referenceGroups)}
          </section>}

          {sharedGroups.length > 0 && <section className="sop-center-path-section sop-center-path-section--shared" aria-labelledby="sop-path-shared-title">
            <h3 id="sop-path-shared-title">Áp dụng mọi SOP</h3>
            {renderGroups(sharedGroups)}
          </section>}
        </div>
      </div>
    </section>
  }

  // A library: the section's rows, narrowed by kind chips (where the section
  // mixes kinds) and by SOP.
  function renderList() {
    const section = sections.find((item) => item.id === routeState.section)
    const kinds = routeState.section === 'approvals'
      ? [...new Set(sectionPool.map((item) => item.kind))]
      : (sectionKinds[routeState.section as keyof typeof sectionKinds] ?? [])
    const countOf = (kind: SopKnowledgeKind) => sectionPool.filter((item) => item.kind === kind).length
    const showKinds = kinds.length > 1
    const showSop = routeState.section !== 'sops' && sopList.length > 0
    return <section className="sop-center-library">
      <header>
        <div><h2>{section?.label}</h2><span>{sectionResources.length} tài liệu</span></div>
        {(showKinds || showSop) && <div className="sop-center-library-filters">
          {showKinds && <div className="sop-center-chips" role="group" aria-label="Loại tài liệu">
            <button type="button" aria-pressed={kindFilter === 'all'} className={kindFilter === 'all' ? 'is-active' : ''} onClick={() => setKindFilter('all')}>Tất cả <small>{sectionPool.length}</small></button>
            {kinds.map((kind) => <button type="button" key={kind} aria-pressed={kindFilter === kind} className={kindFilter === kind ? 'is-active' : ''} onClick={() => setKindFilter(kind)}>{kindLabels[kind]} <small>{countOf(kind)}</small></button>)}
          </div>}
          {showSop && <label className="sop-center-sop-select"><span>Theo SOP</span><select value={sopFilter} onChange={(event) => setSopFilter(event.target.value)}><option value="all">Tất cả SOP</option>{sopList.map((sop) => <option key={sop.id} value={sop.sourceId}>{sop.code} · {sop.title}</option>)}</select></label>}
        </div>}
      </header>
      {sectionResources.length
        ? <div className="sop-center-resource-list">{sectionResources.map((item) => <ResourceRow key={item.id} resource={item} onOpen={() => navigateFeature(routeState.section, item.id)} />)}</div>
        : routeState.section === 'approvals' && sectionPool.length === 0
          ? <EmptyState title="Không có tài liệu chờ duyệt" body="Tài liệu được gửi duyệt sẽ xuất hiện ở đây." />
          : <EmptyState title="Không có tài liệu phù hợp" body="Thử bỏ bớt bộ lọc hoặc chuyển sang khu vực khác." />}
    </section>
  }

  function skillForStep(step: SopStepPayload | undefined) {
    if (!step?.skillId) return undefined
    return resources.find((item) => item.kind === 'skill' && item.sourceId === String(step.skillId))
  }

  // Each step names the one skill it applies; show it with that skill's
  // scripts, dialogues and objections for this SOP.
  function renderStepSkill(sop: SopKnowledgeResource, step: SopStepPayload | undefined) {
    const skill = skillForStep(step)
    if (!skill) return <section className="sop-center-step-skill is-missing"><span>Kỹ năng áp dụng</span><p>Bước này chưa gắn kỹ năng.</p></section>
    const supports = stringIds(step?.supportSkillIds).map((id) => resources.find((item) => item.kind === 'skill' && item.sourceId === id)).filter((item): item is SopKnowledgeResource => Boolean(item))
    const handoffs = (Array.isArray(step?.handoffs) ? step!.handoffs! : []).map((handoff) => ({ ...handoff, sop: resources.find((item) => item.kind === 'sop' && item.sourceId === handoff.sopId) })).filter((handoff) => handoff.sop)
    const contentOf = (skillId: string) => resources.filter((item) => customerKinds.includes(item.kind) && (item.relatedSkillIds ?? []).includes(skillId) && (item.relatedSopIds ?? []).includes(sop.sourceId))
    const content = contentOf(skill.sourceId)
    return <section className="sop-center-step-skill" aria-label="Kỹ năng áp dụng cho bước này">
      <span>Kỹ năng áp dụng</span>
      <button type="button" className="sop-center-step-skill-name" onClick={() => navigateFeature('skills', skill.id)}><i>{String(skill.sourceId).padStart(2, '0')}</i><span><strong>{skill.title}</strong><small>{skill.code}</small></span><ChevronRight size={16} /></button>
      {content.length
        ? <div className="sop-center-step-skill-content"><strong>{content.length} nội dung của kỹ năng này trong {sop.code}</strong><div>{content.slice(0, 6).map((item) => <button type="button" key={item.id} onClick={() => navigateFeature(resourceSection(item), item.id)}><span>{kindLabels[item.kind]}</span>{item.title}<ChevronRight size={14} /></button>)}</div>{content.length > 6 && <button type="button" className="sop-center-step-skill-more" onClick={() => navigateFeature('lookup', null, { sop: sop.sourceId, skill: skill.sourceId })}>Xem tất cả {content.length} trên cây <ArrowRight size={14} /></button>}</div>
        : <p>Kỹ năng này chưa có mẫu câu riêng trong {sop.code}.</p>}
      {supports.length > 0 && <div className="sop-center-step-skill-support"><strong>Phối hợp</strong><div>{supports.map((item) => <button type="button" key={item.id} onClick={() => navigateFeature('lookup', null, { sop: sop.sourceId, step: activeStep, skill: item.sourceId })}>{item.title} <small>{contentOf(item.sourceId).length}</small></button>)}</div></div>}
      {handoffs.length > 0 && <div className="sop-center-step-skill-handoffs"><strong>Chuyển sang</strong><div>{handoffs.map((handoff) => <button type="button" key={`${handoff.sopId}-${handoff.when}`} onClick={() => navigateFeature('sops', handoff.sop!.id)}><span>{handoff.sop!.code}</span>{handoff.when}<ArrowRight size={14} /></button>)}</div></div>}
    </section>
  }

  function renderRelations(resource: SopKnowledgeResource) {
    const sopIds = resource.kind === 'sop' ? [resource.sourceId] : (resource.relatedSopIds ?? [])
    // A skill lists itself in relatedSkillIds; it is not its own related skill.
    const skillIds = (resource.relatedSkillIds ?? []).filter((id) => resource.kind !== 'skill' || id !== resource.sourceId)
    const relatedSops = resources.filter((item) => item.kind === 'sop' && sopIds.includes(item.sourceId))
    const relatedSkills = resources.filter((item) => item.kind === 'skill' && skillIds.includes(item.sourceId))
    const linkedSamples = resource.kind === 'sop'
      ? resources.filter((item) => customerKinds.includes(item.kind) && (item.relatedSopIds ?? []).includes(resource.sourceId))
      : []
    const skillContent = resource.kind === 'skill'
      ? resources.filter((item) => customerKinds.includes(item.kind) && (item.relatedSkillIds ?? []).includes(resource.sourceId))
      : []
    const stepsOf = (sop: SopKnowledgeResource) => sopSteps(sop).map((step, index) => ({ sop, step, index }))
    const usedInSteps = resource.kind === 'skill'
      ? relatedSops.flatMap((sop) => stepsOf(sop).filter(({ step }) => String(step.skillId ?? '') === resource.sourceId))
      : []
    const supportInSteps = resource.kind === 'skill'
      ? relatedSops.flatMap((sop) => stepsOf(sop).filter(({ step }) => stringIds(step.supportSkillIds).includes(resource.sourceId)))
      : []
    const stepButton = ({ sop, step, index }: { sop: SopKnowledgeResource; step: SopStepPayload; index: number }) => <button type="button" key={`${sop.id}-${index}`} onClick={() => navigateFeature('sops', sop.id, { step: index })}><span>{sop.code} · B{pad(index + 1)}</span>{step.title || `Bước ${index + 1}`}<ChevronRight size={14} /></button>
    const stepsKnown = isDemo || relatedSops.every((sop) => loadedDetails.has(sop.id))
    const treeTarget: LookupSelection | null = resource.kind === 'sop'
      ? { sop: resource.sourceId }
      : resource.kind === 'skill' && relatedSops[0] ? { sop: relatedSops[0].sourceId, skill: resource.sourceId } : null
    if (!relatedSops.length && !relatedSkills.length && !linkedSamples.length && resource.kind !== 'skill') return null
    return <section className="sop-center-relations">
      <header><h3>{resource.kind === 'skill' ? 'Kỹ năng này thuộc SOP nào?' : resource.kind === 'sop' ? 'Kỹ năng và mẫu câu theo SOP' : 'Nội dung này được dùng ở đâu?'}</h3>{treeTarget && <button type="button" onClick={() => navigateFeature('lookup', null, treeTarget)}><ListTree size={15} /> Xem trên cây</button>}</header>
      {relatedSops.length > 0 && resource.kind !== 'sop' && <div className="sop-center-relation-group"><strong>SOP liên quan</strong><div>{relatedSops.map((sop) => <button type="button" key={sop.id} onClick={() => navigateFeature('sops', sop.id)}><span>{sop.code}</span>{sop.title}<ChevronRight size={14} /></button>)}</div></div>}
      {relatedSkills.length > 0 && <div className="sop-center-relation-group"><strong>{resource.kind === 'sop' ? `${relatedSkills.length} kỹ năng thuộc SOP này` : 'Kỹ năng liên quan'}</strong><div>{relatedSkills.map((skill) => <button type="button" key={skill.id} onClick={() => navigateFeature('skills', skill.id)}><span>{skill.code}</span>{skill.title}<ChevronRight size={14} /></button>)}</div></div>}
      {resource.kind === 'skill' && stepsKnown && relatedSops.length > 0 && usedInSteps.length > 0 && <div className="sop-center-relation-group"><strong>Dùng ở {usedInSteps.length} bước</strong><div>{usedInSteps.map(stepButton)}</div></div>}
      {resource.kind === 'skill' && stepsKnown && relatedSops.length > 0 && supportInSteps.length > 0 && <div className="sop-center-relation-group"><strong>Phối hợp ở {supportInSteps.length} bước</strong><div>{supportInSteps.map(stepButton)}</div></div>}
      {resource.kind === 'skill' && stepsKnown && relatedSops.length > 0 && !usedInSteps.length && !supportInSteps.length && <p className="sop-center-empty-copy">Kỹ năng hỗ trợ xuyên suốt {relatedSops.map((sop) => sop.code).join(', ')}, chưa bước nào áp dụng hay phối hợp.</p>}
      {resource.kind === 'skill' && (skillContent.length
        ? <div className="sop-center-relation-group"><strong>{skillContent.length} nội dung dùng kỹ năng này</strong><div>{skillContent.map((item) => <button type="button" key={item.id} onClick={() => navigateFeature(resourceSection(item), item.id)}><span>{kindLabels[item.kind]}</span>{item.title}<ChevronRight size={14} /></button>)}</div></div>
        : <p className="sop-center-empty-copy">Kỹ năng này chưa có mẫu câu, hội thoại hay tình huống nào.</p>)}
      {linkedSamples.length > 0 && <div className="sop-center-relation-summary"><span><strong>{linkedSamples.filter((item) => item.kind === 'script').length}</strong> kịch bản</span><span><strong>{linkedSamples.filter((item) => item.kind === 'dialogue').length}</strong> hội thoại</span><span><strong>{linkedSamples.filter((item) => item.kind === 'objection').length}</strong> xử lý băn khoăn</span><button type="button" onClick={() => { setSopFilter(resource.sourceId); setKindFilter('all'); navigateFeature('scripts') }}>Xem tất cả <ArrowRight size={14} /></button></div>}
    </section>
  }

  function renderWorkflowActions(resource: SopKnowledgeResource) {
    const openEditor = () => { setCreating(false); setEditorOpen(true) }
    return <>
      {resource.status === 'draft' && capabilities.canEdit && <button type="button" className="sop-center-button sop-center-button--secondary" disabled={busy} onClick={() => void changeStatus('review')}><Send size={16} /> Gửi duyệt</button>}
      {resource.status === 'review' && capabilities.canReview && <><button type="button" className="sop-center-button sop-center-button--secondary" disabled={busy} onClick={() => void changeStatus('draft')}><X size={16} /> Yêu cầu sửa</button><button type="button" className="sop-center-button sop-center-button--primary" disabled={busy} onClick={() => void changeStatus('approved')}><Check size={16} /> Phê duyệt</button></>}
      {resource.status === 'approved' && capabilities.canPublish && <button type="button" className="sop-center-button sop-center-button--primary" disabled={busy} onClick={() => void changeStatus('live')}><Sparkles size={16} /> Xuất bản</button>}
      {capabilities.canEdit && <button type="button" className="sop-center-button sop-center-button--secondary" onClick={openEditor}><PencilLine size={16} /> {resource.status === 'live' ? 'Tạo bản nháp mới' : 'Chỉnh sửa'}</button>}
    </>
  }

  function renderDetail() {
    if (detailLoading && !selectedResource) return <LoadingState />
    if (!selectedResource) return <EmptyState title="Không tìm thấy tài liệu" body="Tài liệu có thể đã được đổi mã hoặc chưa được nhập vào môi trường này." />
    const resource = selectedResource
    const home = resourceSection(resource)
    const homeLabel = sections.find((item) => item.id === home)?.label ?? 'thư viện'
    const isSop = resource.kind === 'sop'
    return <section className="sop-center-detail">
      <header className="sop-center-detail-header">
        <button type="button" className="sop-center-back" onClick={() => navigateFeature(home)}><ArrowLeft size={17} /> {homeLabel}</button>
        <div className="sop-center-detail-title">
          <div><span>{kindLabels[resource.kind]} · {resource.code}</span><h1>{resource.title}</h1>{resource.summary && <p>{resource.summary}</p>}</div>
          <div className="sop-center-detail-actions">{renderWorkflowActions(resource)}</div>
        </div>
        <dl className="sop-center-detail-meta" aria-label="Trạng thái tài liệu">
          <div><dt>Trạng thái</dt><dd><span className={`sop-center-status sop-center-status--${resource.status}`}>{statusLabels[resource.status]}</span></dd></div>
          <div><dt>Phiên bản</dt><dd>v{resource.version}</dd></div>
          <div><dt>Phụ trách</dt><dd>{resource.ownerRole || 'admin'}</dd></div>
          {resource.audiences.length > 0 && <div><dt>Dành cho</dt><dd>{resource.audiences.join(', ')}</dd></div>}
          <div><dt>Cập nhật</dt><dd>{formatSopTimestamp(resource.updatedAt)}</dd></div>
        </dl>
        {resource.sourceReviewRequired && <p className="sop-center-review-flag"><AlertTriangle size={16} aria-hidden="true" /> Cần xác minh với chính sách hiện hành trước khi xuất bản.</p>}
        <div className="sop-center-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected={detailTab === 'content'} className={detailTab === 'content' ? 'is-active' : ''} onClick={() => setDetailTab('content')}>Nội dung</button><button type="button" role="tab" aria-selected={detailTab === 'history'} className={detailTab === 'history' ? 'is-active' : ''} onClick={() => setDetailTab('history')}><History size={15} /> Lịch sử <span>{resourceVersions.length}</span></button></div>
      </header>

      {detailTab === 'history' ? <div className="sop-center-history-view">
        <p className="sop-center-history-note">Khôi phục luôn tạo một bản nháp mới; phiên bản cũ được giữ nguyên.</p>
        <div className="sop-center-history-list">{resourceVersions.map((version) => <article key={`${version.id}-${version.revision}`}><div className="sop-center-history-line"><span /><i /></div><div><header><strong>v{version.version}</strong><span className={`sop-center-status sop-center-status--${version.status}`}>{statusLabels[version.status]}</span></header><p>{version.note || 'Không có ghi chú.'}</p><small>{formatSopTimestamp(version.createdAt)} · {version.createdBy || 'system'}</small>{capabilities.canEdit && version.revision !== resource.revision && <button type="button" disabled={busy} onClick={() => void restoreVersion(version)}><RotateCcw size={14} /> Khôi phục thành bản nháp</button>}</div></article>)}</div>
      </div> : <div className={`sop-center-workspace ${isSop ? '' : 'sop-center-workspace--single'}`}>
        {isSop && <aside className="sop-center-process-rail">
          <span>Các bước</span>
          {steps.length ? <ol>{steps.map((step, index) => <li key={`${index}-${step.title}`} className={index === activeStep ? 'is-active' : ''}><button type="button" aria-current={index === activeStep ? 'step' : undefined} onClick={() => selectStep(index)}><i>{pad(index + 1)}</i><span><strong>{step.title || `Bước ${index + 1}`}</strong><small>{step.when || step.owner}</small>{skillForStep(step) && <em>{skillForStep(step)?.title}</em>}</span></button></li>)}</ol> : <p className="sop-center-empty-copy">SOP này chưa có bước nào.</p>}
        </aside>}
        <main><ResourceContent resource={resource} activeStep={activeStep} stepSkill={isSop ? renderStepSkill(resource, steps[activeStep]) : undefined} />{renderRelations(resource)}</main>
      </div>}
    </section>
  }

  if (loading) return <div className="sop-center-page"><LoadingState /></div>

  return <div className="sop-center-page">
    <header className="sop-center-page-header">
      <h1>Trung tâm SOP</h1>
      <div className="sop-center-toolbar" aria-label="Tìm kiếm">
        <label className="sop-center-search"><Search size={18} aria-hidden="true" /><input aria-label="Tìm trong Trung tâm SOP" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm SOP, kỹ năng, mẫu câu…" />{query && <button type="button" aria-label="Xóa từ khóa" onClick={() => setQuery('')}><X size={15} /></button>}</label>
        {capabilities.canEdit && <button type="button" className="sop-center-button sop-center-button--primary sop-center-create-button" aria-label="Tạo tài liệu mới" title="Tạo mới" onClick={() => { setCreating(true); setEditorOpen(true) }}><FilePlus2 size={17} /><span className="sop-center-control-label">Tạo mới</span></button>}
      </div>
    </header>

    <nav className="sop-center-nav" aria-label="Khu vực Trung tâm SOP">{visibleSections.map((item) => { const Icon = item.icon; const count = item.id === 'approvals' ? counts.review : item.id === 'sops' ? counts.sops : item.id === 'skills' ? counts.skills : item.id === 'scripts' ? counts.scripts : item.id === 'policies' ? counts.policies : null; return <button type="button" key={item.id} className={routeState.section === item.id && !routeState.resourceId ? 'is-active' : ''} onClick={() => { setKindFilter('all'); navigateFeature(item.id) }}><Icon size={16} /><span>{item.label}</span>{count !== null && <small>{count}</small>}</button> })}</nav>

    {error && <div className="sop-center-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setError('')}><X size={16} /></button></div>}
    {toast && <div className="sop-center-toast" role="status"><Check size={17} />{toast}</div>}

    <div className="sop-center-page-body">
      {query.trim() && !routeState.resourceId ? <section className="sop-center-library"><header><div><h2>“{query.trim()}”</h2><span role="status">{searchResults.length} kết quả{remoteSearching ? ' · đang tìm trong nội dung…' : ''}</span></div></header>{searchResults.length ? <div className="sop-center-resource-list">{searchResults.map((item) => <ResourceRow key={item.id} resource={item} onOpen={() => navigateFeature(resourceSection(item), item.id)} />)}</div> : <EmptyState title="Chưa tìm thấy kết quả" body="Kiểm tra chính tả hoặc thử một từ khóa ngắn hơn." />}</section>
        : routeState.resourceId ? renderDetail()
          : routeState.section === 'lookup' ? renderLookup()
            : renderList()}
    </div>

    {editorOpen && <ResourceEditor resource={creating ? null : selectedResource} activeStep={activeStep} busy={busy} onCancel={() => { if (!busy) { setEditorOpen(false); setCreating(false) } }} onSave={saveDraft} />}
  </div>
}
