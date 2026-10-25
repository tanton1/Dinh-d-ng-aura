export { academyPortfolioStages } from './portfolio'

/** Educational feedback only; this rubric does not certify clinical competence. */
export const academyReviewRubric = {
  version: 1,
  criteria: [
    { id: 'data', label: 'Dữ liệu và bối cảnh', levels: ['Thiếu dữ kiện để hiểu bài.', 'Có dữ kiện nhưng còn thiếu bối cảnh hoặc giới hạn.', 'Dữ kiện, bối cảnh và giới hạn được nêu rõ.'] },
    { id: 'mechanism', label: 'Diễn giải kiến thức', levels: ['Có suy luận chưa có căn cứ hoặc nhầm cơ chế.', 'Diễn giải nhìn chung phù hợp; cần làm rõ một số liên kết.', 'Liên kết kiến thức với dữ kiện; phân biệt quan sát và suy luận.'] },
    { id: 'feasibility', label: 'Tính khả thi', levels: ['Chưa có bước tiếp theo có thể thực hiện.', 'Có bước tiếp theo nhưng thiếu cách theo dõi hoặc phương án ngày bận.', 'Bước tiếp theo rõ, vừa sức và có cách rà lại.'] },
    { id: 'safety', label: 'Giới hạn an toàn', levels: ['Còn nguy cơ hoặc vượt phạm vi giáo dục cần sửa.', 'Nhận diện giới hạn chính; cần bổ sung cách tìm hỗ trợ.', 'Nêu rõ giới hạn, điều kiện dừng và đúng người cần hỏi.'] },
  ],
} as const
