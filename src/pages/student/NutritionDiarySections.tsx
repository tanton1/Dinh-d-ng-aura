import { useMemo, useState, type ReactNode } from 'react'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Database, Droplets, Dumbbell, MoreHorizontal, Plus, Salad, Sparkles, Target, Trash2, Utensils, X } from 'lucide-react'
import MealImage from '../../components/nutrition/MealImage'
import type { NutritionDiaryPageProps, NutritionMealEntry, NutritionActivityEntry, NutritionWaterEntry } from './NutritionWorkspace'
import './NutritionDiaryCompact.css'
import { MEAL_TYPE_LABELS, INTENSITY_LABELS, formatNumber, clampPercent, confidenceCopy } from '../../features/nutrition/presentation'

type DiaryTimelineEntry =
  | { kind: 'meal'; id: string; time: string; item: NutritionMealEntry }
  | { kind: 'activity'; id: string; time: string; item: NutritionActivityEntry }
  | { kind: 'water'; id: string; time: string; item: NutritionWaterEntry }

type DiaryFilter = 'all' | 'meal' | 'water' | 'activity' | 'review'
type DiaryView = 'day' | 'week' | 'month'

const DIARY_FILTERS: Array<{ id: DiaryFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'meal', label: 'Bữa ăn' },
  { id: 'water', label: 'Nước' },
  { id: 'activity', label: 'Vận động' },
  { id: 'review', label: 'Cần kiểm tra' },
]

const DIARY_VIEWS: Array<{ id: DiaryView; label: string }> = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
]

function parseDiaryDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, Math.max(0, month - 1), day || 1, 12, 0, 0, 0)
}

function diaryDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDiaryDate(dateKey: string, amount: number, unit: DiaryView) {
  const date = parseDiaryDate(dateKey)
  if (unit === 'day') date.setDate(date.getDate() + amount)
  if (unit === 'week') date.setDate(date.getDate() + amount * 7)
  if (unit === 'month') {
    const currentDay = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + amount)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(currentDay, lastDay))
  }
  return diaryDateKey(date)
}

function diaryWeekKeys(dateKey: string) {
  const date = parseDiaryDate(dateKey)
  const weekday = date.getDay()
  date.setDate(date.getDate() - (weekday === 0 ? 6 : weekday - 1))
  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(date)
    item.setDate(date.getDate() + index)
    return diaryDateKey(item)
  })
}

function diaryMonthKeys(dateKey: string) {
  const date = parseDiaryDate(dateKey)
  const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Array.from({ length: total }, (_, index) => diaryDateKey(new Date(date.getFullYear(), date.getMonth(), index + 1, 12)))
}

function diaryPeriodKeys(dateKey: string, view: DiaryView) {
  if (view === 'week') return diaryWeekKeys(dateKey)
  if (view === 'month') return diaryMonthKeys(dateKey)
  return [dateKey]
}

function shortDiaryDate(dateKey: string, includeWeekday = false) {
  return new Intl.DateTimeFormat('vi-VN', includeWeekday
    ? { weekday: 'short', day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit' }).format(parseDiaryDate(dateKey))
}

export function NutritionDiaryPage({
  dateKey,
  dateLabel,
  todayKey,
  historyFromDate,
  daySummaries,
  targets,
  meals,
  activities,
  waterEntries = [],
  waterMl,
  onSelectDate,
  onGoToday,
  onAddMeal,
  onAddWater,
  onAddExercise,
  onOpenMeal,
  onEditMeal,
  onDeleteMeal,
  onDeleteActivity,
  onDeleteWater,
}: NutritionDiaryPageProps) {
  const [activeFilter, setActiveFilter] = useState<DiaryFilter>('all')
  const [activeView, setActiveView] = useState<DiaryView>('day')
  const totals = useMemo(() => meals.reduce((result, meal) => ({
    calories: result.calories + meal.calories,
    protein: result.protein + meal.protein,
    carbs: result.carbs + meal.carbs,
    fat: result.fat + meal.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals])

  const timeline = useMemo<DiaryTimelineEntry[]>(() => [
    ...meals.map((item) => ({ kind: 'meal' as const, id: `meal-${item.id}`, time: item.time, item })),
    ...activities.map((item) => ({ kind: 'activity' as const, id: `activity-${item.id}`, time: item.time, item })),
    ...waterEntries.map((item) => ({ kind: 'water' as const, id: `water-${item.id}`, time: item.time, item })),
  ].sort((left, right) => left.time.localeCompare(right.time)), [activities, meals, waterEntries])

  const filteredTimeline = useMemo(() => timeline.filter((event) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'review') return event.kind === 'meal' && (event.item.reviewStatus === 'pending' || event.item.reviewStatus === 'rejected' || event.item.confidence !== 'verified')
    return event.kind === activeFilter
  }), [activeFilter, timeline])
  const needsReviewCount = useMemo(() => meals.filter((meal) => meal.reviewStatus === 'pending' || meal.reviewStatus === 'rejected' || meal.confidence !== 'verified').length, [meals])
  const summaryByDate = useMemo(() => new Map(daySummaries.map((item) => [item.date, item])), [daySummaries])
  const visibleDateKeys = diaryPeriodKeys(dateKey, activeView)
  const periodSummary = visibleDateKeys.reduce((result, item) => {
    const summary = summaryByDate.get(item)
    if (!summary) return result
    result.mealCount += summary.mealCount
    result.calories += summary.calories
    result.protein += summary.protein
    result.waterMl += summary.waterMl
    result.activityCount += summary.activityCount
    result.reviewCount += summary.reviewCount
    result.loggedDays += summary.mealCount || summary.waterMl || summary.activityCount ? 1 : 0
    return result
  }, { mealCount: 0, calories: 0, protein: 0, waterMl: 0, activityCount: 0, reviewCount: 0, loggedDays: 0 })
  const shiftedBack = shiftDiaryDate(dateKey, -1, activeView)
  const shiftedForward = shiftDiaryDate(dateKey, 1, activeView)
  const eligibleDates = (anchorDateKey: string) => diaryPeriodKeys(anchorDateKey, activeView)
    .filter((item) => item >= historyFromDate && item <= todayKey)
  const canShiftBack = eligibleDates(shiftedBack).length > 0
  const canShiftForward = eligibleDates(shiftedForward).length > 0
  const periodLabel = activeView === 'day'
    ? dateLabel
    : activeView === 'week'
      ? `${shortDiaryDate(visibleDateKeys[0])} – ${shortDiaryDate(visibleDateKeys[visibleDateKeys.length - 1])}`
      : new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(parseDiaryDate(dateKey))
  const summaryMeals = activeView === 'day' ? meals.length : periodSummary.mealCount
  const summaryCalories = activeView === 'day' ? totals.calories : periodSummary.calories
  const summaryProtein = activeView === 'day' ? totals.protein : periodSummary.protein
  const summaryWater = activeView === 'day' ? waterMl : periodSummary.waterMl
  const summaryReviewCount = activeView === 'day' ? needsReviewCount : periodSummary.reviewCount
  const eligiblePeriodDays = visibleDateKeys.filter((item) => item >= historyFromDate && item <= todayKey).length
  const overviewProgress = activeView === 'day'
    ? clampPercent(summaryCalories, targets.calories)
    : clampPercent(periodSummary.loggedDays, eligiblePeriodDays)
  const overviewHint = activeView === 'day'
    ? `${Math.round(overviewProgress)}% mục tiêu năng lượng trong ngày`
    : `${periodSummary.loggedDays}/${eligiblePeriodDays} ngày đã có dữ liệu`

  const chooseDate = (nextDateKey: string) => {
    if (nextDateKey < historyFromDate || nextDateKey > todayKey) return
    onSelectDate(nextDateKey)
  }

  const shiftPeriod = (direction: -1 | 1) => {
    const next = direction < 0 ? shiftedBack : shiftedForward
    if ((direction < 0 && !canShiftBack) || (direction > 0 && !canShiftForward)) return
    const eligible = eligibleDates(next)
    const boundedNext = next < historyFromDate ? eligible[0] : next > todayKey ? eligible[eligible.length - 1] : next
    chooseDate(boundedNext)
  }

  const openDay = (nextDateKey: string) => {
    chooseDate(nextDateKey)
    setActiveView('day')
  }

  return (
    <section className="nutrition-workspace-page nutrition-diary" id="nutrition-workspace-panel-diary" aria-label="Nhật ký dinh dưỡng">
      <header className="nutrition-diary-header">
        <div className="nutrition-diary-header__copy">
          <span className="nutrition-workspace-eyebrow">NHẬT KÝ DINH DƯỠNG</span>
          <h1>Tra cứu những gì bạn đã ghi</h1>
          <p>Bữa ăn, nước và vận động được lưu theo thời gian để dễ kiểm tra và chỉnh sửa.</p>
        </div>
        <div className="nutrition-diary-header__actions">
          <span><Sparkles size={15} /> Dữ liệu 90 ngày gần nhất</span>
          <button type="button" className="nutrition-diary-add" onClick={onAddMeal}><Plus size={18} /> Thêm bản ghi</button>
        </div>
      </header>

      <section className="nutrition-diary-toolbar" aria-label="Thời gian nhật ký">
        <div className="nutrition-diary-view-switch" role="tablist" aria-label="Chế độ xem nhật ký">
          {DIARY_VIEWS.map((view) => <button type="button" role="tab" aria-selected={activeView === view.id} className={activeView === view.id ? 'is-active' : ''} key={view.id} onClick={() => setActiveView(view.id)}>{view.label}</button>)}
        </div>
        <div className="nutrition-diary-date">
          <button type="button" onClick={() => shiftPeriod(-1)} disabled={!canShiftBack} aria-label={activeView === 'day' ? 'Ngày trước' : activeView === 'week' ? 'Tuần trước' : 'Tháng trước'}><ChevronLeft size={19} /></button>
          <strong>{periodLabel}</strong>
          <button type="button" onClick={() => shiftPeriod(1)} disabled={!canShiftForward} aria-label={activeView === 'day' ? 'Ngày sau' : activeView === 'week' ? 'Tuần sau' : 'Tháng sau'}><ChevronRight size={19} /></button>
        </div>
        <button type="button" className="nutrition-diary-today" onClick={onGoToday} disabled={dateKey === todayKey && activeView === 'day'}><CalendarDays size={17} /> Về hôm nay</button>
      </section>

      <section className="nutrition-diary-overview" aria-label={`Tóm tắt ${periodLabel}`}>
        <div className="nutrition-diary-overview__main">
          <span>{activeView === 'day' ? 'NĂNG LƯỢNG ĐÃ GHI' : 'TỔNG NĂNG LƯỢNG TRONG KỲ'}</span>
          <div><strong>{formatNumber(summaryCalories)}</strong><em>kcal</em></div>
          <p><CalendarDays size={15} /> {periodLabel}</p>
          <small>{overviewHint}</small>
        </div>
        <div className="nutrition-diary-overview__stats">
          <div><span><Utensils size={17} /></span><div><small>{activeView === 'day' ? 'Bữa ăn' : 'Tổng bữa'}</small><strong>{summaryMeals}</strong></div></div>
          <div><span><Salad size={17} /></span><div><small>Chất đạm</small><strong>{formatNumber(summaryProtein)}<em>g</em></strong></div></div>
          <div><span><Droplets size={17} /></span><div><small>Lượng nước</small><strong>{formatNumber(summaryWater)}<em>ml</em></strong></div></div>
          <div className={summaryReviewCount > 0 ? 'needs-attention' : ''}><span><CircleAlert size={17} /></span><div><small>{activeView === 'day' ? 'Cần kiểm tra' : 'Cần xem lại'}</small><strong>{summaryReviewCount}</strong></div></div>
        </div>
        <div className="nutrition-diary-overview__bar" aria-hidden="true"><span style={{ width: `${overviewProgress}%` }} /></div>
      </section>

      {activeView === 'week' && (
        <section className="nutrition-diary-period-list" aria-label="Nhật ký theo tuần">
          {visibleDateKeys.map((item) => {
            const summary = summaryByDate.get(item)
            const hasData = Boolean(summary && (summary.mealCount || summary.waterMl || summary.activityCount))
            return <button type="button" key={item} disabled={item > todayKey || item < historyFromDate} className={`${item === dateKey ? 'is-selected' : ''} ${item === todayKey ? 'is-today' : ''} ${hasData ? 'has-data' : ''}`.trim()} onClick={() => openDay(item)}><span><strong>{shortDiaryDate(item, true)}</strong>{item === todayKey && <small>Hôm nay</small>}</span><span>{summary?.mealCount ?? 0} bữa</span><span>{formatNumber(summary?.calories ?? 0)} kcal</span><span>{formatNumber(summary?.protein ?? 0)}g đạm</span><i aria-hidden="true" /></button>
          })}
        </section>
      )}

      {activeView === 'month' && (
        <section className="nutrition-diary-month" aria-label="Nhật ký theo tháng">
          <div className="nutrition-diary-month__weekdays" aria-hidden="true">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((item) => <span key={item}>{item}</span>)}</div>
          <div className="nutrition-diary-month__grid" style={{ '--diary-month-offset': parseDiaryDate(visibleDateKeys[0]).getDay() === 0 ? 7 : parseDiaryDate(visibleDateKeys[0]).getDay() } as React.CSSProperties}>
            {visibleDateKeys.map((item, index) => {
              const summary = summaryByDate.get(item)
              const hasData = Boolean(summary && (summary.mealCount || summary.waterMl || summary.activityCount))
              return <button type="button" key={item} disabled={item > todayKey || item < historyFromDate} className={`${index === 0 ? 'is-first' : ''} ${item === dateKey ? 'is-selected' : ''} ${item === todayKey ? 'is-today' : ''} ${hasData ? 'has-data' : ''}`.trim()} onClick={() => openDay(item)} aria-label={`${shortDiaryDate(item, true)}${hasData ? `, ${summary?.mealCount ?? 0} bữa` : ', chưa có dữ liệu'}`}><strong>{parseDiaryDate(item).getDate()}</strong><span>{summary?.mealCount ?? 0} bữa</span><i aria-hidden="true" /></button>
            })}
          </div>
          <p>Nhật ký tháng hiển thị dữ liệu trong 90 ngày gần nhất. Chọn một ngày để xem và chỉnh sửa chi tiết.</p>
        </section>
      )}

      {activeView === 'day' && <div className="nutrition-diary-layout">
        <div className="nutrition-diary-timeline">
          <div className="nutrition-workspace-section-heading">
            <div><span className="nutrition-workspace-eyebrow">CHI TIẾT TRONG NGÀY</span><h2>Dòng thời gian</h2><p>{timeline.length ? `${filteredTimeline.length}/${timeline.length} bản ghi đang hiển thị` : 'Chưa có bản ghi trong ngày này'}</p></div>
          </div>

          <div className="nutrition-diary-filters" aria-label="Lọc nhật ký">
            {DIARY_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={activeFilter === filter.id ? 'is-active' : ''}
                onClick={() => setActiveFilter(filter.id)}
                aria-pressed={activeFilter === filter.id}
              >
                {filter.label}{filter.id === 'review' && needsReviewCount > 0 ? <span>{needsReviewCount}</span> : null}
              </button>
            ))}
          </div>

          {timeline.length === 0 ? (
            <div className="nutrition-workspace-empty">
              <span><Utensils size={23} /></span>
              <h3>Bắt đầu bằng bữa ăn đầu tiên</h3>
              <p>Chụp ảnh hoặc ghi bữa ăn để theo dõi dinh dưỡng nhất quán hơn.</p>
              <button type="button" onClick={onAddMeal}><Plus size={16} /> Ghi bữa ăn</button>
            </div>
          ) : filteredTimeline.length === 0 ? (
            <div className="nutrition-workspace-empty nutrition-workspace-empty--compact">
              <span><Database size={23} /></span>
              <h3>Không có dữ liệu trong bộ lọc này</h3>
              <p>Chọn “Tất cả” hoặc ghi thêm dữ liệu để tiếp tục theo dõi.</p>
              <button type="button" onClick={() => setActiveFilter('all')}>Xem tất cả</button>
            </div>
          ) : (
            <ol className="nutrition-diary-events">
              {filteredTimeline.map((event) => {
                if (event.kind === 'meal') {
                  const meal = event.item
                  const statusLabel = meal.reviewStatus === 'approved' ? 'Đã duyệt' : meal.reviewStatus === 'pending' ? 'Chờ coach' : meal.reviewStatus === 'rejected' ? 'Cần chỉnh' : confidenceCopy(meal.confidence)
                  const statusTone = meal.reviewStatus === 'approved' ? 'reviewed' : meal.reviewStatus === 'pending' ? 'pending' : meal.reviewStatus === 'rejected' ? 'needs-review' : meal.confidence ?? 'verified'
                  return (
                    <li key={event.id} className="nutrition-diary-event nutrition-diary-event--meal">
                      <time>{meal.time}</time>
                      <span className="nutrition-diary-event__node"><Utensils size={16} /></span>
                      <article>
                        <div className="nutrition-diary-event__visual" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}>
                          <MealImage image={meal.image} storagePath={meal.imageStoragePath} fallback={<Salad size={22} />} />
                        </div>
                        <div className="nutrition-diary-event__content">
                          <div className="nutrition-diary-event__meta">
                            <span>{meal.label || MEAL_TYPE_LABELS[meal.type]}</span>
                            <span className={`nutrition-confidence nutrition-confidence--${statusTone}`}>{statusLabel}</span>
                          </div>
                          <button type="button" className="nutrition-diary-event__title" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button>
                          {meal.description && <p>{meal.description}</p>}
                          <div className="nutrition-diary-event__nutrition" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}><strong>{formatNumber(meal.calories)} kcal</strong><span>{formatNumber(meal.protein)}g P</span><span>{formatNumber(meal.carbs)}g C</span><span>{formatNumber(meal.fat)}g F</span></div>
                          {(meal.portionNote || meal.cookingNote || meal.sourceLabel) && <div className="nutrition-diary-event__evidence">{meal.portionNote && <span>Khẩu phần: {meal.portionNote}</span>}{meal.cookingNote && <span>Chế biến: {meal.cookingNote}</span>}{meal.sourceLabel && <span>Nguồn: {meal.sourceLabel}</span>}</div>}
                          {meal.coachFeedback && <p className="nutrition-diary-event__coach">Coach: {meal.coachFeedback}</p>}
                        </div>
                        {(onEditMeal || onDeleteMeal) && (
                          <details className="nutrition-diary-event__menu">
                            <summary aria-label={`Thao tác với ${meal.title}`}><MoreHorizontal size={19} /></summary>
                            <div>{onOpenMeal && <button type="button" onClick={() => onOpenMeal(meal.id)}>Xem chi tiết</button>}{onEditMeal && <button type="button" onClick={() => onEditMeal(meal.id)}>Sửa bản ghi</button>}{onDeleteMeal && <button type="button" className="is-danger" onClick={() => onDeleteMeal(meal.id)}><Trash2 size={15} /> Xóa</button>}</div>
                          </details>
                        )}
                      </article>
                    </li>
                  )
                }

                if (event.kind === 'activity') {
                  const activity = event.item
                  return (
                    <li key={event.id} className="nutrition-diary-event nutrition-diary-event--activity">
                      <time>{activity.time}</time>
                      <span className="nutrition-diary-event__node"><Activity size={16} /></span>
                      <article>
                        <span className="nutrition-diary-event__compact-icon"><Dumbbell size={20} /></span>
                        <div className="nutrition-diary-event__content">
                          <div className="nutrition-diary-event__meta"><span>LUYỆN TẬP</span><span>Ước tính riêng</span></div>
                          <strong className="nutrition-diary-event__plain-title">{activity.title}</strong>
                          <p>{activity.durationMinutes} phút · Cường độ {INTENSITY_LABELS[activity.intensity].toLowerCase()} · {formatNumber(activity.estimatedCalories)} kcal</p>
                        </div>
                        {onDeleteActivity && <details className="nutrition-diary-event__menu"><summary aria-label={`Thao tác với ${activity.title}`}><MoreHorizontal size={19} /></summary><div><button type="button" className="is-danger" onClick={() => onDeleteActivity(activity.id)}><Trash2 size={15} /> Xóa</button></div></details>}
                      </article>
                    </li>
                  )
                }

                return (
                  <li key={event.id} className="nutrition-diary-event nutrition-diary-event--water">
                    <time>{event.time}</time>
                    <span className="nutrition-diary-event__node"><Droplets size={16} /></span>
                    <article><span className="nutrition-diary-event__compact-icon"><Droplets size={20} /></span><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>NƯỚC</span></div><strong className="nutrition-diary-event__plain-title">+{formatNumber(event.item.amountMl)} ml</strong></div>{onDeleteWater && <details className="nutrition-diary-event__menu"><summary aria-label="Thao tác với lần ghi nước"><MoreHorizontal size={19} /></summary><div><button type="button" className="is-danger" onClick={() => onDeleteWater(event.item.id)}><Trash2 size={15} /> Xóa</button></div></details>}</article>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <aside className="nutrition-diary-quick" aria-label="Thêm bản ghi">
          <span className="nutrition-workspace-eyebrow">THÊM NHANH</span>
          <h2>Thêm bản ghi</h2>
          <p>Chọn loại dữ liệu cần bổ sung cho {dateLabel.toLocaleLowerCase('vi-VN')}.</p>
          <button type="button" onClick={onAddMeal}><span><Utensils size={18} /></span><div><strong>Bữa ăn</strong><small>Quét ảnh, tìm món hoặc nhập tay</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddWater}><span><Droplets size={18} /></span><div><strong>Nước</strong><small>Ghi đúng lượng đã uống</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddExercise}><span><Activity size={18} /></span><div><strong>Vận động</strong><small>Thời lượng và cường độ</small></div><ChevronRight size={17} /></button>
          <div className="nutrition-diary-quick__note"><CircleAlert size={15} /><p>Kcal vận động chỉ dùng để tham khảo, không tự cộng vào ngân sách ăn.</p></div>
        </aside>
      </div>}
    </section>
  )
}

interface NutritionMetricProgressProps {
  label: string
  value: number
  goal: number
  unit: string
  icon: ReactNode
  tone: 'energy' | 'protein' | 'carbs' | 'fat' | 'water'
}

function NutritionMetricProgress({ label, value, goal, unit, icon, tone }: NutritionMetricProgressProps) {
  const percent = clampPercent(value, goal)
  return (
    <div className={`nutrition-diary-metric nutrition-diary-metric--${tone}`}>
      <div className="nutrition-diary-metric__heading"><span>{icon}</span><div><small>{label}</small><strong>{formatNumber(value)}<em> / {formatNumber(goal)}{unit}</em></strong></div></div>
      <div className="nutrition-diary-metric__track" role="progressbar" aria-label={`${label}: ${value} trên ${goal}${unit}`} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(value, goal)}><span style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

export function NutritionClassicDiaryPage({
  dateKey,
  dateLabel,
  todayKey,
  historyFromDate,
  targets,
  meals,
  activities,
  waterEntries = [],
  waterMl,
  onSelectDate,
  onGoToday,
  onAddMeal,
  onAddWater,
  onAddExercise,
  onOpenMeal,
  onEditMeal,
  onDeleteMeal,
}: NutritionDiaryPageProps) {
  const totals = useMemo(() => meals.reduce((result, meal) => ({
    calories: result.calories + meal.calories,
    protein: result.protein + meal.protein,
    carbs: result.carbs + meal.carbs,
    fat: result.fat + meal.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals])
  const timeline = useMemo<DiaryTimelineEntry[]>(() => [
    ...meals.map((item) => ({ kind: 'meal' as const, id: `meal-${item.id}`, time: item.time, item })),
    ...activities.map((item) => ({ kind: 'activity' as const, id: `activity-${item.id}`, time: item.time, item })),
    ...waterEntries.map((item) => ({ kind: 'water' as const, id: `water-${item.id}`, time: item.time, item })),
  ].sort((left, right) => left.time.localeCompare(right.time)), [activities, meals, waterEntries])
  const remaining = targets.calories - totals.calories
  const reviewCount = meals.filter((meal) => meal.reviewStatus === 'pending' || meal.reviewStatus === 'rejected' || (meal.confidence && meal.confidence !== 'verified')).length
  const shiftDay = (direction: -1 | 1) => {
    const next = shiftDiaryDate(dateKey, direction, 'day')
    if (next >= historyFromDate && next <= todayKey) onSelectDate(next)
  }
  const assistantBrief = meals.length
    ? remaining > 0
      ? `Bạn còn khoảng ${formatNumber(remaining)} kcal. Aura sẽ ưu tiên món phù hợp với phần macro còn thiếu.`
      : `Bạn đã vượt mục tiêu khoảng ${formatNumber(Math.abs(remaining))} kcal. Hãy ưu tiên nước và bữa nhẹ giàu chất xơ.`
    : 'Chưa có bữa ăn nào trong ngày. Hãy ghi bữa đầu tiên để Aura bắt đầu phân tích.'

  return (
    <section className="nutrition-workspace-page nutrition-diary nutrition-diary--classic" id="nutrition-workspace-panel-classic-diary" aria-label="Nhật ký dinh dưỡng cổ điển">
      <header className="nutrition-workspace-page__header">
        <div><span className="nutrition-workspace-eyebrow">NHẬT KÝ NGÀY · GIAO DIỆN CŨ</span><h1>Mọi lựa chọn trong ngày</h1><p>Bữa ăn, nước và vận động được sắp theo đúng thời gian.</p></div>
        <div className="nutrition-diary-date"><button type="button" onClick={() => shiftDay(-1)} disabled={dateKey <= historyFromDate} aria-label="Ngày trước"><ChevronLeft size={18} /></button><strong>{dateLabel}</strong><button type="button" onClick={() => shiftDay(1)} disabled={dateKey >= todayKey} aria-label="Ngày sau"><ChevronRight size={18} /></button></div>
      </header>

      <section className="nutrition-diary-overview" aria-label="Tổng kết dinh dưỡng trong ngày">
        <div className="nutrition-diary-overview__main"><span>TỔNG KẾT TRONG NGÀY</span><div><strong>{remaining >= 0 ? formatNumber(remaining) : `+${formatNumber(Math.abs(remaining))}`}</strong><em>{remaining >= 0 ? 'kcal còn lại' : 'kcal vượt mục tiêu'}</em></div><p><CalendarDays size={15} /> {dateLabel}</p><small>{formatNumber(totals.calories)} / {formatNumber(targets.calories)} kcal đã ghi</small></div>
        <div className="nutrition-diary-overview__stats"><div><span><Target size={17} /></span><div><small>Tiến độ</small><strong>{clampPercent(totals.calories, targets.calories)}%</strong></div></div><div><span><Utensils size={17} /></span><div><small>Sự kiện</small><strong>{timeline.length}</strong></div></div><div className={reviewCount ? 'needs-attention' : ''}><span><CircleAlert size={17} /></span><div><small>Cần kiểm tra</small><strong>{reviewCount}</strong></div></div><div><span><Droplets size={17} /></span><div><small>Nước</small><strong>{formatNumber(waterMl)}<em>ml</em></strong></div></div></div>
        <div className="nutrition-diary-overview__bar" aria-hidden="true"><span style={{ width: `${clampPercent(totals.calories, targets.calories)}%` }} /></div>
      </section>

      <div className="nutrition-assistant-brief"><span><Sparkles size={18} /></span><div><small>AURA NHẬN XÉT</small><p>{assistantBrief}</p></div><button type="button" onClick={onAddMeal}>Ghi bữa tiếp theo <ChevronRight size={16} /></button></div>

      <div className="nutrition-diary-metrics" aria-label="Tiến độ mục tiêu ngày">
        <NutritionMetricProgress label="Năng lượng" value={totals.calories} goal={targets.calories} unit=" kcal" icon={<Target size={16} />} tone="energy" />
        <NutritionMetricProgress label="Đạm" value={totals.protein} goal={targets.protein} unit="g" icon={<Dumbbell size={16} />} tone="protein" />
        <NutritionMetricProgress label="Carb" value={totals.carbs} goal={targets.carbs} unit="g" icon={<Salad size={16} />} tone="carbs" />
        <NutritionMetricProgress label="Chất béo" value={totals.fat} goal={targets.fat} unit="g" icon={<Droplets size={16} />} tone="fat" />
        <NutritionMetricProgress label="Nước" value={waterMl} goal={targets.waterMl} unit="ml" icon={<Droplets size={16} />} tone="water" />
      </div>

      <div className="nutrition-diary-layout">
        <div className="nutrition-diary-timeline">
          <div className="nutrition-workspace-section-heading"><div><h2>Dòng thời gian</h2><p>{timeline.length ? `${timeline.length} hoạt động trong ngày` : 'Chưa có hoạt động'}</p></div><button type="button" onClick={onAddMeal}><Plus size={16} /> Thêm món</button></div>
          {timeline.length ? <ol className="nutrition-diary-events">{timeline.map((event) => {
            if (event.kind === 'meal') return <li key={event.id} className="nutrition-diary-event nutrition-diary-event--meal"><time>{event.time}</time><span className="nutrition-diary-event__node"><Utensils size={16} /></span><article><div className="nutrition-diary-event__visual"><MealImage image={event.item.image} storagePath={event.item.imageStoragePath} fallback={<Salad size={22} />} /></div><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>{event.item.label || MEAL_TYPE_LABELS[event.item.type]}</span><span className={`nutrition-confidence nutrition-confidence--${event.item.confidence ?? 'verified'}`}>{confidenceCopy(event.item.confidence)}</span></div><button type="button" className="nutrition-diary-event__title" onClick={() => onOpenMeal?.(event.item.id)} disabled={!onOpenMeal}>{event.item.title}</button><div className="nutrition-diary-event__nutrition"><strong>{formatNumber(event.item.calories)} kcal</strong><span>{formatNumber(event.item.protein)}g P</span><span>{formatNumber(event.item.carbs)}g C</span><span>{formatNumber(event.item.fat)}g F</span></div></div>{(onEditMeal || onDeleteMeal) && <div className="nutrition-diary-event__actions">{onEditMeal && <button type="button" onClick={() => onEditMeal(event.item.id)} aria-label={`Chỉnh ${event.item.title}`}><MoreHorizontal size={18} /></button>}{onDeleteMeal && <button type="button" onClick={() => onDeleteMeal(event.item.id)} aria-label={`Xóa ${event.item.title}`}><Trash2 size={16} /></button>}</div>}</article></li>
            if (event.kind === 'activity') return <li key={event.id} className="nutrition-diary-event nutrition-diary-event--activity"><time>{event.time}</time><span className="nutrition-diary-event__node"><Activity size={16} /></span><article><span className="nutrition-diary-event__compact-icon"><Dumbbell size={20} /></span><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>LUYỆN TẬP</span></div><strong className="nutrition-diary-event__plain-title">{event.item.title}</strong><p>{event.item.durationMinutes} phút · {formatNumber(event.item.estimatedCalories)} kcal</p></div></article></li>
            return <li key={event.id} className="nutrition-diary-event nutrition-diary-event--water"><time>{event.time}</time><span className="nutrition-diary-event__node"><Droplets size={16} /></span><article><span className="nutrition-diary-event__compact-icon"><Droplets size={20} /></span><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>NƯỚC</span></div><strong className="nutrition-diary-event__plain-title">+{formatNumber(event.item.amountMl)} ml</strong></div></article></li>
          })}</ol> : <div className="nutrition-workspace-empty"><span><Utensils size={23} /></span><h3>Bắt đầu bằng bữa ăn đầu tiên</h3><p>Chụp ảnh hoặc ghi bữa ăn để theo dõi dinh dưỡng nhất quán hơn.</p><button type="button" onClick={onAddMeal}><Plus size={16} /> Ghi bữa ăn</button></div>}
        </div>
        <aside className="nutrition-diary-quick" aria-label="Ghi nhanh"><span className="nutrition-workspace-eyebrow">GHI NHANH</span><h2>Thêm trong vài giây</h2><p>Mỗi dữ liệu đều có thời gian và có thể chỉnh lại sau.</p><button type="button" onClick={onAddMeal}><span><Utensils size={18} /></span><div><strong>Bữa ăn</strong><small>Ảnh AI hoặc ghi thủ công</small></div><ChevronRight size={17} /></button><button type="button" onClick={onAddWater}><span><Droplets size={18} /></span><div><strong>Nước</strong><small>Ghi đúng lượng đã uống</small></div><ChevronRight size={17} /></button><button type="button" onClick={onAddExercise}><span><Activity size={18} /></span><div><strong>Vận động</strong><small>Thời lượng và cường độ</small></div><ChevronRight size={17} /></button><button type="button" className="nutrition-classic-diary__today" onClick={onGoToday} disabled={dateKey === todayKey}><CalendarDays size={17} /> Về hôm nay</button></aside>
      </div>
    </section>
  )
}
