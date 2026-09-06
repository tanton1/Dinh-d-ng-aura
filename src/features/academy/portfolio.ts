import type { AcademyWorkbookState } from '../../services/academyLearningService'

export type AcademyPortfolioField = {
  id: string
  label: string
  prompt: string
  placeholder: string
  kind: 'short' | 'long'
}

export type AcademyPortfolioStage = {
  id: 1 | 2 | 3 | 4
  milestoneChapter: 5 | 10 | 15 | 20
  chapterRange: readonly [number, number]
  eyebrow: string
  title: string
  description: string
  outcome: string
  fields: AcademyPortfolioField[]
}

const longField = (id: string, label: string, prompt: string, placeholder: string): AcademyPortfolioField => ({
  id,
  label,
  prompt,
  placeholder,
  kind: 'long',
})

export const academyPortfolioStages: AcademyPortfolioStage[] = [
  {
    id: 1,
    milestoneChapter: 5,
    chapterRange: [1, 5],
    eyebrow: 'CHẶNG 1 · HIỂU NỀN TẢNG',
    title: 'Bản đồ nền tảng',
    description: 'Ghép năm bài thực hành đầu tiên thành một bản đồ đủ rõ để quan sát cơ thể mà không tự phán xét hoặc tự chẩn đoán.',
    outcome: 'Một bản đồ gồm mẫu hình chính, điểm gãy, dữ liệu nền, giới hạn an toàn và thử nghiệm nhỏ tiếp theo.',
    fields: [
      longField('foundation-pattern', 'Mẫu hình đang lặp lại', 'Điều gì xuất hiện nhiều lần trong bữa ăn, năng lượng, nước hoặc tiêu hóa?', 'Viết một mẫu hình có thời điểm và bối cảnh cụ thể…'),
      longField('foundation-friction', 'Điểm gãy quan trọng nhất', 'Ma sát nào đang làm lựa chọn mong muốn khó xảy ra nhất?', 'Chọn một điểm gãy, không liệt kê toàn bộ vấn đề…'),
      longField('foundation-baseline', 'Dữ liệu nền tối thiểu', 'Bạn sẽ giữ lại tối đa bốn tín hiệu nào để đọc xu hướng?', 'Ví dụ: giờ ăn, mức đói, nhịp uống, triệu chứng có cấu trúc…'),
      longField('foundation-safety', 'Ranh giới an toàn', 'Tín hiệu nào khiến bạn dừng tự thử và hỏi đúng chuyên môn?', 'Ghi rõ dấu hiệu và người/kênh cần liên hệ…'),
      longField('foundation-next', 'Thử nghiệm nhỏ tiếp theo', 'Bạn sẽ đổi đúng một biến nào, trong bao lâu?', 'Nêu hành động, phiên bản ngày bận và thời gian thử…'),
      longField('foundation-reflection', 'Điều tôi hiểu khác đi', 'Sau chặng này, cách nhìn nào của bạn về dinh dưỡng đã thay đổi?', 'Tự diễn đạt bằng lời của bạn…'),
    ],
  },
  {
    id: 2,
    milestoneChapter: 10,
    chapterRange: [6, 10],
    eyebrow: 'CHẶNG 2 · CÁ NHÂN HÓA',
    title: 'Dashboard cá nhân hóa',
    description: 'Biến dữ liệu thành một bảng điều khiển nhẹ, giúp ra quyết định theo xu hướng thay vì phản ứng với một lần cân hoặc một ngày lệch.',
    outcome: 'Một dashboard tối đa bốn chỉ số, có đường cơ sở, nhịp rà và quy tắc giữ/chỉnh/dừng.',
    fields: [
      longField('dashboard-purpose', 'Câu hỏi dashboard cần trả lời', 'Quyết định thực tế nào bạn muốn dashboard hỗ trợ?', 'Ví dụ: kế hoạch hiện tại có còn phù hợp với mục tiêu và trải nghiệm không?'),
      longField('dashboard-signals', 'Tối đa bốn tín hiệu', 'Chọn kết quả, hành vi, trải nghiệm và an toàn khi phù hợp.', 'Ghi tên chỉ số và vì sao mỗi chỉ số cần thiết…'),
      longField('dashboard-baseline', 'Đường cơ sở và cách đo', 'Đo vào thời điểm nào, tần suất nào và sai số nào cần nhớ?', 'Chuẩn hóa điều kiện đo và ghi khoảng dao động bình thường…'),
      longField('dashboard-rule', 'Quy tắc ra quyết định', 'Khi nào giữ, chỉnh một biến, dừng hoặc hỏi chuyên môn?', 'Viết điều kiện đủ rõ để không đổi kế hoạch theo cảm xúc…'),
      longField('dashboard-review', 'Nhịp rà', 'Bao lâu bạn sẽ đọc xu hướng và ai cần tham gia nếu có cờ đỏ?', 'Chọn một nhịp rà phù hợp với tốc độ thay đổi…'),
      longField('dashboard-reflection', 'Điều dữ liệu chưa thể nói', 'Giới hạn quan trọng nhất của dashboard này là gì?', 'Ghi một điều bạn sẽ không kết luận chỉ từ các chỉ số trên…'),
    ],
  },
  {
    id: 3,
    milestoneChapter: 15,
    chapterRange: [11, 15],
    eyebrow: 'CHẶNG 3 · ĂN CHO MỤC TIÊU',
    title: 'Kế hoạch theo mục tiêu',
    description: 'Ghép dinh dưỡng quanh buổi tập, phục hồi và mục tiêu hình thể thành một block có thể thử, đo và điều chỉnh.',
    outcome: 'Một block 4–8 tuần có mục tiêu, giao thức bữa ăn, phục hồi, kênh đo và điều kiện đổi hướng.',
    fields: [
      longField('goal-north-star', 'Mục tiêu và Sao Bắc Đẩu', 'Điều gì quan trọng hơn con số cân nặng trong block này?', 'Nêu kết quả mong muốn và một trải nghiệm cần bảo vệ…'),
      longField('goal-training-profile', 'Hồ sơ tập luyện', 'Loại buổi, thời lượng, cường độ và thời điểm nào cần được phục vụ?', 'Mô tả lịch tập thật, không dùng một ngày lý tưởng…'),
      longField('goal-fueling', 'Giao thức trước · trong · sau tập', 'Các lựa chọn mặc định và phương án cứu hộ là gì?', 'Nêu bữa/đồ uống dễ thực hiện trong lịch thật…'),
      longField('goal-recovery', 'Kế hoạch phục hồi', 'Bạn sẽ bảo vệ năng lượng, protein, nước và giấc ngủ thế nào?', 'Chọn trụ yếu nhất và hành động ưu tiên…'),
      longField('goal-measures', 'Bốn kênh đo', 'Kết quả, hiệu suất, trải nghiệm và an toàn sẽ được đọc ra sao?', 'Ghi tín hiệu, tần suất và cách đọc xu hướng…'),
      longField('goal-pivot', 'Điều kiện đổi hướng', 'Khi nào tiếp tục, tách giai đoạn, giảm tải hoặc dừng?', 'Đặt ngày rà và cờ đỏ cần chuyển tuyến…'),
    ],
  },
  {
    id: 4,
    milestoneChapter: 20,
    chapterRange: [16, 20],
    eyebrow: 'CHẶNG 4 · TỰ CHỦ BỀN VỮNG',
    title: 'Hệ điều hành dinh dưỡng 1.0',
    description: 'Bản tốt nghiệp để bạn tự quan sát, ra quyết định rủi ro thấp và biết lúc nào cần gọi đúng người hỗ trợ.',
    outcome: 'Một hệ điều hành cá nhân gồm Sao Bắc Đẩu, bữa mặc định, hộ chiếu an toàn, dashboard, thử nghiệm và mạng lưới hỗ trợ.',
    fields: [
      longField('os-north-star', 'Sao Bắc Đẩu', 'Giá trị sức khỏe và cuộc sống nào dẫn đường cho quyết định dinh dưỡng?', 'Viết một câu đủ ngắn để dùng khi phải lựa chọn…'),
      longField('os-default-meals', 'Ba bữa mặc định', 'Ba khung bữa nào phù hợp ngày thường, ngày bận và khi ăn ngoài?', 'Ghi theo chức năng để có thể thay món linh hoạt…'),
      longField('os-safety-passport', 'Hộ chiếu an toàn', 'Thuốc, dị ứng, tình trạng đặc biệt, cờ đỏ và hướng dẫn chuyên môn nào cần luôn được nhớ?', 'Chỉ ghi thông tin bạn chủ động muốn lưu trong portfolio…'),
      longField('os-dashboard', 'Dashboard tối giản', 'Tối đa bốn tín hiệu nào giúp bạn biết hệ thống còn phục vụ mình?', 'Nêu cách đo, nhịp đọc và giới hạn diễn giải…'),
      longField('os-experiment', 'Một thử nghiệm rủi ro thấp', 'Biến duy nhất, dữ liệu, thời gian và điều kiện dừng là gì?', 'Thiết kế một thử nghiệm có thể đảo ngược và kiểm chứng…'),
      longField('os-network', 'Mạng lưới đúng người', 'Ai hỗ trợ thói quen, huấn luyện, dinh dưỡng và y khoa khi cần?', 'Ghi vai trò và cách liên hệ, không cần đưa dữ liệu riêng tư dư thừa…'),
      longField('os-reflection', 'Cam kết tự chủ', 'Bạn sẽ làm gì khi dữ liệu mới không khớp với kế hoạch cũ?', 'Mô tả cách giữ tò mò, điều chỉnh vừa mức và xin hỗ trợ…'),
    ],
  },
]

export const academyPortfolioWorkbookId = (stage: AcademyPortfolioStage) => `academy-portfolio-stage-${stage.id}`

export function getAcademyPortfolioStage(chapter: number) {
  return academyPortfolioStages.find((stage) => stage.milestoneChapter === chapter) ?? null
}

const defaultPracticeFields = ['context', 'hypothesis', 'action', 'minimum', 'data', 'stop']

export function isAcademyPracticeArtifactComplete(workbook: AcademyWorkbookState, requiredFieldIds = defaultPracticeFields) {
  return requiredFieldIds.every((fieldId) => String(workbook.answers[fieldId] ?? '').trim().length > 0)
    && Boolean(workbook.reviewAt)
    && workbook.safetyAcknowledged
}

export function isAcademyPortfolioComplete(stage: AcademyPortfolioStage, workbook: AcademyWorkbookState) {
  const rubricScore = Object.values(workbook.rubric).reduce<number>((total, score) => total + score, 0)
  return stage.fields.every((field) => String(workbook.answers[field.id] ?? '').trim().length > 0)
    && Boolean(workbook.reviewAt)
    && workbook.safetyAcknowledged
    && rubricScore >= 6
}
