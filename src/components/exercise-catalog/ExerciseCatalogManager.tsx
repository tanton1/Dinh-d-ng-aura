import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight,
  CircleCheck, Cloud, Dumbbell, Eye, Flame, Image, Images, Library, Link2, Plus, RefreshCw, Save, Search,
  Send, Sparkles, Trash2, Unlink, Upload, Video, X,
} from 'lucide-react'
import type { ExerciseCatalogItem, ExerciseCatalogMedia, ExerciseCatalogMediaImage } from '../../types'
import {
  getExerciseCatalogItem,
  getExternalExercisePreview,
  listExerciseCatalog,
  publishExerciseCatalogItem,
  saveExerciseCatalogDraft,
  searchExternalExerciseCatalog,
  type ExternalExerciseCandidate,
  type ExternalExerciseProvider,
  type ExerciseCatalogResolvedMedia,
  type ExerciseCatalogDraft,
} from '../../services/exerciseCatalogService'
import { uploadExerciseCatalogImage } from '../../services/exerciseCatalogMediaService'
import { exerciseMatchesMuscleGroup, exerciseMuscleGroupOptions, type ExerciseMuscleGroupId } from '../../utils/exerciseMuscleGroups'
import ExerciseMediaPlayer from './ExerciseMediaPlayer'
import './ExerciseCatalogManager.css'

type CatalogStatusFilter = 'all' | ExerciseCatalogItem['status'] | 'working' | 'popular'
type MediaRole = ExerciseCatalogMediaImage['role']

const statusLabels: Record<CatalogStatusFilter, string> = {
  all: 'Tất cả', popular: 'Nữ hay chọn', draft: 'Nháp', review: 'Chờ duyệt', published: 'Đã xuất bản', archived: 'Lưu trữ', working: 'Đang chỉnh sửa',
}

const wizardSteps = [
  { label: 'Thông tin', note: 'Tên và phân loại' },
  { label: 'Kỹ thuật', note: 'Hướng dẫn thực hiện' },
  { label: 'Giáo án', note: 'Thông số đề xuất' },
  { label: 'Hình ảnh', note: 'Ảnh và video' },
  { label: 'Xem lại', note: 'Kiểm tra và xuất bản' },
] as const

const popularForWomenIds = new Set([
  'aura_women_barbell_hip_thrust', 'aura_women_cable_glute_kickback', 'aura_women_goblet_squat',
  'aura_women_romanian_deadlift', 'aura_women_dumbbell_split_squat', 'aura_women_step_up_knee_raise',
  'aura_women_leg_press', 'aura_women_lying_leg_curl', 'aura_women_wide_grip_lat_pulldown',
  'aura_women_seated_cable_row', 'aura_women_dead_bug', 'aura_women_plank',
])

// The curated ExerciseDB import is explicitly selected for the women’s library.
// Keep the legacy Aura IDs above so the filter remains useful during rollout.
function isPopularForWomen(item: ExerciseCatalogItem | string) {
  const id = typeof item === 'string' ? item : item.id
  return popularForWomenIds.has(id) || id.startsWith('edb_women_') || (typeof item !== 'string' && item.popularForWomen === true)
}

const externalProviderMeta: Record<ExternalExerciseProvider, { label: string; note: string; source: string }> = {
  exercisedb: { label: 'ExerciseDB Free', note: '1.500 ảnh động · không cần API key', source: 'GIF: ExerciseDB Free' },
  ymove_free: { label: 'YMove miễn phí', note: '25 video HD · dùng thương mại', source: 'Video: YMove Free Library' },
  ymove: { label: 'YMove API', note: 'Kho nâng cao · cần API key', source: 'Video: YMove API' },
}

function emptyDraft(): ExerciseCatalogDraft {
  return {
    status: 'draft', nameVi: '', nameEn: '', aliasesVi: [], bodyParts: [], targetMuscles: [], secondaryMuscles: [], equipment: [],
    environment: ['gym'], difficulty: 'beginner', goals: [], instructionsVi: [], cuesVi: [], commonMistakesVi: [], breathingVi: '',
    media: { startImageUrl: '', endImageUrl: '', posterUrl: '', posterImageId: '', images: [], videos: [], animationUrl: '', mimeType: 'image/webp', checksum: '' },
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
    commonMistakesVi: [...item.commonMistakesVi], breathingVi: item.breathingVi || '',
    media: { ...item.media, images: item.media.images?.map((image) => ({ ...image })) || [], videos: item.media.videos?.map((video) => ({ ...video })) || [] },
    externalMedia: item.externalMedia ? { ...item.externalMedia } : undefined,
    defaultPrescription: { ...item.defaultPrescription }, source: { ...item.source }, sourceAttribution: item.sourceAttribution || 'Aura Fitness',
  }
}

function newExerciseId() { return `aura_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}` }

function mediaImages(media: ExerciseCatalogMedia): ExerciseCatalogMediaImage[] {
  if (media.images?.length) return [...media.images].sort((left, right) => left.order - right.order)
  const legacy: ExerciseCatalogMediaImage[] = []
  if (media.startImageUrl) legacy.push({ id: 'legacy-start', url: media.startImageUrl, role: 'start', order: 0, alt: 'Tư thế bắt đầu' })
  if (media.endImageUrl && media.endImageUrl !== media.startImageUrl) legacy.push({ id: 'legacy-end', url: media.endImageUrl, role: 'end', order: legacy.length, alt: 'Tư thế kết thúc' })
  return legacy
}

function syncMedia(media: ExerciseCatalogMedia, images: ExerciseCatalogMediaImage[], requestedPosterId?: string): ExerciseCatalogMedia {
  const ordered = images.map((image, order) => ({ ...image, order }))
  const start = ordered.find((image) => image.role === 'start') || ordered[0]
  const end = ordered.find((image) => image.role === 'end')
  const posterId = requestedPosterId || media.posterImageId || start?.id || ''
  const poster = ordered.find((image) => image.id === posterId) || start
  return {
    ...media, images: ordered, posterImageId: poster?.id || '', startImageUrl: start?.url || '', endImageUrl: end?.url || '',
    posterUrl: poster?.url || '', mimeType: start?.mimeType || media.mimeType || 'image/webp',
  }
}

function roleLabel(role: MediaRole) { return role === 'start' ? 'Bắt đầu' : role === 'end' ? 'Kết thúc' : 'Bổ sung' }

function TagEditor({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder?: string; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState('')
  const add = (raw: string) => {
    const additions = raw.split(',').map((item) => item.trim()).filter(Boolean)
    if (additions.length) onChange([...new Set([...values, ...additions])])
    setInput('')
  }
  return <label className="exercise-catalog-manager__tag-field"><span>{label}</span><div className="exercise-catalog-manager__tag-editor">
    {values.map((value) => <button type="button" key={value} onClick={() => onChange(values.filter((item) => item !== value))}>{value}<X /></button>)}
    <input value={input} placeholder={values.length ? 'Thêm…' : placeholder} onChange={(event) => {
      const value = event.target.value
      if (value.endsWith(',')) add(value)
      else setInput(value)
    }} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); add(input) }
      if (event.key === 'Backspace' && !input && values.length) onChange(values.slice(0, -1))
    }} onBlur={() => { if (input.trim()) add(input) }} />
  </div></label>
}

function OrderedLinesEditor({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder: string; onChange: (values: string[]) => void }) {
  const add = () => onChange([...values, ''])
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= values.length) return
    const next = [...values]; [next[index], next[target]] = [next[target], next[index]]; onChange(next)
  }
  return <section className="exercise-catalog-manager__ordered-field">
    <header><span>{label}</span><button type="button" onClick={add}><Plus />Thêm dòng</button></header>
    <div>{values.map((value, index) => <article key={`${label}-${index}`}>
      <b>{index + 1}</b><textarea value={value} placeholder={placeholder} onChange={(event) => { const next = [...values]; next[index] = event.target.value; onChange(next) }} />
      <span><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Đưa lên"><ArrowUp /></button><button type="button" disabled={index === values.length - 1} onClick={() => move(index, 1)} aria-label="Đưa xuống"><ArrowDown /></button><button type="button" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))} aria-label="Xóa"><Trash2 /></button></span>
    </article>)}</div>
    {!values.length && <button type="button" className="exercise-catalog-manager__ordered-empty" onClick={add}><Plus />{placeholder}</button>}
  </section>
}

function MediaCarousel({ images: entries, posterId, onSetPoster }: { images: ExerciseCatalogMediaImage[]; posterId?: string; onSetPoster: (id: string) => void }) {
  const [active, setActive] = useState(0)
  const dragStart = useRef<number | null>(null)
  useEffect(() => { if (active >= entries.length) setActive(Math.max(0, entries.length - 1)) }, [active, entries.length])
  useEffect(() => {
    if (entries.length < 2) return
    const preload = new window.Image(); preload.src = entries[(active + 1) % entries.length].url
  }, [active, entries])
  if (!entries.length) return <div className="exercise-catalog-manager__carousel-empty"><Images /><strong>Chưa có hình ảnh</strong><span>Tải ảnh từ máy hoặc thêm bằng URL.</span></div>
  const go = (next: number) => setActive((next + entries.length) % entries.length)
  return <div className="exercise-catalog-manager__carousel">
    <div className="exercise-catalog-manager__carousel-stage" onPointerDown={(event) => { dragStart.current = event.clientX }} onPointerUp={(event) => {
      if (dragStart.current === null) return
      const delta = event.clientX - dragStart.current; dragStart.current = null
      if (Math.abs(delta) > 40) go(active + (delta < 0 ? 1 : -1))
    }}>
      <div style={{ transform: `translate3d(-${active * 100}%,0,0)` }}>{entries.map((image) => <figure key={image.id}><img src={image.url} alt={image.alt || roleLabel(image.role)} loading="lazy" /><figcaption><span>{roleLabel(image.role)}</span>{image.id === posterId && <em><Check />Ảnh bìa</em>}</figcaption></figure>)}</div>
      {entries.length > 1 && <><button type="button" className="is-prev" onClick={() => go(active - 1)} aria-label="Ảnh trước"><ChevronLeft /></button><button type="button" className="is-next" onClick={() => go(active + 1)} aria-label="Ảnh sau"><ChevronRight /></button></>}
      <span className="exercise-catalog-manager__carousel-count">{active + 1}/{entries.length}</span>
    </div>
    <div className="exercise-catalog-manager__thumbnails">{entries.map((image, index) => <button type="button" className={index === active ? 'is-active' : ''} onClick={() => setActive(index)} key={image.id}><img src={image.url} alt="" /><span>{roleLabel(image.role)}</span></button>)}</div>
    <button type="button" className="exercise-catalog-manager__poster-action" disabled={entries[active]?.id === posterId} onClick={() => onSetPoster(entries[active].id)}><Image />{entries[active]?.id === posterId ? 'Đang là ảnh bìa' : 'Đặt làm ảnh bìa'}</button>
  </div>
}

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
  const [muscleFilter, setMuscleFilter] = useState<ExerciseMuscleGroupId>('all')
  const [activeStep, setActiveStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stepError, setStepError] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteRole, setRemoteRole] = useState<MediaRole>('detail')
  const [externalQuery, setExternalQuery] = useState('')
  const [externalProvider, setExternalProvider] = useState<ExternalExerciseProvider>('exercisedb')
  const [externalItems, setExternalItems] = useState<ExternalExerciseCandidate[]>([])
  const [externalPreview, setExternalPreview] = useState<ExternalExerciseCandidate | null>(null)
  const [externalConfigured, setExternalConfigured] = useState<boolean | null>(null)
  const [externalLoading, setExternalLoading] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const changeVersionRef = useRef(0)

  const loadItems = useCallback(async () => {
    setLoading(true); setError('')
    try { setItems(isDemo ? demoCatalog() : await listExerciseCatalog({ includeReview: true })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải thư viện bài tập.') }
    finally { setLoading(false) }
  }, [isDemo])

  useEffect(() => { void loadItems() }, [loadItems])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const selectItem = async (item: ExerciseCatalogItem) => {
    setError(''); setNotice(''); setStepError('')
    try {
      const detail = isDemo ? { item, editItem: item } : await getExerciseCatalogItem(item.id)
      setSelectedId(item.id); setPublishedItem(detail.item); setDraft(draftFromItem(detail.editItem)); setEditRevision(detail.editItem.revision)
      setDirty(false); setActiveStep(0); setLastSavedAt(null); setExternalPreview(null); setExternalItems([]); setExternalConfigured(null)
      setExternalProvider(detail.editItem.externalMedia?.provider || 'exercisedb'); changeVersionRef.current = 0
      requestAnimationFrame(() => { if (window.matchMedia('(max-width: 760px)').matches) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể mở bài tập.') }
  }

  const closeMobileDetail = () => {
    setSelectedId(''); setPublishedItem(null); setDraft(emptyDraft()); setEditRevision(0); setDirty(false); setError(''); setNotice(''); setActiveStep(0); setExternalPreview(null); setExternalItems([]); setExternalProvider('exercisedb')
  }

  const createNew = () => {
    const id = newExerciseId(); const next = emptyDraft(); next.source.sourceExerciseId = id
    setSelectedId(id); setPublishedItem(null); setDraft(next); setEditRevision(0); setDirty(true); setError(''); setNotice(''); setStepError(''); setActiveStep(0); setLastSavedAt(null); setExternalPreview(null); setExternalItems([]); setExternalProvider('exercisedb'); changeVersionRef.current = 1
  }

  const updateDraft = (patch: Partial<ExerciseCatalogDraft>) => {
    changeVersionRef.current += 1; setDraft((current) => ({ ...current, ...patch })); setDirty(true); setNotice(''); setStepError('')
  }

  const updateMedia = (mutator: (media: ExerciseCatalogMedia) => ExerciseCatalogMedia) => {
    changeVersionRef.current += 1; setDraft((current) => ({ ...current, media: mutator(current.media) })); setDirty(true); setNotice(''); setStepError('')
  }

  const persist = useCallback(async (nextStatus: 'draft' | 'review' = draft.status, refreshList = true) => {
    if (!selectedId || !draft.nameVi.trim() || !draft.nameEn?.trim()) throw new Error('Cần nhập tên tiếng Việt và tiếng Anh.')
    const savedVersion = changeVersionRef.current
    const payload = { ...draft, status: nextStatus, instructionsVi: draft.instructionsVi.map((value) => value.trim()).filter(Boolean), cuesVi: draft.cuesVi.map((value) => value.trim()).filter(Boolean), commonMistakesVi: draft.commonMistakesVi.map((value) => value.trim()).filter(Boolean) }
    if (isDemo) {
      const revision = editRevision + 1
      const item = { ...payload, id: selectedId, schemaVersion: 1 as const, revision, status: nextStatus }
      setItems((current) => [...current.filter((entry) => entry.id !== selectedId), item]); setDraft(payload); setEditRevision(revision)
      if (changeVersionRef.current === savedVersion) setDirty(false)
      setLastSavedAt(new Date()); return revision
    }
    const result = await saveExerciseCatalogDraft({ exerciseId: selectedId, expectedRevision: editRevision, draft: payload })
    setDraft(payload); setEditRevision(result.revision)
    if (changeVersionRef.current === savedVersion) setDirty(false)
    setLastSavedAt(new Date())
    if (refreshList) await loadItems()
    return result.revision
  }, [draft, editRevision, isDemo, loadItems, selectedId])

  useEffect(() => {
    if (!dirty || saving || autoSaving || uploading || !selectedId || !draft.nameVi.trim() || !draft.nameEn?.trim()) return
    const timer = window.setTimeout(() => {
      setAutoSaving(true)
      void persist(draft.status, false).catch(() => {}).finally(() => setAutoSaving(false))
    }, 1_800)
    return () => window.clearTimeout(timer)
  }, [autoSaving, dirty, draft.nameEn, draft.nameVi, draft.status, persist, saving, selectedId, uploading])

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
      const revision = dirty ? await persist(draft.status, false) : editRevision
      if (isDemo) setItems((current) => current.map((item) => item.id === selectedId ? { ...item, ...draft, status: 'published', revision: revision + 1 } : item))
      else {
        await publishExerciseCatalogItem(selectedId, revision); await loadItems()
        const detail = await getExerciseCatalogItem(selectedId); setPublishedItem(detail.item); setDraft(draftFromItem(detail.editItem)); setEditRevision(detail.editItem.revision)
      }
      setDirty(false); setNotice('Đã xuất bản bài tập. Staff có thể sử dụng ngay trong giáo án.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xuất bản bài tập.') }
    finally { setSaving(false) }
  }

  const handleFiles = async (files: FileList | File[]) => {
    if (!selectedId || uploading) return
    const selected = Array.from(files)
    if (!selected.length) { setError('Không có ảnh hợp lệ để tải lên.'); return }
    setUploading(true); setUploadProgress(0); setError('')
    let working = mediaImages(draft.media)
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const role: MediaRole = working.some((image) => image.role === 'start') ? (working.some((image) => image.role === 'end') ? 'detail' : 'end') : 'start'
        const uploaded = await uploadExerciseCatalogImage(selected[index], selectedId, role, working.length, (percent) => setUploadProgress(Math.round(((index + percent / 100) / selected.length) * 100)))
        working = [...working, uploaded]
        updateMedia((current) => syncMedia(current, working))
      }
      setNotice(`Đã tải ${selected.length} ảnh. Bản nháp sẽ tự động lưu.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải ảnh lên.') }
    finally { setUploading(false); setUploadProgress(0); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const addRemoteImage = () => {
    const url = remoteUrl.trim()
    if (!/^https:\/\//i.test(url)) { setStepError('Đường dẫn ảnh phải bắt đầu bằng https://'); return }
    const current = mediaImages(draft.media)
    const image: ExerciseCatalogMediaImage = { id: `remote-${crypto.randomUUID()}`, url, role: remoteRole, order: current.length, alt: '', mimeType: 'image/jpeg' }
    const next = remoteRole === 'start' || remoteRole === 'end' ? current.map((entry) => entry.role === remoteRole ? { ...entry, role: 'detail' as const } : entry) : current
    updateMedia((media) => syncMedia(media, [...next, image])); setRemoteUrl(''); setRemoteRole('detail')
  }

  const searchExternal = async () => {
    setExternalLoading(true); setStepError('')
    try {
      const result = await searchExternalExerciseCatalog({ provider: externalProvider, search: externalQuery.trim(), pageSize: 12 })
      setExternalConfigured(result.providerConfigured); setExternalItems(result.items)
      if (result.providerConfigured && !result.items.length) setStepError('Không tìm thấy bài tập phù hợp ở nguồn video.')
    } catch (cause) { setStepError(cause instanceof Error ? cause.message : 'Không thể tìm nguồn video.') }
    finally { setExternalLoading(false) }
  }

  const previewExternal = async (candidate: ExternalExerciseCandidate) => {
    setExternalLoading(true); setStepError('')
    try {
      const result = await getExternalExercisePreview(candidate.id, candidate.provider)
      setExternalConfigured(result.providerConfigured); setExternalPreview(result.item || candidate)
    } catch (cause) { setStepError(cause instanceof Error ? cause.message : 'Không thể xem trước bài tập.') }
    finally { setExternalLoading(false) }
  }

  const linkExternal = (candidate: ExternalExerciseCandidate) => {
    updateDraft({
      externalMedia: {
        provider: candidate.provider,
        exerciseId: candidate.id,
        ...(candidate.slug ? { slug: candidate.slug } : {}),
        ...(candidate.provider === 'ymove' ? { preferredVideoTag: 'white-background' as const, preferredOrientation: 'portrait' as const } : {}),
        syncedAt: new Date().toISOString(),
      },
      // Metadata is only used to fill blanks. PT-reviewed Vietnamese content is never overwritten.
      nameEn: draft.nameEn?.trim() ? draft.nameEn : candidate.title,
      targetMuscles: draft.targetMuscles.length ? draft.targetMuscles : candidate.muscleGroup ? [candidate.muscleGroup] : [],
      secondaryMuscles: draft.secondaryMuscles.length ? draft.secondaryMuscles : candidate.secondaryMuscles,
      equipment: draft.equipment.length ? draft.equipment : candidate.equipment,
      sourceAttribution: `Nội dung: Aura Fitness · ${externalProviderMeta[candidate.provider].source}`,
    })
    setExternalPreview(candidate)
    setExternalProvider(candidate.provider)
    setNotice(candidate.provider === 'ymove' ? 'Đã liên kết YMove API. Nội dung tiếng Việt của Aura được giữ nguyên; URL video tạm không được lưu.' : 'Đã liên kết nguồn media miễn phí. Nội dung tiếng Việt của Aura được giữ nguyên và nguồn sử dụng đã được ghi nhận.')
  }

  const externalResolvedMedia = useMemo<ExerciseCatalogResolvedMedia | null>(() => externalPreview ? {
    provider: externalPreview.provider,
    providerConfigured: true,
    externalLinked: true,
    transientMedia: externalPreview.provider === 'ymove',
    images: [],
    videos: externalPreview.videos,
  } : null, [externalPreview])

  const filteredItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('vi')
    return items.filter((item) => {
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'popular' ? isPopularForWomen(item) : statusFilter === 'working' ? item.hasWorkingDraft : item.status === statusFilter)
      const matchesQuery = !term || [item.nameVi, item.nameEn, ...item.targetMuscles, ...item.bodyParts, ...item.equipment].join(' ').toLocaleLowerCase('vi').includes(term)
      return matchesStatus && matchesQuery && exerciseMatchesMuscleGroup(item, muscleFilter)
    })
  }, [items, muscleFilter, query, statusFilter])

  const counts = useMemo(() => ({ published: items.filter((item) => item.status === 'published').length, review: items.filter((item) => item.status === 'review').length, working: items.filter((item) => item.hasWorkingDraft).length }), [items])
  const muscleGroups = useMemo(() => exerciseMuscleGroupOptions(items), [items])
  const imagesForDraft = useMemo(() => mediaImages(draft.media), [draft.media])
  const stepComplete = (step: number): boolean => step === 0
    ? Boolean(draft.nameVi.trim() && draft.nameEn?.trim() && draft.targetMuscles.length)
    : step === 1 ? draft.instructionsVi.some((value) => value.trim())
      : step === 2 ? draft.defaultPrescription.sets > 0 && Boolean(draft.defaultPrescription.reps) && draft.defaultPrescription.rpe > 0
        : step === 3 ? Boolean(draft.media.startImageUrl || imagesForDraft.length) : [0, 1, 2, 3].every((item) => stepComplete(item))
  const missingPublishData = !draft.nameVi.trim() || !draft.nameEn?.trim() || !draft.instructionsVi.some((value) => value.trim()) || !(draft.media.startImageUrl || imagesForDraft.length)
  const nextStep = () => {
    if (!stepComplete(activeStep)) { setStepError(activeStep === 0 ? 'Nhập đủ tên tiếng Việt, tiếng Anh và ít nhất một nhóm cơ chính.' : activeStep === 1 ? 'Thêm ít nhất một bước hướng dẫn kỹ thuật.' : activeStep === 3 ? 'Tải ít nhất một ảnh minh họa.' : 'Kiểm tra lại thông tin ở bước này.'); return }
    setStepError(''); setActiveStep((current) => Math.min(4, current + 1)); editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <section className={`exercise-catalog-manager ${selectedId ? 'has-mobile-detail' : ''}`} aria-label="Quản lý thư viện bài tập">
    <header className="exercise-catalog-manager__heading"><div><span>THƯ VIỆN DÙNG CHUNG</span><h2>Kho bài tập Aura</h2><p>Tạo hồ sơ bài tập theo từng bước, đồng bộ cho mọi giáo án.</p></div><button className="exercise-catalog-manager__new" onClick={createNew}><Plus />Thêm bài tập</button></header>
    <div className="exercise-catalog-manager__metrics"><article><Library /><span><small>Tổng bài</small><strong>{items.length}</strong></span></article><article><Check /><span><small>Đã xuất bản</small><strong>{counts.published}</strong></span></article><article><Send /><span><small>Chờ duyệt</small><strong>{counts.review}</strong></span></article><article><Sparkles /><span><small>Đang chỉnh sửa</small><strong>{counts.working}</strong></span></article></div>
    {(error || notice) && <div className={`exercise-catalog-manager__message ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    <div className="exercise-catalog-manager__layout">
      <aside className="exercise-catalog-manager__browser"><div className="exercise-catalog-manager__tools"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên bài, nhóm cơ, dụng cụ…" aria-label="Tìm trong thư viện bài tập" /></label><button onClick={() => void loadItems()} disabled={loading} aria-label="Tải lại thư viện"><RefreshCw /></button></div><div className="exercise-catalog-manager__filters">{(['all', 'popular', 'published', 'review', 'draft', 'working'] as CatalogStatusFilter[]).map((status) => <button className={`${statusFilter === status ? 'is-active' : ''} ${status === 'popular' ? 'is-popular' : ''}`} onClick={() => setStatusFilter(status)} key={status}>{status === 'popular' && <Flame />}{statusLabels[status]}</button>)}</div><div className="exercise-catalog-manager__muscle-filters" role="group" aria-label="Lọc thư viện theo nhóm cơ">{muscleGroups.map((group) => <button className={muscleFilter === group.id ? 'is-active' : ''} onClick={() => setMuscleFilter(group.id)} key={group.id}>{group.label}<small>{group.count}</small></button>)}</div><div className="exercise-catalog-manager__list">
        {filteredItems.map((item) => <button className={`${selectedId === item.id ? 'is-active' : ''} ${isPopularForWomen(item) ? 'is-popular' : ''}`} onClick={() => void selectItem(item)} key={item.id}><span className="exercise-catalog-manager__thumb">{item.media.posterUrl || item.media.startImageUrl ? <img src={item.media.posterUrl || item.media.startImageUrl} alt="" loading="lazy" /> : <Dumbbell />}</span><span><b>{item.nameVi}</b><small>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ') || 'Chưa phân nhóm'}</small><span className="exercise-catalog-manager__badges">{isPopularForWomen(item) && <em className="is-popular"><Flame />Nữ hay chọn</em>}<em className={`is-${item.hasWorkingDraft ? 'working' : item.status}`}>{item.hasWorkingDraft ? 'Đang sửa' : statusLabels[item.status]}</em></span></span>{(!item.instructionsVi.length || !item.media.startImageUrl) ? <AlertTriangle aria-label="Thiếu dữ liệu xuất bản" /> : <ChevronRight aria-label="Xem chi tiết" />}</button>)}
        {!loading && !filteredItems.length && <div className="exercise-catalog-manager__empty"><Library /><strong>Không có bài tập phù hợp</strong><span>Đổi bộ lọc hoặc thêm một bài mới.</span></div>}
      </div></aside>
      <div className="exercise-catalog-manager__editor" ref={editorRef}>
        {!selectedId ? <div className="exercise-catalog-manager__empty is-large"><Dumbbell /><strong>Chọn hoặc thêm bài tập</strong><span>Biên tập khoa học theo 5 bước, không cần điền một form dài.</span></div> : <>
          <button className="exercise-catalog-manager__mobile-back" onClick={closeMobileDetail}><ArrowLeft />Danh sách bài tập</button>
          <header><div><span>{publishedItem?.status === 'published' ? 'CHI TIẾT BÀI TẬP' : 'HỒ SƠ BÀI TẬP'}</span><h3>{draft.nameVi || 'Bài tập mới'}</h3><p>{autoSaving ? 'Đang tự động lưu…' : dirty ? 'Có thay đổi chưa lưu' : lastSavedAt ? `Đã lưu lúc ${lastSavedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : `Revision ${editRevision}`}</p></div>{isPopularForWomen(selectedId) ? <em className="is-popular"><Flame />Nữ hay chọn</em> : <em>{draft.status === 'review' ? 'Chờ duyệt' : 'Nháp'}</em>}</header>
          <nav className="exercise-catalog-manager__stepper" aria-label="Các bước tạo bài tập">{wizardSteps.map((step, index) => <button type="button" aria-label={`${step.label}: ${step.note}`} className={`${activeStep === index ? 'is-active' : ''} ${stepComplete(index) ? 'is-complete' : ''}`} onClick={() => { setActiveStep(index); setStepError('') }} key={step.label}><i>{stepComplete(index) ? <Check /> : index + 1}</i><span><b>{step.label}</b><small>{step.note}</small></span></button>)}</nav>
          <div className="exercise-catalog-manager__step-content">
            {activeStep === 0 && <section className="exercise-catalog-manager__panel"><header><span>BƯỚC 1</span><h4>Thông tin và phân loại</h4><p>Nhập thông tin giúp Staff tìm và chọn đúng bài tập.</p></header><div className="exercise-catalog-manager__form-grid"><label>Tên tiếng Việt *<input value={draft.nameVi} onChange={(event) => updateDraft({ nameVi: event.target.value })} placeholder="Ví dụ: Đẩy hông với tạ đòn" /></label><label>Tên tiếng Anh *<input value={draft.nameEn || ''} onChange={(event) => updateDraft({ nameEn: event.target.value })} placeholder="Barbell Hip Thrust" /></label><label>Độ khó<select value={draft.difficulty} onChange={(event) => updateDraft({ difficulty: event.target.value as ExerciseCatalogDraft['difficulty'] })}><option value="beginner">Cơ bản</option><option value="intermediate">Trung bình</option><option value="advanced">Nâng cao</option></select></label><fieldset><legend>Môi trường tập</legend><div className="exercise-catalog-manager__choice-row">{(['gym', 'home'] as const).map((environment) => <button type="button" className={draft.environment.includes(environment) ? 'is-selected' : ''} onClick={() => updateDraft({ environment: draft.environment.includes(environment) ? draft.environment.filter((item) => item !== environment) : [...draft.environment, environment] })} key={environment}>{environment === 'gym' ? 'Phòng gym' : 'Tại nhà'}</button>)}</div></fieldset></div><div className="exercise-catalog-manager__tag-grid"><TagEditor label="Nhóm cơ chính *" values={draft.targetMuscles} onChange={(targetMuscles) => updateDraft({ targetMuscles })} placeholder="Mông, Đùi sau" /><TagEditor label="Nhóm cơ phụ" values={draft.secondaryMuscles} onChange={(secondaryMuscles) => updateDraft({ secondaryMuscles })} placeholder="Core" /><TagEditor label="Vùng cơ thể" values={draft.bodyParts} onChange={(bodyParts) => updateDraft({ bodyParts })} placeholder="Thân dưới" /><TagEditor label="Dụng cụ" values={draft.equipment} onChange={(equipment) => updateDraft({ equipment })} placeholder="Tạ đòn, Ghế" /><TagEditor label="Mục tiêu" values={draft.goals} onChange={(goals) => updateDraft({ goals })} placeholder="Tăng cơ, Sức mạnh" /><TagEditor label="Tên gọi khác" values={draft.aliasesVi} onChange={(aliasesVi) => updateDraft({ aliasesVi })} placeholder="Tên thường dùng" /></div></section>}
            {activeStep === 1 && <section className="exercise-catalog-manager__panel"><header><span>BƯỚC 2</span><h4>Hướng dẫn kỹ thuật</h4><p>Mỗi ý là một dòng riêng, có thể thay đổi thứ tự.</p></header><OrderedLinesEditor label="Hướng dẫn từng bước *" values={draft.instructionsVi} onChange={(instructionsVi) => updateDraft({ instructionsVi })} placeholder="Thêm bước thực hiện" /><div className="exercise-catalog-manager__ordered-grid"><OrderedLinesEditor label="Điểm nhắc kỹ thuật" values={draft.cuesVi} onChange={(cuesVi) => updateDraft({ cuesVi })} placeholder="Thêm điểm nhắc" /><OrderedLinesEditor label="Lỗi thường gặp" values={draft.commonMistakesVi} onChange={(commonMistakesVi) => updateDraft({ commonMistakesVi })} placeholder="Thêm lỗi cần tránh" /></div><label className="exercise-catalog-manager__breathing">Nhịp thở<textarea value={draft.breathingVi || ''} onChange={(event) => updateDraft({ breathingVi: event.target.value })} placeholder="Ví dụ: Hít vào khi hạ tạ, thở ra khi đẩy lên." /></label></section>}
            {activeStep === 2 && <section className="exercise-catalog-manager__panel"><header><span>BƯỚC 3</span><h4>Giáo án đề xuất</h4><p>Thông số mặc định khi Staff thêm bài này vào lịch tập.</p></header><div className="exercise-catalog-manager__prescription"><label>Hiệp<input type="number" min="1" max="10" value={draft.defaultPrescription.sets} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, sets: Number(event.target.value) } })} /></label><label>Reps<input value={draft.defaultPrescription.reps} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, reps: event.target.value } })} /></label><label>Nghỉ (giây)<input type="number" min="0" max="600" value={draft.defaultPrescription.restSeconds} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, restSeconds: Number(event.target.value) } })} /></label><label>RPE<input type="number" min="1" max="10" value={draft.defaultPrescription.rpe} onChange={(event) => updateDraft({ defaultPrescription: { ...draft.defaultPrescription, rpe: Number(event.target.value) } })} /></label></div><article className="exercise-catalog-manager__prescription-preview"><Dumbbell /><span><small>GIÁO ÁN MẶC ĐỊNH</small><strong>{draft.defaultPrescription.sets} hiệp × {draft.defaultPrescription.reps} reps</strong><p>Nghỉ {draft.defaultPrescription.restSeconds} giây · RPE {draft.defaultPrescription.rpe}/10</p></span></article></section>}
            {activeStep === 3 && <section className="exercise-catalog-manager__panel"><header><span>BƯỚC 4</span><h4>Hình ảnh và video</h4><p>Vuốt để xem, chọn vai trò và đặt ảnh bìa cho thư viện.</p></header><div className="exercise-catalog-manager__media-workspace"><MediaCarousel images={imagesForDraft} posterId={draft.media.posterImageId} onSetPoster={(id) => updateMedia((media) => syncMedia(media, mediaImages(media), id))} /><div className={`exercise-catalog-manager__dropzone ${uploading ? 'is-uploading' : ''}`} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('is-dragging') }} onDragLeave={(event) => event.currentTarget.classList.remove('is-dragging')} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('is-dragging'); void handleFiles(event.dataTransfer.files) }}><input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => event.target.files && void handleFiles(event.target.files)} /><Upload /><strong>{uploading ? `Đang tải ${uploadProgress}%` : 'Kéo ảnh vào đây hoặc chọn từ máy'}</strong><span>JPG, PNG, WebP · tối đa 10MB/ảnh · tự tối ưu WebP</span>{uploading ? <div><i style={{ width: `${uploadProgress}%` }} /></div> : <button type="button" onClick={() => fileInputRef.current?.click()}>Chọn ảnh</button>}</div></div>
              {!!imagesForDraft.length && <div className="exercise-catalog-manager__media-list">{imagesForDraft.map((image, index) => <article key={image.id}><img src={image.url} alt="" /><span><b>Ảnh {index + 1}</b><input value={image.alt || ''} placeholder="Mô tả ảnh" onChange={(event) => updateMedia((media) => syncMedia(media, mediaImages(media).map((entry) => entry.id === image.id ? { ...entry, alt: event.target.value } : entry)))} /></span><select value={image.role} onChange={(event) => { const role = event.target.value as MediaRole; updateMedia((media) => { const current = mediaImages(media).map((entry) => (role === 'start' || role === 'end') && entry.role === role ? { ...entry, role: 'detail' as const } : entry).map((entry) => entry.id === image.id ? { ...entry, role } : entry); return syncMedia(media, current) }) }}><option value="start">Bắt đầu</option><option value="end">Kết thúc</option><option value="detail">Bổ sung</option></select><div><button type="button" disabled={index === 0} onClick={() => updateMedia((media) => { const next = mediaImages(media); [next[index - 1], next[index]] = [next[index], next[index - 1]]; return syncMedia(media, next) })}><ArrowUp /></button><button type="button" disabled={index === imagesForDraft.length - 1} onClick={() => updateMedia((media) => { const next = mediaImages(media); [next[index + 1], next[index]] = [next[index], next[index + 1]]; return syncMedia(media, next) })}><ArrowDown /></button><button type="button" onClick={() => updateMedia((media) => syncMedia(media, mediaImages(media).filter((entry) => entry.id !== image.id)))}><Trash2 /></button></div></article>)}</div>}
              <section className="exercise-catalog-manager__external-sync">
                <header><span><Cloud /><b>Kho media bài tập</b><small>Nguồn miễn phí trước · giữ nguyên nội dung tiếng Việt của Aura</small></span>{draft.externalMedia ? <em>Đã liên kết</em> : <em className="is-muted">Chưa liên kết</em>}</header>
                {draft.externalMedia && <div className="exercise-catalog-manager__external-linked">
                  <span><Video /><b>{externalPreview?.title || draft.nameEn || draft.nameVi}</b><small>{externalProviderMeta[draft.externalMedia.provider].label} · {draft.externalMedia.exerciseId}</small></span>
                  {draft.externalMedia.provider === 'ymove' && <><label>Phông video<select value={draft.externalMedia.preferredVideoTag || 'white-background'} onChange={(event) => updateDraft({ externalMedia: { ...draft.externalMedia!, preferredVideoTag: event.target.value as 'white-background' | 'gym-shot' } })}><option value="white-background">Nền trắng</option><option value="gym-shot">Phòng tập</option></select></label>
                  <label>Khung hình<select value={draft.externalMedia.preferredOrientation || 'portrait'} onChange={(event) => updateDraft({ externalMedia: { ...draft.externalMedia!, preferredOrientation: event.target.value as 'portrait' | 'landscape' } })}><option value="portrait">Dọc · mobile</option><option value="landscape">Ngang</option></select></label></>}
                  <button type="button" onClick={() => { updateDraft({ externalMedia: undefined }); setExternalPreview(null) }}><Unlink />Bỏ liên kết</button>
                </div>}
                <div className="exercise-catalog-manager__provider-tabs" role="group" aria-label="Chọn nguồn media">{(Object.keys(externalProviderMeta) as ExternalExerciseProvider[]).map((provider) => <button type="button" className={externalProvider === provider ? 'is-active' : ''} onClick={() => { setExternalProvider(provider); setExternalItems([]); setExternalPreview(null); setExternalConfigured(null); setStepError('') }} key={provider}><b>{externalProviderMeta[provider].label}</b><small>{externalProviderMeta[provider].note}</small></button>)}</div>
                <div className="exercise-catalog-manager__external-search"><label><Search /><input value={externalQuery} onChange={(event) => setExternalQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchExternal() } }} placeholder="Tìm tên tiếng Anh, ví dụ hip thrust…" /></label><button type="button" onClick={() => void searchExternal()} disabled={externalLoading}><Search />{externalLoading ? 'Đang tìm…' : 'Tìm video'}</button></div>
                {externalConfigured === false && <div className="exercise-catalog-manager__external-unconfigured"><AlertTriangle /><span><b>Chưa bật YMove API</b><small>ExerciseDB Free và 25 video YMove miễn phí vẫn hoạt động mà không cần secret.</small></span></div>}
                {!!externalItems.length && <div className="exercise-catalog-manager__external-results">{externalItems.map((candidate) => <button type="button" className={externalPreview?.id === candidate.id && externalPreview.provider === candidate.provider ? 'is-active' : ''} onClick={() => void previewExternal(candidate)} key={`${candidate.provider}-${candidate.id}`}>{candidate.thumbnailUrl ? <img src={candidate.thumbnailUrl} alt="" loading="lazy" /> : <Video />}<span><b>{candidate.title}</b><small>{[candidate.muscleGroup, ...candidate.equipment.slice(0, 1)].filter(Boolean).join(' · ') || 'Bài tập kỹ thuật'}</small><em>{candidate.mediaLabel || `${candidate.videoCount || candidate.videos.length} video`}</em></span><Eye /></button>)}</div>}
                {externalPreview && <div className="exercise-catalog-manager__external-preview"><ExerciseMediaPlayer name={externalPreview.title} media={draft.media} resolvedMedia={externalResolvedMedia} compact /><article><span>{externalProviderMeta[externalPreview.provider].label.toLocaleUpperCase('vi')}</span><h5>{externalPreview.title}</h5><p>{externalPreview.description || [externalPreview.muscleGroup, ...externalPreview.equipment].filter(Boolean).join(' · ')}</p><small>{externalPreview.licenseNotice || `${externalPreview.videos.length} biến thể media`}</small><button type="button" onClick={() => linkExternal(externalPreview)}><Link2 />{draft.externalMedia?.provider === externalPreview.provider && draft.externalMedia?.exerciseId === externalPreview.id ? 'Đã liên kết bài này' : 'Liên kết vào bài Aura'}</button></article></div>}
              </section>
              <details className="exercise-catalog-manager__advanced-media"><summary><Link2 />Thêm media bằng URL</summary><div><label>Đường dẫn ảnh<input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://…" /></label><label>Vai trò<select value={remoteRole} onChange={(event) => setRemoteRole(event.target.value as MediaRole)}><option value="detail">Bổ sung</option><option value="start">Bắt đầu</option><option value="end">Kết thúc</option></select></label><button type="button" onClick={addRemoteImage}><Plus />Thêm ảnh</button><label className="is-wide">Video MP4/WebM hoặc ảnh động GIF<input value={draft.media.animationUrl || ''} onChange={(event) => updateMedia((media) => ({ ...media, animationUrl: event.target.value }))} placeholder="https://…/video.mp4" /></label><p className="is-wide exercise-catalog-manager__license-note">Có thể dùng video được cấp phép từ <a href="https://programme.app/license" target="_blank" rel="noreferrer">Programme</a>. Chỉ dán đường dẫn media trực tiếp và ghi nguồn ở bước xem lại.</p><label className="is-wide">Ghi nguồn media<input value={draft.sourceAttribution || ''} onChange={(event) => updateDraft({ sourceAttribution: event.target.value })} placeholder="Ví dụ: Nội dung Aura Fitness · Video Programme" /></label></div></details>
            </section>}
            {activeStep === 4 && <section className="exercise-catalog-manager__panel"><header><span>BƯỚC 5</span><h4>Xem lại và xuất bản</h4><p>Đây là thông tin Staff và học viên sẽ nhìn thấy.</p></header><div className="exercise-catalog-manager__review"><ExerciseMediaPlayer exerciseId={publishedItem?.id} name={draft.nameVi || 'Bài tập Aura'} media={draft.media} externalMedia={draft.externalMedia} resolvedMedia={externalResolvedMedia} /><article><span className="exercise-catalog-manager__review-badge">{draft.difficulty === 'beginner' ? 'Cơ bản' : draft.difficulty === 'intermediate' ? 'Trung bình' : 'Nâng cao'}</span><h4>{draft.nameVi || 'Chưa đặt tên'}</h4><small>{draft.nameEn}</small><div className="exercise-catalog-manager__review-tags">{[...draft.targetMuscles, ...draft.equipment].map((tag) => <em key={tag}>{tag}</em>)}</div><strong>{draft.defaultPrescription.sets} hiệp × {draft.defaultPrescription.reps} reps · nghỉ {draft.defaultPrescription.restSeconds}s</strong><ol>{draft.instructionsVi.filter(Boolean).map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></article></div><div className="exercise-catalog-manager__checklist">{[{ label: 'Tên và nhóm cơ', ok: stepComplete(0) }, { label: 'Hướng dẫn kỹ thuật', ok: stepComplete(1) }, { label: 'Giáo án đề xuất', ok: stepComplete(2) }, { label: 'Ảnh minh họa', ok: stepComplete(3) }].map((item) => <span className={item.ok ? 'is-ok' : ''} key={item.label}>{item.ok ? <CircleCheck /> : <AlertTriangle />}{item.label}</span>)}</div></section>}
          </div>
          {(stepError || (activeStep === 4 && missingPublishData)) && <div className="exercise-catalog-manager__warning"><AlertTriangle /><span><b>{stepError || 'Chưa thể xuất bản'}</b>{!stepError && <small>Hoàn thành các mục còn thiếu trong checklist.</small>}</span></div>}
          <footer className="exercise-catalog-manager__wizard-footer"><button type="button" onClick={() => setActiveStep((current) => Math.max(0, current - 1))} disabled={activeStep === 0}><ArrowLeft />Quay lại</button><span /><button type="button" onClick={() => void save('draft')} disabled={saving || uploading}><Save />Lưu nháp</button>{activeStep < 4 ? <button type="button" className="is-primary" onClick={nextStep}>Tiếp tục<ArrowRight /></button> : <><button type="button" onClick={() => void save('review')} disabled={saving || missingPublishData}><Send />Gửi duyệt</button>{canPublish && <button type="button" className="is-primary" onClick={() => void publish()} disabled={saving || missingPublishData}><Check />Xuất bản</button>}</>}</footer>
        </>}
      </div>
    </div>
  </section>
}
