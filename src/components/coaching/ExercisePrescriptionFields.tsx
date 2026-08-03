import type { WorkoutProgramExerciseDraft } from '../../types'
import {
  readPtExercisePrescription,
  visibleExerciseTags,
  writePtExercisePrescription,
  type PtExercisePrescription,
} from '../../services/ptCoachingProgramService'

interface ExercisePrescriptionFieldsProps {
  exercise: WorkoutProgramExerciseDraft
  onChange: (tags: string[]) => void
}

export default function ExercisePrescriptionFields({ exercise, onChange }: ExercisePrescriptionFieldsProps) {
  const prescription = readPtExercisePrescription(exercise.tags)
  const visibleTags = visibleExerciseTags(exercise.tags)

  const update = (patch: Partial<PtExercisePrescription>) => {
    onChange(writePtExercisePrescription(exercise, patch))
  }

  return (
    <div className="pt-prescription-fields" aria-label={`Chỉ định tập luyện cho ${exercise.name}`}>
      <label>
        <span>RIR mục tiêu</span>
        <select value={prescription.rir} onChange={(event) => update({ rir: Number(event.target.value) })}>
          {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} reps dự trữ</option>)}
        </select>
      </label>
      <label>
        <span>Tempo</span>
        <input value={prescription.tempo} onChange={(event) => update({ tempo: event.target.value })} placeholder="3-1-1-0" />
      </label>
      <label className="pt-prescription-substitute">
        <span>Bài thay thế</span>
        <input value={prescription.substitute} onChange={(event) => update({ substitute: event.target.value })} placeholder="Ví dụ: Leg Press" />
      </label>
      <div className="pt-visible-tags">
        <span>Nhóm / mục tiêu</span>
        <strong>{visibleTags.join(' · ') || 'Chưa phân nhóm'}</strong>
      </div>
    </div>
  )
}
