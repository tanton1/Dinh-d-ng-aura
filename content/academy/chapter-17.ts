import type { AcademyLearningUnit } from './learning-unit'

export const chapter17Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 17, revision: '2026-10-24.1',
  title: 'Dinh dưỡng khi có bệnh lý: hiểu giới hạn và phối hợp an toàn',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên và PT học cách chuẩn bị thông tin, đặt câu hỏi và hỗ trợ thực hiện hướng dẫn đã được xác nhận.',
  scope: 'Không chẩn đoán, kê chế độ điều trị, chỉ định xét nghiệm hay thay đổi thuốc. Bài nộp là hồ sơ phối hợp giả định.',
  prerequisites: [4, 6, 16],
  objectives: [
    { id: 'ch17-scope', outcome: 'Phân biệt giáo dục chung, hỗ trợ thực hiện và quyết định điều trị.', evidence: 'Phân loại ba yêu cầu và chỉ rõ phần cần chuyên môn.' },
    { id: 'ch17-context', outcome: 'Giải thích vì sao tên bệnh không đủ để đặt mục tiêu dưỡng chất.', evidence: 'Nêu dữ liệu còn thiếu trong tình huống bệnh thận.' },
    { id: 'ch17-handoff', outcome: 'Viết hồ sơ ngắn tách dữ kiện, điều chưa biết và câu hỏi.', evidence: 'Phiếu phối hợp có người nhận, đồng ý chia sẻ và bước tiếp theo.' },
    { id: 'ch17-urgent', outcome: 'Không để bài tập hoặc tin nhắn coach làm trì hoãn trợ giúp y tế.', evidence: 'Chọn hướng xử lý ngay cho tình huống mất ý thức giả định.' },
  ],
  sections: [
    {
      id: 'ch17-boundary', title: 'Biết hỗ trợ ở đâu và dừng ở đâu', objectiveIds: ['ch17-scope'],
      paragraphs: [
        'Giải thích “mỗi khẩu phần” trên nhãn là giáo dục. Giúp học viên lập danh sách mua sắm theo kế hoạch đã được chuyên môn xác nhận là hỗ trợ thực hiện. Tự đặt mức kali, đổi protein điều trị hoặc giảm thuốc là một loại quyết định khác, không nằm trong quyền mà khóa học này cung cấp.',
        'Một câu trả lời hữu ích không nhất thiết là một con số. Có thể nói: “Tôi giúp bạn đọc thông tin và chuẩn bị câu hỏi; mức áp dụng cho bệnh của bạn cần người phụ trách đánh giá.” Giới hạn rõ không có nghĩa bỏ mặc: cần có người nhận câu hỏi và cách theo dõi việc đã kết nối.',
        'Các tình huống trong chương là bài học, không phải đường dẫn tự chẩn đoán. Chứng nhận hoàn thành khóa học cũng không xác nhận quyền hành nghề dinh dưỡng lâm sàng.',
      ],
      takeaways: ['Hỗ trợ làm theo một chỉ định khác với tự tạo chỉ định.', 'Không biết câu trả lời thì ghi rõ, không dùng số phổ thông để lấp chỗ trống.'],
      sourceIds: ['niddk-ckd-nutrition', 'niddk-hypoglycemia'],
    },
    {
      id: 'ch17-kidney', title: 'Bệnh thận: tên bệnh chưa đủ cho một thực đơn', objectiveIds: ['ch17-context'],
      paragraphs: [
        'NIDDK nhấn mạnh không có một kế hoạch ăn chung cho mọi người có bệnh thận mạn. Nhu cầu có thể khác theo tình trạng và điều trị. Quá ít protein có thể dẫn đến thiếu dinh dưỡng; người đang lọc máu có thể có nhu cầu khác người chưa lọc máu.',
        'Vì vậy, “bệnh thận thì giảm đạm” hoặc “uống nhiều nước để tốt cho thận” đều không phải câu lệnh có thể áp máy móc. Cũng không tự loại toàn bộ thực phẩm có kali hoặc chọn chất thay muối mà chưa hỏi đội ngũ chăm sóc.',
        'Bài học không yêu cầu PT diễn giải xét nghiệm. Hãy ghi hướng dẫn hiện có, điểm học viên chưa hiểu và câu hỏi cần xác nhận. Nếu chưa có hướng dẫn cụ thể, đó là thông tin còn thiếu, không phải giấy phép tự lập mức gram.',
      ],
      takeaways: ['Cùng tên bệnh không có nghĩa cùng lượng protein, nước hoặc khoáng.', 'Chuẩn bị câu hỏi, không tự giải bài toán điều trị.'],
      sourceIds: ['niddk-ckd-nutrition'],
    },
    {
      id: 'ch17-diabetes', title: 'Bữa ăn, vận động và thuốc không tách rời', objectiveIds: ['ch17-scope', 'ch17-urgent'],
      paragraphs: [
        'Ở người dùng insulin hoặc một số thuốc đái tháo đường, bỏ hay lùi bữa, nhịn ăn và tăng vận động có thể liên quan hạ đường huyết. Vì vậy lời khuyên ăn ít hơn hoặc tập thêm cần được xét trong kế hoạch chăm sóc, không chỉ trong mục tiêu hình thể.',
        'PT không tự giảm thuốc để học viên tập được. Hướng hỗ trợ là hỏi học viên đã có kế hoạch an toàn nào do đội ngũ điều trị hướng dẫn, biết người liên hệ và không bắt đầu thử nghiệm mới khi chưa được xác nhận.',
        'Mất ý thức hoặc co giật là tình huống cần trợ giúp khẩn cấp, không chờ coach trả lời hay chờ hoàn thành nhật ký. Dừng hoạt động, gọi cấp cứu địa phương và làm theo hướng dẫn của nhân viên cấp cứu; không cố cho người bất tỉnh ăn uống. Chương này không thay thế huấn luyện sơ cứu hoặc kế hoạch xử trí cá nhân.',
      ],
      takeaways: ['Không thay thuốc để phù hợp với kế hoạch ăn/tập tự đặt.', 'Trợ giúp khẩn cấp đi trước thủ tục và bài nộp.'],
      sourceIds: ['niddk-hypoglycemia', 'nhs-hypoglycemia'],
    },
    {
      id: 'ch17-record', title: 'Hồ sơ phối hợp ngắn nhưng đủ dùng', objectiveIds: ['ch17-handoff'],
      paragraphs: [
        'Chia phiếu thành bốn phần: điều người học báo lại; hướng dẫn hiện có và nguồn; điều chưa biết; câu hỏi cần trả lời. Ví dụ “học viên nói thường bỏ bữa trưa” là dữ kiện được báo lại, còn “nguyên nhân là thuốc” là kết luận chưa có cơ sở. Đừng viết hai câu như thể có cùng mức chắc chắn.',
        'Chỉ ghi thông tin cần cho câu hỏi và có sự đồng ý của người học. Không đưa ảnh hồ sơ, thông tin định danh hoặc toàn bộ đơn thuốc vào bài học chung. Học viên có thể dùng hồ sơ giả định để hoàn thành mà vẫn chứng minh được kỹ năng.',
        'Phiếu cần có người nhận phù hợp, cách liên hệ và bước nếu chưa liên hệ được. Với câu hỏi không khẩn cấp, chưa tự thay đổi kế hoạch điều trị; nếu có diễn biến đáng lo, cần liên hệ cơ sở y tế theo mức khẩn cấp, không lấy ngày rà bài làm hạn chờ.',
      ],
      takeaways: ['Tách dữ kiện với suy đoán.', 'Chỉ thu thập tối thiểu và phải biết ai sẽ nhận câu hỏi.'],
      sourceIds: ['niddk-ckd-nutrition', 'niddk-hypoglycemia'],
    },
  ],
  workedExamples: [
    {
      id: 'ch17-sort', title: 'Ba yêu cầu, ba phạm vi', objectiveIds: ['ch17-scope'],
      prompt: 'Phân loại các yêu cầu giả định, không quyết định điều trị.',
      given: ['A: Giải thích nhãn ghi 2 khẩu phần/hộp.', 'B: Sắp xếp mua món trong kế hoạch đã được xác nhận.', 'C: Đặt lượng protein cho người bệnh thận từ cân nặng.'],
      steps: ['A là giáo dục đọc dữ liệu.', 'B là hỗ trợ thực hiện; cần làm rõ kế hoạch còn áp dụng không.', 'C cần đánh giá chuyên môn, không suy từ cân nặng đơn độc.'],
      answer: 'Có thể hỗ trợ A và phần thực hiện của B; chuyển câu hỏi C cho người phụ trách chăm sóc.',
      limitation: 'Phân loại theo nhiệm vụ không thay thế quy định chuyên môn hoặc phạm vi công việc của từng người.',
    },
    {
      id: 'ch17-handoff-example', title: 'Sửa một câu suy đoán thành hồ sơ', objectiveIds: ['ch17-handoff'],
      prompt: 'Viết lại câu: “Người này mệt vì thuốc nên cần giảm thuốc và tăng protein.”',
      given: ['Dữ kiện duy nhất: học viên báo thấy mệt sau một số buổi tập.', 'Chưa có thông tin thời điểm, triệu chứng kèm theo hoặc kế hoạch chăm sóc.'],
      steps: ['Giữ dữ kiện: học viên báo mệt; chưa xác định nguyên nhân.', 'Ghi điều chưa biết và chỉ hỏi thông tin cần thiết.', 'Câu hỏi gửi chuyên môn: cần đánh giá gì và giới hạn hoạt động nào nên tuân theo?', 'Không đề xuất giảm thuốc hoặc thêm protein điều trị.'],
      answer: 'Một hồ sơ tốt làm rõ điều chưa biết, thay vì viết kết luận chắc chắn từ một triệu chứng.',
      limitation: 'Nếu hiện có dấu hiệu cấp tính nghiêm trọng, bỏ qua việc soạn phiếu để tìm trợ giúp ngay.',
    },
    {
      id: 'ch17-urgent-example', title: 'Không chờ hoàn thành bài', objectiveIds: ['ch17-urgent'],
      prompt: 'Trong tình huống giả định, học viên mất ý thức tại buổi tập. App đang yêu cầu điền đủ các ô.',
      given: ['Không thể xác định nguyên nhân bằng bài học hoặc qua tin nhắn.', 'Có người hỗ trợ tại chỗ.'],
      steps: ['Dừng hoạt động và gọi trợ giúp khẩn cấp.', 'Làm theo hướng dẫn của nhân viên cấp cứu và quy trình sơ cứu phù hợp.', 'Không trì hoãn để đoán nguyên nhân, xin điểm danh hoặc điền phiếu.'],
      answer: 'An toàn và trợ giúp y tế đi trước quy trình app.',
      limitation: 'Đây là nhận diện thứ tự ưu tiên, không phải bài huấn luyện hồi sức.',
    },
  ],
  cases: [
    { id: 'ch17-case-salt', title: 'Chất thay muối', context: 'Một người có bệnh thận muốn tự đổi sang sản phẩm “ít natri”, nhưng chưa xem thành phần.', question: 'Cần hỏi gì trước?', reasoning: ['Nhãn ít natri không tự bảo đảm phù hợp.', 'Cần kiểm tra thành phần và hướng dẫn hiện có.', 'Chuyển câu hỏi về mức phù hợp cho đội ngũ chăm sóc.'], safeNextStep: 'Mang nhãn tới người phụ trách, không tự dùng theo lời khuyên chung.', commonError: 'Một chỉ số tốt hơn nghĩa là phù hợp mọi bệnh.' },
    { id: 'ch17-case-fasting', title: 'Nhịn bữa để tập giảm cân', context: 'Học viên đang dùng thuốc đái tháo đường hỏi có nên bỏ bữa trước buổi tập mới không.', question: 'Vì sao không trả lời chỉ bằng phép tính calorie?', reasoning: ['Thuốc, bữa ăn và vận động có thể tương tác về nguy cơ.', 'Chưa biết kế hoạch an toàn cá nhân.', 'Không thay thuốc hoặc tạo thử nghiệm nhịn bữa trong khóa học.'], safeNextStep: 'Xác nhận kế hoạch với đội ngũ điều trị trước thay đổi.', commonError: 'Đưa cùng lời khuyên nhịn ăn như người khỏe mạnh.' },
    { id: 'ch17-case-privacy', title: 'Nộp ảnh toàn bộ hồ sơ', context: 'Học viên định gửi giấy tờ y tế có thông tin định danh vào bài thực hành để được điểm cao.', question: 'Cần bao nhiêu thông tin cho mục tiêu học?', reasoning: ['Mục tiêu là kỹ năng lập phiếu, không đánh giá bệnh.', 'Có thể dùng dữ liệu giả định.', 'Chỉ chia sẻ phần cần thiết với đúng người khi có đồng ý.'], safeNextStep: 'Nộp phiếu giả định, không tải hồ sơ định danh vào bài học.', commonError: 'Càng nhiều dữ liệu nhạy cảm thì bài càng đầy đủ.' },
  ],
  practice: {
    title: 'Hồ sơ phối hợp chuyên môn', artifact: 'Một phiếu giả định có dữ kiện, câu hỏi, người nhận và ranh giới hành động.',
    steps: ['Chọn một tình huống giả định.', 'Tách điều đã biết khỏi điều chưa biết.', 'Viết câu hỏi và người nhận phù hợp.', 'Ghi việc không tự làm và bước khi cần trợ giúp ngay.'],
    fields: [
      { id: 'context', label: 'Dữ kiện đã biết', prompt: 'Ghi nguồn và thời điểm; không dùng thông tin định danh.', required: true },
      { id: 'hypothesis', label: 'Điều chưa biết và câu hỏi', prompt: 'Không dùng giả thuyết làm chẩn đoán; câu hỏi nào cần chuyên môn?', required: true },
      { id: 'action', label: 'Bước phối hợp', prompt: 'Ai nhận câu hỏi, liên hệ bằng cách nào, đã có sự đồng ý chưa?', required: true },
      { id: 'minimum', label: 'Nếu chưa kết nối được', prompt: 'Không tự sửa điều trị; nếu diễn biến nghiêm trọng thì tìm trợ giúp ngay.', required: true },
      { id: 'data', label: 'Thông tin tối thiểu cần gửi', prompt: 'Nêu phần cần thiết và phần nhạy cảm không đưa vào bài học.', required: true },
      { id: 'stop', label: 'Giới hạn và tình huống khẩn cấp', prompt: 'Nêu việc không tự làm và vì sao không chờ ngày rà khi cần trợ giúp.', required: true },
    ],
    modelResponse: ['Tình huống giả định: người có bệnh thận hỏi lượng protein; chưa biết hướng dẫn điều trị.', 'Tôi không tính gram từ cân nặng. Tôi giúp chuẩn bị nhãn và câu hỏi cho đội ngũ chăm sóc.', 'Chỉ gửi thông tin cần thiết với sự đồng ý; bài nộp không có hồ sơ định danh.', 'Nếu có diễn biến nghiêm trọng, không chờ phản hồi bài thực hành.'],
    rubric: [
      { id: 'data', label: 'Dữ kiện và riêng tư', levels: ['Suy đoán thành chẩn đoán hoặc lộ dữ liệu không cần thiết.', 'Có dữ kiện nhưng chưa tách điều chưa biết.', 'Nguồn, điều chưa biết và dữ liệu tối thiểu rõ ràng.'] },
      { id: 'mechanism', label: 'Nhận diện giới hạn', levels: ['Kê dinh dưỡng hoặc đổi thuốc.', 'Nêu giới hạn chung nhưng chưa gắn tình huống.', 'Phân biệt giáo dục, hỗ trợ và quyết định chuyên môn.'] },
      { id: 'feasibility', label: 'Kết nối chăm sóc', levels: ['Chỉ nói đi hỏi mà không có bước tiếp.', 'Có người nhận hoặc cách liên hệ.', 'Có người nhận, cách liên hệ, đồng ý và bước dự phòng.'] },
      { id: 'safety', label: 'Ưu tiên trợ giúp', levels: ['Đề nghị chờ phiếu hoặc tự thử khi có nguy cơ.', 'Biết cần trợ giúp nhưng thứ tự chưa rõ.', 'Không trì hoãn khẩn cấp; không tự đổi điều trị.'] },
    ],
  },
  coachExtension: ['Chấm cách xác định giới hạn, không yêu cầu dự đoán chẩn đoán.', 'Dừng và sửa bài nếu học viên đề xuất thay thuốc hoặc mức dưỡng chất điều trị.', 'Không yêu cầu người học chứng minh bệnh hoặc cung cấp hồ sơ thật để đạt điểm.'],
  safety: ['Chương này không cấp năng lực hành nghề lâm sàng.', 'Không tự thay thuốc, xét nghiệm hoặc chế độ điều trị.', 'Tình huống cấp cứu không chờ app, coach hoặc ngày rà bài.'],
  referenceIds: ['niddk-ckd-nutrition', 'niddk-hypoglycemia', 'nhs-hypoglycemia'],
}
