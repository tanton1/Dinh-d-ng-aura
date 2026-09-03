import type { Course, CourseLessonDraft, CourseModuleDraft } from '../types'

const auraFoundationCourseId = 'nutrition-foundation'

const categoryLessonTitles: Record<string, string[]> = {
  'Dinh dưỡng': [
    'Xác định nhu cầu năng lượng',
    'Làm chủ protein, carb và chất béo',
    'Xây dựng một đĩa ăn cân bằng',
    'Lập thực đơn phù hợp mục tiêu',
  ],
  'Linh hoạt': [
    'Đánh giá biên độ vận động',
    'Giải phóng vùng vai và lưng trên',
    'Mobility hông và cổ chân',
    'Flow phục hồi toàn thân',
  ],
  'Giảm mỡ': [
    'Làm quen với HIIT an toàn',
    'Kiểm soát nhịp tim và nhịp thở',
    'HIIT toàn thân không dụng cụ',
    'Phục hồi sau buổi tập cường độ cao',
  ],
}

function buildDemoModules(course: Course): CourseModuleDraft[] {
  const lessonCount = Math.max(1, course.lessons || 1)
  const seedTitles = categoryLessonTitles[course.category] ?? [
    'Chào mừng và định hướng',
    'Kiến thức nền tảng',
    'Thực hành có hướng dẫn',
    'Đánh giá và bước tiếp theo',
  ]
  const lessons: CourseLessonDraft[] = Array.from({ length: lessonCount }, (_, index) => ({
    id: `${String(course.id)}-lesson-${index + 1}`,
    title: seedTitles[index] ?? `Bài học ${index + 1}: Thực hành và củng cố`,
    type: index % 6 === 5 ? 'Quiz' : index % 4 === 3 ? 'Bài đọc' : 'Video',
    duration: index % 6 === 5 ? '8 phút' : `${String(7 + (index % 8)).padStart(2, '0')}:00`,
    preview: index === 0,
    summary: `Nội dung ${index + 1} trong lộ trình ${course.title}.`,
  }))

  const moduleSize = 6
  return Array.from({ length: Math.ceil(lessonCount / moduleSize) }, (_, moduleIndex) => ({
    id: `${String(course.id)}-module-${moduleIndex + 1}`,
    title: moduleIndex === 0 ? 'Bắt đầu hành trình' : `Chặng ${moduleIndex + 1}`,
    order: moduleIndex + 1,
    lessons: lessons.slice(moduleIndex * moduleSize, (moduleIndex + 1) * moduleSize),
  }))
}

export function getCourseModules(course: Course, allowDemoFallback = false): CourseModuleDraft[] {
  if (course.modules?.length) return [...course.modules].sort((a, b) => a.order - b.order)
  if (!allowDemoFallback) return []
  if (String(course.id) === '1' || String(course.id) === auraFoundationCourseId) {
    return buildDemoModules(course)
  }
  return buildDemoModules(course)
}

export function flattenCourseLessons(course: Course, allowDemoFallback = false): CourseLessonDraft[] {
  return getCourseModules(course, allowDemoFallback).flatMap((module) => module.lessons)
}

export function getInitialDemoCompletedLessonIds(course: Course): string[] {
  const lessons = flattenCourseLessons(course, true)
  const completedCount = Math.min(lessons.length, Math.round((Math.max(0, course.progress) / 100) * lessons.length))
  return lessons.slice(0, completedCount).map((lesson) => lesson.id)
}
