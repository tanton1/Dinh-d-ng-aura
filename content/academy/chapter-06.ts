import type { AcademyLearningUnit } from './learning-unit'

export const chapter06Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 6, revision: '2026-10-24.1',
  title: 'Hormone, insulin và đường huyết: hiểu điều phối, đọc đúng giới hạn',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên trưởng thành học sinh lý nền; coach luyện đọc dữ kiện và chuyển câu hỏi, không làm thay người điều trị.',
  scope: 'Giải thích vai trò hormone và phân biệt các loại dữ liệu glucose bằng ca giả định. Không chẩn đoán, đặt ngưỡng điều trị, chỉnh thuốc hoặc tự thử nhịn ăn để kiểm chứng.',
  prerequisites: [2, 3, 5],
  objectives: [
    { id: 'ch06-regulation', outcome: 'Giải thích insulin và glucagon như tín hiệu phối hợp sử dụng, dự trữ và cung cấp glucose.', evidence: 'Sửa sơ đồ coi insulin là chất độc hoặc coi glucagon là lệnh bỏ ăn.' },
    { id: 'ch06-measures', outcome: 'Phân biệt glucose ở một thời điểm, CGM và HbA1c.', evidence: 'Ghi đúng nguồn, đơn vị, khoảng thời gian và điều một con số không cho biết.' },
    { id: 'ch06-context', outcome: 'Đọc dữ liệu có bối cảnh mà không chẩn đoán từ buồn ngủ hoặc một điểm cao.', evidence: 'Viết lại một kết luận vội thành dữ kiện, thông tin thiếu và câu hỏi chuyên môn.' },
    { id: 'ch06-handoff', outcome: 'Chọn bước phối hợp an toàn khi có thuốc, cảnh báo thiết bị hoặc triệu chứng.', evidence: 'Nêu điều không tự đổi và tình huống không được chờ coach hoặc bài học.' },
  ],
  sections: [
    {
      id: 'ch06-signals', title: 'Tụy gửi tín hiệu; cơ thể không có một công tắc duy nhất', objectiveIds: ['ch06-regulation'],
      paragraphs: [
        'Tế bào beta của tụy tiết insulin; tế bào alpha tiết glucagon. Insulin hỗ trợ sử dụng và dự trữ glucose, còn glucagon giúp gan đưa glucose ra khi cần. Hai tín hiệu tham gia điều hòa nguồn nhiên liệu, không phải một hormone tốt đối đầu một hormone xấu.',
        'Sau ăn và giữa các bữa, nguồn glucose vào máu và cách mô sử dụng nó thay đổi. Hình dung phản hồi là tín hiệu thay đổi khi điều kiện thay đổi, không phải mệnh lệnh để glucose luôn thành một đường thẳng. Không suy từ vai trò dự trữ sang kết luận phải triệt tiêu insulin.',
        'Kháng insulin nói về đáp ứng kém với insulin; thiếu insulin nói về lượng insulin không đáp ứng nhu cầu. Hai ý này không được dùng thay nhau và không thể phân loại chỉ bằng cảm giác sau ăn. Trong bài làm, hãy gọi đúng cơ chế rồi dừng trước kết luận người cụ thể có bệnh gì.',
      ],
      takeaways: ['Insulin có vai trò sinh lý cần thiết, không phải thứ cần loại bỏ.', 'Sơ đồ phản hồi giúp hiểu cơ chế; không tạo ra toa điều chỉnh hormone.'], sourceIds: ['openstax-pancreas', 'niddk-insulin-resistance'],
    },
    {
      id: 'ch06-data-types', title: 'Ba loại dữ liệu trả lời ba câu hỏi khác nhau', objectiveIds: ['ch06-measures'],
      paragraphs: [
        'Một kết quả glucose cần biết được lấy lúc nào, bằng phương pháp nào và dùng đơn vị gì. CGM sử dụng tín hiệu từ dịch giữa tế bào để ước lượng glucose theo thời gian; không phải mỗi điểm đều là một mẫu máu xét nghiệm. Việc dùng và xác minh cảnh báo phải theo thiết bị cùng kế hoạch chăm sóc riêng.',
        'HbA1c liên quan lượng glucose gắn với hemoglobin và phản ánh bối cảnh khoảng ba tháng. Nó không kể lại mọi đỉnh và đáy từng giờ. Một số tình trạng ảnh hưởng hồng cầu hoặc hemoglobin có thể làm diễn giải khó hơn; khi số liệu không khớp, câu hỏi thuộc người phụ trách đánh giá, không phải tự chọn số mình thích.',
        'Trong bài học, nhãn dữ liệu phải gồm “đây là gì” và “không phải là gì”. Ví dụ % HbA1c không là % đường trong bữa ăn, còn ảnh một đoạn CGM không đại diện toàn bộ ba tháng. Không ghép các loại đơn vị vào một phép so sánh hơn–kém chỉ vì đều có chữ glucose.',
      ],
      takeaways: ['Ghi loại phép đo, thời điểm, đơn vị và nguồn trước diễn giải.', 'Trung bình dài hạn không thay toàn bộ thông tin dao động ngắn hạn.'], sourceIds: ['niddk-cgm', 'niddk-a1c'],
    },
    {
      id: 'ch06-read-context', title: 'Một đường cong cần bối cảnh, không chỉ một món để đổ lỗi', objectiveIds: ['ch06-context'],
      paragraphs: [
        'Dữ liệu glucose có thể thay đổi cùng ăn uống, vận động, bệnh và stress. Khi xem một hình chụp, hỏi phần trước và sau đã có chưa, thời gian có đúng không, có thuốc hoặc hướng dẫn nào liên quan không. Những câu hỏi này hỗ trợ trao đổi; không biến người học thành người tự đọc bệnh qua đồ thị.',
        'Hai chuỗi dữ liệu giả định có thể cùng trung bình nhưng khác mức dao động. Ngược lại, hai bữa khác ngày không phải phép thử kiểm soát để kết luận chỉ một thành phần gây ra khác biệt. Viết rõ phần quan sát và các giải thích có thể, không gán chắc nguyên nhân chỉ vì hình vẽ trông thuyết phục.',
        'Không có triệu chứng cũng không chứng minh không có vấn đề; buồn ngủ sau ăn cũng không đủ chứng minh kháng insulin. Nếu có lý do cần kiểm tra sức khỏe, hỏi nhân viên y tế về đánh giá phù hợp. Khóa này không yêu cầu mua CGM, xét nghiệm hoặc tự tạo một đỉnh đường để đủ dữ liệu nộp bài.',
      ],
      takeaways: ['Không biến một món hoặc một cảm giác thành chẩn đoán.', 'Bài thực hành dùng dữ liệu giả định, không đòi tự thử gây biến động glucose.'], sourceIds: ['niddk-a1c', 'niddk-insulin-resistance', 'cochrane-interpretation'],
    },
    {
      id: 'ch06-care-boundary', title: 'Bước tiếp theo có thể là phối hợp, không phải thay bữa ngay', objectiveIds: ['ch06-handoff'],
      paragraphs: [
        'Với người dùng thuốc hạ glucose, thay lượng ăn hoặc vận động có thể liên quan nguy cơ hạ đường huyết. Không tự sửa thuốc, bỏ bữa hay tăng tập để làm đồ thị đẹp hơn. Giữ kế hoạch đã được đội ngũ điều trị hướng dẫn và chuyển câu hỏi về thay đổi cụ thể cho họ.',
        'Cảnh báo thiết bị hoặc triệu chứng không nên bị gạt bỏ bằng câu “có thể chỉ là sai số”. Làm theo kế hoạch chăm sóc và hướng dẫn thiết bị; tìm trợ giúp khi cần. Nếu mất ý thức, co giật hoặc không thể nuốt an toàn, ưu tiên trợ giúp khẩn cấp tại địa phương; không cố cho ăn uống và không chờ phản hồi trên app.',
        'Phiếu của chương ghi dữ kiện, điều chưa rõ, hướng dẫn hiện có và câu hỏi cần gửi đúng người. Không cần nộp tên thuốc, kết quả xét nghiệm hoặc hồ sơ thật. Khi dùng ca giả định, chấm khả năng giữ phạm vi và nhận ra mức khẩn cấp, không chấm tài đoán chẩn đoán.',
      ],
      takeaways: ['Giới hạn của phép đo không phải lý do bỏ qua cảnh báo.', 'Bài học và phản hồi coach không được trì hoãn chăm sóc cần thiết.'], sourceIds: ['niddk-hypoglycemia', 'nhs-hypoglycemia', 'niddk-cgm'],
    },
  ],
  workedExamples: [
    {
      id: 'ch06-loop-example', title: 'Sửa sơ đồ “insulin càng thấp càng tốt”', objectiveIds: ['ch06-regulation'],
      prompt: 'Một sơ đồ học tập gọi insulin là chất có hại vì có liên quan dự trữ. Hãy viết lại mà không kê chế độ ăn.',
      given: ['Đề chỉ mô tả cơ chế, không có hồ sơ bệnh.', 'Sơ đồ bỏ qua sử dụng glucose và vai trò cung cấp glucose của gan.', 'Không có dữ liệu hormone hoặc kết quả đánh giá cá nhân.'],
      steps: ['Đổi nhãn phán xét thành vai trò: insulin hỗ trợ sử dụng và dự trữ.', 'Thêm glucagon và gan trong điều phối nguồn glucose.', 'Giải thích tín hiệu thay đổi theo điều kiện, không đặt mục tiêu triệt tiêu hormone.', 'Ghi rằng sơ đồ chưa nói người nào cần thuốc hoặc chế độ ăn nào.'],
      answer: 'Một mô hình phối hợp thay cho đối lập tốt–xấu; chưa có chỉ định giảm insulin hoặc bỏ carbohydrate.',
      limitation: 'Sơ đồ là sinh lý đơn giản, không mô tả mọi hormone hoặc phân loại bệnh ở một người.',
    },
    {
      id: 'ch06-mean-example', title: 'Cùng trung bình, không cùng chuỗi', objectiveIds: ['ch06-measures', 'ch06-context'],
      prompt: 'Hai chuỗi glucose giả định có ba điểm cùng khoảng cách thời gian, cùng đơn vị mg/dL. Chỉ luyện phép tính, không áp ngưỡng lâm sàng.',
      given: ['A: 90, 120, 150 mg/dL.', 'B: 120, 120, 120 mg/dL.', 'Không có thông tin về bệnh, bữa ăn, thuốc hay phương pháp đo.'],
      steps: ['Trung bình A = (90 + 120 + 150) / 3 = 120 mg/dL.', 'Trung bình B = (120 + 120 + 120) / 3 = 120 mg/dL.', 'Khoảng biến thiên A là 150 − 90 = 60 mg/dL; B là 0 mg/dL trong các điểm đã cho.', 'Chỉ kết luận trung bình bằng nhau không chứng minh các chuỗi giống nhau; không suy HbA1c từ ba điểm.'],
      answer: 'Cả hai trung bình 120 mg/dL; khoảng biến thiên của các điểm là 60 và 0 mg/dL.',
      limitation: 'Không phân loại chuỗi nào khỏe hơn, không xác định bệnh và không xem ba điểm như báo cáo CGM đầy đủ.',
    },
    {
      id: 'ch06-note-example', title: 'Đổi lời khuyên vội thành câu hỏi phối hợp', objectiveIds: ['ch06-context', 'ch06-handoff'],
      prompt: 'Ca giả định có người báo buồn ngủ sau trưa và đang dùng thuốc hạ glucose. Một bạn khuyên bỏ cơm rồi tăng tập.',
      given: ['Chưa biết giờ, diễn biến, dữ liệu đo hay hướng dẫn điều trị.', 'Không được tự thay thuốc hoặc ăn uống để kiểm chứng.', 'Mục tiêu là viết phiếu hỏi, không xử trí bệnh.'],
      steps: ['Ghi đúng lời báo, chưa đặt tên nguyên nhân.', 'Đánh dấu dữ liệu còn thiếu và hỏi hướng dẫn chăm sóc hiện có.', 'Loại bỏ lời khuyên tự bỏ bữa hoặc tăng tập để sửa đồ thị.', 'Chuyển câu hỏi cho người điều trị; nếu có triệu chứng đáng lo hoặc cảnh báo, ưu tiên kế hoạch chăm sóc, không chờ bài học.'],
      answer: 'Phiếu mô tả và hỏi đúng người thay cho chẩn đoán kháng insulin hoặc chỉ định thay bữa từ một cảm giác.',
      limitation: 'Không dùng bài mẫu để trì hoãn hỗ trợ khi tình huống thật cần xử trí sớm hoặc cấp cứu.',
    },
  ],
  cases: [
    { id: 'ch06-case-chart', title: 'Chụp một đỉnh rồi cấm món', context: 'Hùng chụp một điểm CGM sau cơm và muốn cấm cơm cho cả gia đình.', question: 'Kết luận đang vượt dữ kiện ở đâu?', reasoning: ['Một điểm chưa mô tả chuỗi và bối cảnh.', 'Một trải nghiệm không là thử nghiệm kiểm soát hoặc chỉ định cho người khác.', 'Cần phân biệt việc hỏi chuyên môn với tự xếp hạng thực phẩm bằng đồ thị.'], safeNextStep: 'Giữ dữ liệu đúng phạm vi và hỏi khi cần; không tự loại món hoặc sửa điều trị để săn đường phẳng.', commonError: 'Biến một điểm thiết bị thành chẩn đoán và quy tắc ăn cho mọi người.' },
    { id: 'ch06-case-a1c', title: 'A1c giống nhau, ngày sống khác nhau', context: 'Hai nhân vật có cùng một kết quả HbA1c giả định nhưng một người có cảnh báo thiết bị và triệu chứng.', question: 'Có thể bỏ qua cảnh báo vì trung bình giống nhau không?', reasoning: ['Chỉ số dài hạn không kể mọi dao động ngắn hạn.', 'Triệu chứng và cảnh báo cần được xem theo kế hoạch chăm sóc.', 'Bài học không chọn hoặc đổi ngưỡng điều trị cá nhân.'], safeNextStep: 'Thực hiện kế hoạch chăm sóc, tìm trợ giúp phù hợp; không dùng sự giống nhau của một số để trì hoãn.', commonError: 'Coi trung bình giống nhau đồng nghĩa mọi thời điểm đều an toàn như nhau.' },
    { id: 'ch06-case-urgent', title: 'Mất ý thức tại buổi tập', context: 'Trong ca giả định, người dùng thuốc hạ glucose mất ý thức khi tập.', question: 'Ưu tiên nào vượt mọi mục tiêu thu thập dữ liệu?', reasoning: ['Không thể tự xác định nguyên nhân qua bài học.', 'Mất ý thức cần trợ giúp khẩn cấp.', 'Người không nuốt an toàn không được cố cho ăn uống.'], safeNextStep: 'Dừng hoạt động, gọi trợ giúp khẩn cấp và làm theo hướng dẫn; không chờ coach duyệt hoặc cố cho uống nước đường.', commonError: 'Đợi đủ số đo, hỏi app hoặc cho ăn uống dù người đó không thể nuốt an toàn.' },
  ],
  practice: {
    title: 'Phiếu đọc dữ liệu glucose và chuyển câu hỏi', artifact: 'Một phiếu trên ca giả định, có sơ đồ hormone và ranh giới xử lý; không là thử nghiệm ăn uống bảy ngày.',
    steps: ['Sửa sơ đồ insulin–glucagon bằng vai trò thay vì nhãn tốt/xấu.', 'Chọn chuỗi giả định và ghi nguồn, đơn vị, thời gian cùng điều chưa biết.', 'Tách quan sát với diễn giải; viết câu hỏi cho người phụ trách chăm sóc.', 'Nêu điều không tự thay đổi và khi nào ưu tiên trợ giúp; không cần dữ liệu y tế thật.'],
    fields: [
      { id: 'context', label: 'Ca và dữ kiện', prompt: 'Mô tả ca giả định, loại phép đo, đơn vị, thời gian và hướng dẫn chăm sóc được đề bài cho biết.', required: true },
      { id: 'hypothesis', label: 'Cơ chế và giới hạn', prompt: 'Giải thích vai trò insulin/glucagon và điều không thể suy từ một cảm giác hoặc kết quả đơn lẻ.', required: true },
      { id: 'action', label: 'Câu hỏi phối hợp', prompt: 'Viết câu hỏi cùng dữ kiện cần gửi đúng người; không đề xuất tự đổi thuốc, bỏ bữa hoặc tăng tập.', required: true },
      { id: 'minimum', label: 'Khi thiếu thiết bị', prompt: 'Nếu không có CGM hoặc xét nghiệm, giữ được thông tin nào trong ca giả định mà không tự tạo số liệu?', required: true },
      { id: 'data', label: 'Kiểm tra bài viết', prompt: 'Tính hoặc phân loại dữ liệu ví dụ, ghi giới hạn và ngày rà bài; không coi ngày rà là mốc chờ chăm sóc.', required: true },
      { id: 'stop', label: 'Cảnh báo và cấp cứu', prompt: 'Nêu cách tôn trọng kế hoạch chăm sóc, cảnh báo thiết bị và tình huống mất ý thức/không nuốt an toàn.', required: true },
    ],
    modelResponse: ['Insulin và glucagon tham gia điều phối glucose, không phân loại tốt/xấu. Ca chỉ có ba điểm giả định, không là chẩn đoán hoặc HbA1c.', 'Trung bình hai chuỗi đều 120 mg/dL nhưng phạm vi các điểm khác nhau. Chưa biết bữa ăn, thuốc hoặc điều kiện đo; sẽ hỏi người phụ trách đánh giá thay vì cấm món.', 'Không đổi thuốc hoặc thử nhịn ăn. Cảnh báo xử lý theo kế hoạch; mất ý thức cần trợ giúp khẩn cấp, không cố cho ăn uống. Rà bài vào buổi học sau, không trì hoãn chăm sóc thật.'],
    rubric: [
      { id: 'data', label: 'Đúng loại dữ liệu', levels: ['Trộn đơn vị hoặc biến ba điểm thành chẩn đoán.', 'Có nguồn và đơn vị nhưng thiếu phạm vi thời gian.', 'Tách phép đo, thời gian, đơn vị và phần chưa biết; tính đúng phần đề cho.'] },
      { id: 'mechanism', label: 'Hiểu điều phối', levels: ['Coi insulin có hại hoặc nhầm trung bình với mọi dao động.', 'Nêu hormone nhưng chưa giải thích giới hạn dữ liệu.', 'Giải thích phối hợp và khác biệt phép đo; không suy bệnh từ một điểm.'] },
      { id: 'feasibility', label: 'Phiếu hỏi dùng được', levels: ['Không có câu hỏi hoặc thay bằng toa tự đặt.', 'Có câu hỏi nhưng thiếu người nhận hay thông tin cần thêm.', 'Phiếu ngắn, rõ người nhận và dữ liệu thiếu; làm được bằng ca giả định.'] },
      { id: 'safety', label: 'Không tự sửa điều trị', levels: ['Đổi thuốc, thử nhịn ăn, bỏ cảnh báo hoặc trì hoãn cấp cứu.', 'Giữ thuốc nhưng chưa rõ ưu tiên khi có cảnh báo.', 'Giữ kế hoạch chăm sóc, không tự thử; nhận ra cấp cứu và không cho ăn uống khi nuốt không an toàn.'] },
    ],
  },
  coachExtension: ['Yêu cầu người học gọi tên loại dữ liệu trước khi diễn giải con số.', 'Không nhận vai chỉnh thuốc hoặc điều trị qua ảnh CGM; giải thích giới hạn không đồng nghĩa xem nhẹ cảnh báo.', 'Đánh giá phiếu giả định và kỹ năng chuyển câu hỏi, không yêu cầu chia sẻ hồ sơ y tế thật.'],
  safety: ['Không tự đổi thuốc, nhịn ăn hoặc tăng tập để làm đẹp đồ thị.', 'Không bỏ qua cảnh báo hoặc triệu chứng vì nghĩ có sai số; làm theo kế hoạch chăm sóc và tìm trợ giúp.', 'Mất ý thức hoặc không nuốt an toàn cần trợ giúp khẩn cấp, không cố cho ăn uống.', 'Bài học không yêu cầu mua thiết bị, tự xét nghiệm hoặc nộp dữ liệu nhạy cảm thật.'],
  referenceIds: ['openstax-pancreas', 'niddk-insulin-resistance', 'niddk-cgm', 'niddk-a1c', 'cochrane-interpretation', 'niddk-hypoglycemia', 'nhs-hypoglycemia'],
}
