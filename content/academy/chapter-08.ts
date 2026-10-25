import type { AcademyLearningUnit } from './learning-unit'

export const chapter08Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 8, revision: '2026-10-24.1',
  title: 'Ước tính nhu cầu năng lượng: đúng đơn vị, đúng phạm vi, biết độ bất định',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành học đọc công thức; PT luyện giải thích một ước tính, không kê mức ăn điều trị.',
  scope: 'Tính trên hồ sơ giả định và thiết kế phiếu quan sát. Không tự động chuyển kết quả thành mục tiêu calorie hoặc mức thâm hụt.',
  prerequisites: [2, 3, 7],
  objectives: [
    { id: 'ch08-ree', outcome: 'Phân biệt REE dự đoán với tổng tiêu hao trong ngày.', evidence: 'Ghi đúng tên đại lượng và đơn vị của kết quả.' },
    { id: 'ch08-calculate', outcome: 'Thực hiện công thức Mifflin–St Jeor và kiểm tra đầu vào.', evidence: 'Một phép tính đầy đủ với kg, cm, năm và hệ số đã nêu.' },
    { id: 'ch08-uncertainty', outcome: 'Trình bày tác động của giả định hoạt động mà không đếm trùng.', evidence: 'Hai kịch bản minh họa và lý do không cộng thêm một buổi tập đã được tính.' },
    { id: 'ch08-boundary', outcome: 'Nhận ra khi nào công cụ không đủ cơ sở để ra quyết định.', evidence: 'Phiếu ghi dữ liệu còn thiếu và câu hỏi dành cho chuyên môn.' },
  ],
  sections: [
    {
      id: 'ch08-meaning', title: 'Công thức trả lời một câu hỏi hẹp', objectiveIds: ['ch08-ree', 'ch08-boundary'],
      paragraphs: [
        'REE là tiêu hao năng lượng lúc nghỉ. Tổng tiêu hao trong ngày còn có những thành phần khác; vì thế REE dự đoán không đồng nghĩa lượng nên ăn. Trước khi bấm máy, viết câu hỏi: tôi đang ước tính đại lượng nào, bằng mô hình nào và để làm gì?',
        'Nghiên cứu Mifflin–St Jeor năm 1990 xây dựng phương trình trên 498 người khỏe mạnh, 19–78 tuổi. Phương trình mô tả quan hệ trong mẫu nghiên cứu, không đo trực tiếp từng người. Một kết quả có số lẻ không chứng minh độ chính xác đến từng calorie.',
        'Không lấy công thức người trưởng thành làm mặc định cho trẻ em, mang thai, cho con bú hoặc tình huống cần dinh dưỡng lâm sàng. Công cụ Body Weight Planner của NIDDK cũng có giới hạn đối tượng riêng; điều đó không có nghĩa mọi máy tính trên mạng dùng cùng mô hình.',
      ],
      takeaways: ['Tên đại lượng và phạm vi đối tượng phải đi kèm kết quả.', 'Chính xác về phép tính không đồng nghĩa chính xác về dự đoán.'],
      sourceIds: ['mifflin-1990', 'niddk-body-weight-planner'],
    },
    {
      id: 'ch08-formula', title: 'Viết đơn vị trước, thay số sau', objectiveIds: ['ch08-calculate'],
      paragraphs: [
        'Dạng đơn giản của Mifflin–St Jeor: REE = 10 × W + 6,25 × H − 5 × A + s; W là kg, H là cm, A là tuổi theo năm. Nghiên cứu gốc dùng s = +5 ở nhóm nam và −161 ở nhóm nữ. Đây là các biến phân nhóm của mô hình gốc, không phải công cụ xác định bản dạng giới hoặc lời khẳng định phù hợp cho mọi người.',
        'Trong bài tập, hệ số được cho sẵn. Ngoài đời, nếu bối cảnh không khớp mô hình hoặc không biết chọn thế nào, ghi nhận giới hạn và hỏi người có chuyên môn; không tự suy từ tên, ngoại hình hay dữ liệu hồ sơ thiếu.',
        'Kiểm tra lỗi phổ biến: nhập 1,60 thay vì 160 cho chiều cao tính bằng cm; dùng pound ở ô kg; quên dấu trừ; gọi kết quả là TDEE. Giữ phép tính từng dòng để phát hiện lỗi, sau đó làm tròn ở bước diễn giải.',
      ],
      takeaways: ['Đầu vào sai đơn vị có thể tạo kết quả máy tính vẫn chấp nhận.', 'Không làm tròn nhiều lần giữa các bước.'],
      sourceIds: ['mifflin-1990'],
    },
    {
      id: 'ch08-scenarios', title: 'Một khoảng kịch bản không phải khoảng tin cậy', objectiveIds: ['ch08-uncertainty'],
      paragraphs: [
        'Để học tính nhạy, bài này cho hai hệ số hoạt động giả định 1,4 và 1,6. Chúng không phải bảng chọn hệ số đã thẩm định cho học viên. Nhân REE với hai số cho thấy kết quả phụ thuộc giả định ra sao; hai đầu mút không phải khoảng tin cậy thống kê và không bảo đảm nhu cầu thật nằm bên trong.',
        'Nếu định nghĩa hệ số đã bao gồm hoạt động trong cả ngày, cộng thêm calorie của buổi tập sẽ tính lại cùng phần hoạt động. Muốn cộng riêng phải có một mô hình thành phần khác được mô tả rõ. Không ghép số từ hai mô hình chỉ vì app có sẵn các ô.',
        'Kết quả nên có bốn phần: mô hình, đầu vào, giả định và giới hạn. Thêm nhiều chữ số hoặc chọn số ở giữa không tự sửa được một giả định chưa có căn cứ.',
      ],
      takeaways: ['Khoảng do đổi giả định khác với sai số được nghiên cứu.', 'Kiểm tra thành phần đã được tính trước khi cộng.'],
      sourceIds: ['mifflin-1990', 'niddk-body-weight-planner'],
    },
    {
      id: 'ch08-observe', title: 'Từ con số sang câu hỏi kiểm chứng', objectiveIds: ['ch08-boundary', 'ch08-uncertainty'],
      paragraphs: [
        'Đầu ra của chương là phiếu kiểm tra, chưa phải kế hoạch ăn kiêng. Với hồ sơ giả định, ghi điều cần biết thêm: ngày làm việc và nghỉ khác nhau thế nào, thông tin ăn uống ghi theo đơn vị nào, dữ liệu nào chưa đủ tin cậy và ai có thể xác minh.',
        'Có thể thiết kế bảy ngày chuẩn bị cách ghi, rồi mười bốn ngày quan sát theo lịch học. Đây là mốc tổ chức bài tập, không phải ngưỡng sinh học để khẳng định đã biết nhu cầu năng lượng. Không bắt buộc cân hoặc đếm calorie nếu điều đó gây căng thẳng; bài tập bằng dữ liệu giả định có giá trị tương đương.',
        'Khi mô hình và quan sát khác nhau, liệt kê nhiều khả năng thay vì lập tức cắt ăn: đầu vào, đơn vị, hoạt động, dữ liệu thiếu hoặc độ phù hợp của mô hình. Học viên chỉ nộp câu hỏi và phương án kiểm tra an toàn, không phải chứng minh đã giảm cân.',
      ],
      takeaways: ['Không lấy một ngày làm phép kiểm định mô hình.', 'Điểm bài tập dựa trên lập luận, không dựa trên thay đổi cân nặng.'],
      sourceIds: ['niddk-body-weight-planner'],
    },
  ],
  workedExamples: [
    {
      id: 'ch08-ree-example', title: 'Hồ sơ giả định: 60 kg, 160 cm, 30 tuổi', objectiveIds: ['ch08-calculate', 'ch08-ree'],
      prompt: 'Tính REE với hệ số −161 được cho sẵn trong đề. Không dùng kết quả làm chỉ định ăn.',
      given: ['W = 60 kg; H = 160 cm; A = 30 năm; s = −161.'],
      steps: ['10 × 60 = 600.', '6,25 × 160 = 1.000.', '5 × 30 = 150.', 'REE = 600 + 1.000 − 150 − 161 = 1.289 kcal/ngày.'],
      answer: 'REE dự đoán 1.289 kcal/ngày; khi giải thích có thể nói khoảng 1.290. Đây không phải tổng tiêu hao hoặc mức ăn đề xuất.',
      limitation: 'Đúng số học không loại bỏ sai số dự đoán hoặc giới hạn đối tượng.',
    },
    {
      id: 'ch08-range-example', title: 'Tính nhạy với hai giả định', objectiveIds: ['ch08-uncertainty'],
      prompt: 'Dùng REE trên và hai hệ số giả định để thấy độ nhạy của kết quả.',
      given: ['REE = 1.289 kcal/ngày.', 'Hai kịch bản minh họa: hệ số 1,4 và 1,6; chưa xác định hệ số phù hợp cho người thật.'],
      steps: ['Kịch bản A: 1.289 × 1,4 = 1.804,6.', 'Kịch bản B: 1.289 × 1,6 = 2.062,4.', 'Chênh lệch: 257,8 kcal/ngày.', 'Diễn giải làm tròn: hai kịch bản khoảng 1.805 và 2.062 kcal/ngày, không phải khoảng tin cậy.'],
      answer: 'Chỉ đổi giả định đã làm kết quả khác khoảng 258 kcal/ngày; chưa đủ để chọn một mục tiêu ăn.',
      limitation: 'Hai hệ số là dữ kiện bài toán, không phải khuyến nghị chọn mức hoạt động.',
    },
    {
      id: 'ch08-double-count', title: 'Vì sao không cộng thêm 300?', objectiveIds: ['ch08-uncertainty'],
      prompt: 'Một mô hình giả định đã tính cả buổi tập trong hệ số ngày. Đồng hồ báo buổi tập 300 kcal.',
      given: ['Tổng theo mô hình: 2.000 kcal/ngày, đã bao gồm buổi tập.', 'Đồng hồ hiển thị 300 kcal cho chính buổi tập đó.'],
      steps: ['Xác định cùng buổi tập có nằm trong hai con số không.', 'Đề đã nói có, nên 2.000 + 300 tính trùng thành phần.', 'Giữ kết quả của mô hình kèm giới hạn, không dùng số đồng hồ để sửa tùy ý.'],
      answer: 'Không đủ cơ sở đổi thành 2.300 chỉ bằng phép cộng trên.',
      limitation: 'Nếu mô hình nền có định nghĩa khác, phải phân tích lại; bài này không xác minh độ chính xác của đồng hồ.',
    },
  ],
  cases: [
    { id: 'ch08-case-unit', title: 'Máy tính vẫn hiện một con số', context: 'Linh nhập chiều cao 1,60 vào ô cm. Công thức không báo lỗi.', question: 'Kiểm tra gì trước khi dùng kết quả?', reasoning: ['Đọc lại đơn vị từng ô.', 'Đổi 1,60 m thành 160 cm.', 'Tính lại và ghi đây là REE dự đoán.'], safeNextStep: 'Lưu cả đầu vào và đơn vị vào phiếu.', commonError: 'Tin số hiển thị vì giao diện không báo đỏ.' },
    { id: 'ch08-case-busy', title: 'Ba buổi tập chưa mô tả cả tuần', context: 'Hai người đều tập ba buổi nhưng một người ngồi làm việc, một người di chuyển nhiều.', question: 'Có đủ cơ sở gán cùng hệ số chỉ từ số buổi tập không?', reasoning: ['Số buổi không mô tả toàn bộ hoạt động.', 'Cần định nghĩa hệ số và dữ liệu của các ngày.', 'Nêu chưa đủ thông tin thay vì chọn hệ số cao hơn cho chắc.'], safeNextStep: 'Lập hai hồ sơ hoạt động bằng dữ liệu giả định, không kê calorie.', commonError: 'Cộng tất cả calorie đồng hồ vào một hệ số đã gồm tập.' },
    { id: 'ch08-case-pregnancy', title: 'Muốn dùng công thức khi mang thai', context: 'Một học viên hỏi lấy REE rồi trừ 500 để giảm cân khi mang thai được không.', question: 'Phạm vi bài học có cho phép quyết định này không?', reasoning: ['Ví dụ người lớn khỏe mạnh không phải hướng dẫn cho thai kỳ.', 'REE không phải lượng ăn và không suy ra mức thâm hụt an toàn.', 'Cần trao đổi đội ngũ chăm sóc thai kỳ.'], safeNextStep: 'Chuẩn bị câu hỏi và không đưa mục tiêu giảm calorie từ công thức này.', commonError: 'Chỉ cần cộng một hệ số khác là thành tư vấn thai kỳ.' },
  ],
  practice: {
    title: 'Phiếu kiểm tra một ước tính năng lượng', artifact: 'Phép tính kiểm tra được, hai kịch bản và danh sách điều chưa biết.',
    steps: ['Dùng hồ sơ giả định của chương.', 'Viết đơn vị và thực hiện công thức từng dòng.', 'So hai kịch bản, ghi phần hoạt động đã bao gồm.', 'Nêu giới hạn và kế hoạch thu thập dữ liệu không gây áp lực.'],
    fields: [
      { id: 'context', label: 'Đầu vào và đối tượng mô hình', prompt: 'Ghi kg, cm, năm, hệ số của đề và nguồn công thức.', required: true },
      { id: 'hypothesis', label: 'Đại lượng đang ước tính', prompt: 'Kết quả là REE hay tổng ngày? Điều gì chưa được đo?', required: true },
      { id: 'action', label: 'Phép tính có đơn vị', prompt: 'Viết từng dòng và kết quả; không ghi mục tiêu giảm calorie.', required: true },
      { id: 'minimum', label: 'Kiểm tra lỗi và đếm trùng', prompt: 'Nêu một lỗi đơn vị và một thành phần không cộng hai lần.', required: true },
      { id: 'data', label: 'Kịch bản và dữ liệu còn thiếu', prompt: 'So hai giả định; vì sao khoảng này không phải khoảng tin cậy?', required: true },
      { id: 'stop', label: 'Giới hạn và người cần hỏi', prompt: 'Khi nào không áp công thức phổ thông hoặc không nên tiếp tục tự theo dõi?', required: true },
    ],
    modelResponse: ['REE của đề là 1.289 kcal/ngày, không phải mức ăn.', 'Hai hệ số đề cho tạo hai kịch bản 1.804,6 và 2.062,4; chưa biết kịch bản nào phù hợp.', 'Nếu hệ số đã gồm tập, không cộng lại calorie buổi tập.', 'Dùng dữ liệu giả định; trường hợp mang thai cần đội ngũ chăm sóc đánh giá riêng.'],
    rubric: [
      { id: 'data', label: 'Đầu vào', levels: ['Thiếu hoặc nhầm đơn vị.', 'Đúng số nhưng thiếu nguồn hoặc đối tượng.', 'Đủ số, đơn vị, nguồn và giới hạn mẫu.'] },
      { id: 'mechanism', label: 'Mô hình và phép tính', levels: ['Nhầm REE với mức ăn hoặc đếm trùng.', 'Tính đúng nhưng chưa diễn giải giả định.', 'Tính đúng, gọi đúng đại lượng, chỉ rõ bất định.'] },
      { id: 'feasibility', label: 'Kế hoạch kiểm tra', levels: ['Đề xuất thay ăn ngay.', 'Có dữ liệu cần ghi nhưng chưa rõ mục đích.', 'Có câu hỏi, dữ liệu tối thiểu và phương án giả định.'] },
      { id: 'safety', label: 'Phạm vi', levels: ['Áp công thức cho mọi đối tượng.', 'Có cảnh báo chung.', 'Nêu trường hợp không áp và hướng phối hợp phù hợp.'] },
    ],
  },
  coachExtension: ['Đổi duy nhất một đầu vào để học viên phát hiện độ nhạy.', 'Yêu cầu phân biệt kết quả số học, dự đoán và quyết định.', 'Không chấm cao hơn vì học viên giảm cân hoặc ghi nhật ký chi li.'],
  safety: ['Không kê mức ăn từ ví dụ.', 'Không dùng mốc 7 hoặc 14 ngày như bảo đảm xác định nhu cầu.', 'Có thể hoàn thành bằng hồ sơ giả định; không cần công khai cân nặng hay tình trạng sức khỏe.'],
  referenceIds: ['mifflin-1990', 'niddk-body-weight-planner'],
}
