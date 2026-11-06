import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  FilePlus2,
  GraduationCap,
  History,
  LibraryBig,
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
  SopKnowledgeStatus,
  SopKnowledgeVersion,
} from './types'
import './sop-center.css'

const sections: Array<{ id: SopCenterSection; label: string; icon: typeof LibraryBig }> = [
  { id: 'overview', label: 'Tổng quan', icon: LibraryBig },
  { id: 'sops', label: 'SOP', icon: BookOpenCheck },
  { id: 'skills', label: 'Kỹ năng', icon: Sparkles },
  { id: 'scripts', label: 'Kịch bản', icon: ClipboardCheck },
  { id: 'policies', label: 'Chính sách', icon: ShieldCheck },
  { id: 'training', label: 'Đào tạo', icon: GraduationCap },
  { id: 'approvals', label: 'Chờ duyệt', icon: FileClock },
]

const sectionSet = new Set(sections.map((item) => item.id))

function locationState() {
  const [, rawQuery = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(rawQuery)
  const rawSection = params.get('section') as SopCenterSection | null
  return {
    section: rawSection && sectionSet.has(rawSection) ? rawSection : 'overview' as SopCenterSection,
    resourceId: params.get('resource'),
  }
}

function featureHash(section: SopCenterSection, resourceId?: string | null) {
  const params = new URLSearchParams()
  if (section !== 'overview') params.set('section', section)
  if (resourceId) params.set('resource', resourceId)
  const query = params.toString()
  return `#/admin-sop${query ? `?${query}` : ''}`
}

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
  return <button type="button" className="sop-center-resource-row" onClick={onOpen}>
    <span className={`sop-center-kind-mark sop-center-kind-mark--${resource.kind}`}>{kindLabels[resource.kind]}</span>
    <span className="sop-center-resource-copy"><strong>{resource.title}</strong><small>{resource.summary || resource.code}</small><span>{resource.code} · {resource.ownerRole || 'admin'} · v{resource.version}</span></span>
    <span className={`sop-center-status sop-center-status--${resource.status}`}>{statusLabels[resource.status]}</span>
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

  const navigateFeature = useCallback((section: SopCenterSection, resourceId?: string | null) => {
    const next = { section, resourceId: resourceId || null }
    setRouteState(next)
    window.history.pushState(null, '', featureHash(section, resourceId))
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

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
    setActiveStep(0)
    setDetailTab('content')
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

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const sectionResources = useMemo(
    () => filterSopResources(resources, routeState.section, query),
    [query, resources, routeState.section],
  )
  const searchResults = useMemo(
    () => query.trim() ? filterSopResources(resources, 'overview', query) : [],
    [query, resources],
  )
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
    scripts: resources.filter((item) => ['script', 'dialogue', 'objection'].includes(item.kind)).length,
    policies: resources.filter((item) => ['policy', 'variable', 'kpi', 'escalation'].includes(item.kind)).length,
    review: resources.filter((item) => item.status === 'review').length,
    live: resources.filter((item) => item.status === 'live').length,
  }), [resources])

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

  function renderOverview() {
    const recent = [...resources].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 6)
    const pending = resources.filter((item) => item.status === 'review').slice(0, 5)
    return <>
      <section className="sop-center-ledger" aria-label="Tổng quan kho tri thức">
        <div className="sop-center-ledger-intro"><span>Kho tri thức vận hành</span><h2>Một nguồn chuẩn.<br />Một luồng phê duyệt.</h2><p>Nội dung được tổ chức để nhân sự tìm đúng hướng dẫn, còn Admin kiểm soát rõ bản nháp, người duyệt và phiên bản đang áp dụng.</p></div>
        <dl>
          <div><dt>SOP</dt><dd>{counts.sops}</dd><small>quy trình trong phạm vi</small></div>
          <div><dt>Skill</dt><dd>{counts.skills}</dd><small>hợp đồng kỹ năng</small></div>
          <div><dt>Kịch bản</dt><dd>{counts.scripts}</dd><small>mẫu câu & tình huống</small></div>
          <div><dt>Chờ duyệt</dt><dd>{counts.review}</dd><small>cần Admin xử lý</small></div>
        </dl>
      </section>

      <section className="sop-center-scope-note">
        <ShieldCheck size={22} />
        <div><strong>Phạm vi đã khóa theo yêu cầu</strong><p>Không nhập Lead Pipeline, Hội viên 360, Renewal, dữ liệu hội viên/hợp đồng, bảng giá hay khuyến mãi. Chính sách cũ chỉ ở trạng thái tham chiếu chờ duyệt.</p></div>
      </section>

      <section className="sop-center-release-flow">
        <header><div><span>Governance</span><h2>Luồng phát hành</h2></div><p>Mỗi lần thay đổi tạo một snapshot bất biến để đối chiếu hoặc khôi phục.</p></header>
        <ol>
          {[
            ['01', 'Bản nháp', 'Biên tập nội dung'],
            ['02', 'Chờ duyệt', 'Rà soát nghiệp vụ'],
            ['03', 'Đã duyệt', 'Sẵn sàng phát hành'],
            ['04', 'Đang áp dụng', 'Phiên bản chuẩn'],
          ].map(([number, title, body], index) => <li key={number}><span>{number}</span><div><strong>{title}</strong><small>{body}</small></div>{index < 3 && <ArrowRight size={16} />}</li>)}
        </ol>
      </section>

      <div className="sop-center-overview-columns">
        <section className="sop-center-panel">
          <header><div><span>Mới cập nhật</span><h2>Tài liệu gần đây</h2></div></header>
          <div className="sop-center-resource-list">{recent.map((item) => <ResourceRow key={item.id} resource={item} onOpen={() => navigateFeature(resourceSection(item), item.id)} />)}</div>
        </section>
        <section className="sop-center-panel sop-center-panel--approval">
          <header><div><span>Review queue</span><h2>Đang chờ duyệt</h2></div><button type="button" onClick={() => navigateFeature('approvals')}>Xem tất cả <ArrowRight size={15} /></button></header>
          {pending.length ? <div className="sop-center-compact-list">{pending.map((item) => <button type="button" key={item.id} onClick={() => navigateFeature('approvals', item.id)}><span>{kindLabels[item.kind]}</span><strong>{item.title}</strong><small>{item.ownerRole}</small></button>)}</div> : <p className="sop-center-empty-copy">Không có tài liệu chờ duyệt.</p>}
        </section>
      </div>
    </>
  }

  function renderTraining() {
    const audiences = new Map<string, { total: number; live: number }>()
    resources.forEach((resource) => {
      const labels = resource.audiences.length ? resource.audiences : [resource.ownerRole || 'admin']
      labels.forEach((label) => {
        const current = audiences.get(label) ?? { total: 0, live: 0 }
        current.total += 1
        if (resource.status === 'live') current.live += 1
        audiences.set(label, current)
      })
    })
    return <section className="sop-center-training">
      <div className="sop-center-training-hero"><span>Training readiness</span><h2>Chuẩn bị nội dung trước khi giao học.</h2><p>Phiên bản đầu tập trung chuẩn hóa kho tài liệu. Việc giao bài, ghi nhận hoàn thành và kiểm tra năng lực sẽ được bật sau khi nội dung nguồn hoàn tất duyệt.</p></div>
      <div className="sop-center-readiness-table">
        <header><span>Nhóm người học</span><span>Tài liệu</span><span>Đang áp dụng</span><span>Mức sẵn sàng</span></header>
        {[...audiences.entries()].sort((left, right) => right[1].total - left[1].total).slice(0, 10).map(([label, value]) => {
          const readiness = value.total ? Math.round(value.live / value.total * 100) : 0
          return <div key={label}><strong>{label}</strong><span>{value.total}</span><span>{value.live}</span><span><i style={{ width: `${readiness}%` }} />{readiness}%</span></div>
        })}
      </div>
      <div className="sop-center-training-gate"><AlertTriangle size={20} /><div><strong>Chưa ghi nhận kết quả đào tạo</strong><p>Không có dữ liệu hoàn thành giả. Khu vực này chỉ thể hiện độ sẵn sàng của nội dung cho tới khi backend đào tạo được kích hoạt.</p></div></div>
    </section>
  }

  function renderList() {
    const section = sections.find((item) => item.id === routeState.section)
    return <section className="sop-center-library">
      <header><div><span>Thư viện</span><h2>{section?.label}</h2><p>{sectionResources.length} tài liệu phù hợp bộ lọc hiện tại.</p></div></header>
      {sectionResources.length ? <div className="sop-center-resource-list">{sectionResources.map((item) => <ResourceRow key={item.id} resource={item} onOpen={() => navigateFeature(routeState.section, item.id)} />)}</div> : <EmptyState title="Không có tài liệu phù hợp" body="Thử từ khóa khác hoặc chuyển sang khu vực khác trong Trung tâm SOP." />}
    </section>
  }

  function renderDetail() {
    if (detailLoading && !selectedResource) return <LoadingState />
    if (!selectedResource) return <EmptyState title="Không tìm thấy tài liệu" body="Tài liệu có thể đã được đổi mã hoặc chưa được nhập vào môi trường này." />
    const canEdit = capabilities.canEdit
    return <section className="sop-center-detail">
      <header className="sop-center-detail-header">
        <button type="button" className="sop-center-back" onClick={() => navigateFeature(resourceSection(selectedResource))}><ArrowLeft size={17} /> Quay lại thư viện</button>
        <div className="sop-center-detail-title"><div><span>{kindLabels[selectedResource.kind]} · {selectedResource.code}</span><h1>{selectedResource.title}</h1><p>{selectedResource.summary}</p></div><div className="sop-center-detail-actions">{canEdit && <button type="button" className="sop-center-button sop-center-button--secondary" onClick={() => { setCreating(false); setEditorOpen(true) }}><PencilLine size={16} /> Chỉnh sửa</button>}</div></div>
        <div className="sop-center-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected={detailTab === 'content'} className={detailTab === 'content' ? 'is-active' : ''} onClick={() => setDetailTab('content')}>Nội dung</button><button type="button" role="tab" aria-selected={detailTab === 'history'} className={detailTab === 'history' ? 'is-active' : ''} onClick={() => setDetailTab('history')}><History size={15} /> Lịch sử <span>{resourceVersions.length}</span></button></div>
      </header>

      {detailTab === 'history' ? <div className="sop-center-history-view">
        <div className="sop-center-history-intro"><span>Version history</span><h2>Mọi thay đổi đều có dấu vết.</h2><p>Khôi phục luôn tạo một bản nháp mới; phiên bản cũ không bị sửa hoặc xóa.</p></div>
        <div className="sop-center-history-list">{resourceVersions.map((version) => <article key={`${version.id}-${version.revision}`}><div className="sop-center-history-line"><span /><i /></div><div><header><strong>v{version.version}</strong><span className={`sop-center-status sop-center-status--${version.status}`}>{statusLabels[version.status]}</span></header><p>{version.note || 'Không có ghi chú.'}</p><small>{formatSopTimestamp(version.createdAt)} · {version.createdBy || 'system'} · revision {version.revision}</small>{capabilities.canEdit && version.revision !== selectedResource.revision && <button type="button" disabled={busy} onClick={() => void restoreVersion(version)}><RotateCcw size={14} /> Khôi phục thành bản nháp</button>}</div></article>)}</div>
      </div> : <div className={`sop-center-workspace ${selectedResource.kind !== 'sop' ? 'sop-center-workspace--compact' : ''}`}>
        <aside className="sop-center-process-rail">
          <span>{selectedResource.kind === 'sop' ? 'Process spine' : 'Mục lục'}</span>
          {steps.length ? <ol>{steps.map((step, index) => <li key={`${index}-${step.title}`} className={index === activeStep ? 'is-active' : ''}><button type="button" onClick={() => setActiveStep(index)}><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{step.title || `Bước ${index + 1}`}</strong><small>{step.when || step.owner}</small></span></button></li>)}</ol> : <div className="sop-center-outline-meta"><div><small>Loại</small><strong>{kindLabels[selectedResource.kind]}</strong></div><div><small>Mã</small><strong>{selectedResource.code}</strong></div><div><small>Owner</small><strong>{selectedResource.ownerRole}</strong></div></div>}
        </aside>
        <main><ResourceContent resource={selectedResource} activeStep={activeStep} /></main>
        <aside className="sop-center-governance">
          <span>Governance</span>
          <div className="sop-center-governance-status"><span className={`sop-center-status sop-center-status--${selectedResource.status}`}>{statusLabels[selectedResource.status]}</span><strong>v{selectedResource.version}</strong><small>Revision {selectedResource.revision}</small></div>
          {selectedResource.sourceReviewRequired && <div className="sop-center-review-flag"><AlertTriangle size={17} /><span>Cần xác minh với chính sách hiện hành trước khi xuất bản.</span></div>}
          <dl><div><dt>Owner</dt><dd>{selectedResource.ownerRole || 'admin'}</dd></div><div><dt>Đối tượng</dt><dd>{selectedResource.audiences.join(', ') || 'Chưa gán'}</dd></div><div><dt>Cập nhật</dt><dd>{formatSopTimestamp(selectedResource.updatedAt)}</dd></div><div><dt>Nguồn</dt><dd>{selectedResource.sourceSystem}</dd></div></dl>
          <div className="sop-center-tag-list">{selectedResource.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <div className="sop-center-governance-actions">
            {selectedResource.status === 'draft' && capabilities.canEdit && <button type="button" disabled={busy} onClick={() => void changeStatus('review')}><Send size={16} /> Gửi duyệt</button>}
            {selectedResource.status === 'review' && capabilities.canReview && <><button type="button" className="is-primary" disabled={busy} onClick={() => void changeStatus('approved')}><Check size={16} /> Phê duyệt</button><button type="button" disabled={busy} onClick={() => void changeStatus('draft')}><X size={16} /> Yêu cầu sửa</button></>}
            {selectedResource.status === 'approved' && capabilities.canPublish && <button type="button" className="is-primary" disabled={busy} onClick={() => void changeStatus('live')}><Sparkles size={16} /> Xuất bản</button>}
            {selectedResource.status === 'live' && capabilities.canEdit && <button type="button" disabled={busy} onClick={() => { setCreating(false); setEditorOpen(true) }}><PencilLine size={16} /> Tạo bản nháp mới</button>}
          </div>
        </aside>
      </div>}
    </section>
  }

  if (loading) return <div className="sop-center-page"><LoadingState /></div>

  return <div className="sop-center-page">
    <header className="sop-center-page-header">
      <div><span className="sop-center-eyebrow">Aura Operations Standard</span><h1>Trung tâm SOP</h1><p>Tìm kiếm, biên tập và phát hành tri thức vận hành có kiểm soát.</p></div>
      <div className="sop-center-header-actions">
        <label className="sop-center-search"><Search size={18} aria-hidden="true" /><input aria-label="Tìm trong Trung tâm SOP" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm SOP, kỹ năng, mẫu câu…" />{query && <button type="button" aria-label="Xóa từ khóa" onClick={() => setQuery('')}><X size={15} /></button>}</label>
        {capabilities.canEdit && <button type="button" className="sop-center-button sop-center-button--primary" onClick={() => { setCreating(true); setEditorOpen(true) }}><FilePlus2 size={17} /> Tạo tài liệu</button>}
      </div>
    </header>

    <nav className="sop-center-nav" aria-label="Khu vực Trung tâm SOP">{sections.map((item) => { const Icon = item.icon; const count = item.id === 'approvals' ? counts.review : item.id === 'sops' ? counts.sops : item.id === 'skills' ? counts.skills : item.id === 'scripts' ? counts.scripts : item.id === 'policies' ? counts.policies : null; return <button type="button" key={item.id} className={routeState.section === item.id ? 'is-active' : ''} onClick={() => navigateFeature(item.id)}><Icon size={16} /><span>{item.label}</span>{count !== null && <small>{count}</small>}</button> })}</nav>

    {error && <div className="sop-center-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setError('')}><X size={16} /></button></div>}
    {toast && <div className="sop-center-toast" role="status"><Check size={17} />{toast}</div>}

    <div className="sop-center-page-body">
      {query.trim() && !routeState.resourceId ? <section className="sop-center-library"><header><div><span>Kết quả tìm kiếm</span><h2>“{query.trim()}”</h2><p>{searchResults.length} tài liệu được tìm thấy trong toàn bộ kho.</p></div></header>{searchResults.length ? <div className="sop-center-resource-list">{searchResults.map((item) => <ResourceRow key={item.id} resource={item} onOpen={() => navigateFeature(resourceSection(item), item.id)} />)}</div> : <EmptyState title="Chưa tìm thấy kết quả" body="Kiểm tra chính tả hoặc thử một từ khóa ngắn hơn." />}</section>
        : routeState.resourceId ? renderDetail()
          : routeState.section === 'overview' ? renderOverview()
            : routeState.section === 'training' ? renderTraining()
              : renderList()}
    </div>

    {editorOpen && <ResourceEditor resource={creating ? null : selectedResource} activeStep={activeStep} busy={busy} onCancel={() => { if (!busy) { setEditorOpen(false); setCreating(false) } }} onSave={saveDraft} />}
  </div>
}
