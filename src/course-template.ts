import type { AcademyLessonMemory, CourseDraftInput, CourseLessonType } from './types'

const lesson = (
  id: string,
  title: string,
  type: CourseLessonType,
  duration: string,
  preview = false,
  memory?: AcademyLessonMemory,
) => ({ id, title, type, duration, preview, ...(memory ? { memory } : {}) })

export const auraFoundationCourse: CourseDraftInput = {
  id: 'nutrition-foundation',
  slug: 'nen-tang-dinh-duong-ung-dung',
  title: 'Nền tảng dinh dưỡng ứng dụng',
  description: 'Khóa học chuyên sâu giúp học viên hiểu nguyên lý dinh dưỡng, đọc dữ liệu đúng cách và xây dựng quyết định ăn uống có cơ sở trong thực tế.',
  category: 'Dinh dưỡng nền tảng',
  level: 'Foundation',
  coach: 'Aura Academy',
  duration: '6 tuần',
  outcomes: [
    'Hiểu cân bằng năng lượng và vai trò của các chất dinh dưỡng đa lượng',
    'Biết đọc nhãn thực phẩm và đánh giá chất lượng thông tin dinh dưỡng',
    'Thiết kế bữa ăn mẫu phù hợp với mục tiêu và bối cảnh thực tế',
    'Phân tích case study trong phạm vi chuyên môn và nhận diện khi cần chuyển tuyến',
  ],
  requirements: [
    'Không yêu cầu kiến thức dinh dưỡng trước đó',
    'Sẵn sàng thực hành đọc nhãn và phân tích tình huống',
    'Nội dung phục vụ đào tạo, không thay thế chẩn đoán hoặc điều trị y khoa',
  ],
  modules: [
    {
      id: 'module-onboarding', order: 1, title: 'Định hướng học tập', lessons: [
        lesson('welcome', 'Chào mừng đến Aura Academy', 'Video', '04:30', true),
        lesson('course-guide', 'Cách học sâu và ghi nhớ lâu', 'Bài đọc', '6 phút', true),
        lesson('nutrition-pretest', 'Kiểm tra kiến thức đầu vào', 'Quiz', '12 phút'),
        lesson('scope-of-practice', 'Phạm vi chuyên môn và nguyên tắc an toàn', 'Bài đọc', '8 phút'),
      ],
    },
    {
      id: 'module-energy', order: 2, title: 'Năng lượng và chuyển hóa', lessons: [
        lesson('energy-balance', 'Cân bằng năng lượng trong thực tế', 'Video', '14:20', false, {
          recap: 'Cân bằng năng lượng mô tả mối quan hệ dài hạn giữa năng lượng nạp vào và năng lượng tiêu hao. Biến động cân nặng ngắn hạn còn chịu ảnh hưởng của nước, glycogen và khối lượng thức ăn.',
          takeaways: [
            'Xu hướng dài hạn quan trọng hơn một ngày ăn riêng lẻ.',
            'Năng lượng tiêu hao thay đổi theo cơ thể, vận động và sự thích nghi.',
            'Cân nặng ngắn hạn không đồng nghĩa với thay đổi lượng mỡ.',
          ],
          glossary: [
            { id: 'energy-balance', term: 'Cân bằng năng lượng', definition: 'Chênh lệch giữa năng lượng nạp vào và tổng năng lượng cơ thể sử dụng trong một khoảng thời gian.' },
            { id: 'tdee', term: 'TDEE', definition: 'Tổng năng lượng tiêu hao mỗi ngày, gồm chuyển hóa nền, vận động và hiệu ứng nhiệt của thực phẩm.' },
          ],
          recallPrompts: [
            { id: 'energy-recall-1', prompt: 'Vì sao cân nặng tăng sau một bữa ăn không đồng nghĩa cơ thể vừa tăng lượng mỡ tương ứng?', answer: 'Vì cân nặng ngắn hạn còn thay đổi bởi nước, glycogen, natri và khối lượng thức ăn trong hệ tiêu hóa.' },
          ],
          flashcards: [
            { id: 'energy-card-1', front: 'Ba nhóm thành phần chính của TDEE là gì?', back: 'Chuyển hóa nền, hoạt động thể chất và hiệu ứng nhiệt của thực phẩm.', hint: 'Nghĩ đến năng lượng khi nghỉ, khi vận động và khi tiêu hóa.' },
            { id: 'energy-card-2', front: 'Nên đánh giá cân bằng năng lượng theo một ngày hay theo xu hướng?', back: 'Theo xu hướng đủ dài, vì dữ liệu từng ngày có dao động lớn.' },
          ],
        }),
        lesson('metabolism-basics', 'Hiểu đúng về chuyển hóa', 'Bài đọc', '10 phút'),
        lesson('energy-calculation', 'Thực hành ước tính nhu cầu năng lượng', 'Bài đọc', '12 phút'),
        lesson('energy-checkpoint', 'Checkpoint: Năng lượng', 'Quiz', '10 phút'),
      ],
    },
    {
      id: 'module-macros', order: 3, title: 'Protein, carbohydrate và chất béo', lessons: [
        lesson('protein', 'Protein: vai trò, nguồn và khẩu phần', 'Video', '15 phút'),
        lesson('carbohydrate', 'Carbohydrate: hiệu suất và lựa chọn thực phẩm', 'Video', '14 phút'),
        lesson('dietary-fat', 'Chất béo: chất lượng và cân đối', 'Bài đọc', '11 phút'),
        lesson('macro-case', 'Case study: phân bổ macro', 'Quiz', '15 phút'),
      ],
    },
    {
      id: 'module-food-literacy', order: 4, title: 'Hiểu thực phẩm và nhãn dinh dưỡng', lessons: [
        lesson('food-quality', 'Mật độ dinh dưỡng và mức độ chế biến', 'Video', '12 phút'),
        lesson('food-labels', 'Đọc nhãn thực phẩm từng bước', 'Bài đọc', '14 phút', false, {
          recap: 'Đọc nhãn bắt đầu từ khẩu phần, sau đó mới so sánh năng lượng, chất dinh dưỡng và danh sách thành phần trong đúng bối cảnh sử dụng.',
          takeaways: [
            'Luôn kiểm tra kích thước khẩu phần trước khi đọc các con số khác.',
            'So sánh sản phẩm trên cùng một khối lượng hoặc khẩu phần tương đương.',
            'Tuyên bố ở mặt trước bao bì không thay thế bảng thành phần dinh dưỡng.',
          ],
          glossary: [
            { id: 'serving-size', term: 'Khẩu phần công bố', definition: 'Lượng thực phẩm được dùng làm cơ sở cho các số liệu trên nhãn; không nhất thiết là lượng phù hợp cho mọi người.' },
          ],
          recallPrompts: [
            { id: 'label-recall-1', prompt: 'Bạn cần kiểm tra điều gì đầu tiên khi so sánh hai nhãn thực phẩm?', answer: 'Kích thước khẩu phần và đơn vị so sánh phải tương đương.' },
          ],
          flashcards: [
            { id: 'label-card-1', front: 'Một gói có hai khẩu phần nhưng bạn ăn hết gói. Các số trên nhãn cần xử lý thế nào?', back: 'Nhân các giá trị tính trên một khẩu phần với hai.' },
          ],
        }),
        lesson('claims-myths', 'Nhận diện tuyên bố và thông tin sai', 'Bài đọc', '10 phút'),
        lesson('label-assessment', 'Bài thực hành đọc nhãn', 'Quiz', '15 phút'),
      ],
    },
    {
      id: 'module-meal-design', order: 5, title: 'Thiết kế bữa ăn ứng dụng', lessons: [
        lesson('plate-framework', 'Khung xây dựng bữa ăn cân đối', 'Video', '13 phút'),
        lesson('portioning', 'Khẩu phần và cách điều chỉnh linh hoạt', 'Bài đọc', '12 phút'),
        lesson('meal-comparison', 'So sánh và cải thiện một bữa ăn', 'Bài đọc', '10 phút'),
        lesson('meal-plan-practice', 'Bài thực hành xây dựng thực đơn mẫu', 'Quiz', '18 phút'),
      ],
    },
    {
      id: 'module-mastery', order: 6, title: 'Ứng dụng và đánh giá cuối khóa', lessons: [
        lesson('behavior-change', 'Thay đổi hành vi ăn uống bền vững', 'Video', '14 phút'),
        lesson('client-case', 'Case study khách hàng giả lập', 'Bài đọc', '20 phút'),
        lesson('final-assessment', 'Bài kiểm tra tổng hợp cuối khóa', 'Quiz', '25 phút'),
        lesson('next-path', 'Lộ trình học chuyên sâu tiếp theo', 'Bài đọc', '6 phút'),
      ],
    },
  ],
  settings: {
    accessTier: 'pro',
    completionPercent: 80,
    certificateEnabled: true,
      dripSchedule: 'none',
    visibility: 'members',
  },
  publicationStatus: 'draft',
}
