import { useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Dumbbell, History, RefreshCw, Sparkles, Target, Weight } from 'lucide-react'
import { getPtStudentTrainingPlan, listPtWorkoutHistory, type PtTrainingProgram, type PtWorkoutHistory } from '../../services/ptWorkoutTrackingService'
import '../operations/PtWorkoutWorkspacePage.css'
import './StudentPtWorkoutPage.css'

export default function StudentPtWorkoutPage() {
  const [program, setProgram] = useState<PtTrainingProgram | null>(null)
  const [history, setHistory] = useState<PtWorkoutHistory | null>(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true); setError('')
    try {
      const [nextProgram, nextHistory] = await Promise.all([getPtStudentTrainingPlan(), listPtWorkoutHistory()])
      setProgram(nextProgram); setHistory(nextHistory); setDayIndex(0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải giáo án PT.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const day = program?.trainingDays[dayIndex]
  return <main className="pt-workout-workspace pt-workout-learner">
    <section className="pt-workout-workspace__slides" aria-label="Giáo án PT của tôi">
      <article className="pt-workout-workspace__hero"><span>AURA PT · CỦA BẠN</span><h1>Giáo án tập luyện</h1><p>Theo dõi bài tập, mức tạ và tiến bộ qua từng buổi.</p><Dumbbell /></article>
      <article className="pt-workout-workspace__metric"><small>Buổi đã ghi</small><strong>{history?.analytics.completedWorkouts || 0}</strong><span>Nhật ký có PT xác nhận</span><History /></article>
      <article className="pt-workout-workspace__metric"><small>Tổng volume</small><strong>{Math.round(history?.analytics.totalVolumeKg || 0).toLocaleString('vi-VN')}</strong><span>kg qua các buổi đã hoàn thành</span><Weight /></article>
    </section>
    {error && <div className="pt-workout-workspace__message is-error" role="alert">{error}</div>}
    <div className="pt-workout-workspace__toolbar"><div className="pt-workout-learner__title"><span>GIÁO ÁN HIỆN TẠI</span><strong>{program?.title || 'Chưa được phân giáo án'}</strong></div><button className="pt-workout-workspace__refresh" onClick={() => void load()} disabled={loading}><RefreshCw />Làm mới</button></div>
    {!loading && !program ? <section className="pt-workout-workspace__logger"><div className="pt-workout-workspace__empty"><Sparkles /><strong>PT đang chuẩn bị giáo án</strong><span>Khi giáo án được lưu, các buổi tập và mức tạ sẽ xuất hiện tại đây.</span></div></section> : program && <>
      <nav className="pt-workout-workspace__day-tabs pt-workout-learner__days">{program.trainingDays.map((item, index) => <button className={index === dayIndex ? 'is-active' : ''} onClick={() => setDayIndex(index)} key={item.id}>{item.title}</button>)}</nav>
      <section className="pt-workout-workspace__today pt-workout-learner__content">
        <div className="pt-workout-workspace__logger"><header><div><span>NHÓM CƠ</span><h2>{day?.title}</h2><p>{day?.focusMuscles.join(' · ') || program.goal}</p></div><Target /></header><div className="pt-workout-workspace__set-list">{day?.exercises.map((exercise) => <article className="pt-workout-workspace__log-exercise" key={exercise.id}><div className="pt-workout-workspace__exercise-heading"><div>{exercise.media.posterUrl ? <img src={exercise.media.posterUrl} alt="" /> : <Dumbbell />}</div><span><b>{exercise.nameVi}</b><small>{exercise.targetMuscles.join(' · ')}</small></span></div><div className="pt-workout-learner__prescription"><span><b>{exercise.sets}</b><small>hiệp</small></span><span><b>{exercise.repMinimum}–{exercise.repMaximum}</b><small>reps</small></span><span><b>RPE {exercise.targetRpe}</b><small>mục tiêu</small></span><span><b>{exercise.restSeconds}s</b><small>nghỉ</small></span></div>{exercise.cuesVi.length > 0 && <p>{exercise.cuesVi[0]}</p>}</article>)}</div></div>
        <aside className="pt-workout-workspace__session-rail"><div className="pt-workout-workspace__section-title"><div><span>TIẾN BỘ</span><h2>Kỷ lục mức tạ</h2></div><BarChart3 /></div>{history?.analytics.personalRecords.slice(0, 8).map((record) => <article className="pt-workout-learner__record" key={record.catalogExerciseId}><span><b>{record.exerciseName}</b><small>Hiệp tốt nhất {record.maximumSetVolumeKg.toLocaleString('vi-VN')} kg</small></span><strong>{record.maximumWeightKg} kg</strong></article>)}{history?.analytics.painAlerts ? <div className="pt-workout-learner__alert"><AlertTriangle />Có {history.analytics.painAlerts} buổi cần PT lưu ý đau/hạn chế vận động.</div> : null}</aside>
      </section>
    </>}
  </main>
}
