import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Beef,
  Bookmark,
  BookmarkCheck,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Database,
  Droplets,
  ExternalLink,
  Flame,
  Info,
  Leaf,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Salad,
  Scale,
  ScanLine,
  Sparkles,
  Utensils,
  Wheat,
} from 'lucide-react'
import NutritionGroupIcon, { getNutritionGroupVisual } from '../../components/NutritionGroupIcon'
import '../../styles-nutrition-detail.css'

export type NutritionFoodDetailKind = 'dish' | 'food'

export interface NutritionFoodDetailCategory {
  id?: string | null
  nameVi?: string | null
  nameEn?: string | null
}

export interface NutritionFoodDetailRegion {
  id?: string | null
  nameVi?: string | null
  code?: string | null
}

export interface NutritionFoodDetailBasis {
  amount?: number | null
  unit?: string | null
  qualifier?: string | null
  labelVi?: string | null
}

export interface NutritionNutrientEquivalent {
  key?: string | null
  nameVi?: string | null
  nameEn?: string | null
  value?: number | null
  unit?: string | null
}

export interface NutritionDetailNutrient {
  key: string
  sourceKey?: string | null
  nameVi: string
  nameEn?: string | null
  value: number | null
  unit?: string | null
  equivalents?: NutritionNutrientEquivalent[]
}

export interface NutritionRecipeComponent {
  id?: string | null
  nameVi?: string | null
  nameEn?: string | null
  amount?: number | null
  unit?: string | null
  note?: string | null
}

export interface NutritionFoodDetailSource {
  publisher?: string | null
  pageUrl?: string | null
  apiUrl?: string | null
  sourceId?: string | null
  sourceUpdatedAt?: string | null
  fetchedAt?: string | null
}

export interface NutritionFoodDetailRecord {
  id: string
  kind: NutritionFoodDetailKind
  code?: string | null
  nameVi: string
  nameEn?: string | null
  nameAscii?: string | null
  category?: NutritionFoodDetailCategory | null
  region?: NutritionFoodDetailRegion | null
  basis?: NutritionFoodDetailBasis | null
  energyKcal?: number | null
  nutrients?: NutritionDetailNutrient[]
  recipeComponents?: NutritionRecipeComponent[]
  imageUrl?: string | null
  description?: string | null
  source?: NutritionFoodDetailSource | null
}

export interface NutritionFoodDetailSummary {
  id: string
  kind: NutritionFoodDetailKind
  detailBucket: string
  code?: string | null
  nameVi: string
  nameEn?: string | null
  category?: NutritionFoodDetailCategory | null
  region?: NutritionFoodDetailRegion | null
  basis?: NutritionFoodDetailBasis | null
  energyKcal?: number | null
  macros?: {
    proteinG?: number | null
    carbohydrateG?: number | null
    fatG?: number | null
  } | null
  imageUrl?: string | null
  sourceUrl?: string | null
}

export interface NutritionServingSelection {
  amount: number
  unit: 'g' | 'serving'
  multiplier: number
  label: string
}

export interface NutritionFoodDetailProps {
  item: NutritionFoodDetailSummary
  relatedItems?: NutritionFoodDetailSummary[]
  initialSaved?: boolean
  detailsBasePath?: string
  className?: string
  onBack: () => void
  onAdd?: (record: NutritionFoodDetailRecord, serving: NutritionServingSelection) => void
  onSave?: (record: NutritionFoodDetailRecord, saved: boolean) => void
  onScan?: () => void
  onSelectRelated?: (item: NutritionFoodDetailSummary) => void
}

interface NutritionDetailBucket {
  records?: unknown
}

const CORE_NUTRIENT_KEYS = new Set(['energy', 'protein', 'fat', 'carbohydrate'])
const DEFAULT_VISIBLE_NUTRIENTS = 8
const FOOD_PORTIONS = [50, 100, 150, 200]
const DISH_PORTIONS = [0.5, 1, 1.5, 2]

function isRecordCandidate(value: unknown): value is NutritionFoodDetailRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NutritionFoodDetailRecord>
  return typeof candidate.id === 'string' && typeof candidate.nameVi === 'string'
}

function findRecord(payload: unknown, id: string) {
  if (Array.isArray(payload)) return payload.find((record) => isRecordCandidate(record) && record.id === id) ?? null
  if (!payload || typeof payload !== 'object') return null

  const bucket = payload as NutritionDetailBucket & Record<string, unknown>
  if (Array.isArray(bucket.records)) {
    return bucket.records.find((record) => isRecordCandidate(record) && record.id === id) ?? null
  }

  const keyedRecord = bucket[id]
  return isRecordCandidate(keyedRecord) ? keyedRecord : null
}

function summaryToRecord(item: NutritionFoodDetailSummary): NutritionFoodDetailRecord {
  const nutrients: NutritionDetailNutrient[] = [
    { key: 'energy', nameVi: 'Năng lượng', value: item.energyKcal ?? null, unit: 'kcal' },
    { key: 'protein', nameVi: 'Chất đạm', value: item.macros?.proteinG ?? null, unit: 'g' },
    { key: 'carbohydrate', nameVi: 'Chất bột đường', value: item.macros?.carbohydrateG ?? null, unit: 'g' },
    { key: 'fat', nameVi: 'Chất béo', value: item.macros?.fatG ?? null, unit: 'g' },
  ]

  return {
    id: item.id,
    kind: item.kind,
    code: item.code,
    nameVi: item.nameVi,
    nameEn: item.nameEn,
    category: item.category,
    region: item.region,
    basis: item.basis,
    energyKcal: item.energyKcal,
    nutrients,
    imageUrl: item.imageUrl,
    source: {
      publisher: 'Viện Dinh dưỡng Quốc gia',
      pageUrl: item.sourceUrl,
    },
  }
}

function scaledValue(value: number | null | undefined, multiplier: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value * multiplier : null
}

function formatValue(value: number | null | undefined, maximumFractionDigits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value)
}

function formatNutrientValue(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Chưa có dữ liệu'
  const maximumFractionDigits = Math.abs(value) < 10 ? 2 : 1
  return formatValue(value, maximumFractionDigits)
}

function formatSourceDate(value?: string | null) {
  if (!value) return null
  const normalizedValue = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function getNutrient(record: NutritionFoodDetailRecord, key: string) {
  return record.nutrients?.find((nutrient) => nutrient.key === key) ?? null
}

function getBucketUrl(basePath: string, bucket: string) {
  const normalizedBase = basePath.replace(/\/$/, '')
  const normalizedBucket = bucket.endsWith('.json') ? bucket : `${bucket}.json`
  return `${normalizedBase}/${encodeURIComponent(normalizedBucket)}`
}

function getFallbackRecord(item: NutritionFoodDetailSummary) {
  return summaryToRecord(item)
}

export default function NutritionFoodDetail({
  item,
  relatedItems = [],
  initialSaved = false,
  detailsBasePath = `${import.meta.env.BASE_URL}data/nutrition-details`,
  className = '',
  onBack,
  onAdd,
  onSave,
  onScan,
  onSelectRelated,
}: NutritionFoodDetailProps) {
  const [detail, setDetail] = useState<NutritionFoodDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [portionGrams, setPortionGrams] = useState(100)
  const [dishMultiplier, setDishMultiplier] = useState(1)
  const [nutrientsExpanded, setNutrientsExpanded] = useState(false)
  const [saved, setSaved] = useState(initialSaved)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const bucketUrl = getBucketUrl(detailsBasePath, item.detailBucket)

    setLoading(true)
    setLoadError(null)
    setDetail(null)

    fetch(bucketUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Không thể tải dữ liệu (${response.status})`)
        return response.json() as Promise<unknown>
      })
      .then((payload) => {
        const record = findRecord(payload, item.id)
        if (!record) throw new Error('Không tìm thấy món trong gói dữ liệu')
        setDetail(record)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : 'Không thể tải dữ liệu chi tiết')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [detailsBasePath, item.detailBucket, item.id, requestVersion])

  useEffect(() => {
    setPortionGrams(100)
    setDishMultiplier(1)
    setNutrientsExpanded(false)
    setSaved(initialSaved)
    setImageFailed(false)
  }, [initialSaved, item.id])

  const record = detail ?? getFallbackRecord(item)
  const isFood = record.kind === 'food'
  const basisAmount = record.basis?.amount && record.basis.amount > 0 ? record.basis.amount : 100
  const multiplier = isFood ? portionGrams / basisAmount : dishMultiplier
  const serving: NutritionServingSelection = isFood
    ? { amount: portionGrams, unit: 'g', multiplier, label: `${portionGrams} g` }
    : { amount: dishMultiplier, unit: 'serving', multiplier, label: `${formatValue(dishMultiplier)} suất` }

  const energy = scaledValue(record.energyKcal ?? getNutrient(record, 'energy')?.value, multiplier)
  const protein = scaledValue(getNutrient(record, 'protein')?.value ?? item.macros?.proteinG, multiplier)
  const carbohydrate = scaledValue(getNutrient(record, 'carbohydrate')?.value ?? item.macros?.carbohydrateG, multiplier)
  const fat = scaledValue(getNutrient(record, 'fat')?.value ?? item.macros?.fatG, multiplier)

  const micronutrients = useMemo(
    () => (record.nutrients ?? []).filter((nutrient) => !CORE_NUTRIENT_KEYS.has(nutrient.key)),
    [record],
  )
  const visibleNutrients = nutrientsExpanded
    ? micronutrients
    : micronutrients.slice(0, DEFAULT_VISIBLE_NUTRIENTS)

  const notices = useMemo(() => {
    const sodium = scaledValue(getNutrient(record, 'sodium')?.value, multiplier)
    const sugar = scaledValue(getNutrient(record, 'sugars_total')?.value ?? getNutrient(record, 'sugar')?.value, multiplier)
    const cholesterol = scaledValue(getNutrient(record, 'cholesterol')?.value, multiplier)
    const messages: string[] = []

    if (typeof sodium === 'number' && sodium >= 600) {
      messages.push('Khẩu phần này có lượng natri đáng lưu ý. Cân nhắc món ăn kèm ít muối trong ngày.')
    }
    if (typeof sugar === 'number' && sugar >= 20) {
      messages.push('Lượng đường của khẩu phần tương đối cao; bạn có thể điều chỉnh kích thước khẩu phần.')
    }
    if (typeof cholesterol === 'number' && cholesterol >= 200) {
      messages.push('Chỉ số cholesterol của khẩu phần ở mức đáng lưu ý khi theo dõi chế độ ăn.')
    }
    if (typeof energy === 'number' && energy >= 700) {
      messages.push('Đây là khẩu phần giàu năng lượng. Hãy đối chiếu với mục tiêu kcal trong ngày.')
    }
    if (!messages.length) {
      messages.push('Giá trị dinh dưỡng thay đổi theo nguyên liệu, cách chế biến và khẩu phần thực tế.')
    }
    return messages.slice(0, 2)
  }, [energy, multiplier, record])

  const imageUrl = record.imageUrl || item.imageUrl
  const groupVisual = getNutritionGroupVisual(record.category?.nameVi, record.kind)
  const categoryName = record.category?.nameVi || 'Chưa phân nhóm'
  const regionName = record.region?.nameVi
  const sourcePublisher = record.source?.publisher || 'Viện Dinh dưỡng Quốc gia'
  const sourceUrl = record.source?.pageUrl || item.sourceUrl
  const sourceDate = formatSourceDate(record.source?.sourceUpdatedAt)
  const related = relatedItems.filter((relatedItem) => relatedItem.id !== item.id).slice(0, 4)

  const handleSave = () => {
    const nextSaved = !saved
    setSaved(nextSaved)
    onSave?.(record, nextSaved)
  }

  const handlePortionInput = (value: string) => {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) return
    setPortionGrams(Math.min(basisAmount * 5, Math.max(0, Math.round(parsedValue * 10) / 10)))
  }

  const handleMultiplierInput = (value: number) => {
    const safeValue = Math.min(5, Math.max(0, Math.round(value * 10) / 10))
    if (isFood) setPortionGrams(Math.round(basisAmount * safeValue * 10) / 10)
    else setDishMultiplier(safeValue)
  }

  return (
    <article className={`nutrition-food-detail ${className}`.trim()} aria-labelledby="nutrition-food-title">
      <header className="nutrition-food-detail__topbar">
        <button type="button" className="nutrition-food-detail__back" onClick={onBack} aria-label="Quay lại thư viện dinh dưỡng">
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Thư viện dinh dưỡng</span>
        </button>

        <div className="nutrition-food-detail__top-actions">
          {onScan && (
            <button type="button" className="nutrition-food-detail__ghost-button" onClick={onScan}>
              <ScanLine size={17} aria-hidden="true" />
              Quét món tương tự
            </button>
          )}
          <button
            type="button"
            className={`nutrition-food-detail__save ${saved ? 'is-saved' : ''}`}
            onClick={handleSave}
            aria-pressed={saved}
          >
            {saved ? <BookmarkCheck size={17} aria-hidden="true" /> : <Bookmark size={17} aria-hidden="true" />}
            {saved ? 'Đã lưu' : 'Lưu món'}
          </button>
        </div>
      </header>

      <section className="nutrition-food-detail__hero">
        <div className={`nutrition-food-detail__media ${!imageUrl || imageFailed ? 'is-fallback' : ''}`}>
          {imageUrl && !imageFailed ? (
            <img
              src={imageUrl}
              alt={`Ảnh ${record.nameVi}`}
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="nutrition-food-detail__fallback">
              <NutritionGroupIcon categoryName={record.category?.nameVi} kind={record.kind} size={64} strokeWidth={1.35} className="nutrition-food-detail__fallback-icon" ariaLabel={`Không có ảnh; minh họa ${groupVisual.label.toLocaleLowerCase('vi')} cho ${record.nameVi}`} />
              <span>{record.category?.nameVi || (record.kind === 'dish' ? 'Món ăn Việt' : 'Thực phẩm')}</span>
            </div>
          )}
          <span className="nutrition-food-detail__kind">
            {record.kind === 'dish' ? <Utensils size={13} aria-hidden="true" /> : <Leaf size={13} aria-hidden="true" />}
            {record.kind === 'dish' ? 'Món ăn' : 'Thực phẩm'}
          </span>
          {imageUrl && !imageFailed && <small>Ảnh từ nguồn dữ liệu</small>}
        </div>

        <div className="nutrition-food-detail__intro">
          <div className="nutrition-food-detail__eyebrow">
            <span>{categoryName}</span>
            {record.code && <span>Mã {record.code}</span>}
          </div>
          <h1 id="nutrition-food-title">{record.nameVi}</h1>
          {record.nameEn && <p className="nutrition-food-detail__english-name" lang="en">{record.nameEn}</p>}
          {record.description && <p className="nutrition-food-detail__description">{record.description}</p>}

          <div className="nutrition-food-detail__metadata" aria-label="Thông tin món ăn">
            <span><Database size={15} aria-hidden="true" /> {sourcePublisher}</span>
            {regionName && <span><MapPin size={15} aria-hidden="true" /> {regionName}</span>}
            <span><Scale size={15} aria-hidden="true" /> {record.basis?.labelVi || 'Khẩu phần theo dữ liệu nguồn'}</span>
          </div>

          <div className="nutrition-food-detail__hero-actions">
            <button type="button" className="nutrition-food-detail__primary" onClick={() => onAdd?.(record, serving)} disabled={!onAdd || multiplier <= 0}>
              <Plus size={18} aria-hidden="true" />
              Thêm vào nhật ký
            </button>
            <button type="button" className={`nutrition-food-detail__icon-save ${saved ? 'is-saved' : ''}`} onClick={handleSave} aria-label={saved ? 'Bỏ lưu món' : 'Lưu món'} aria-pressed={saved}>
              {saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </section>

      {loading && (
        <div className="nutrition-food-detail__load-state" role="status" aria-live="polite">
          <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />
          Đang tải bảng thành phần chi tiết…
        </div>
      )}
      {loadError && (
        <div className="nutrition-food-detail__load-state is-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>Đang hiển thị dữ liệu tóm tắt. {loadError}.</span>
          <button type="button" onClick={() => setRequestVersion((version) => version + 1)}>
            <RefreshCw size={14} aria-hidden="true" /> Thử lại
          </button>
        </div>
      )}

      <div className="nutrition-food-detail__layout">
        <div className="nutrition-food-detail__main">
          <section className="nutrition-food-detail__section" aria-labelledby="macro-heading">
            <div className="nutrition-food-detail__section-heading">
              <div>
                <span>THÀNH PHẦN CHÍNH</span>
                <h2 id="macro-heading">Dinh dưỡng theo {serving.label}</h2>
              </div>
              <span className="nutrition-food-detail__reference-label">Dữ liệu tham khảo</span>
            </div>

            <div className="nutrition-food-detail__macro-grid">
              <div className="nutrition-food-detail__macro nutrition-food-detail__macro--energy">
                <span><Flame size={18} aria-hidden="true" /></span>
                <div><small>Năng lượng</small><strong>{formatValue(energy)} <em>kcal</em></strong></div>
              </div>
              <div className="nutrition-food-detail__macro nutrition-food-detail__macro--protein">
                <span><Beef size={18} aria-hidden="true" /></span>
                <div>
                  <small>Chất đạm</small>
                  <strong>{formatValue(protein)} <em>g</em></strong>
                  {(protein ?? 0) > 0 && <em>({Math.round((((protein ?? 0) * 4) / Math.max(1, energy ?? 0)) * 100)}%)</em>}
                </div>
              </div>
              <div className="nutrition-food-detail__macro nutrition-food-detail__macro--carbs">
                <span><Wheat size={18} aria-hidden="true" /></span>
                <div>
                  <small>Bột đường</small>
                  <strong>{formatValue(carbohydrate)} <em>g</em></strong>
                  {(carbohydrate ?? 0) > 0 && <em>({Math.round((((carbohydrate ?? 0) * 4) / Math.max(1, energy ?? 0)) * 100)}%)</em>}
                </div>
              </div>
              <div className="nutrition-food-detail__macro nutrition-food-detail__macro--fat">
                <span><Droplets size={18} aria-hidden="true" /></span>
                <div>
                  <small>Chất béo</small>
                  <strong>{formatValue(fat)} <em>g</em></strong>
                  {(fat ?? 0) > 0 && <em>({Math.round((((fat ?? 0) * 9) / Math.max(1, energy ?? 0)) * 100)}%)</em>}
                </div>
              </div>
            </div>
          </section>

          <section className="nutrition-food-detail__section" aria-labelledby="micronutrient-heading">
            <div className="nutrition-food-detail__section-heading">
              <div>
                <span>VI CHẤT & THÀNH PHẦN</span>
                <h2 id="micronutrient-heading">Bảng dinh dưỡng chi tiết</h2>
              </div>
              <span className="nutrition-food-detail__count">{micronutrients.length} chỉ số</span>
            </div>

            {micronutrients.length ? (
              <>
                <div className="nutrition-food-detail__table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Thành phần</th>
                        <th scope="col">Giá trị</th>
                        <th scope="col">Đơn vị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleNutrients.map((nutrient) => {
                        const value = scaledValue(nutrient.value, multiplier)
                        return (
                          <tr key={`${nutrient.key}-${nutrient.sourceKey ?? ''}`} className={value === null ? 'is-empty' : ''}>
                            <th scope="row">
                              <span>{nutrient.nameVi}</span>
                              {nutrient.nameEn && <small lang="en">{nutrient.nameEn}</small>}
                            </th>
                            <td>{formatNutrientValue(value)}</td>
                            <td>{value === null ? '—' : nutrient.unit || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {micronutrients.length > DEFAULT_VISIBLE_NUTRIENTS && (
                  <button type="button" className="nutrition-food-detail__expand" onClick={() => setNutrientsExpanded((expanded) => !expanded)} aria-expanded={nutrientsExpanded}>
                    {nutrientsExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                    {nutrientsExpanded ? 'Thu gọn bảng dinh dưỡng' : `Xem thêm ${micronutrients.length - DEFAULT_VISIBLE_NUTRIENTS} chỉ số`}
                  </button>
                )}
              </>
            ) : (
              <div className="nutrition-food-detail__empty">
                <Database size={22} aria-hidden="true" />
                <p>Chưa có dữ liệu vi chất cho món này trong nguồn hiện tại.</p>
              </div>
            )}
          </section>

          {!!record.recipeComponents?.length && (
            <section className="nutrition-food-detail__section" aria-labelledby="ingredients-heading">
              <div className="nutrition-food-detail__section-heading">
                <div>
                  <span>THÀNH PHẦN MÓN</span>
                  <h2 id="ingredients-heading">Nguyên liệu từ nguồn</h2>
                </div>
              </div>
              <ul className="nutrition-food-detail__ingredients">
                {record.recipeComponents.map((component, index) => (
                  <li key={component.id || `${component.nameVi ?? 'ingredient'}-${index}`}>
                    <span>{component.nameVi || component.nameEn || 'Thành phần chưa đặt tên'}</span>
                    <strong>{component.amount == null ? '—' : formatValue(component.amount, 2)} {component.unit || ''}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="nutrition-food-detail__source" aria-labelledby="source-heading">
            <span className="nutrition-food-detail__source-icon"><Database size={20} aria-hidden="true" /></span>
            <div>
              <span>NGUỒN DỮ LIỆU</span>
              <h2 id="source-heading">{sourcePublisher}</h2>
              <p>
                Số liệu được chuẩn hóa từ trang công cụ dinh dưỡng của nguồn.
                {sourceDate ? ` Cập nhật tại nguồn: ${sourceDate}.` : ''}
              </p>
            </div>
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
                Xem nguồn <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </section>
        </div>

        <aside className="nutrition-food-detail__side" aria-label="Điều chỉnh khẩu phần và gợi ý">
          <section className="nutrition-food-detail__portion-card">
            <div className="nutrition-food-detail__side-heading">
              <span><Scale size={18} aria-hidden="true" /></span>
              <div><small>ĐIỀU CHỈNH</small><h2>Khẩu phần của bạn</h2></div>
            </div>

            {isFood ? (
              <>
                <label className="nutrition-food-detail__portion-input">
                  <span>Khối lượng</span>
                  <span><input type="number" min="0" max={basisAmount * 5} step="0.1" inputMode="decimal" value={portionGrams} onChange={(event) => handlePortionInput(event.target.value)} /> <b>g</b></span>
                </label>
                <div className="nutrition-food-detail__portion-options" role="group" aria-label="Chọn nhanh khối lượng">
                  {FOOD_PORTIONS.map((portion) => (
                    <button key={portion} type="button" className={portionGrams === portion ? 'active' : ''} onClick={() => setPortionGrams(portion)} aria-pressed={portionGrams === portion}>{portion} g</button>
                  ))}
                </div>
                <p><Info size={13} aria-hidden="true" /> Giá trị nguồn tính trên {basisAmount} g phần ăn được.</p>
              </>
            ) : (
              <>
                <div className="nutrition-food-detail__portion-copy">
                  <span>Số suất</span>
                  <strong>{formatValue(dishMultiplier)} <small>suất</small></strong>
                </div>
                <div className="nutrition-food-detail__portion-options" role="group" aria-label="Chọn số suất ăn">
                  {DISH_PORTIONS.map((portion) => (
                    <button key={portion} type="button" className={dishMultiplier === portion ? 'active' : ''} onClick={() => setDishMultiplier(portion)} aria-pressed={dishMultiplier === portion}>{formatValue(portion)}</button>
                  ))}
                </div>
                <p><Info size={13} aria-hidden="true" /> Nguồn chưa nêu khối lượng suất chuẩn; số liệu được nhân theo suất gốc.</p>
              </>
            )}

            <label className="nutrition-food-detail__portion-slider">
              <span><strong>Hệ số khẩu phần</strong><output>{formatValue(multiplier)}×</output></span>
              <input type="range" min="0" max="5" step="0.1" value={Math.min(5, Math.max(0, multiplier))} onChange={(event) => handleMultiplierInput(Number(event.target.value))} aria-valuetext={serving.label} />
              <small><span>0</span><span>1 khẩu phần</span><span>5</span></small>
            </label>

            <button type="button" className="nutrition-food-detail__primary is-full" onClick={() => onAdd?.(record, serving)} disabled={!onAdd || multiplier <= 0}>
              <Plus size={17} aria-hidden="true" /> Thêm {serving.label} vào nhật ký
            </button>
          </section>

          <section className="nutrition-food-detail__notice-card">
            <div className="nutrition-food-detail__side-heading">
              <span><Sparkles size={18} aria-hidden="true" /></span>
              <div><small>GỢI Ý NHẸ</small><h2>Lưu ý cho khẩu phần</h2></div>
            </div>
            <ul>
              {notices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
            <p><CircleAlert size={13} aria-hidden="true" /> Thông tin chỉ nhằm hỗ trợ ghi nhật ký, không thay thế tư vấn y khoa.</p>
          </section>

          {!!related.length && (
            <section className="nutrition-food-detail__related" aria-labelledby="related-heading">
              <div className="nutrition-food-detail__section-heading">
                <div><span>KHÁM PHÁ THÊM</span><h2 id="related-heading">Món tương tự</h2></div>
              </div>
              <div className="nutrition-food-detail__related-list">
                {related.map((relatedItem) => (
                  <button key={relatedItem.id} type="button" onClick={() => onSelectRelated?.(relatedItem)} disabled={!onSelectRelated}>
                    <span className="nutrition-food-detail__related-media">
                      <NutritionGroupIcon categoryName={relatedItem.category?.nameVi} kind={relatedItem.kind} size={18} className="nutrition-food-detail__related-placeholder" />
                      {relatedItem.imageUrl && <img src={relatedItem.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
                    </span>
                    <span className="nutrition-food-detail__related-copy">
                      <strong>{relatedItem.nameVi}</strong>
                      <small>{formatValue(relatedItem.energyKcal)} kcal · {relatedItem.category?.nameVi || (relatedItem.kind === 'dish' ? 'Món ăn' : 'Thực phẩm')}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {onScan && (
            <button type="button" className="nutrition-food-detail__scan-card" onClick={onScan}>
              <span><Camera size={22} aria-hidden="true" /></span>
              <span><small>AI FOOD SCAN</small><strong>Chụp món để ước tính khẩu phần</strong></span>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          )}
        </aside>
      </div>

      <div className="nutrition-food-detail__mobile-actions" aria-label="Thao tác nhanh">
        <button type="button" className={saved ? 'is-saved' : ''} onClick={handleSave} aria-label={saved ? 'Bỏ lưu món' : 'Lưu món'} aria-pressed={saved}>
          {saved ? <BookmarkCheck size={19} aria-hidden="true" /> : <Bookmark size={19} aria-hidden="true" />}
        </button>
        <button type="button" className="nutrition-food-detail__primary" onClick={() => onAdd?.(record, serving)} disabled={!onAdd || multiplier <= 0}>
          <Plus size={18} aria-hidden="true" /> Thêm {serving.label}
        </button>
      </div>
    </article>
  )
}
