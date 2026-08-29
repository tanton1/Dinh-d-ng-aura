import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Dumbbell, Flame, Image, Library, Plus, RefreshCw, Save, Search, Send, Sparkles } from 'lucide-react'
import type { ExerciseCatalogItem } from '../../types'
import {
  getExerciseCatalogItem,
  listExerciseCatalog,
  publishExerciseCatalogItem,
  saveExerciseCatalogDraft,
  type ExerciseCatalogDraft,
} from '../../services/exerciseCatalogService'
import './ExerciseCatalogManager.css'

type CatalogStatusFilter = 'all' | ExerciseCatalogItem['status'] | 'working' | 'popular'

const statusLabels: Record<CatalogStatusFilter, string> = {
  all: 'Tất cả', popular: 'Nữ hay chọn', draft: 'Nháp', review: 'Chờ duyệt', published: 'Đã xuất bản', archived: 'Lưu trữ', working: 'Đang chỉnh sửa',
}

// Curated starting set while Aura collects enough program and workout-log
// usage for a statistically meaningful server-side ranking.
const popularForWomenIds = new Set([
  'aura_women_barbell_hip_thrust', 'aura_women_cable_glute_kickback', 'aura_women_goblet_squat',
  'aura_women_romanian_deadlift', 'aura_women_dumbbell_split_squat', 'aura_women_step_up_knee_raise',
  'aura_women_leg_press', 'aura_women_lying_leg_curl', 'aura_women_wide_grip_lat_pulldown',
  'aura_women_seated_cable_row', 'aura_women_dead_bug', 'aura_women_plank',
])

function emptyDraft(): ExerciseCatalogDraft {
  return {
    status: 'draft', nameVi: '', nameEn: '', aliasesVi: [], bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipment: [],
    environment: ['gym'], difficulty: 'beginner', goals: [], instructionsVi: [], cuesVi: [], commonMistakesVi: [], breathingVi: '',
    media: { startImageUrl: '', endImageUrl: '', posterUrl: '', animationUrl: '', mimeType: 'image/jpeg', checksum: '' },
    defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 60, rpe: 7 },
    source: { provider: 'aura', sourceExerciseId: '', sourceVersion: 'aura-v1', license: 'Aura-owned' },
    sourceAttribution: 'Aura Fitness',
  }
}

function draftFromItem(item: ExerciseCatalogItem): ExerciseCatalogDraft {
  return {
    status: item.status === 'review' ? 'review' : 'draft', nameVi: item.nameVi, nameEn: item.nameEn || '', aliasesVi: [...item.aliasesVi],
    bodyParts: [...item.bodyParts], targetMuscles: [...item.targetMuscles], secondaryMuscles: [...item.secondaryMuscles], equipment: [...item.equipment],
    environment: [...item.environment], difficulty: item.difficulty, goals: [...item.goals], instructionsVi: [...item.instructionsVi], cuesVi: [...item.cuesVi],
    commonMistakesVi: [...item.commonMistakesVi], breathingVi: item.breathingVi || '', media: { ...item.media },
    defaultPrescription: { ...item.defaultPrescription }, source: { ...item.source }, sourceAttribution: item.sourceAttribution || 'Aura Fitness',
  }
}

function listValue(values: string[]) { return values.join(', ') }
function parseList(value: string) { return value.split(',').map((item) => item.trim()).filter(Boolean) }
function linesValue(values: string[]) { return values.join('\n') }
function parseLines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
function newExerciseId() { return `aura_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}` }

function demoCatalog(): ExerciseCatalogItem[] {
  return [{
    id: 'aura_demo_squat', schemaVersion: 1, revision: 2, status: 'published', nameVi: 'Goblet Squat', nameEn: 'Goblet Squat', aliasesVi: ['Squat tạ trước'],
    bodyParts: ['Chân'], targetMuscles: ['Đùi trước', 'Mông'], secondaryMuscles: ['Core'], equipment: ['Tạ đơn'], environment: ['gym'], difficulty: 'beginner', goals: ['Tăng sức mạnh'],
    instructionsVi: ['Giữ tạ trước ngực.', 'Hạ hông có kiểm soát.', 'Đẩy chân đứng lên và siết mông.'], cuesVi: ['Giữ ngực mở', 'Gối theo hướng mũi chân'],
    commonMistakesVi: ['Khép gối vào trong'], breathingVi: 'Hít khi hạ, thở khi đứng lên.', media: {},
    defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 60, rpe: 7 },
    source: { provider: 'aura', sourceExerciseId: 'aura_demo_squat', sourceVersion: 'aura-v1', license: 'Aura-owned' }, sourceAttribution: 'Aura Fitness',
  }]
}

export default function ExerciseCatalogManager({ canPublish, isDemo = false }: { canPublish: boolean; isDemo?: boolean }) {
  const [items, setItems] = useState<ExerciseCatalogItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [publishedItem, setPublishedItem] = useState<ExerciseCatalogItem | null>(null)
  const [draft, setDraft] = useState<ExerciseCatalogDraft>(emptyDraft)
  const [editRevision, setEditRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)

  const loadItems = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(isDemo ? demoCatalog() : await listExerciseCatalog({ includeReview: true })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải thư viện bài tập.') }
    finally { setLoading(false) }
  }, [isDemo])

  useEffect(() => { void loadItems() }, [loadItems])

  const selectItem = async (item: ExerciseCatalogItem) => {
    setError(''); setNotice('')
    try {
      const detail = isDemo ? { item, editItem: item } : await getExerciseCatalogItem(item.id)
      setSelectedId(item.id); setPublishedItem(detail.item); setDraft(draftFromItem(detail.editItem)); setEditRevision(detail.editItem.revision); setDirty(false)
      requestAnimationFrame(() => { if (window.matchMedia('(max-width: 760px)').matches) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể mở bài tập.') }
  }

  const closeMobileDetail = () => {
    setSelectedId(''); setPublishedItem(null); setDraft(emptyDraft()); setEditRevision(0); setDirty(false); setError(''); setNotice('')
  }

  const createNew = () => {
    const id = newExerciseId(); const next = emptyDraft(); next.source.sourceExerciseId = id
    setSelectedId(id); setPublishedItem(null); setDraft(next); setEditRevision(0); setDirty(true); setError(''); setNotice('')
  }

  const updateDraft = (patch: Partial<ExerciseCatalogDraft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true) }

  const persist = async (nextStatus: 'draft' | 'review' = draft.status) => {
    if (!selectedId || !draft.nameVi.trim() || !draft.nameEn?.trim()) throw new Error('Cần nhập tên tiếng Việt và tiếng Anh.')
    const payload = { ...draft, status: nextStatus }
    if (isDemo) {
      const revision = editRevision + 1
      const item = { ...payload, id: selectedId, schemaVersion: 1 as const, revision, status: nextStatus }
      setItems((current) => [...current.filter((entry) => entry.id !== selectedId), item]); setDraft(payload); setEditRevision(revision); setDirty(false)
      return revision
    }
    const result = await saveExerciseCatalogDraft({ exerciseId: selectedId, expectedRevision: editRevision, draft: payload })
    setDraft(payload); setEditRevision(result.revision); setDirty(false)
    await loadItems()
    return result.revision
  }

  const save = async (nextStatus: 'draft' | 'review' = draft.status) => {
    setSaving(true); setError(''); setNotice('')
    try { await persist(nextStatus); setNotice(nextStatus === 'review' ? 'Đã gửi bài tập sang hàng chờ duyệt.' : 'Đã lưu bản nháp bài tập.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu bài tập.') }
    finally { setSaving(false) }
  }

  const publish = async () => {
    if (!canPublish || !selectedId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const revision = dirty ? await persist(draft.status) : editRevision
      if (isDemo) {
        setItems((current) => current.map((item) => item.id === selectedId ? { ...item, ...draft, status: 'published', revision: revision + 1 } : item))
      } else {
        await publishExerciseCatalogItem(selectedId, revision)
        await loadItems()
        const detail = await getExerciseCatalogItem(selectedId)
        setPublishedItem(detail.item); setDraft(draftFromItem(detail.editItem)); setEditRevision(detail.editItem.revision)
      }
      setDirty(false); setNotice('Đã xuất bản bài tập. Staff có thể sử dụng ngay trong giáo án.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xuất bản bài tập.') }
    finally { setSaving(false) }
  }

  const filteredItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('vi')
    return items.filter((item) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'popular' ? popularForWomenIds.has(item.id) : statusFilter === 'working' ? item.hasWorkingDraft : item.status === statusFilter)
      const matchesQuery = !term || [item.nameVi, item.nameEn, ...item.targetMuscles, ...item.bodyParts, ...item.equipment].join(' ').toLocaleLowerCase('vi').includes(term)
      return matchesStatus && matchesQuery
    })
  }, [items, query, statusFilter])

  const counts = useMemo(() => ({ published: items.filter((item) => item.status === 'published').length, review: items.filter((item) => item.status === 'review').length, working: items.filter((item) => item.hasWorkingDraft).length }), [items])
  const missingPublishData = !draft.instructionsVi.length || !draft.media.startImageUrl

  return <section className={`exercise-catalog-manager ${selectedId ? 'has-mobile-detail' : ''}`} aria-label="Quản lý thư viện bài tập">
    <header className="exercise-catalog-manager__heading">
      <div><span>THƯ VIỆN DÙNG CHUNG</span><h2>Kho bài tập Aura</h2><p>Một nguồn bài tập thống nhất cho giáo án của tất cả học viên.</p></div>
      <button className="exercise-catalog-manager__new" onClick={createNew}><Plus />Thêm bài tập</button>
    </header>

    <div className="exercise-catalog-manager__metrics">
      <article><Library /><span><small>Tổng bài</small><strong>{items.length}</strong></span></article>
      <article><Check /><span><small>Đã xuất bản</small><strong>{counts.published}</strong></span></article>
      <article><Send /><span><small>Chờ duyệt</small><strong>{counts.review}</strong></span></article>
      <article><Sparkles /><span><small>Đang chỉnh sửa</small><strong>{counts.working}</strong></span></article>
    </div>

    {(error || notice) && <div className={`exercise-catalog-manager__message ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <div className="exercise-catalog-manager__layout">
      <aside className="exercise-catalog-manager__browser">
        <div className="exercise-catalog-manager__tools">
          <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên bài, nhóm cơ, dụng cụ…" aria-label="Tìm trong thư viện bài tập" /></label>
          <button onClick={() => void loadItems()} disabled={loading} aria-label="Tải lại thư viện"><RefreshCw /></button>
        </div>
        <div className="exercise-catalog-manager__filters">{(['all', 'popular', 'published', 'review', 'draft', 'working'] as CatalogStatusFilter[]).map((status) => <button className={`${statusFilter === status ? 'is-active' : ''} ${status === 'popular' ? 'is-popular' : ''}`} onClick={() => setStatusFilter(status)} key={status}>{status === 'popular' && <Flame />}{statusLabels[status]}</button>)}</div>
        <div className="exercise-catalog-manager__list">
          {filteredItems.map((item) => <button className={`${selectedId === item.id ? 'is-active' : ''} ${popularForWomenIds.has(item.id) ? 'is-popular' : ''}`} onClick={() => void selectItem(item)} key={item.id}>
            <span className="exercise-catalog-manager__thumb">{item.media.posterUrl || item.media.startImageUrl ? <img src={item.media.posterUrl || item.media.startImageUrl} alt="" /> : <Dumbbell />}</span>
            <span><b>{item.nameVi}</b><small>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ') || 'Chưa phân nhóm'}</small><span className="exercise-catalog-manager__badges">{popularForWomenIds.has(item.id) && <em className="is-popular"><Flame />Nữ hay chọn</em>}<em className={`is-${item.hasWorkingDraft ? 'working' : item.status}`}>{item.hasWorkingDraft ? 'Đang sửa' : statusLabels[item.status]}</em></span></span>
            {(!item.instructionsVi.length || !item.media.startImageUrl) ? <AlertTriangle aria-label="Thiếu dữ liệu xuất bản" /> : <ChevronRight aria-label="Xem chi tiết" />}
          </button>)}
          {!loading && !filteredItems.length && <div className="exercise-catalog-manager__empty"><Library /><strong>Không có bài tập phù hợp</strong><span>Đổi bộ lọc hoặc thêm một bài mới.</span></div>}
        </div>
      </aside>

      <div className="exercise-catalog-manager__editor" ref={editorRef}>
        {!selectedId ? <div className="exercise-catalog-manager__empty is-large"><Dumbbell /><strong>Chọn hoặc thêm bài tập</strong><span>Biên tập ngay trên trang, không mở popup.</span></div> : <>
          <button className="exercise-catalog-manager__mobile-back" onClick={closeMobileDetail}><ArrowLeft />Danh sách bài tập</button>
          <header><div><span>{publishedItem?.status === 'published' ? 'CHI TIẾT BÀI TẬP' : 'HỒ SƠ BÀI TẬP'}</span><h3>{draft.nameVi || 'Bài tập mới'}</h3><p>{popularForWomenIds.has(selectedId) ? 'Nữ hay chọn · ' : ''}{publishedItem?.status === 'published' ? 'Xem kỹ thuật, nhóm cơ và giáo án đề xuất.' : `Revision ${editRevision}`}</p></div>{popularForWomenIds.has(selectedId) ? <em className="is-popular"><Flame />Nữ hay chọn</em> : <em>{draft.status === 'review' ? 'Chờ duyệt' : 'Nháp'}</em>}</header>

          <div className="exercise-catalog-manager__form-grid">
            <label>Tên tiếng Việt<input value={draft.nameVi} onChange={(event) => updateDraft({ nameVi: event.target.value })} /></label>
            <label>Tên tiếng Anh<input value={draft.nameEn || ''} onChange={(event) => updateDraft({ nameEn: event.target.value })} /></label>
            <label>Nhóm cơ chính<input value={listValue(draft.targetMuscles)} onChange={(event) => updateDraft({ targetMuscles: parseList(event.target.value) })} placeholder="Mông, Đùi sau" /></label>
            <label>Nhóm cơ phụ<input value={listValue(draft.secondaryMuscles)} onChange={(event) => updateDraft({ secondaryMuscles: parseList(event.target.value) })} /></label>
            <label>Vùng cơ thể<input value={listValue(draft.bodyParts)} onChange={(event) => updateDraft({ bodyParts: parseList(event.target.value) })} placeholder="Chân, Thân dưới" /></label>
            <label>Dụng cụ<input value={listValue(draft.equipment)} onChange={(event) => updateDraft({ equipment: parseList(event.target.value) })} placeholder="Tạ đơn, Ghế" /></label>
            <label>Độ khó<select value={draft.difficulty} onChange={(event) => updateDraft({ difficulty: event.target.value as ExerciseCatalogDraft['difficulty'] })}><option value="beginner">Cơ bản</option><option value="intermediate">Trung bình</option><option value="advanced">Nâng cao</option></select></label>
            <label>Mục tiêu<input value={listValue(draft.goals)} onChange={(event) => updateDraft({ goals: parseList(event.target.value) })} placeholder="Tăng cơ, Sức mạnh" /></label>
          </div>

          <div className="exercise-catalog-manager__prescription">
            <label>Hiệp<input type="number" min="1" max="10" value={draft.defaultPrescription.sets} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, sets: Number(event.target.value) } })} /></label>
            <label>Reps<input value={draft.defaultPrescription.reps} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, reps: event.target.value } })} /></label>
            <label>Nghỉ (giây)<input type="number" min="0" max="600" value={draft.defaultPrescription.restSeconds} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, restSeconds: Number(event.target.value) } })} /></label>
            <label>RPE<input type="number" min="1" max="10" value={draft.defaultPrescription.rpe} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, rpe: Number(event.target.value) } })} /></label>
          </div>

          <div className="exercise-catalog-manager__textareas">
            <label>Hướng dẫn từng bước<textarea value={linesValue(draft.instructionsVi)} onChange={(event) => updateDraft({ instructionsVi: parseLines(event.target.value) })} placeholder={'Mỗi bước một dòng\nVí dụ: Giữ lưng trung lập…'} /></label>
            <label>Điểm nhắc kỹ thuật<textarea value={linesValue(draft.cuesVi)} onChange={(event) => updateDraft({ cuesVi: parseLines(event.target.value) })} placeholder="Mỗi lưu ý một dòng" /></label>
            <label>Lỗi thường gặp<textarea value={linesValue(draft.commonMistakesVi)} onChange={(event) => updateDraft({ commonMistakesVi: parseLines(event.target.value) })} /></label>
            <label>Nhịp thở<textarea value={draft.breathingVi || ''} onChange={(event) => updateDraft({ breathingVi: event.target.value })} /></label>
          </div>

          <div className="exercise-catalog-manager__media">
            <div>{draft.media.startImageUrl ? <img src={draft.media.startImageUrl} alt="Minh họa bài tập" /> : <Image />}</div>
            <span><label>Ảnh bắt đầu<input value={draft.media.startImageUrl || ''} onChange={(event) => updateDraft({ media: { ...draft.media, startImageUrl: event.target.value, posterUrl: draft.media.posterUrl || event.target.value } })} placeholder="https://…" /></label><label>Ảnh kết thúc<input value={draft.media.endImageUrl || ''} onChange={(event) => updateDraft({ media: { ...draft.media, endImageUrl: event.target.value } })} placeholder="https://…" /></label><label>Video / animation<input value={draft.media.animationUrl || ''} onChange={(event) => updateDraft({ media: { ...draft.media, animationUrl: event.target.value } })} placeholder="https://…" /></label></span>
          </div>

          {missingPublishData && <div className="exercise-catalog-manager__warning"><AlertTriangle /><span><b>Chưa thể xuất bản</b><small>Cần ít nhất một bước hướng dẫn và ảnh bắt đầu.</small></span></div>}
          <footer><button onClick={() => void save('draft')} disabled={saving}><Save />Lưu nháp</button><button onClick={() => void save('review')} disabled={saving}><Send />Gửi duyệt</button>{canPublish && <button className="is-primary" onClick={() => void publish()} disabled={saving || missingPublishData}><Check />Xuất bản</button>}</footer>
        </>}
      </div>
    </div>
  </section>
}
