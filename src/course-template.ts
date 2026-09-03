import { buildAuraNutritionModules } from './data/auraNutritionCurriculum'
import type { CourseDraftInput } from './types'

/**
 * Canonical 20-chapter curriculum distilled from the 2026 Aura Fitness
 * Academy student handbooks. It remains a draft until an Academy admin has
 * reviewed the generated micro-lessons and sends it through publication.
 */
export const auraFoundationCourse: CourseDraftInput = {
  id: 'nutrition-foundation',
  schemaVersion: 2,
  slug: 'lam-chu-dinh-duong-aura',
  title: 'Làm chủ dinh dưỡng cùng AURA',
  description: 'Lộ trình 20 chương giúp học viên đi từ hiểu cơ thể và dưỡng chất đến tự thiết kế, theo dõi và điều chỉnh cách ăn trong đúng phạm vi an toàn. Mỗi chương gồm bài nắm lõi, bài thực hành và checkpoint.',
  category: 'Giáo trình dinh dưỡng AURA',
  level: 'Từ nền tảng đến chuyên sâu',
  coach: 'AURA Fitness Academy',
  duration: '20 chương · 4 chặng',
  outcomes: [
    'Hiểu cách cơ thể sử dụng năng lượng, dưỡng chất, nước và tín hiệu sinh học',
    'Biết ước tính nhu cầu, xây bữa ăn và theo dõi tiến độ bằng dữ liệu có bối cảnh',
    'Thiết kế dinh dưỡng phù hợp tập luyện, phục hồi và mục tiêu hình thể',
    'Nhận diện giới hạn an toàn, đọc bằng chứng và biết khi nào cần chuyển tuyến',
    'Xây hệ điều hành dinh dưỡng cá nhân có thể duy trì và cập nhật suốt đời',
  ],
  requirements: [
    'Không yêu cầu kiến thức dinh dưỡng trước đó; học lần lượt để xây nền vững',
    'Hoàn thành bài thực hành và checkpoint của mỗi chương trước khi chuyển tiếp',
    'Nội dung phục vụ giáo dục, không thay thế chẩn đoán, điều trị hoặc dinh dưỡng lâm sàng',
  ],
  modules: buildAuraNutritionModules(),
  settings: {
    accessTier: 'pro',
    completionPercent: 80,
    certificateEnabled: true,
    dripSchedule: 'none',
    visibility: 'members',
  },
  publicationStatus: 'draft',
}
