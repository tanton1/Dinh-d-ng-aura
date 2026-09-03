import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'

export default function StaffNutritionReviewsPage({ initialStudentName = '' }: { initialStudentName?: string }) {
  return <NutritionReviewWorkspace title="Bữa ăn học viên tôi phụ trách" initialQuery={initialStudentName} />
}
