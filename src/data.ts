import type { Course, Exercise, Lesson } from './types'

export const courses: Course[] = [
  {
    id: 1,
    title: 'Làm chủ dinh dưỡng cùng AURA',
    description: 'Lộ trình 20 chương từ hiểu cơ thể đến tự thiết kế và điều chỉnh dinh dưỡng trong đúng phạm vi an toàn.',
    category: 'Giáo trình dinh dưỡng AURA',
    level: 'Từ nền tảng đến chuyên sâu',
    coach: 'AURA Fitness Academy',
    lessons: 60,
    duration: '20 chương · 4 chặng',
    progress: 68,
    accent: 'purple',
    icon: 'nutrition',
    settings: {
      accessTier: 'free',
      completionPercent: 80,
      certificateEnabled: true,
      dripSchedule: 'none',
      visibility: 'members',
    },
    status: 'Đang học',
  },
  {
    id: 2,
    title: 'Dinh dưỡng giảm mỡ chuyên sâu',
    description: 'Phân tích cân bằng năng lượng, hành vi và chiến lược giảm mỡ bền vững qua case study.',
    category: 'Quản lý cân nặng',
    level: 'Intermediate',
    coach: 'Aura Academy',
    lessons: 18,
    duration: '4 tuần',
    progress: 35,
    accent: 'green',
    icon: 'nutrition',
    status: 'Đang học',
  },
  {
    id: 3,
    title: 'Dinh dưỡng thể thao nâng cao',
    description: 'Xây dựng chiến lược năng lượng, hydration và phục hồi cho các bối cảnh vận động khác nhau.',
    category: 'Dinh dưỡng thể thao',
    level: 'Advanced',
    coach: 'Aura Academy',
    lessons: 21,
    duration: '3 tuần',
    progress: 100,
    accent: 'orange',
    icon: 'mobility',
    status: 'Đã hoàn thành',
  },
  {
    id: 4,
    title: 'Đọc nghiên cứu dinh dưỡng',
    description: 'Học cách đánh giá chất lượng bằng chứng và chuyển hóa nghiên cứu thành quyết định thực hành.',
    category: 'Chuyên sâu',
    level: 'Professional',
    coach: 'Aura Academy',
    lessons: 16,
    duration: '4 tuần',
    progress: 0,
    accent: 'pink',
    icon: 'hiit',
    status: 'Khám phá',
  },
]

export const courseLessons: Lesson[] = [
  { id: 1, title: 'Chào mừng đến Aura Academy', type: 'Video', duration: '04:30', completed: true },
  { id: 2, title: 'Cách học sâu và ghi nhớ lâu', type: 'Bài đọc', duration: '6 phút', completed: true },
  { id: 3, title: 'Kiểm tra kiến thức đầu vào', type: 'Quiz', duration: '12 phút', completed: true },
  { id: 4, title: 'Cân bằng năng lượng trong thực tế', type: 'Video', duration: '14:20', active: true },
  { id: 5, title: 'Protein: vai trò, nguồn và khẩu phần', type: 'Video', duration: '15 phút' },
  { id: 6, title: 'Checkpoint: Năng lượng', type: 'Quiz', duration: '10 phút' },
]

export const workoutExercises: Exercise[] = [
  { id: 1, name: 'Goblet Squat', target: 'Đùi trước · Mông', sets: 4, reps: '10 lần', rest: 60, icon: '01', color: 'pink' },
  { id: 2, name: 'Dumbbell Row', target: 'Lưng · Tay trước', sets: 3, reps: '12 mỗi bên', rest: 45, icon: '02', color: 'green' },
  { id: 3, name: 'Push-up', target: 'Ngực · Tay sau', sets: 3, reps: '8–12 lần', rest: 45, icon: '03', color: 'orange' },
  { id: 4, name: 'Romanian Deadlift', target: 'Đùi sau · Mông', sets: 4, reps: '10 lần', rest: 60, icon: '04', color: 'pink' },
  { id: 5, name: 'Dead Bug', target: 'Core', sets: 3, reps: '10 mỗi bên', rest: 30, icon: '05', color: 'blue' },
]

export const weeklyActivity = [
  { day: 'T2', minutes: 45, completed: true },
  { day: 'T3', minutes: 25, completed: true },
  { day: 'T4', minutes: 50, completed: true },
  { day: 'T5', minutes: 0, completed: false },
  { day: 'T6', minutes: 40, completed: true },
  { day: 'T7', minutes: 30, completed: false },
  { day: 'CN', minutes: 0, completed: false },
]

export const scheduleItems = [
  { date: 29, time: '18:00', title: 'Full Body A', type: 'Buổi tập', coach: 'Tự tập', color: 'pink' },
  { date: 30, time: '07:30', title: 'Mobility Flow', type: 'Phục hồi', coach: 'Quang Huy', color: 'green' },
  { date: 31, time: '20:00', title: 'Q&A dinh dưỡng', type: 'Livestream', coach: 'Thảo Vy', color: 'orange' },
  { date: 1, time: '18:00', title: 'Lower Body B', type: 'Buổi tập', coach: 'Tự tập', color: 'pink' },
]

export const adminCourses = [
  { title: 'Nền tảng sức mạnh', learners: 428, completion: 68, rating: 4.9, status: 'Đã xuất bản', updated: '2 giờ trước' },
  { title: 'Dinh dưỡng chủ động', learners: 312, completion: 54, rating: 4.8, status: 'Đã xuất bản', updated: 'Hôm qua' },
  { title: 'Mobility mỗi ngày', learners: 186, completion: 81, rating: 4.9, status: 'Đã xuất bản', updated: '3 ngày trước' },
  { title: 'HIIT đốt mỡ 20 phút', learners: 0, completion: 0, rating: 0, status: 'Bản nháp', updated: '10 phút trước' },
]

export const students = [
  { name: 'Nguyễn Hoàng Nam', email: 'nam.nguyen@email.com', program: 'Nền tảng sức mạnh', progress: 72, streak: 12, status: 'Hoạt động', initials: 'NN' },
  { name: 'Trần Thu Hà', email: 'ha.tran@email.com', program: 'Dinh dưỡng chủ động', progress: 48, streak: 6, status: 'Hoạt động', initials: 'TH' },
  { name: 'Lê Minh Tuấn', email: 'tuan.le@email.com', program: 'Nền tảng sức mạnh', progress: 31, streak: 0, status: 'Cần chú ý', initials: 'LT' },
  { name: 'Phạm Gia Linh', email: 'linh.pham@email.com', program: 'Mobility mỗi ngày', progress: 94, streak: 28, status: 'Hoạt động', initials: 'PL' },
  { name: 'Võ Thanh Tùng', email: 'tung.vo@email.com', program: 'HIIT đốt mỡ', progress: 15, streak: 2, status: 'Cần chú ý', initials: 'VT' },
]
