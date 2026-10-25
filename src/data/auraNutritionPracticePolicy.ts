import type { AcademyPracticeDefinition } from '../types'

export function auraPracticeMode(chapter: number) {
  return chapter === 16 || chapter === 17 ? 'coordination' : chapter === 18 ? 'evidence' : 'observation'
}

export function applyAuraPracticePolicy(chapter: number, practice: AcademyPracticeDefinition): AcademyPracticeDefinition {
  if (auraPracticeMode(chapter) !== 'coordination') return practice
  const prompts: Record<string, { label: string; prompt: string }> = {
    context: { label: 'Bối cảnh cần phối hợp', prompt: 'Dùng tình huống giả định hoặc thông tin bạn tự nguyện chia sẻ. Ghi giai đoạn sống, câu hỏi và hướng dẫn chuyên môn đang có; không điền dữ liệu định danh không cần thiết.' },
    hypothesis: { label: 'Điều chưa rõ cần xác minh', prompt: 'Điều gì đã được chuyên môn xác nhận, điều gì mới là suy đoán và cần hỏi ai? Không tự đặt chẩn đoán.' },
    action: { label: 'Bước phối hợp tiếp theo', prompt: 'Chuẩn bị câu hỏi, thông tin và người chịu trách nhiệm trước khi thay đổi chế độ ăn, sản phẩm bổ sung hoặc thuốc.' },
    minimum: { label: 'Khi chưa liên hệ được', prompt: 'Ghi kênh liên hệ thay thế và những quyết định bạn sẽ không tự thay đổi. Nếu nghi cấp cứu, tìm trợ giúp khẩn cấp, không chờ hoàn tất bài tập.' },
    data: { label: 'Thông tin tối thiểu để trao đổi', prompt: 'Chọn thông tin liên quan: thời điểm, triệu chứng đã quan sát, hướng dẫn hiện có, danh sách thuốc/sản phẩm. Không tự diễn giải xét nghiệm thành chỉ định.' },
    stop: { label: 'Giới hạn của người học và PT', prompt: 'Ghi rõ không tự chẩn đoán, kê đơn, chỉnh thuốc hoặc dùng bài học làm phác đồ điều trị; quyết định nào phải được người có thẩm quyền xác nhận?' },
    reviewAt: { label: 'Ngày rà việc phối hợp', prompt: 'Chọn ngày kiểm tra việc liên hệ hoặc câu hỏi còn thiếu. Đây không phải thời hạn chờ khi có dấu hiệu cần trợ giúp sớm.' },
  }
  return {
    ...practice,
    fields: practice.fields.map((field) => ({ ...field, ...prompts[field.id] })),
    minimumEvidence: ['Bối cảnh đã xác minh', 'Điều chưa rõ', 'Người chịu trách nhiệm', 'Bước liên hệ', 'Giới hạn an toàn', 'Ngày rà việc phối hợp'],
  }
}
