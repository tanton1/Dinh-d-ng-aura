import type { AcademyLearningUnit } from './learning-unit'

export const chapter19Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 19, revision: '2026-10-24.1',
  title: 'Thói quen bền vững: thiết kế điều kiện thực hiện và đường nối lại',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên trưởng thành xây hành vi phù hợp đời sống; PT/coach luyện hỏi rào cản và phản hồi không phán xét.',
  scope: 'Thiết kế một hành vi hậu cần ăn uống tự nguyện, hoặc dùng ca giả định. Không điều trị rối loạn ăn uống, không chấm đạo đức qua nhật ký và không yêu cầu nhịn hoặc tập bù khi bỏ lỡ.',
  prerequisites: [1, 9, 10, 17, 18],
  objectives: [
    { id: 'ch19-target', outcome: 'Chuyển mong muốn thành hành vi quan sát được với cơ hội thực hiện rõ.', evidence: 'Mô tả ai làm gì, lúc nào, ở đâu và phân biệt hành động với kết quả sức khỏe.' },
    { id: 'ch19-barrier', outcome: 'Dùng COM-B để đặt giả thuyết về rào cản thay vì quy thiếu ý chí.', evidence: 'Nêu dữ kiện, điều cần hỏi và hỗ trợ khớp năng lực, cơ hội hoặc động lực.' },
    { id: 'ch19-plan', outcome: 'Viết tín hiệu, kế hoạch nếu–thì và ba phương án cùng giữ an toàn.', evidence: 'Có hành động tiêu chuẩn, duy trì, tối thiểu và điều kiện chuyển phương án.' },
    { id: 'ch19-review', outcome: 'Rà mức thực hiện với dữ liệu thiếu và nối lại không bù trừ.', evidence: 'Tính đúng mẫu số, không coi ô trống là thất bại và sửa điều kiện ở cơ hội kế tiếp.' },
  ],
  sections: [
    {
      id: 'ch19-observable-target', title: 'Chọn một việc làm được, không đặt mục tiêu bằng lời phán xét', objectiveIds: ['ch19-target'],
      paragraphs: [
        '“Ăn tốt hơn” hoặc “có kỷ luật” chưa cho biết việc gì sẽ xảy ra. Một hành vi rõ có người thực hiện, hành động, tình huống và dấu hiệu đã làm. Ví dụ do Aura đặt: sau khi xem lịch làm việc tối Chủ nhật, chọn phương án bữa trưa cho những ngày có ca. Mục tiêu này là tổ chức bữa, không cam kết giảm cân hay thay chỉ số máu.',
        'Tách ba tầng: hành động là đã chuẩn bị phương án; kết quả gần là có bữa dùng được; kết quả sức khỏe là điều cần bằng chứng và thời gian phù hợp. Làm được một hành động chưa chứng minh hiệu quả điều trị. Chọn việc có ý nghĩa với người học, không chỉ dễ đánh dấu để tăng chuỗi ngày.',
        'Cơ hội thực hiện phải được định nghĩa trước khi đếm. Một việc gắn với ca làm có thể có ba cơ hội trong tuần, không mặc định bảy ngày. Khi lịch thay đổi, ghi thay đổi thay vì sửa mẫu số để báo cáo đẹp. Nếu người học chưa muốn đổi hành vi, có thể phân tích ca giả định hoặc tìm hiểu điều họ coi trọng trước.',
      ],
      takeaways: ['Hành động, cơ hội và kết quả là ba thứ khác nhau.', 'Mục tiêu do người học chọn, không phải nhãn ngoan hoặc lười.'], sourceIds: ['nice-behaviour-ph49', 'nice-shared-decisions', 'niddk-habits'],
    },
    {
      id: 'ch19-comb-context', title: 'COM-B: điều gì làm hành vi khó xảy ra trong bối cảnh này?', objectiveIds: ['ch19-barrier'],
      paragraphs: [
        'COM-B của Michie và cộng sự phân tích hành vi qua năng lực, cơ hội và động lực. Năng lực gồm hiểu biết, kỹ năng và khả năng thực hiện; cơ hội gồm điều kiện vật chất và xã hội; động lực gồm suy nghĩ có chủ ý lẫn phản ứng tự động, cảm xúc và thói quen. Các phần tương tác, không phải ba điểm tính cách cố định.',
        'Không có tủ lạnh và thời gian mua bữa là dữ kiện về cơ hội; chưa biết đọc đơn vị nhãn có thể là kỹ năng; muốn thay đổi nhưng tín hiệu cũ kéo sang việc khác gợi ý xem động lực tự động. Đây là giả thuyết để hỏi lại, không kết luận từ một lần quan sát. Một rào cản có thể nằm ở nhiều phần.',
        'Chọn hỗ trợ khớp dữ kiện: luyện kỹ năng bằng ví dụ, đổi điều kiện mua/cất bữa, nhờ người hỗ trợ được đồng ý hoặc làm rõ ưu tiên. Gửi thêm bài giảng không tự tạo tủ lạnh; thông báo dày không tự tạo thời gian nghỉ. COM-B giúp thiết kế câu hỏi, không bảo đảm mọi can thiệp gắn tên mô hình sẽ thành công.',
      ],
      takeaways: ['Hỏi bối cảnh trước khi khuyên cố gắng hơn.', 'Sửa điều kiện có thể quan trọng hơn tăng nhắc nhở.'], sourceIds: ['michie-comb-2011', 'nice-behaviour-ph49'],
    },
    {
      id: 'ch19-cue-and-options', title: 'Tín hiệu, nếu–thì và ba phương án không giảm chuẩn an toàn', objectiveIds: ['ch19-plan'],
      paragraphs: [
        'Tín hiệu hữu ích gắn với sự kiện có thể nhận ra: khi kết thúc xem lịch, trước khi rời nhà hoặc lúc chuẩn bị túi. Kế hoạch nếu–thì nối một trở ngại cụ thể với hành động đã chọn, chẳng hạn nếu không có chỗ giữ lạnh thì chọn phương án mua bữa phù hợp giờ dùng, không mang thực phẩm dễ hỏng cả buổi.',
        'Ba phương án của Aura là tiêu chuẩn, duy trì và tối thiểu cho cùng nhiệm vụ tổ chức. Ví dụ: chuẩn bị phương án và nguyên liệu; dùng món đã biết dễ mua; tối thiểu xác nhận nơi và giờ lấy bữa. “Tối thiểu” không có nghĩa ăn ít nhất, bỏ bữa hoặc giảm an toàn thực phẩm. Cần ghi rõ phương án nào đã làm thay vì tính mọi mức như cùng một đầu ra.',
        'Khung AURA 6N của bài gồm Nhắm việc, Nhận diện cản trở, Nối tín hiệu, Nắn môi trường, Nối lại và Nhìn lại. Đây là cách ghi nhớ do Aura tổ chức từ nguyên tắc hành vi, không phải thang chẩn đoán hay phương pháp đã được thử nghiệm riêng. Cách chọn bữa vẫn giữ dị ứng, chỉ định chăm sóc và điều kiện bảo quản.',
      ],
      takeaways: ['Nếu–thì cần tình huống cụ thể và bước thực hiện rõ.', 'Giảm công tổ chức, không giảm nhu cầu chăm sóc hoặc an toàn.'], sourceIds: ['nice-behaviour-ph49', 'niddk-habits', 'food-safety-four-steps', 'nhs-food-allergy'],
    },
    {
      id: 'ch19-review-and-restart', title: 'Lặp lại, dữ liệu thiếu và nối lại không phải trả nợ', objectiveIds: ['ch19-review'],
      paragraphs: [
        'Nghiên cứu Lally và cộng sự theo dõi 96 tình nguyện viên tự báo cáo trong 12 tuần cho thấy tính tự động tăng khác nhau giữa người và hành vi; một lần bỏ lỡ không xóa cả quá trình. Đây không phải thử nghiệm ngẫu nhiên và các thời gian dài được mô hình hóa, không phải lời hứa tạo thói quen sau đúng 21 hoặc 66 ngày.',
        'Đếm cả cơ hội, phần có dữ liệu và kiểu hành động đã làm. Ô trống nghĩa chưa biết, không tự gán 0 hoặc hoàn thành. Tỷ lệ trong phần đã ghi cần đi cùng độ phủ dữ liệu; không gọi một tỷ lệ cao ở rất ít lượt là bằng chứng kế hoạch đã bền. Mức tự động cũng khác số ngày bấm hoàn thành.',
        'Khi bỏ lỡ, rà sự kiện và nối lại ở cơ hội phù hợp kế tiếp, không nhịn bù, tập bù hoặc đợi thứ Hai. Khung rà tuần là lịch học tập, không quy định phải sửa xong trong 24 giờ. Nếu ghi chép gây lo âu, né ăn cùng người khác hoặc bù trừ, giảm/dừng cách theo dõi gây hại và tìm hỗ trợ; không tăng giám sát như một hình phạt.',
      ],
      takeaways: ['Không cần chuỗi hoàn hảo để tiếp tục.', 'Một ô trống và một lần chưa làm là hai loại dữ liệu khác nhau.'], sourceIds: ['lally-habits-2010', 'niddk-habits', 'nhs-eating-disorders'],
    },
  ],
  workedExamples: [
    {
      id: 'ch19-barrier-example', title: 'Biết ăn thế nào nhưng không có chỗ cất bữa', objectiveIds: ['ch19-target', 'ch19-barrier'],
      prompt: 'Linh biết chuẩn bị bữa và muốn mang đi, nhưng nơi làm không có chỗ giữ lạnh. Lời nhắc hiện tại là cố gắng chuẩn bị tốt hơn.',
      given: ['Có kỹ năng và ý định được Linh tự mô tả.', 'Chưa có phương án giữ bữa an toàn.', 'Cần hỏi thêm thời gian, ngân sách và nơi mua bữa.'],
      steps: ['Đặt hành vi: chọn phương án bữa cho ca, không buộc phải mang hộp từ nhà.', 'Giả thuyết chính là cơ hội vật chất, chưa phải thiếu kiến thức hoặc ý chí.', 'Hỏi Linh phương án mua gần giờ ăn hoặc giữ lạnh phù hợp nào khả thi.', 'Viết nếu không có điều kiện cất an toàn thì chọn phương án thay; không giao thêm bài giảng như giải pháp duy nhất.'],
      answer: 'Ưu tiên làm rõ và sửa điều kiện sử dụng bữa; không quy người học thiếu động lực từ việc chưa mang hộp.',
      limitation: 'COM-B là khung hỏi, không loại trừ các rào cản khác hoặc xác nhận món nào an toàn khi chưa biết điều kiện.',
    },
    {
      id: 'ch19-coverage-example', title: '75% trong phần đã ghi không phải 75% mọi cơ hội', objectiveIds: ['ch19-review'],
      prompt: 'Có sáu cơ hội đã xác định. Bốn có dữ liệu: ba đã làm, một chưa làm; hai còn trống.',
      given: ['Tổng cơ hội: 6.', 'Dữ liệu đã biết: 4, trong đó thực hiện: 3.', 'Hai lượt chưa rõ, không tự điền thay.'],
      steps: ['Trong phần đã biết: 3/4 × 100 = 75%.', 'Độ phủ: 4/6 × 100 ≈ 66,7%.', 'Toàn bộ sáu cơ hội chỉ xác nhận được ba đã làm; nếu hai lượt trống đều chưa làm hoặc đều làm, tỷ lệ có thể từ 3/6 tới 5/6.', 'Báo 75% trên dữ liệu biết, phủ 66,7%; chưa kết luận thói quen đã hình thành.'],
      answer: '75% trong phần có dữ liệu, độ phủ khoảng 66,7%; tỷ lệ toàn bộ chưa biết, nằm trong 50–83,3% theo hai cực giả định.',
      limitation: 'Khoảng cực không là khoảng tin cậy; không chứng minh cải thiện sức khỏe hoặc quy hai ô trống thành thất bại.',
    },
    {
      id: 'ch19-options-example', title: 'Ba phương án cho cùng việc chuẩn bị bữa trưa', objectiveIds: ['ch19-plan'],
      prompt: 'Ca giả định đã chọn việc kiểm tra phương án bữa trưa sau khi xem lịch ngày mai. Tuần này giờ làm thay đổi.',
      given: ['Tiêu chuẩn: kiểm tra lịch và chuẩn bị các bước cần thiết cho bữa phù hợp.', 'Duy trì: chọn bữa quen có thể mua đúng giờ.', 'Tối thiểu: xác nhận nơi, giờ và người giúp lấy bữa; chưa tính là đã ăn.'],
      steps: ['Giữ tín hiệu xem lịch, không đặt một giờ dễ xung đột ca mới.', 'Nếu thiếu thời gian chuẩn bị thì dùng phương án mua đã kiểm tra, không bỏ bữa để giữ chuỗi.', 'Ghi rõ mức đã làm và liệu bữa thực sự có dùng được không.', 'Ở lần rà, hỏi điều gì giúp hoặc cản; đổi tổ chức nếu cần, không giảm tiêu chuẩn dị ứng hoặc bảo quản.'],
      answer: 'Ba phương án giảm công chuẩn bị nhưng cùng hướng tới bữa dùng được; hành động tối thiểu chưa bằng một bữa đã ăn.',
      limitation: 'Đây là thiết kế giả định, không chứng minh nhu cầu dinh dưỡng đã đủ hoặc phù hợp mọi lịch làm.',
    },
  ],
  cases: [
    { id: 'ch19-case-streak', title: 'Mất chuỗi 21 ngày', context: 'Người học bỏ một lượt và nghĩ cần làm lại từ số 0 vì thói quen chưa được khóa.', question: 'Nên phản hồi thế nào?', reasoning: ['Không có mốc cố định bảo đảm cho mọi người.', 'Một lần bỏ lỡ không xóa kiến thức hoặc điều kiện đã xây.', 'Rà trở ngại và nối lại có ích hơn phạt.'], safeNextStep: 'Chọn cơ hội phù hợp kế tiếp và một hỗ trợ cụ thể, không bù trừ hoặc tự xóa thành quả đã có.', commonError: 'Nói đã hỏng toàn bộ vì chuỗi ngày không còn hoàn hảo.' },
    { id: 'ch19-case-reminders', title: 'Tăng thông báo khi không có giờ nghỉ', context: 'Lịch làm khiến người học khó có khoảng ăn; coach định nhắc mỗi giờ để tăng kỷ luật.', question: 'Điểm nghẽn nào cần hỏi trước?', reasoning: ['Thông báo không tự tạo cơ hội vật chất.', 'Cần nghe ràng buộc công việc và lựa chọn của người học.', 'Có thể cần hỗ trợ tổ chức hoặc phương án bữa khác.'], safeNextStep: 'Trao đổi rào cản thực tế và thống nhất mức nhắc mong muốn, không thêm giám sát tự động.', commonError: 'Đồng nhất nhận nhiều nhắc nhở với có đủ thời gian và điều kiện thực hiện.' },
    { id: 'ch19-case-compensation', title: 'Muốn nhịn bù để bảng không bị đỏ', context: 'Một học viên thấy tội lỗi vì lệch kế hoạch và định bỏ bữa, tập bù để bù điểm.', question: 'Có nên tiếp tục bảng theo dõi như cũ không?', reasoning: ['Cách theo dõi đang tạo hành vi có hại.', 'Điểm học không được mua bằng thiếu ăn hoặc quá tải.', 'Cần hỗ trợ thay vì tăng áp lực.'], safeNextStep: 'Không nhịn hoặc tập bù; giảm/dừng cách theo dõi gây hại và tìm hỗ trợ phù hợp, dùng ca giả định cho bài.', commonError: 'Khen bù trừ là kỷ luật và tiếp tục chấm màu như không có vấn đề.' },
  ],
  practice: {
    title: 'Bản thiết kế thói quen AURA 6N', artifact: 'Một thiết kế hành vi có tín hiệu, rào cản, ba phương án và cách rà; không yêu cầu có chuỗi ngày hoàn hảo.',
    steps: ['Nhắm một việc tự nguyện và định nghĩa cơ hội.', 'Nhận diện cản trở bằng COM-B rồi hỏi lại giả thuyết.', 'Nối tín hiệu, nắn môi trường và viết nếu–thì.', 'Viết đường nối lại và cách nhìn lại dữ liệu có thiếu.'],
    fields: [
      { id: 'context', label: 'Việc và cơ hội', prompt: 'Ghi ai làm gì, trong bối cảnh nào, cơ hội được đếm ra sao và vì sao người học chọn việc này.', required: true },
      { id: 'hypothesis', label: 'Rào cản COM-B', prompt: 'Nêu dữ kiện gợi ý rào cản, điều còn phải hỏi và vì sao không quy ngay thiếu ý chí.', required: true },
      { id: 'action', label: 'Tín hiệu và nếu–thì', prompt: 'Viết sự kiện kích hoạt, hành động cụ thể và phản ứng an toàn khi gặp một trở ngại đã dự kiến.', required: true },
      { id: 'minimum', label: 'Ba phương án', prompt: 'Nêu tiêu chuẩn, duy trì và tối thiểu cho cùng nhiệm vụ, không biến tối thiểu thành bỏ bữa.', required: true },
      { id: 'data', label: 'Rà mức thực hiện', prompt: 'Ghi cơ hội, lượt có dữ liệu, mức hành động và giới hạn; không tự coi ô trống là chưa làm.', required: true },
      { id: 'stop', label: 'Nối lại và hỗ trợ', prompt: 'Ghi cách nối lại không bù trừ, lúc thay cách theo dõi và người hỗ trợ khi xuất hiện lo âu hoặc hành vi có hại.', required: true },
    ],
    modelResponse: ['Sau khi xem lịch tối, Linh kiểm tra phương án bữa trưa cho ca có mặt tại nơi làm. Cơ hội tính theo ca, không tính mọi ngày.', 'Giả thuyết là thiếu chỗ giữ lạnh; cần hỏi giờ và ngân sách. Nếu không có cách bảo quản phù hợp, chọn nơi mua gần giờ ăn; tối thiểu xác nhận phương án, không tính đã ăn.', 'Rà lượt có dữ liệu và kiểu phương án đã dùng. Bỏ lỡ thì nối lại ở cơ hội phù hợp, không phạt bằng nhịn; theo dõi gây hại thì dừng cách đó và tìm hỗ trợ.'],
    rubric: [
      { id: 'data', label: 'Hành vi và mẫu số', levels: ['Mục tiêu mơ hồ hoặc ô trống bị gán thất bại.', 'Có hành vi nhưng cơ hội hoặc độ phủ chưa rõ.', 'Hành vi, cơ hội, dữ liệu thiếu và mức thực hiện được phân biệt.'] },
      { id: 'mechanism', label: 'Rào cản và hỗ trợ', levels: ['Quy hết thiếu ý chí hoặc gắn nhãn tính cách.', 'Nêu COM-B nhưng hỗ trợ chưa khớp dữ kiện.', 'Giả thuyết có câu hỏi kiểm tra và hỗ trợ đúng điều kiện.'] },
      { id: 'feasibility', label: 'Thiết kế dùng được', levels: ['Chỉ nhắc cố gắng hoặc cần tuần hoàn hảo.', 'Có tín hiệu nhưng thiếu phương án trở ngại.', 'Có tín hiệu, nếu–thì, ba phương án và cơ hội nối lại.'] },
      { id: 'safety', label: 'Không bù trừ', levels: ['Khuyến khích nhịn, tập bù hoặc hạ an toàn.', 'Nhắc an toàn chung nhưng chưa biết khi dừng theo dõi.', 'Không phạt, giữ an toàn bữa và có bước hỗ trợ khi theo dõi gây hại.'] },
    ],
  },
  coachExtension: ['Hỏi ràng buộc công việc và nguồn lực trước tăng tần suất nhắc.', 'Tách hành vi đã thực hiện, khả năng tự động và kết quả sức khỏe.', '6N là khung học của Aura, không tuyên bố có thử nghiệm xác nhận hiệu quả riêng.'],
  safety: ['Không nhịn, tập bù hoặc dùng cảm giác tội lỗi để giữ chuỗi.', 'Không giảm an toàn thực phẩm, bỏ chỉ định chăm sóc hoặc dị ứng trong phương án tối thiểu.', 'Dừng cách theo dõi gây lo âu/bù trừ và tìm hỗ trợ phù hợp.', 'Không suy chẩn đoán tâm lý hoặc tính cách từ COM-B hay một tuần nhật ký.'],
  referenceIds: ['nice-behaviour-ph49', 'nice-shared-decisions', 'niddk-habits', 'michie-comb-2011', 'food-safety-four-steps', 'nhs-food-allergy', 'lally-habits-2010', 'nhs-eating-disorders'],
}
