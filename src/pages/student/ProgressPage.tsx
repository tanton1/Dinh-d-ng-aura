import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Dumbbell,
  Image as ImageIcon,
  LoaderCircle,
  Ruler,
  Sparkles,
  Target,
  Utensils,
  Waves,
} from 'lucide-react'

import type { Course, CourseProgress } from '../../types'
import type {
  BodyMeasurements,
  ProgressCategory,
  ProgressCheckInPhoto,
  ProgressCheckInRecord,
  ProgressPeriod,
  WeightRecord,
} from '../../types/progressTypes'
import type { NutritionProfileDraft } from '../../features/nutrition/types'
import type { LoyaltyDashboard } from '../../features/loyalty/types'
import { completeMealDates } from '../../features/nutrition/progressNutrition'
import { resolveDailyNutritionTargets, recentAverageWeight } from '../../features/nutrition/dailyNutritionTargets'
import { toLocalDateKey } from '../../features/nutrition/routing'
import { demoLoyaltyDashboard, getMyLoyaltyDashboard } from '../../features/loyalty/loyaltyService'
import { AiCoachBottomSheet } from '../../components/progress/AiCoachBottomSheet'
import { prewarmAiCoachAppCheck } from '../../services/nutritionService'
import { firebaseAuth } from '../../lib/firebase'
import {
  subscribeToRecentUserActivityLogs,
  subscribeToRecentUserMealLogs,
  subscribeToRecentUserWaterLogs,
  subscribeToUserBodyMeasurements,
  subscribeToUserProgressCheckIns,
  subscribeToUserProgressPhotos,
  subscribeToUserWeightLogs,
} from '../../services/firebaseService'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { readProgressPhotoCache } from '../../dataSync/progressPhotoCache'
import '../../styles-progress.css'
import './ProgressPage.css'

interface ProgressPageProps {
  courseItems?: Course[]
  progressItems?: CourseProgress[]
  loading?: boolean
  error?: string | null
  onOpenCourse?: (courseId: string) => void
  onNavigate?: (view: any) => void
  ownerId?: string
  weightKg?: number | null
  targetWeightDeltaKg?: number | null
  targetTimeframeMonths?: number | null
  heightCm?: number | null
  nutritionProfile?: NutritionProfileDraft | null
}

type LegacyPhoto = Partial<ProgressCheckInRecord> & {
  id: string
  imageUrl?: string
  angle?: string
  recordedAt?: string
}

type MetricId = 'weightKg' | 'waistCm' | 'hipsCm' | 'bodyFatPercentage' | 'muscleMassKg'

const metricDefinitions: Array<{ id: MetricId; label: string; unit: string }> = [
  { id: 'weightKg', label: 'Cân nặng', unit: 'kg' },
  { id: 'waistCm', label: 'Vòng eo', unit: 'cm' },
  { id: 'hipsCm', label: 'Vòng mông', unit: 'cm' },
  { id: 'bodyFatPercentage', label: 'Mỡ cơ thể', unit: '%' },
  { id: 'muscleMassKg', label: 'Khối lượng cơ', unit: 'kg' },
]

const allMeasurementDefinitions: Array<{ id: keyof ProgressCheckInRecord; label: string; unit: string }> = [
  ...metricDefinitions,
  { id: 'thighCm', label: 'Vòng đùi', unit: 'cm' },
  { id: 'armCm', label: 'Bắp tay', unit: 'cm' },
  { id: 'chestCm', label: 'Vòng ngực', unit: 'cm' },
]

function positive(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function formatDate(value?: string) {
  if (!value) return 'Chưa có ngày'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function normalizeAngle(value: unknown): ProgressCheckInPhoto['angle'] {
  if (value === 'back' || value === 'left' || value === 'right') return value
  return 'front'
}

function daysAgoKey(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days + 1)
  return toLocalDateKey(date)
}

function changeCopy(value: number | null, unit: string) {
  if (value === null) return 'Chưa đủ dữ liệu'
  if (Math.abs(value) < 0.05) return `Không đổi ${unit}`
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} ${unit}`
}

function photoFor(record: ProgressCheckInRecord | undefined) {
  if (!record?.photos?.length) return null
  return record.photos.find((photo) => photo.angle === 'front') || record.photos[0]
}

function readCachedPhotos(ownerId: string): LegacyPhoto[] {
  return readProgressPhotoCache<LegacyPhoto>(ownerId, (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })
}

/**
 * Lightweight photo surface for the body tab.  It intentionally reads the
 * same owner-scoped cache as the photo studio so an empty, confirmed snapshot
 * immediately removes stale comparison photos instead of resurrecting the
 * fallback legacy cache.
 */
function ProgressPhotoGallery({ records, legacyPhotos, onOpenCheckIn }: { records: ProgressCheckInRecord[]; legacyPhotos: LegacyPhoto[]; onOpenCheckIn: () => void }) {
  const photos = useMemo(() => {
    const canonical = records.flatMap((record) => (record.photos || []).map((photo) => ({
      id: photo.id,
      date: record.date,
      imageUrl: photo.imageUrl,
      angle: photo.angle,
    })))
    const legacy = legacyPhotos
      .filter((photo) => Boolean(photo.imageUrl))
      .map((photo) => ({
        id: photo.id,
        date: String(photo.date || photo.recordedAt || '').slice(0, 10),
        imageUrl: String(photo.imageUrl),
        angle: normalizeAngle(photo.angle),
      }))
    return [...canonical, ...legacy]
      .filter((photo) => photo.date && photo.imageUrl)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [legacyPhotos, records])
  const frontPhoto = photos.find((photo) => photo.angle === 'front')

  return <section id="progress-photos-section" className="progress-v2-section progress-v2-photos" aria-labelledby="progress-photos-title">
    <header><div><h2 id="progress-photos-title">Ảnh tiến độ</h2><p>Ảnh riêng tư được đồng bộ theo từng lần ghi nhận.</p></div><button type="button" onClick={onOpenCheckIn}><Camera /> Ghi nhận</button></header>
    {frontPhoto ? <div className="progress-v2-photos__preview"><img src={frontPhoto.imageUrl} alt="Trước" loading="eager" /><div><span>Chính diện</span><strong>{formatDate(frontPhoto.date)}</strong></div></div> : <div className="progress-v2-empty"><ImageIcon /><strong>Chưa có ảnh cho góc Chính diện</strong><span>Thêm ảnh đầu tiên để theo dõi thay đổi vóc dáng.</span><button type="button" onClick={onOpenCheckIn}>Thêm ảnh</button></div>}
  </section>
}

function ProgressImage({ record, label }: { record?: ProgressCheckInRecord; label: string }) {
  const photo = photoFor(record)
  return <figure className={`progress-v2-journey__photo${photo ? ' has-photo' : ''}`}>
    {photo ? <img src={photo.imageUrl} alt={`${label} ngày ${formatDate(record?.date)}`} /> : <span><ImageIcon /><small>Chưa có ảnh</small></span>}
    <figcaption><span>{label}</span><strong>{formatDate(record?.date)}</strong></figcaption>
  </figure>
}

function JourneyHero({ baseline, latest, onOpenCheckIn }: { baseline?: ProgressCheckInRecord; latest?: ProgressCheckInRecord; onOpenCheckIn: () => void }) {
  const deltas = [
    { label: 'Cân nặng', value: baseline && latest && positive(baseline.weightKg) && positive(latest.weightKg) ? Number(latest.weightKg) - Number(baseline.weightKg) : null, unit: 'kg' },
    { label: 'Vòng eo', value: baseline && latest && positive(baseline.waistCm) && positive(latest.waistCm) ? Number(latest.waistCm) - Number(baseline.waistCm) : null, unit: 'cm' },
    { label: 'Mỡ cơ thể', value: baseline && latest && positive(baseline.bodyFatPercentage) && positive(latest.bodyFatPercentage) ? Number(latest.bodyFatPercentage) - Number(baseline.bodyFatPercentage) : null, unit: '%' },
  ]
  const hasComparison = Boolean(baseline && latest && baseline.id !== latest.id)

  return <section className="progress-v2-journey" aria-labelledby="progress-journey-title">
    <div className="progress-v2-journey__heading">
      <div><h2 id="progress-journey-title">Hành trình của bạn</h2><p>{hasComparison ? 'So sánh lần đầu và lần gần nhất trong khoảng đang xem.' : 'Ghi nhận ít nhất hai lần để nhìn thấy thay đổi.'}</p></div>
      <button type="button" onClick={onOpenCheckIn}><Camera /> Ghi nhận</button>
    </div>
    <div className="progress-v2-journey__visual">
      <ProgressImage record={baseline} label="Trước" />
      <span className="progress-v2-journey__connector" aria-hidden="true"><ArrowRight /></span>
      <ProgressImage record={latest} label="Hiện tại" />
    </div>
    <div className="progress-v2-journey__changes">
      {deltas.map((item) => <div key={item.label}><span>{item.label}</span><strong>{changeCopy(item.value, item.unit)}</strong></div>)}
    </div>
  </section>
}

function BodyTrend({ records }: { records: ProgressCheckInRecord[] }) {
  const [metricId, setMetricId] = useState<MetricId>('weightKg')
  const metric = metricDefinitions.find((item) => item.id === metricId) || metricDefinitions[0]
  const points = useMemo(() => records
    .map((record) => ({ date: record.date, value: positive(record[metricId]) }))
    .filter((item): item is { date: string; value: number } => item.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date)), [metricId, records])
  const geometry = useMemo(() => {
    if (points.length < 2) return null
    const min = Math.min(...points.map((item) => item.value))
    const max = Math.max(...points.map((item) => item.value))
    const range = Math.max(1, max - min)
    const coords = points.map((item, index) => ({ ...item, x: 24 + index * (572 / Math.max(1, points.length - 1)), y: 184 - ((item.value - min) / range) * 142 }))
    return { coords, path: coords.map((item, index) => `${index ? 'L' : 'M'} ${item.x} ${item.y}`).join(' ') }
  }, [points])

  return <section className="progress-v2-section progress-v2-trend" aria-labelledby="body-trend-title">
    <header><div><h2 id="body-trend-title">Xu hướng cơ thể</h2><p>Chọn một chỉ số để xem thay đổi qua từng lần ghi nhận.</p></div></header>
    <div className="progress-v2-metric-tabs" role="tablist" aria-label="Chọn chỉ số cơ thể">
      {metricDefinitions.map((item) => <button type="button" role="tab" aria-selected={metricId === item.id} className={metricId === item.id ? 'is-active' : ''} onClick={() => setMetricId(item.id)} key={item.id}>{item.label}</button>)}
    </div>
    {geometry ? <div className="progress-v2-chart">
      <div className="progress-v2-chart__summary"><strong>{points.at(-1)?.value.toFixed(1)} {metric.unit}</strong><span>{formatDate(points.at(-1)?.date)}</span></div>
      <svg viewBox="0 0 620 220" role="img" aria-label={`Biểu đồ ${metric.label.toLowerCase()}`} preserveAspectRatio="none">
        <defs><linearGradient id="progress-line-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d90068" stopOpacity=".2" /><stop offset="1" stopColor="#d90068" stopOpacity="0" /></linearGradient></defs>
        {[42, 89, 136, 183].map((y) => <line key={y} x1="24" y1={y} x2="596" y2={y} stroke="#e7e4e8" strokeWidth="1" />)}
        <path d={`${geometry.path} L 596 202 L 24 202 Z`} fill="url(#progress-line-fill)" />
        <path d={geometry.path} fill="none" stroke="#d90068" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {geometry.coords.map((item) => <circle key={`${item.date}-${item.value}`} cx={item.x} cy={item.y} r="5" fill="#fff" stroke="#d90068" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="progress-v2-chart__dates"><span>{formatDate(points[0].date)}</span><span>{formatDate(points.at(-1)?.date)}</span></div>
    </div> : <div className="progress-v2-empty"><CircleGauge /><strong>Chưa đủ dữ liệu {metric.label.toLowerCase()}</strong><span>Cần ít nhất hai lần ghi nhận chỉ số này để tạo biểu đồ.</span></div>}
  </section>
}

function CheckInHistory({ records, onOpenCheckIn }: { records: ProgressCheckInRecord[]; onOpenCheckIn: () => void }) {
  if (!records.length) return <section className="progress-v2-section"><div className="progress-v2-empty"><Camera /><strong>Chưa có lần ghi nhận</strong><span>Thêm ảnh hoặc số đo đầu tiên để bắt đầu hành trình.</span><button type="button" onClick={onOpenCheckIn}>Ghi nhận tiến độ</button></div></section>
  return <section className="progress-v2-section progress-v2-history" aria-labelledby="progress-history-title">
    <header><div><h2 id="progress-history-title">Các lần ghi nhận</h2><p>Mỗi ngày chỉ hiển thị một bản gồm toàn bộ ảnh và số đo liên quan.</p></div><span>{records.length} lần</span></header>
    <div className="progress-v2-history__list">
      {records.map((record) => {
        const measurements = allMeasurementDefinitions.filter((item) => positive(record[item.id]) !== null)
        return <article key={record.id}>
          <div className="progress-v2-history__media">
            {record.photos?.slice(0, 4).map((photo) => <img key={photo.id || photo.angle} src={photo.imageUrl} alt={`Ảnh ${photo.angle} ngày ${formatDate(record.date)}`} loading="lazy" />)}
            {!record.photos?.length && <span><Ruler /></span>}
          </div>
          <div className="progress-v2-history__copy"><time>{formatDate(record.date)}</time><strong>{record.photos?.length || 0} ảnh · {measurements.length} chỉ số</strong><small>{record.verificationStatus === 'verified' ? 'PT đã xác nhận' : record.source === 'legacy' ? 'Dữ liệu cũ' : 'Học viên tự ghi'}</small>{record.measurementNote && <p>{record.measurementNote}</p>}</div>
          <div className="progress-v2-history__metrics">{measurements.slice(0, 4).map((item) => <span key={String(item.id)}>{item.label}<b>{positive(record[item.id])} {item.unit}</b></span>)}</div>
        </article>
      })}
    </div>
  </section>
}

export default function ProgressPage({
  loading = false,
  error = null,
  onNavigate,
  ownerId = 'demo',
  weightKg,
  targetWeightDeltaKg,
  targetTimeframeMonths,
  nutritionProfile = null,
}: ProgressPageProps) {
  const [period, setPeriod] = useState<ProgressPeriod>('30-days')
  const [category, setCategory] = useState<ProgressCategory>('overview')
  const [coachOpen, setCoachOpen] = useState(false)
  const resolvedOwnerId = ownerId?.trim() || firebaseAuth?.currentUser?.uid || 'demo'
  const isDemo = resolvedOwnerId === 'demo'
  const recentNutritionFromDate = useMemo(() => daysAgoKey(period === '7-days' ? 7 : period === '90-days' ? 90 : 30), [period])

  const [allMeals, setAllMeals] = useState<any[]>(() => readLocal(`aura:nutrition:meals:v2:${resolvedOwnerId}`, []))
  const [allActivities, setAllActivities] = useState<any[]>(() => readLocal(`aura:nutrition:activities:v1:${resolvedOwnerId}`, []))
  const [allWater, setAllWater] = useState<any[]>(() => readLocal(`aura:nutrition:water-entries:v1:${resolvedOwnerId}`, []))
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>(() => readLocal(`aura:progress:weight-records:${resolvedOwnerId}`, []))
  const emptyMetrics: BodyMeasurements = { bmi: 0, bmiCategory: 'Chưa cập nhật', bodyFatPercentage: 0, bodyFatStatus: 'Chưa cập nhật', muscleMassKg: 0, muscleStatus: 'Chưa cập nhật', waistCm: 0, waistStatus: 'Chưa cập nhật', updatedAt: '' }
  const [bodyMetrics, setBodyMetrics] = useState<BodyMeasurements>(() => readLocal(`aura:progress:body-measurements:${resolvedOwnerId}`, emptyMetrics))
  const [canonicalCheckIns, setCanonicalCheckIns] = useState<ProgressCheckInRecord[]>(() => readLocal(`aura:cache:user_progress_checkins:${resolvedOwnerId}`, []))
  const [legacyPhotos, setLegacyPhotos] = useState<LegacyPhoto[]>(() => readCachedPhotos(resolvedOwnerId))
  const [loyalty, setLoyalty] = useState<LoyaltyDashboard | null>(isDemo ? demoLoyaltyDashboard() : null)

  useEffect(() => {
    const refreshLocal = () => {
      setAllMeals(readLocal(`aura:nutrition:meals:v2:${resolvedOwnerId}`, []))
      setAllActivities(readLocal(`aura:nutrition:activities:v1:${resolvedOwnerId}`, []))
      setAllWater(readLocal(`aura:nutrition:water-entries:v1:${resolvedOwnerId}`, []))
    }
    refreshLocal()
    window.addEventListener('storage', refreshLocal)
    window.addEventListener('aura:nutrition:updated', refreshLocal)
    if (isDemo || resolvedOwnerId === 'anonymous') return () => {
      window.removeEventListener('storage', refreshLocal)
      window.removeEventListener('aura:nutrition:updated', refreshLocal)
    }
    const unsubscribers = [
      subscribeToRecentUserMealLogs(resolvedOwnerId, recentNutritionFromDate, setAllMeals),
      subscribeToRecentUserWaterLogs(resolvedOwnerId, recentNutritionFromDate, setAllWater),
      subscribeToRecentUserActivityLogs(resolvedOwnerId, recentNutritionFromDate, setAllActivities),
    ]
    return () => {
      window.removeEventListener('storage', refreshLocal)
      window.removeEventListener('aura:nutrition:updated', refreshLocal)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [isDemo, recentNutritionFromDate, resolvedOwnerId])

  useEffect(() => {
    setWeightRecords(readLocal(`aura:progress:weight-records:${resolvedOwnerId}`, []))
    setBodyMetrics(readLocal(`aura:progress:body-measurements:${resolvedOwnerId}`, emptyMetrics))
    setCanonicalCheckIns(readLocal(`aura:cache:user_progress_checkins:${resolvedOwnerId}`, []))
    setLegacyPhotos(readCachedPhotos(resolvedOwnerId))
    const refreshProgressPhotos = () => setLegacyPhotos(readCachedPhotos(resolvedOwnerId))
    window.addEventListener('aura:progress-photos-updated', refreshProgressPhotos)
    if (isDemo || resolvedOwnerId === 'anonymous') return () => window.removeEventListener('aura:progress-photos-updated', refreshProgressPhotos)
    const unsubscribers = [
      subscribeToUserWeightLogs(resolvedOwnerId, (rows) => {
        const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))
        setWeightRecords(sorted)
        safeLocalStorageSet(`aura:progress:weight-records:${resolvedOwnerId}`, JSON.stringify(sorted))
      }),
      subscribeToUserBodyMeasurements(resolvedOwnerId, (value) => {
        if (!value) return
        setBodyMetrics(value)
        safeLocalStorageSet(`aura:progress:body-measurements:${resolvedOwnerId}`, JSON.stringify(value))
      }),
      subscribeToUserProgressCheckIns(resolvedOwnerId, setCanonicalCheckIns),
      subscribeToUserProgressPhotos(resolvedOwnerId, setLegacyPhotos),
    ]
    return () => {
      window.removeEventListener('aura:progress-photos-updated', refreshProgressPhotos)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [isDemo, resolvedOwnerId])

  useEffect(() => {
    let active = true
    if (isDemo) {
      setLoyalty(demoLoyaltyDashboard())
      return () => { active = false }
    }
    getMyLoyaltyDashboard().then((value) => { if (active) setLoyalty(value) }).catch(() => { if (active) setLoyalty(null) })
    return () => { active = false }
  }, [isDemo])

  useEffect(() => {
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return undefined
    const timer = window.setTimeout(prewarmAiCoachAppCheck, 1_500)
    return () => window.clearTimeout(timer)
  }, [])

  const checkIns = useMemo(() => {
    const records = new Map<string, ProgressCheckInRecord>()
    canonicalCheckIns.forEach((item) => {
      const id = item.checkInId || item.id
      records.set(id, { ...item, id, checkInId: id, photos: Array.isArray(item.photos) ? item.photos.filter((photo) => photo?.imageUrl) : [] })
    })
    const groupedLegacy = new Map<string, LegacyPhoto[]>()
    legacyPhotos.forEach((photo) => {
      if (!photo?.imageUrl) return
      const date = String(photo.date || photo.recordedAt || '').slice(0, 10)
      const key = photo.checkInId || `legacy-${date}`
      groupedLegacy.set(key, [...(groupedLegacy.get(key) || []), photo])
    })
    groupedLegacy.forEach((photos, id) => {
      if (records.has(id)) return
      const sample = photos[0]
      records.set(id, {
        id, checkInId: id, date: String(sample.date || sample.recordedAt || '').slice(0, 10), source: 'legacy', verificationStatus: 'self_reported',
        weightKg: positive(sample.weightKg) || undefined,
        bodyFatPercentage: positive(sample.bodyFatPercentage ?? (sample as any).bodyFat) || undefined,
        muscleMassKg: positive(sample.muscleMassKg) || undefined,
        waistCm: positive(sample.waistCm) || undefined,
        hipsCm: positive(sample.hipsCm) || undefined,
        thighCm: positive(sample.thighCm) || undefined,
        armCm: positive(sample.armCm) || undefined,
        chestCm: positive(sample.chestCm) || undefined,
        measurementNote: sample.measurementNote,
        photos: photos.slice(0, 4).map((photo) => ({ id: photo.id, angle: normalizeAngle(photo.angle), imageUrl: String(photo.imageUrl) })),
      })
    })
    weightRecords.forEach((weight) => {
      const matching = [...records.values()].find((record) => record.id === weight.id || record.date === weight.date)
      if (matching) {
        if (!positive(matching.weightKg)) matching.weightKg = weight.weightKg
        return
      }
      records.set(weight.id, { id: weight.id, checkInId: weight.id, date: weight.date, weightKg: weight.weightKg, measurementNote: weight.note, photos: [], source: 'legacy', verificationStatus: 'self_reported' })
    })
    if (bodyMetrics.updatedAt) {
      const matching = [...records.values()].find((record) => record.date === bodyMetrics.updatedAt)
      if (matching) Object.assign(matching, Object.fromEntries(allMeasurementDefinitions.flatMap((item) => positive(bodyMetrics[item.id as keyof BodyMeasurements]) ? [[item.id, bodyMetrics[item.id as keyof BodyMeasurements]]] : [])))
    }
    return [...records.values()].filter((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.date)).sort((a, b) => b.date.localeCompare(a.date))
  }, [bodyMetrics, canonicalCheckIns, legacyPhotos, weightRecords])

  const days = period === '7-days' ? 7 : period === '90-days' ? 90 : 30
  const periodStart = daysAgoKey(days)
  const periodCheckIns = checkIns.filter((record) => record.date >= periodStart)
  const latest = periodCheckIns[0]
  const baseline = periodCheckIns.length > 1 ? periodCheckIns.at(-1) : undefined
  const baseWeight = weightKg ?? nutritionProfile?.weightKg ?? 0
  const sortedWeights = [...weightRecords].sort((a, b) => a.date.localeCompare(b.date))
  const currentWeight = positive(latest?.weightKg) ?? positive(sortedWeights.at(-1)?.weightKg) ?? baseWeight
  const startWeight = positive(sortedWeights[0]?.weightKg) ?? positive(checkIns.at(-1)?.weightKg) ?? baseWeight
  const configuredTargetDelta = targetWeightDeltaKg ?? nutritionProfile?.targetWeightDeltaKg ?? null
  const goalWeight = nutritionProfile?.targetWeightKg ?? (startWeight && configuredTargetDelta !== null ? Number((startWeight + configuredTargetDelta).toFixed(1)) : 0)
  const actual30DayWeight = recentAverageWeight(weightRecords, currentWeight || baseWeight)
  const nutritionTargets = resolveDailyNutritionTargets(nutritionProfile, actual30DayWeight > 0 ? actual30DayWeight : undefined)

  const periodSummary = useMemo(() => {
    const meals = allMeals.filter((meal: any) => (!meal.status || meal.status === 'logged') && meal.date >= periodStart)
    const mealDays = completeMealDates(meals, nutritionProfile?.mealsPerDay || 3).size
    const waterByDate = new Map<string, number>()
    allWater.filter((entry: any) => entry.date >= periodStart).forEach((entry: any) => waterByDate.set(entry.date, (waterByDate.get(entry.date) || 0) + (Number(entry.amountMl) || 0)))
    const waterDays = [...waterByDate.values()].filter((amount) => nutritionTargets.waterGoal > 0 && amount >= nutritionTargets.waterGoal * .8).length
    const activityDays = new Set(allActivities.filter((entry: any) => entry.date >= periodStart).map((entry: any) => entry.date)).size
    const expectedActivities = Math.max(1, Math.round(days * ((nutritionProfile?.trainingSessions || 3) / 7)))
    const adherence = Math.round(Math.min(100, mealDays / days * 100) * .5 + Math.min(100, activityDays / expectedActivities * 100) * .3 + Math.min(100, waterDays / days * 100) * .2)
    return { mealDays, waterDays, activityDays, expectedActivities, adherence }
  }, [allActivities, allMeals, allWater, days, nutritionProfile?.mealsPerDay, nutritionProfile?.trainingSessions, nutritionTargets.waterGoal, periodStart])

  const latestDateAge = latest ? Math.max(0, Math.floor((Date.now() - new Date(`${latest.date}T12:00:00`).getTime()) / 86_400_000)) : null
  const nextMission = loyalty?.missions.find((mission) => mission.status !== 'completed' && mission.status !== 'claimed') || loyalty?.missions[0]
  const recognition = loyalty?.recognition
  const targetDateText = useMemo(() => {
    const months = targetTimeframeMonths ?? nutritionProfile?.targetTimeframeMonths
    if (!months || months <= 0) return 'Chưa đặt thời hạn'
    const anchor = sortedWeights[0]?.date ? new Date(`${sortedWeights[0].date}T12:00:00`) : new Date()
    anchor.setMonth(anchor.getMonth() + months)
    return formatDate(toLocalDateKey(anchor))
  }, [nutritionProfile?.targetTimeframeMonths, sortedWeights, targetTimeframeMonths])

  const openCheckIn = () => onNavigate?.('progress-photo-studio')
  const insight = latestDateAge === null
    ? 'Ghi nhận ảnh hoặc số đo đầu tiên để Aura bắt đầu theo dõi thay đổi.'
    : latestDateAge > 14
      ? `Lần ghi nhận gần nhất đã cách ${latestDateAge} ngày. Một lần cập nhật mới sẽ giúp so sánh chính xác hơn.`
      : baseline && latest && positive(baseline.waistCm) && positive(latest.waistCm)
        ? `Vòng eo thay đổi ${changeCopy(Number(latest.waistCm) - Number(baseline.waistCm), 'cm')} trong khoảng đang xem.`
        : 'Dữ liệu mới đã được ghi nhận. Tiếp tục duy trì cùng điều kiện đo để so sánh đáng tin cậy.'

  return <section className="progress-center-page progress-v2-page" aria-label="Tiến độ cơ thể">
    {loading && <div className="pg-data-state is-loading" role="status"><LoaderCircle className="spin" /><span>Đang đồng bộ tiến độ…</span></div>}
    {!loading && error && <div className="pg-data-state is-error" role="alert"><AlertCircle /><span>{error}</span></div>}

    <header className="progress-v2-header">
      <div><h1>Tiến độ</h1><p>Nhìn lại thay đổi của cơ thể và mức độ bám kế hoạch.</p></div>
      <button type="button" onClick={openCheckIn}><Camera /> Ghi nhận tiến độ</button>
    </header>

    <div className="progress-v2-controls">
      <div className="progress-v2-period" role="group" aria-label="Khoảng thời gian">
        {([['7-days', '7 ngày'], ['30-days', '30 ngày'], ['90-days', '90 ngày']] as const).map(([id, label]) => <button type="button" className={period === id ? 'is-active' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)} key={id}>{label}</button>)}
      </div>
      <nav className="progress-v2-tabs" aria-label="Nội dung tiến độ">
        {([['overview', 'Tổng quan'], ['body', 'Cơ thể'], ['history', 'Nhật ký']] as const).map(([id, label]) => <button type="button" className={category === id ? 'is-active' : ''} aria-current={category === id ? 'page' : undefined} onClick={() => setCategory(id)} key={id}>{label}</button>)}
      </nav>
    </div>

    {category === 'overview' && <div className="progress-v2-stack">
      <JourneyHero baseline={baseline} latest={latest} onOpenCheckIn={openCheckIn} />
      <section className="progress-v2-section progress-v2-goal" aria-labelledby="progress-goal-title">
        <header><div><h2 id="progress-goal-title">Mục tiêu cơ thể</h2><p>{goalWeight > 0 ? `Dự kiến đến ${targetDateText}` : 'Bổ sung mục tiêu trong hồ sơ để theo dõi chính xác.'}</p></div><Target /></header>
        <div><span><small>Bắt đầu</small><strong>{startWeight ? `${startWeight.toFixed(1)} kg` : '—'}</strong></span><i /><span><small>Hiện tại</small><strong>{currentWeight ? `${currentWeight.toFixed(1)} kg` : '—'}</strong></span><i /><span><small>Mục tiêu</small><strong>{goalWeight > 0 ? `${goalWeight.toFixed(1)} kg` : '—'}</strong></span></div>
      </section>
      <section className="progress-v2-section progress-v2-adherence" aria-labelledby="progress-adherence-title">
        <header><div><h2 id="progress-adherence-title">Bám kế hoạch</h2><p>Dựa trên những ngày đã ghi nhận trong {days} ngày gần nhất.</p></div><strong>{periodSummary.adherence}%</strong></header>
        <div className="progress-v2-adherence__rows">
          <div><Utensils /><span><strong>Dinh dưỡng</strong><small>{periodSummary.mealDays}/{days} ngày đủ khung bữa</small></span></div>
          <div><Dumbbell /><span><strong>Vận động</strong><small>{periodSummary.activityDays}/{periodSummary.expectedActivities} ngày mục tiêu</small></span></div>
          <div><Waves /><span><strong>Nước uống</strong><small>{periodSummary.waterDays}/{days} ngày đạt ít nhất 80%</small></span></div>
        </div>
      </section>
      <section className="progress-v2-insight" aria-labelledby="progress-insight-title"><Sparkles /><div><h2 id="progress-insight-title">Điều đáng chú ý</h2><p>{insight}</p></div><button type="button" onPointerEnter={prewarmAiCoachAppCheck} onFocus={prewarmAiCoachAppCheck} onClick={() => setCoachOpen(true)}>Trao đổi với Aura <ChevronRight /></button></section>
      <section className="progress-v2-section progress-v2-club" aria-labelledby="progress-club-title">
        <header><div><h2 id="progress-club-title">Aura Club</h2><p>Thành tích và quyền lợi dùng cùng dữ liệu đã được Aura xác minh.</p></div><button type="button" onClick={() => onNavigate?.('aura-club')}>Mở Aura Club <ChevronRight /></button></header>
        {nextMission ? <div className="progress-v2-club__mission"><CheckCircle2 /><span><strong>{nextMission.title || 'Nhiệm vụ Aura'}</strong><small>{Number(nextMission.progress || 0)}/{Math.max(1, Number(nextMission.target || 1))} · +{Number(nextMission.rewardPoints || 0)} Điểm Aura</small></span><i><b style={{ width: `${Math.min(100, Number(nextMission.progress || 0) / Math.max(1, Number(nextMission.target || 1)) * 100)}%` }} /></i></div> : <div className="progress-v2-club__empty">Chưa có nhiệm vụ đang hoạt động.</div>}
        <div className="progress-v2-club__stats"><span><strong>{recognition?.totalXp || 0}</strong><small>XP động lực</small></span><span><strong>{recognition?.totalKudos || 0}</strong><small>lời khen từ PT</small></span><span><strong>{recognition?.badges.length || 0}</strong><small>huy hiệu xác minh</small></span></div>
      </section>
    </div>}

    {category === 'body' && <div className="progress-v2-stack">
      <BodyTrend records={periodCheckIns} />
      <section className="progress-v2-section progress-v2-measurements" aria-labelledby="latest-measurements-title">
        <header><div><h2 id="latest-measurements-title">Số đo gần nhất</h2><p>{latest ? `Ghi nhận ngày ${formatDate(latest.date)}` : 'Chưa có dữ liệu cơ thể.'}</p></div><Ruler /></header>
        <div>{allMeasurementDefinitions.map((item) => <span key={String(item.id)}><small>{item.label}</small><strong>{positive(latest?.[item.id]) ?? '—'}{positive(latest?.[item.id]) ? ` ${item.unit}` : ''}</strong></span>)}</div>
      </section>
      <ProgressPhotoGallery records={periodCheckIns} legacyPhotos={legacyPhotos} onOpenCheckIn={openCheckIn} />
    </div>}

    {category === 'history' && <CheckInHistory records={checkIns} onOpenCheckIn={openCheckIn} />}
    {coachOpen && <AiCoachBottomSheet onClose={() => setCoachOpen(false)} conversationScope={`progress-${resolvedOwnerId}`} />}
  </section>
}
