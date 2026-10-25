import type { AcademyLearningUnit } from './learning-unit'

export const chapter10Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 10, revision: '2026-10-24.1',
  title: 'Theo dõi tiến độ và điều chỉnh: ít chỉ số, rõ quyết định, giữ an toàn',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên trưởng thành tự tổ chức theo dõi; coach phản hồi minh chứng mà không biến điểm học thành đánh giá sức khỏe.',
  scope: 'Thiết kế bảng theo dõi và quy tắc quyết định trên dữ liệu giả định hoặc dữ liệu tối thiểu tự nguyện. Không kê thay đổi calorie/thuốc, không yêu cầu cân, chụp cơ thể hoặc đo BIA để hoàn thành bài.',
  prerequisites: [6, 7, 8, 9],
  objectives: [
    { id: 'ch10-signals', outcome: 'Chọn tối đa bốn tín hiệu theo câu hỏi: kết quả, quá trình, trải nghiệm và an toàn.', evidence: 'Giải thích mỗi tín hiệu sẽ hỗ trợ quyết định nào và dữ liệu nào không cần thu.' },
    { id: 'ch10-quality', outcome: 'Phân biệt biến thiên, sai số và giới hạn của phép đo thành phần cơ thể.', evidence: 'Mô tả cách ghi nhất quán, xử lý thiếu dữ liệu và không suy mỡ/cơ chính xác từ cân BIA.' },
    { id: 'ch10-decision', outcome: 'Viết quy tắc giữ, làm rõ, đơn giản hóa, điều chỉnh hoặc dừng dựa trên dữ kiện.', evidence: 'Nêu một quyết định cùng lý do, giới hạn và điều kiện xem lại, không phản ứng theo một điểm.' },
    { id: 'ch10-portfolio', outcome: 'Tổng hợp năm minh chứng đúng phiên bản và tách tự soi với nhận xét coach.', evidence: 'Lập tóm tắt chặng 6–10 có nguồn minh chứng, điều còn thiếu và bước tiếp theo phù hợp.' },
  ],
  sections: [
    {
      id: 'ch10-question-first', title: 'Chọn câu hỏi trước khi chọn chỉ số', objectiveIds: ['ch10-signals'],
      paragraphs: [
        'Một bảng theo dõi nên bắt đầu bằng quyết định cần hỗ trợ. Nếu câu hỏi là chuẩn bị bữa trưa có phù hợp ngày họp không, số lần dùng phương án và trở ngại có ích hơn một bảng cân nặng dày đặc. Chỉ số phải gắn với việc muốn hiểu, không được chọn chỉ vì ứng dụng có sẵn.',
        'Trong bài này, giới hạn tối đa bốn tín hiệu là quy tắc giảm gánh nặng học tập của Aura, không phải ngưỡng khoa học bắt buộc. Có thể chọn kết quả của kỹ năng, việc đã thực hiện, trải nghiệm và tín hiệu an toàn. Chẳng hạn số bữa có phương án phù hợp, lần chuẩn bị, mức phiền khi ghi và vấn đề cần hỏi hỗ trợ.',
        'Mỗi dòng cần tên, cách thu, tần suất phù hợp và quyết định được hỗ trợ. Nếu bỏ một chỉ số không làm mất thông tin cần ra quyết định, cân nhắc bỏ nó. Không buộc người học chia sẻ ảnh, số đo hay nhật ký y tế để chứng minh đã làm nghiêm túc; tình huống giả định vẫn đáp ứng mục tiêu.',
      ],
      takeaways: ['Không có chỉ số “hay” nếu chưa biết nó trả lời câu hỏi gì.', 'Tối đa bốn tín hiệu là cách tổ chức bài, không chứng minh mọi người cần đo cùng thứ.'], sourceIds: ['niddk-habits', 'nhs-eating-disorders'],
    },
    {
      id: 'ch10-measurement-quality', title: 'Giảm nhiễu không đồng nghĩa xóa sai số', objectiveIds: ['ch10-quality'],
      paragraphs: [
        'Biến thiên thật của đối tượng và sai số của cách đo không giống nhau, dù có thể cùng xuất hiện trong chuỗi. Ghi điều kiện, dụng cụ, đơn vị và cách tổng hợp trước khi so. Nếu thay thiết bị hoặc cách ghi, đánh dấu điểm đổi; nhiều chữ số thập phân không sửa được sai lệch của phương pháp.',
        'BIA dùng trở kháng điện cùng mô hình để ước tính thành phần cơ thể, không cân tách từng kilogram cơ và mỡ. Nghiên cứu của Frija-Masson và cộng sự năm 2021 kiểm tra ba cân so với DXA trong mẫu bệnh viện cho thấy độ chính xác cân tổng không đồng nghĩa độ chính xác thành phần cơ thể. Nghiên cứu cắt ngang này không xác nhận mọi thiết bị hiện tại hoặc khả năng theo dõi thay đổi của một cá nhân.',
        'Trung bình nhiều điểm có thể tóm tắt dữ liệu nhưng không xóa sai số hệ thống hoặc việc chỉ ghi những ngày thuận tiện. Nêu số điểm đã có và điều kiện chọn; không gọi trung bình ba điểm là trung bình cả tuần nếu bốn ngày khác không có dữ liệu. Đừng bù ô thiếu bằng số không hoặc bằng giá trị mong muốn.',
      ],
      takeaways: ['Chuẩn hóa và lấy trung bình không chứng minh phép đo hoàn toàn đúng.', 'BIA là ước tính; chênh lệch hiển thị chưa xác nhận lượng mô thật thay đổi.'], sourceIds: ['frija-masson-scales-2021', 'cochrane-interpretation'],
    },
    {
      id: 'ch10-review-gates', title: 'Qua cổng kiểm tra trước khi đổi kế hoạch', objectiveIds: ['ch10-decision'],
      paragraphs: [
        'Đầu tiên xem an toàn: có triệu chứng, lo âu ăn uống hoặc xung đột hướng dẫn chăm sóc không? Nếu có, không đợi ngày rà mới tìm hỗ trợ. Sau đó hỏi dữ liệu có đáng so, khoảng theo dõi có trả lời câu hỏi, việc dự kiến có được thực hiện và trải nghiệm có chấp nhận được không.',
        'Các câu trả lời có thể dẫn tới giữ cách đang làm, làm rõ dữ liệu, đơn giản hóa cách tổ chức, sửa một việc ít rủi ro, tạm dừng phần theo dõi hoặc hỏi chuyên môn. Đây là lựa chọn giáo dục, không là quy tắc tự đổi thuốc hay lượng ăn. Kết quả có vẻ tốt nhưng đi cùng khó khăn nghiêm trọng vẫn cần xem lại.',
        'Viết quyết định dưới dạng: dựa trên dữ kiện nào, chưa biết gì, sẽ làm gì và khi nào xem lại. Chỉ đổi một việc có thể giúp theo dõi dễ hơn nhưng không chứng minh nhân quả như thử nghiệm kiểm soát. “Chưa đủ dữ liệu để đổi” là một kết luận hợp lệ, miễn không dùng nó để trì hoãn chăm sóc cần thiết.',
      ],
      takeaways: ['An toàn đi trước đủ số ngày hoặc đủ số đo.', 'Đôi khi cần sửa cách ghi hoặc cách tổ chức, không cần sửa mức ăn.'], sourceIds: ['niddk-habits', 'cochrane-interpretation', 'nhs-unintentional-loss', 'nhs-eating-disorders'],
    },
    {
      id: 'ch10-evidence-chain', title: 'Portfolio chặng 6–10: truy được lý do, không chỉ gom ảnh', objectiveIds: ['ch10-portfolio'],
      paragraphs: [
        'Sau khi hoàn thành và nộp từng bài, portfolio chặng này nối năm minh chứng: chương 6 giữ giới hạn dữ liệu glucose; chương 7 phân tích khác biệt; chương 8 làm rõ giả định nhu cầu; chương 9 kiểm tra tính khả thi thực đơn; chương 10 đưa dữ kiện thành quyết định. Không cần mọi bài dùng cùng một hồ sơ y tế thật.',
        'Tóm tắt cần chỉ rõ minh chứng nào hỗ trợ kết luận nào và phiên bản đang dùng. Sửa nháp không tự sửa bản đã nộp; nhận xét coach của bản cũ không tự trở thành nhận xét bản mới. Nếu thiếu một bài hoặc định nghĩa bài đã thay đổi, nêu khoảng trống và xử lý theo luồng nộp, không tự ghi rằng đã đủ hoặc đã duyệt.',
        'Tự soi tiêu chí giúp chuẩn bị câu hỏi; phản hồi coach là đánh giá học tập riêng, gắn với bản nộp cụ thể. Mục tiêu portfolio là chứng minh khả năng đặt câu hỏi, đọc giới hạn và điều chỉnh hợp lý, không cấp quyền chẩn đoán hoặc điều trị. Một bài tốt nêu được cả điều mình chưa biết.',
      ],
      takeaways: ['Năm minh chứng phải là bài đã nộp đúng phiên bản, không chỉ ô nháp đã điền.', 'Phản hồi học tập không thay đánh giá y tế hoặc chứng nhận hành nghề.'], sourceIds: ['ies-learning', 'cochrane-interpretation'],
    },
  ],
  workedExamples: [
    {
      id: 'ch10-coverage-example', title: 'Trước phần trăm thực hiện, hỏi dữ liệu phủ tới đâu', objectiveIds: ['ch10-signals', 'ch10-quality'],
      prompt: 'Tám cơ hội chuẩn bị bữa giả định có năm ghi đã làm, hai ghi chưa làm và một chưa có dữ liệu.',
      given: ['Số cơ hội dự kiến: 8.', '5 có, 2 không, 1 chưa rõ.', 'Không có dữ liệu để suy kết quả sức khỏe.'],
      steps: ['Độ phủ dữ liệu = 7/8 = 87,5%.', 'Tỷ lệ ghi đã làm trong các cơ hội biết được = 5/7 ≈ 71,4%.', 'Với toàn bộ tám cơ hội, chỉ biết chắc năm đã ghi có; không tự gán cơ hội thiếu là không.', 'Quyết định bước đầu có thể là làm rõ ô thiếu và rào cản của hai cơ hội chưa làm.'],
      answer: 'Độ phủ 87,5%; tỷ lệ ghi có trong dữ liệu đã biết khoảng 71,4%, không phải tỷ lệ chắc chắn của cả tám.',
      limitation: 'Đây là chỉ số quá trình từ tự báo cáo, không chứng minh khẩu phần đủ hoặc cân nặng phải thay đổi.',
    },
    {
      id: 'ch10-bia-example', title: 'Đúng phép nhân nhưng chưa chứng minh giảm mỡ thật', objectiveIds: ['ch10-quality', 'ch10-decision'],
      prompt: 'Hai lần hiển thị giả định của một cân: 60 kg với 22% mỡ và 59,5 kg với 20% mỡ. Tính giá trị suy ra, rồi giữ giới hạn.',
      given: ['Lần 1: 60 × 22%.', 'Lần 2: 59,5 × 20%.', 'Đây là số do thiết bị ước tính; chưa có dữ liệu độ đúng và khả năng phát hiện thay đổi.'],
      steps: ['Lần 1 suy ra 60 × 0,22 = 13,2 kg theo ước tính.', 'Lần 2 suy ra 59,5 × 0,20 = 11,9 kg theo ước tính.', 'Chênh lệch giá trị suy ra là 11,9 − 13,2 = −1,3 kg.', 'Không đổi cách gọi thành “chắc chắn giảm 1,3 kg mỡ”; kiểm tra điều kiện và giới hạn thiết bị trước diễn giải.'],
      answer: 'Hai giá trị ước tính là 13,2 và 11,9 kg, chênh −1,3 kg theo số hiển thị; chưa xác nhận mô mỡ thật.',
      limitation: 'Không suy tăng cơ, tốc độ sinh học hoặc hiệu quả kế hoạch chỉ từ phép nhân phần trăm của thiết bị.',
    },
    {
      id: 'ch10-decision-example', title: 'Kết quả tổ chức tốt hơn, trải nghiệm ghi chép tệ hơn', objectiveIds: ['ch10-decision', 'ch10-portfolio'],
      prompt: 'Ca giả định chuẩn bị bữa thường xuyên hơn nhưng thấy bảng ghi quá nhiều mục và bắt đầu lo phải hoàn hảo.',
      given: ['Minh chứng chương 9 cho thấy đã có phương án dự phòng.', 'Bảng chương 10 thu 12 mục nhưng nhiều mục không gắn quyết định.', 'Bài chương 6 mới là nháp, chưa nộp.'],
      steps: ['Giữ thông tin về cải thiện việc tổ chức nhưng không bỏ qua trải nghiệm khó chịu.', 'Bỏ mục không phục vụ câu hỏi, thiết kế bảng nhẹ hơn; tìm hỗ trợ nếu việc theo dõi gây hại.', 'Ghi giới hạn: chưa kết luận về sức khỏe hoặc nhu cầu năng lượng.', 'Portfolio vẫn thiếu minh chứng chương 6 đã nộp; xử lý bài đó riêng, không tự đánh dấu đủ năm.'],
      answer: 'Đơn giản hóa cách theo dõi và làm rõ an toàn; portfolio chưa đủ chỉ vì bốn bài khác đã có.',
      limitation: 'Không chẩn đoán rối loạn ăn uống từ một câu kể và không dùng điểm tự soi để thay phản hồi chuyên môn.',
    },
  ],
  cases: [
    { id: 'ch10-case-new-scale', title: 'Đổi cân, số mỡ thay đổi', context: 'Thư đổi thiết bị và thấy phần trăm mỡ khác ngay trong ngày, muốn sửa thực đơn theo số mới.', question: 'Bước kiểm tra nào phải đi trước?', reasoning: ['Thiết bị và mô hình ước tính đã thay đổi.', 'Một chênh lệch giữa thiết bị không là thay đổi cơ thể trong ngày.', 'Cần ghi điểm đổi phương pháp và giới hạn so sánh.'], safeNextStep: 'Không tự đổi mức ăn theo chênh lệch đó; kiểm tra cách đo và trao đổi người phụ trách nếu cần.', commonError: 'Nối hai thiết bị thành một chuỗi rồi gọi chênh lệch là tăng mỡ thật.' },
    { id: 'ch10-case-distress', title: 'Bảng đẹp nhưng sinh hoạt bị thu hẹp', context: 'Một người tránh gặp bạn vì sợ bữa ăn lệch và dành nhiều thời gian kiểm tra cân.', question: 'Có nên tăng số đo để cảm thấy kiểm soát hơn?', reasoning: ['Theo dõi đang ảnh hưởng đời sống, không chỉ thiếu số liệu.', 'Không cần một mức cân cụ thể để được tìm hỗ trợ.', 'Chương học có thể chuyển sang ca giả định, không ép tiếp tục theo dõi hình thể.'], safeNextStep: 'Dừng phần theo dõi gây hại và tìm hỗ trợ y tế/tâm lý phù hợp; không tự chẩn đoán hoặc tăng hạn chế ăn.', commonError: 'Coi bảng đầy đủ là thành công dù trải nghiệm và quan hệ với ăn uống xấu đi.' },
    { id: 'ch10-case-old-review', title: 'Nhận xét đúng bài nhưng sai phiên bản', context: 'Portfolio đã có nhận xét; sau đó học viên sửa và nộp lại một bài nguồn.', question: 'Có thể tự coi nhận xét cũ áp dụng cho kết luận mới không?', reasoning: ['Nhận xét gắn với minh chứng và phiên bản đã được xem.', 'Bài mới có thể làm giả định hoặc kết luận cần sửa.', 'Cần nêu thay đổi và dùng đúng luồng nộp/nhận xét, không gắn nhãn đã duyệt bằng suy đoán.'], safeNextStep: 'Giữ lịch sử, kiểm tra minh chứng đang tham chiếu và chủ động nộp phiên bản tổng hợp mới khi cần.', commonError: 'Xem việc lưu nháp hoặc thay bài nguồn là cập nhật tự động sự chấp thuận của coach.' },
  ],
  practice: {
    title: 'Bảng theo dõi tối giản và một quyết định có căn cứ', artifact: 'Một bảng tối đa bốn tín hiệu kèm quy tắc giữ/sửa/dừng và bản nháp tổng hợp minh chứng chặng 6–10.',
    steps: ['Chọn một câu hỏi thực tế từ ca giả định và tối đa bốn tín hiệu cần thiết.', 'Ghi cách thu, đơn vị, tần suất, dữ liệu thiếu và giới hạn từng tín hiệu.', 'Đi qua an toàn, chất lượng dữ liệu, thực hiện và trải nghiệm trước quyết định.', 'Nêu minh chứng chương 6–9 liên quan; sau khi nộp bài 10 mới tổng hợp đủ năm bản nộp theo luồng portfolio.'],
    fields: [
      { id: 'context', label: 'Câu hỏi cần quyết định', prompt: 'Bảng này giúp quyết định gì, cho bối cảnh nào? Có thể dùng ca giả định không có cân nặng hoặc ảnh.', required: true },
      { id: 'hypothesis', label: 'Tối đa bốn tín hiệu', prompt: 'Chọn tín hiệu kết quả/quá trình/trải nghiệm/an toàn khi phù hợp; giải thích từng tín hiệu phục vụ câu hỏi nào.', required: true },
      { id: 'action', label: 'Quy tắc giữ, sửa, dừng', prompt: 'Dựa trên dữ kiện nào sẽ giữ, làm rõ, đơn giản hóa, sửa một việc ít rủi ro hoặc tìm hỗ trợ? Không tự kê mức ăn hay thuốc.', required: true },
      { id: 'minimum', label: 'Bảng nhẹ khi bận', prompt: 'Nếu quá tải ghi chép hoặc thiếu thiết bị, bỏ mục nào mà vẫn giữ được câu hỏi chính và an toàn?', required: true },
      { id: 'data', label: 'Cách đo và minh chứng', prompt: 'Ghi đơn vị, số điểm, phần thiếu, ngày rà bài và minh chứng liên quan từ các chương trước; không gọi nháp là bản đã nộp.', required: true },
      { id: 'stop', label: 'Điều kiện ưu tiên hỗ trợ', prompt: 'Nêu khi nào dừng phần theo dõi, không chờ ngày rà, và tìm đúng người; dữ liệu nào không cần thu hoặc chia sẻ?', required: true },
    ],
    modelResponse: ['Câu hỏi giả định: phương án trưa ngày họp có dùng được không? Chọn số bữa có phương án, lần chuẩn bị, mức phiền khi ghi và vấn đề an toàn cần hỏi; không cần ảnh cơ thể.', 'Có 7/8 cơ hội được ghi, 5/7 ghi đã làm. Ưu tiên làm rõ ô thiếu và sửa cách nhắc lịch, không tự giảm calorie. Rà bài thứ sáu; nếu việc ghi gây hại hoặc có triệu chứng cần chăm sóc thì hỗ trợ trước.', 'Dẫn đúng bản nộp chương 6–9 và nộp bài 10 trước khi tổng hợp portfolio. Nhận xét cũ không tự áp dụng bản mới; bảng không chẩn đoán hoặc chứng minh lượng mỡ thay đổi.'],
    rubric: [
      { id: 'data', label: 'Thông tin đủ để kiểm tra', levels: ['Điền thiếu bằng số không hoặc khẳng định mỡ/cơ từ số hiển thị.', 'Có số liệu nhưng thiếu điều kiện, mẫu số hoặc giới hạn.', 'Nêu cách thu, độ phủ, mẫu số và giới hạn; không biến ước tính thành mô thật.'] },
      { id: 'mechanism', label: 'Chỉ số phục vụ quyết định', levels: ['Thu nhiều mục nhưng không biết dùng làm gì.', 'Có câu hỏi nhưng một số chỉ số chưa liên quan.', 'Mỗi tín hiệu phục vụ câu hỏi rõ; tách kết quả, quá trình và trải nghiệm.'] },
      { id: 'feasibility', label: 'Quy tắc và minh chứng', levels: ['Không có bước tiếp hoặc tự ghi đã đủ portfolio.', 'Có quyết định nhưng thiếu mốc rà hoặc nguồn minh chứng.', 'Có quy tắc, cách ghi nhẹ và lịch rà; phân biệt đúng bản nháp, bản nộp và nhận xét.'] },
      { id: 'safety', label: 'An toàn trước bảng điểm', levels: ['Ép cân/ảnh, tăng hạn chế ăn hoặc chờ dữ liệu dù cần hỗ trợ.', 'Nhắc an toàn chung nhưng chưa rõ điều kiện dừng.', 'Không bắt buộc dữ liệu cơ thể; nhận ra khi dừng và tìm hỗ trợ, không tự chẩn đoán hoặc đổi điều trị.'] },
    ],
  },
  coachExtension: ['Hỏi người học sẽ làm gì khác đi khi biết thêm một chỉ số; nếu không đổi quyết định, cân nhắc bỏ thu thập.', 'Không xác nhận tăng cơ/giảm mỡ chính xác từ chênh lệch BIA; nêu đúng giới hạn kiểm định và điều kiện.', 'Khi rà portfolio, kiểm tra năm nguồn, phiên bản và lập luận nối chúng, không chỉ tổng điểm tự soi.'],
  safety: ['Không yêu cầu cân, đo BIA hoặc ảnh cơ thể để đạt tiến độ học.', 'Không tự đổi calorie, thuốc hay tải tập từ một điểm hoặc số phần trăm của thiết bị.', 'Theo dõi gây lo âu, hành vi ăn uống có hại hoặc triệu chứng đáng lo cần được ưu tiên hỗ trợ, không đợi ngày rà.', 'Chỉ chia sẻ dữ liệu cần thiết có chủ động đồng ý; phản hồi coach là học tập, không chẩn đoán hoặc chứng nhận hành nghề.'],
  referenceIds: ['niddk-habits', 'nhs-eating-disorders', 'frija-masson-scales-2021', 'cochrane-interpretation', 'nhs-unintentional-loss', 'ies-learning'],
}
