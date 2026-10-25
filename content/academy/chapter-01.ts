import type { AcademyLearningUnit } from './learning-unit'

export const chapter01Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 1, revision: '2026-10-24.1',
  title: 'Khởi đầu đúng: từ mục tiêu đến một việc làm kiểm tra được',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành bắt đầu học dinh dưỡng; coach luyện đặt câu hỏi và hỗ trợ, không chẩn đoán.',
  scope: 'Xây cách học và cách ghi nhận bối cảnh trước khi tính khẩu phần. Không yêu cầu giảm cân, đếm calorie hoặc thay hướng dẫn điều trị để hoàn thành chương.',
  prerequisites: [],
  objectives: [
    { id: 'ch01-pattern', outcome: 'Xem chế độ ăn trong bối cảnh thay vì chấm một món là tốt hoặc xấu tuyệt đối.', evidence: 'Nêu hai thông tin còn thiếu khi đánh giá một bữa ăn và một tiêu chí ngoài cân nặng.' },
    { id: 'ch01-observation', outcome: 'Tách điều đã ghi nhận, giả thuyết và điều chưa biết.', evidence: 'Viết lại một kết luận vội thành ba dòng dữ kiện, giải thích có thể và câu hỏi cần làm rõ.' },
    { id: 'ch01-plan', outcome: 'Chọn hành động nhỏ, có điều kiện thực hiện, phương án tối thiểu và ngày rà lại.', evidence: 'Lập kế hoạch một việc phù hợp lịch sinh hoạt, không gắn với lời hứa giảm cân.' },
    { id: 'ch01-learn', outcome: 'Dùng vòng đọc, tự nhớ, vận dụng và phản hồi; biết giới hạn của bài học.', evidence: 'Giải thích một lỗi sau câu hỏi tự kiểm và phân biệt nháp, bài nộp với tư vấn điều trị.' },
  ],
  sections: [
    {
      id: 'ch01-context', title: 'Bắt đầu từ điều bạn muốn làm được', objectiveIds: ['ch01-pattern'],
      paragraphs: [
        'Ăn lành mạnh cần xét sự đầy đủ, cân đối, điều độ, đa dạng và an toàn. Nhưng một bữa ăn không cho biết toàn bộ cách ăn của một người. Hãy đặt thông tin cạnh lịch làm việc, thực phẩm có sẵn, khẩu vị, nguồn lực và các hướng dẫn chăm sóc đang có.',
        'Trong khóa này, mục tiêu học nên là một kỹ năng quan sát được: đọc đúng một nhãn, giải thích một lựa chọn hoặc lên được phương án bữa trưa khi bận. “Ăn hoàn hảo” không cho biết cần làm gì; “chuẩn bị được một phương án bữa trưa phù hợp lịch làm” cho phép kiểm tra và sửa kế hoạch.',
        'Đừng lấy cân nặng làm điểm số học tập. Với tình huống giả định có cùng cân nặng, hai người vẫn có thể khác ngân sách, kỹ năng nấu và yêu cầu y tế. Bài làm cần mô tả được bối cảnh, không cần đưa thông tin sức khỏe riêng tư để chứng minh mình xứng đáng được hỗ trợ.',
      ],
      takeaways: ['Đặt mục tiêu kỹ năng trước mục tiêu con số.', 'Một món hoặc một bữa chưa đại diện toàn bộ chế độ ăn.'], sourceIds: ['who-healthy-diet-2026'],
    },
    {
      id: 'ch01-evidence', title: 'Ba cột: thấy gì, nghĩ gì, chưa biết gì', objectiveIds: ['ch01-observation'],
      paragraphs: [
        'Ghi nhận hữu ích có thời điểm, hoàn cảnh và cách thu thập. “Tôi ghi lại bữa trưa lúc 13 giờ, sau cuộc họp” là dữ kiện tự báo cáo; “tôi ăn như vậy vì chuyển hóa chậm” là diễn giải. Dữ kiện có thể chưa đầy đủ nhưng không nên bị thay bằng một nguyên nhân chưa kiểm tra.',
        'Chia trang thành ba cột: điều đã ghi, các giải thích có thể, thông tin cần bổ sung. Ví dụ bỏ quên bữa trưa có thể liên quan cuộc họp hoặc việc chưa chuẩn bị đồ ăn; chưa cần chốt nguyên nhân để thử một cách nhắc lịch phù hợp. Ghi rõ ngày nào thiếu dữ liệu, không biến ô trống thành “không ăn”.',
        'Ba ngày ghi chép trong bài mẫu chỉ giúp học cách ghi. Đó không phải số ngày đủ để xác định cơ địa, thiếu chất hoặc hiệu quả của một chế độ ăn. Khi giải thích vượt quá dữ liệu, câu trả lời tốt là nêu giới hạn và câu hỏi tiếp theo, không thêm độ chắc chắn bằng cách viết nhiều con số.',
      ],
      takeaways: ['Tự báo cáo vẫn cần ghi rõ thời điểm và phần bị thiếu.', 'Quan sát một thay đổi không tự chứng minh nguyên nhân.'], sourceIds: ['niddk-habits', 'cochrane-interpretation'],
    },
    {
      id: 'ch01-small-action', title: 'Một hành động có chỗ đứng trong ngày thật', objectiveIds: ['ch01-plan'],
      paragraphs: [
        'Một kế hoạch dùng được trả lời: làm gì, khi nào, ở đâu, cần chuẩn bị gì và nếu bận thì làm phiên bản nào? Có thể bắt đầu bằng kiểm tra lựa chọn bữa trưa trước giờ đi làm. Việc đó nhỏ nhưng cụ thể hơn lời hứa thay toàn bộ cách ăn ngay ngày mai.',
        'Chọn một chỉ số quá trình như số lần đã chuẩn bị hoặc trở ngại gặp phải; ghi ngày quay lại xem kế hoạch. Mốc bảy ngày trong bài này là lịch học tiện dùng, không phải thời hạn cơ thể phải thay đổi. Nếu không thực hiện được, xem thời điểm, nguồn lực và độ khó trước khi kết luận thiếu ý chí.',
        'Không biến bài tập thành thử thách nhịn ăn, loại nhiều nhóm thực phẩm hoặc đổi thuốc. Người có hướng dẫn điều trị giữ hướng dẫn đó và có thể dùng tình huống giả định để học. Một phương án tối thiểu an toàn vẫn là bài làm hợp lệ; “càng cực đoan càng quyết tâm” không phải tiêu chí chấm.',
      ],
      takeaways: ['Giảm độ khó của hành động khi nguồn lực thay đổi.', 'Rà lại để sửa kế hoạch, không để phán xét bản thân.'], sourceIds: ['niddk-habits', 'niddk-ckd-nutrition'],
    },
    {
      id: 'ch01-learning-loop', title: 'Học để giải thích được, không chỉ đánh dấu đã xem', objectiveIds: ['ch01-learn'],
      paragraphs: [
        'Đọc một đoạn, gấp nội dung lại và thử nói bằng lời của mình; sau đó so với ví dụ có lời giải rồi làm một tình huống khác. Quay lại câu hỏi sau một khoảng thời gian giúp kiểm tra khả năng tự nhớ thay vì chỉ cảm thấy quen khi nhìn đáp án. Các hoạt động này là cách tổ chức học, không bảo đảm kết quả sức khỏe.',
        'Trong Aura, lưu nháp giúp tiếp tục bài viết; nộp bài cố định một phiên bản để phản hồi. Tự đánh giá giúp nhận ra chỗ cần sửa, còn nhận xét coach là một bước riêng. Điền đủ ô hoặc đạt câu hỏi không chứng nhận năng lực khám bệnh, và phản hồi học tập không thay lời khuyên của người phụ trách điều trị.',
        'Khi trả lời sai, ghi lại vì sao phương án sai hấp dẫn và thông tin nào làm bạn đổi ý. Bài học có ích khi bạn sửa được cách suy luận, không phải khi thuộc thứ tự đáp án. Nếu nội dung gợi đến một vấn đề sức khỏe thật, hãy tách câu hỏi học thuật khỏi yêu cầu chăm sóc cá nhân.',
      ],
      takeaways: ['Nhớ lại và giải thích lỗi là một phần của học.', 'Nháp, bản nộp và nhận xét là ba trạng thái khác nhau.'], sourceIds: ['ies-learning'],
    },
  ],
  workedExamples: [
    {
      id: 'ch01-goal-example', title: 'Từ “ăn tốt hơn” đến một việc cụ thể', objectiveIds: ['ch01-pattern', 'ch01-plan'],
      prompt: 'Mai muốn học cách tổ chức bữa trưa nhưng hay họp sát giờ nghỉ. Lập mục tiêu học tập, không kê thực đơn.',
      given: ['Mai có thể xem lịch vào buổi sáng.', 'Chưa biết ngân sách, lựa chọn món và điều kiện bảo quản.', 'Mục tiêu ban đầu: tuần tới phải ăn thật hoàn hảo.'],
      steps: ['Đổi mục tiêu thành biết chuẩn bị một lựa chọn bữa trưa phù hợp lịch.', 'Làm rõ ngân sách, nơi mua hoặc bảo quản và các điều kiện ăn uống cần giữ.', 'Gắn hành động xem lựa chọn với lúc mở lịch làm việc.', 'Đặt phiên bản tối thiểu: ghi một lựa chọn khả thi; cuối tuần xem lúc nào kế hoạch vướng.'],
      answer: 'Mục tiêu kiểm tra bằng khả năng chuẩn bị và giải thích lựa chọn, không bằng lời hứa cân nặng hay danh sách món cấm.',
      limitation: 'Chưa đủ thông tin để đánh giá khẩu phần dinh dưỡng; ví dụ chỉ luyện tổ chức một hành động.',
    },
    {
      id: 'ch01-missing-data-example', title: 'Ô trống không phải số không', objectiveIds: ['ch01-observation'],
      prompt: 'Một nhật ký giả định có ba ngày. Người đọc muốn kết luận chủ nhân chỉ ăn trưa hai lần trong ba ngày.',
      given: ['Thứ hai ghi “ăn trưa lúc 12:30”.', 'Thứ ba để trống.', 'Thứ tư ghi “ăn trưa sau họp”.'],
      steps: ['Đếm hai ngày có ghi chép, không phải hai ngày chắc chắn có ăn.', 'Đánh dấu thứ ba thiếu dữ liệu thay vì suy rằng đã bỏ bữa.', 'Hỏi người ghi có nhớ và muốn bổ sung không; giữ dấu chưa rõ nếu không.', 'Chỉ kết luận nhật ký chưa đầy đủ và cần cách ghi thuận tiện hơn.'],
      answer: 'Có thông tin của 2/3 ngày; không đủ dữ kiện để tính tỷ lệ bỏ bữa hoặc xác định nguyên nhân.',
      limitation: 'Ngay cả nhật ký đủ ba ngày cũng không tự đại diện thói quen dài hạn hay chứng minh tình trạng dinh dưỡng.',
    },
    {
      id: 'ch01-feedback-example', title: 'Đọc phản hồi mà không xóa lịch sử bài làm', objectiveIds: ['ch01-learn'],
      prompt: 'Một người nộp kế hoạch phiên bản 1, sau đó viết thêm chi tiết vào nháp. Coach đang nhận xét bản 1.',
      given: ['Bản 1 chưa nói cách xử lý khi tăng ca.', 'Nháp mới thêm phương án tối thiểu.', 'Chưa bấm nộp bản mới.'],
      steps: ['Đọc số phiên bản mà nhận xét đang gắn vào.', 'So sánh câu hỏi của coach với đúng nội dung đã nộp.', 'Dùng nháp để trả lời điểm còn thiếu và tự giải thích vì sao sửa.', 'Nếu muốn nhận xét trên thay đổi đó, chủ động nộp phiên bản mới theo luồng bài học.'],
      answer: 'Nhận xét cũ vẫn thuộc bản 1; việc sửa nháp không có nghĩa coach đã xem hoặc chấp thuận bản mới.',
      limitation: 'Đây là quy trình minh chứng học tập, không phải quy trình phê duyệt một kế hoạch điều trị.',
    },
  ],
  cases: [
    { id: 'ch01-case-shift', title: 'Ca làm thay đổi', context: 'An đặt mục tiêu nấu đủ mọi bữa, nhưng hai ngày phải tăng ca.', question: 'Nên kết luận thất bại hay sửa điều kiện thực hiện?', reasoning: ['Xác định điều kiện khiến việc nấu không khả thi.', 'Giữ mục tiêu chuẩn bị lựa chọn thay vì buộc mọi bữa tự nấu.', 'Chọn một cách dự phòng có sẵn, kiểm tra điều kiện bảo quản và ăn uống.'], safeNextStep: 'Viết lại kế hoạch và mốc rà lại, không nhịn bữa để bù cho ngày lệch kế hoạch.', commonError: 'Đồng nhất một kế hoạch không phù hợp với phẩm chất hay ý chí của người học.' },
    { id: 'ch01-case-comparison', title: 'So với bài đăng của bạn', context: 'Bình thấy bạn kể thay đổi nhanh nên muốn sao chép y hệt và bỏ qua bối cảnh của mình.', question: 'Cần hỏi gì trước khi lấy trải nghiệm đó làm quy tắc?', reasoning: ['Bài kể không cho biết đầy đủ hoàn cảnh và cách đo.', 'Hai người có thể khác mục tiêu, nguồn lực và hướng dẫn y tế.', 'Chọn kỹ năng muốn học thay vì hứa lặp lại kết quả của người khác.'], safeNextStep: 'Ghi câu hỏi còn thiếu và chọn một hành động phù hợp, không tăng mức hạn chế ăn chỉ để đuổi kịp.', commonError: 'Coi một trải nghiệm cá nhân là bằng chứng đủ cho mọi người.' },
    { id: 'ch01-case-care', title: 'Bài tập và hướng dẫn chăm sóc', context: 'Chi đang có kế hoạch ăn do đội ngũ điều trị hướng dẫn; lo không được điểm nếu không đổi cách ăn.', question: 'Có cần tự đổi kế hoạch để làm thực hành không?', reasoning: ['Mục tiêu là chứng minh cách đặt câu hỏi và lập kế hoạch.', 'Không cần thử thay đổi có nguy cơ trên bản thân.', 'Dùng tình huống giả định và nêu phần cần hỏi người điều trị.'], safeNextStep: 'Giữ hướng dẫn chăm sóc hiện tại và làm bài giả định; hỏi chuyên môn trước thay đổi liên quan điều trị.', commonError: 'Đặt yêu cầu hoàn thành bài học cao hơn điều kiện an toàn cá nhân.' },
  ],
  practice: {
    title: 'Phiếu khởi đầu: một kỹ năng, một hành động, một lần rà lại',
    artifact: 'Một trang kế hoạch học tập trên bối cảnh thật tối giản hoặc giả định; không cần số đo cơ thể.',
    steps: ['Chọn một kỹ năng muốn làm được và một hoàn cảnh cụ thể.', 'Tách dữ kiện với giả thuyết; ghi điều chưa rõ.', 'Viết hành động, dấu nhắc và phiên bản tối thiểu.', 'Chọn cách ghi nhận, ngày rà lại và giới hạn an toàn; tự soi rubric rồi mới nộp.'],
    fields: [
      { id: 'context', label: 'Bối cảnh và kỹ năng', prompt: 'Ai đang học, muốn làm được việc gì, có lịch và nguồn lực nào? Có thể dùng nhân vật giả định.', required: true },
      { id: 'hypothesis', label: 'Dữ kiện và điều chưa biết', prompt: 'Viết một điều đã quan sát, một giải thích có thể và một câu hỏi chưa có đủ dữ kiện.', required: true },
      { id: 'action', label: 'Hành động gắn với thời điểm', prompt: 'Sẽ làm gì, lúc nào, ở đâu; điều gì nhắc bạn bắt đầu và cần chuẩn bị gì?', required: true },
      { id: 'minimum', label: 'Phiên bản khi bận', prompt: 'Nếu điều kiện không thuận lợi, phiên bản nhỏ hơn nào vẫn phục vụ kỹ năng và giữ an toàn?', required: true },
      { id: 'data', label: 'Cách ghi nhận và rà lại', prompt: 'Ghi việc đã làm và trở ngại bằng cách nào? Nêu ngày rà lại; không biến thiếu ghi chép thành số không.', required: true },
      { id: 'stop', label: 'Ranh giới của bài học', prompt: 'Điều gì bạn không tự thay đổi, khi nào cần hỏi chuyên môn, và dữ liệu riêng tư nào không cần đưa vào bài?', required: true },
    ],
    modelResponse: ['Bối cảnh giả định: Mai muốn chuẩn bị lựa chọn bữa trưa trước cuộc họp, chưa biết lựa chọn gần nơi làm.', 'Dữ kiện là giờ họp, chưa phải bằng chứng về chuyển hóa. Mỗi sáng khi mở lịch sẽ kiểm tra một lựa chọn; khi bận chỉ ghi tên lựa chọn để xem lại.', 'Ghi có làm hay không, lý do vướng và ô chưa rõ; rà lại thứ sáu. Không đặt mục tiêu cân nặng, không đổi hướng dẫn điều trị, không gửi hồ sơ y tế.'],
    rubric: [
      { id: 'data', label: 'Dữ kiện có giới hạn', levels: ['Trộn dữ kiện với kết luận hoặc coi ô trống là không xảy ra.', 'Có bối cảnh nhưng chưa chỉ rõ điều chưa biết.', 'Tách dữ kiện, giả thuyết và thông tin thiếu; không suy rộng từ vài ngày.'] },
      { id: 'mechanism', label: 'Giải thích lựa chọn', levels: ['Chọn vì trào lưu hoặc lời hứa kết quả.', 'Có mục tiêu nhưng chưa nối với hành động.', 'Giải thích hành động giúp kỹ năng nào và không thể kết luận điều gì.'] },
      { id: 'feasibility', label: 'Kế hoạch thực hiện', levels: ['Mục tiêu chung, không có hành động cụ thể.', 'Có hành động nhưng thiếu phương án bận hoặc ngày rà lại.', 'Có thời điểm, nguồn lực, phiên bản tối thiểu và lịch rà lại.'] },
      { id: 'safety', label: 'An toàn và phạm vi', levels: ['Tự thay điều trị hoặc thử hạn chế ăn có nguy cơ.', 'Nêu an toàn chung nhưng chưa rõ cách xử lý.', 'Giữ hướng dẫn chăm sóc, nêu điểm cần hỏi và dùng dữ liệu tối thiểu hoặc giả định.'] },
    ],
  },
  coachExtension: ['Hỏi người học mục tiêu nào do chính họ chọn; tránh biến sở thích của coach thành tiêu chuẩn duy nhất.', 'Phản hồi một chỗ suy luận và một hành động sửa cụ thể; không khen mức hạn chế ăn hoặc tốc độ thay đổi cơ thể.', 'Tách mục tiêu giáo dục khỏi tư vấn cá nhân và thống nhất thông tin nào thực sự cần chia sẻ.'],
  safety: ['Không đổi thuốc hay hướng dẫn điều trị để làm bài.', 'Có thể dùng dữ liệu giả định; không bắt buộc tải hồ sơ sức khỏe hoặc ảnh cơ thể.', 'Nếu việc theo dõi gây lo âu hoặc thúc đẩy hành vi ăn uống có hại, dừng bài theo dõi và tìm hỗ trợ chuyên môn phù hợp.'],
  referenceIds: ['who-healthy-diet-2026', 'niddk-habits', 'cochrane-interpretation', 'niddk-ckd-nutrition', 'ies-learning'],
}
