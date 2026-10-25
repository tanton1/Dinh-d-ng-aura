import type { AcademyLearningUnit } from './learning-unit'

export const chapter20Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 20, revision: '2026-10-24.1',
  title: 'Tự chủ dinh dưỡng: hệ quyết định có bằng chứng và mạng lưới hỗ trợ',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên tổng hợp toàn khóa và PT/coach hỗ trợ bàn giao quyền quyết định trong phạm vi học tập.',
  scope: 'Xây hệ quyết định cho sinh hoạt ăn uống bằng ca giả định hoặc mục tiêu đời sống ít rủi ro. Hoàn thành khóa không tạo bằng cấp chuyên môn, quyền kê chế độ điều trị hoặc lý do từ chối chăm sóc cần thiết.',
  prerequisites: [5, 10, 15, 16, 17, 18, 19],
  objectives: [
    { id: 'ch20-decision', outcome: 'Dùng AURA 6Đ để tổ chức một quyết định có mục tiêu, lựa chọn và giới hạn.', evidence: 'Viết đủ sáu bước, gồm lựa chọn giữ hoặc chưa đổi, không chỉ chọn một phương án tối ưu giả định.' },
    { id: 'ch20-evidence', outcome: 'Nối nguồn, dữ liệu đời sống và kết luận theo đúng độ chắc chắn.', evidence: 'Tính đúng độ phủ và mức thực hiện, nêu yếu tố cùng thay đổi và không nhận quan hệ trước–sau là nhân quả.' },
    { id: 'ch20-support', outcome: 'Xây bản đồ hỗ trợ và câu hỏi đúng người, đúng mức khẩn cấp.', evidence: 'Phân biệt tổ chức bữa, đánh giá dinh dưỡng, thuốc và chăm sóc khẩn cấp mà không tự thay chỉ định.' },
    { id: 'ch20-continuity', outcome: 'Lập kế hoạch cập nhật một năm và portfolio theo đúng phiên bản minh chứng.', evidence: 'Có điểm rà theo bối cảnh, năm bản nộp 16–20 và phân biệt tự soi, phản hồi coach, năng lực chuyên môn.' },
  ],
  sections: [
    {
      id: 'ch20-six-decisions', title: '6Đ: cấu trúc quyền quyết định, không phải công thức điều trị', objectiveIds: ['ch20-decision'],
      paragraphs: [
        'AURA 6Đ là khung ghi nhớ của khóa: Định hướng — điều gì quan trọng với tôi; Đọc — nguồn và bối cảnh nói gì; Đặt ưu tiên — việc nào đáng làm trước; Đưa vào đời sống — ai làm, lúc nào, có phương án dự phòng; Đo — dữ liệu tối thiểu phục vụ câu hỏi; Đánh giá — giữ, làm rõ, sửa, dừng thử hoặc tìm hỗ trợ. Đây không phải mô hình lâm sàng đã được kiểm định riêng.',
        'Tự chủ không có nghĩa phải đổi thứ gì đó ngay. So lựa chọn bằng lợi ích mong đợi, rủi ro, công sức, chi phí, điều chưa chắc và sở thích. Giữ kế hoạch đang phù hợp hoặc xin thêm thông tin là lựa chọn hợp lệ; không tự ngừng thuốc hay bỏ đánh giá cần thiết dưới tên gọi không thay đổi.',
        'Học viên có quyền chọn mức tham gia và người đồng hành. Một quyết định tốt ghi điều đã hiểu, lý do chọn và điều sẽ khiến mình xem lại. Cách diễn đạt lại bằng lời của mình giúp kiểm tra thông tin được giải thích rõ, không phải kiểm tra sự ngoan ngoãn. Có thể học cả quá trình bằng ca giả định mà không thử thay đổi cơ thể.',
      ],
      takeaways: ['6Đ là công cụ học của Aura, không cấp quyền hành nghề.', 'Một lựa chọn tốt phải khớp mục tiêu của người thực hiện và giới hạn bằng chứng.'], sourceIds: ['nice-shared-decisions', 'niddk-habits', 'ies-learning'],
    },
    {
      id: 'ch20-evidence-chain', title: 'Chuỗi bằng chứng: câu hỏi → nguồn → quan sát → kết luận có giới hạn', objectiveIds: ['ch20-evidence'],
      paragraphs: [
        'Nguồn nghiên cứu giúp hiểu điều có thể kỳ vọng trong đối tượng và điều kiện được nghiên cứu; nhật ký cá nhân giúp biết kế hoạch có dùng được trong đời sống. Hai nguồn trả lời câu hỏi khác nhau. Không dùng một tuần thực hiện tốt để chứng minh cơ chế hormone, hiệu quả thuốc hay tính đúng của mọi lời quảng cáo.',
        'Một thử phương án hậu cần ít rủi ro có thể đặt câu hỏi như: nơi mua bữa dự phòng có giúp bữa trưa dễ tiếp cận hơn trong ca làm không? Ghi cơ hội, dữ liệu thiếu, phương án đã dùng và trải nghiệm; nếu cùng lúc đổi lịch, tiền hỗ trợ và nơi làm thì giữ các thay đổi đó trong kết luận. Trước–sau không tự tách được nguyên nhân.',
        'Kết luận có cấu trúc gồm: quan sát được gì, với bao nhiêu dữ liệu, chưa biết gì và quyết định tạm thời nào hợp lý. Không thêm chữ số để che đầu vào thiếu. Phân biệt chưa đủ bằng chứng với đã chứng minh không có hiệu quả; cảnh báo an toàn vẫn có giá trị dù dữ liệu chưa đủ hoặc tỷ lệ thực hiện cao.',
      ],
      takeaways: ['Nhật ký kiểm tra tính khả thi, không thay thử nghiệm điều trị.', 'Giữ mẫu số, dữ liệu thiếu và yếu tố cùng đổi cạnh kết luận.'], sourceIds: ['cochrane-pico', 'cochrane-bias', 'cochrane-interpretation', 'niddk-habits'],
    },
    {
      id: 'ch20-support-network', title: 'Gọi đúng người là một năng lực tự chủ', objectiveIds: ['ch20-support'],
      paragraphs: [
        'Bản đồ hỗ trợ gắn với câu hỏi, không chỉ là danh bạ. Người thân hoặc coach có thể giúp hậu cần và thói quen trong phạm vi phù hợp; chuyên gia dinh dưỡng có chuyên môn phù hợp giúp đánh giá nhu cầu và điều chỉnh liên quan dinh dưỡng; bác sĩ đánh giá triệu chứng và bệnh; dược sĩ giúp rà thuốc, sản phẩm và tương tác. Kiểm tra phạm vi thực tế của người hỗ trợ thay vì suy từ tên tài khoản.',
        'Chuẩn bị câu hỏi ngắn: mục tiêu của tôi là gì, điều đang xảy ra từ khi nào, hướng dẫn hiện có, thay đổi tôi đang cân nhắc và điều cần làm rõ. Chỉ chia sẻ dữ liệu cần thiết với sự đồng ý; không đăng hồ sơ bệnh, thuốc hoặc ảnh của người khác để xin đánh giá công khai. Nội dung khóa không thay việc xác minh hoặc đánh giá trực tiếp khi cần.',
        'Nếu có triệu chứng đáng lo, đừng chờ mốc rà để hoàn thiện nhật ký. Khó thở hoặc đau ngực trong ca thai kỳ/sau sinh ở chương 16 cần chăm sóc khẩn cấp; sụt cân không chủ ý hoặc lo âu quanh ăn uống cần đánh giá phù hợp. Học viên không cần tự gọi tên bệnh trước khi tìm trợ giúp và không tự thử lại chất gây dị ứng để có thêm dữ liệu.',
      ],
      takeaways: ['Hỏi đúng câu và đúng người tốt hơn tự đoán ngoài phạm vi.', 'Thiếu hồ sơ hoàn hảo không phải lý do trì hoãn trợ giúp.'], sourceIds: ['nice-shared-decisions', 'nih-supplements-consumer', 'niddk-ckd-nutrition', 'cdc-maternal-warning', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'nhs-food-allergy'],
    },
    {
      id: 'ch20-versioned-continuity', title: 'Bàn giao một hệ có thể cập nhật, không đóng băng kế hoạch mười hai tháng', objectiveIds: ['ch20-continuity'],
      paragraphs: [
        'Kế hoạch một năm ghi các bối cảnh dự kiến: mùa công việc bận, thay lịch gia đình, đi xa hoặc mốc chăm sóc đã có. Chọn một ưu tiên và đường rà phù hợp mỗi giai đoạn, không kê sẵn calorie hoặc xét nghiệm cho cả năm. Các mốc tháng do bài học chọn để tổ chức, không trì hoãn khám hoặc thay lịch điều trị đang được hướng dẫn.',
        'Bài thực hành 20 là bản hệ quyết định có thể nộp độc lập. Sau đó portfolio 20 ghép đúng năm bản nộp cố định của chương 16–20: hộ chiếu giai đoạn sống, phối hợp bệnh lý, đọc bằng chứng, thiết kế thói quen và hệ quyết định này. Đối chiếu mục tiêu, nguồn, điều đã sửa và câu hỏi còn mở; không bắt portfolio xong trước khi nộp bài 20.',
        'Bản nháp, bản đã nộp, tự soi rubric và nhận xét coach là các trạng thái khác nhau. Nhận xét cho phiên bản cũ không tự phê duyệt bản mới; giữ bản cũ làm lịch sử, nộp và rà lại bản cần dùng. Đạt bài chứng minh lập luận theo tiêu chí học tập, không cấp danh xưng chuyên gia, không xác nhận điều trị an toàn và không buộc tiếp tục chia sẻ dữ liệu sau khóa.',
      ],
      takeaways: ['Kế hoạch dài hạn cần điều kiện cập nhật, không phải cam kết không đổi.', 'Tự chủ gồm biết tiếp tục, thay đổi và tìm lại hỗ trợ khi cần.'], sourceIds: ['niddk-habits', 'nice-shared-decisions', 'ies-learning'],
    },
  ],
  workedExamples: [
    {
      id: 'ch20-decision-example', title: 'Một quyết định hậu cần đi đủ sáu bước', objectiveIds: ['ch20-decision', 'ch20-evidence'],
      prompt: 'Ca giả định muốn giảm số lần không tìm được bữa trưa trong ngày đi làm. Trong hai tuần có 10 cơ hội; 8 được ghi, 6 có bữa dùng được. Cũng trong kỳ đó lịch nghỉ trưa đổi.',
      given: ['10 cơ hội, 8 có dữ liệu, 6 ghi có bữa dùng được.', 'Có phương án nơi mua dự phòng và lịch nghỉ mới.', 'Không đo chỉ số bệnh hoặc hiệu quả dinh dưỡng điều trị.'],
      steps: ['Định hướng: dễ tiếp cận bữa; Đọc: lịch, khả năng mua và an toàn; Đặt ưu tiên: một phương án dự phòng.', 'Đưa vào đời sống: chốt nơi và giờ phù hợp; Đo: 6/8 = 75% ở dữ liệu biết, độ phủ 8/10 = 80%.', 'Đánh giá: bước tổ chức có vẻ dùng được trong phần ghi, còn hai lượt chưa biết và lịch nghỉ cùng đổi.', 'Có thể giữ để rà thêm tính khả thi nếu phù hợp; không kết luận nơi mua gây ra cải thiện hay đã chữa một vấn đề sức khỏe.'],
      answer: '75% trong phần có dữ liệu và độ phủ 80%; kết luận tạm về tính khả thi, chưa xác định quan hệ nhân quả.',
      limitation: 'Không có nhóm so sánh và có thay đổi đồng thời; đây không là thử nghiệm tự điều trị hoặc lời hứa sức khỏe.',
    },
    {
      id: 'ch20-versions-example', title: 'Năm bản nộp không đồng nghĩa năm bản hiện tại được coach chấp nhận', objectiveIds: ['ch20-continuity'],
      prompt: 'Ca portfolio đã có năm bản nộp 16–20. Bốn bản hiện tại có nhận xét chấp nhận; riêng chương 19 hiện tại là v2, còn nhận xét chấp nhận gắn v1.',
      given: ['Bản nộp hiện tại đủ 5/5.', 'Nhận xét khớp bản hiện tại: 4/5.', 'Bản 19 v1 được giữ như lịch sử; v2 là nội dung đã sửa.'],
      steps: ['Tách đủ minh chứng nộp: 5/5, tức 100%.', 'Tách nhận xét chấp nhận đúng phiên bản: 4/5, tức 80%.', 'Không sao nhận xét v1 sang v2; nếu cần nhận xét cho v2, mở đúng bản để rà.', 'Trình bày cả hai trạng thái; tỷ lệ này không đo khả năng chẩn đoán hoặc hiệu quả chăm sóc.'],
      answer: 'Đủ 5/5 bản nộp nhưng chỉ 4/5 bản hiện tại có nhận xét chấp nhận; không hiển thị 100% đã được coach chấp nhận.',
      limitation: 'Đây là ví dụ trạng thái minh chứng; không quy định mọi portfolio phải có coach chấp nhận trước khi nộp hoặc cấp chứng chỉ chuyên môn.',
    },
    {
      id: 'ch20-year-example', title: 'Một năm có mốc rà và đường mở lại', objectiveIds: ['ch20-support', 'ch20-continuity'],
      prompt: 'Ca giả định chia năm thành ba giai đoạn bốn tháng: lịch ổn định, mùa bận và thời gian đi xa. Viết một ưu tiên cùng điều kiện xem lại cho mỗi giai đoạn.',
      given: ['3 × 4 tháng = 12 tháng, chỉ là cách chia lịch của bài.', 'Chưa kê mức ăn hoặc điều trị cho bất kỳ giai đoạn nào.', 'Hướng dẫn chăm sóc hiện tại và quyền riêng tư vẫn được giữ.'],
      steps: ['Lịch ổn định: thử tổ chức bữa phù hợp và ghi tối thiểu điều cần cho câu hỏi.', 'Mùa bận: ưu tiên phương án dự phòng và người hỗ trợ, không tăng giám sát để bù thiếu nguồn lực.', 'Đi xa: cập nhật điều kiện mua/cất bữa và đường liên hệ hỗ trợ tại nơi đến.', 'Rà khi bối cảnh hoặc hướng dẫn đổi, không chờ hết bốn tháng nếu có triệu chứng; ghi phiên bản quyết định mới.'],
      answer: 'Một bản đồ 12 tháng có ba ưu tiên bối cảnh và điều kiện rà sớm, không phải thực đơn hoặc toa cố định một năm.',
      limitation: 'Không thay lịch chăm sóc, xét nghiệm hay khám theo chỉ định; ba giai đoạn là ví dụ tổ chức của Aura.',
    },
  ],
  cases: [
    { id: 'ch20-case-certificate', title: 'Học xong nên muốn tự kê cho người khác', context: 'Người học đạt các bài và muốn dùng kết quả làm bằng chứng đủ chuyên môn kê ăn cho người có bệnh.', question: 'Kết quả khóa cho phép kết luận gì?', reasoning: ['Bài chấm lập luận theo phạm vi học tập.', 'Kiến thức khóa không thay đào tạo và thẩm quyền chuyên môn.', 'Hồ sơ bệnh cần người phù hợp và dữ kiện thực tế.'], safeNextStep: 'Giữ vai trò hỗ trợ trong phạm vi, tìm người có chuyên môn phù hợp; không giới thiệu điểm khóa như giấy phép điều trị.', commonError: 'Đổi nhãn hoàn thành hoặc nhận xét coach thành chứng nhận hành nghề.' },
    { id: 'ch20-case-treatment', title: 'Tự chủ nên tự ngừng thuốc', context: 'Một học viên thấy bữa ăn tốt hơn và muốn ngừng thuốc để thử xem cơ thể đã tự cân bằng chưa.', question: 'Khung 6Đ có cho phép thử điều trị như vậy không?', reasoning: ['Nhật ký bữa không chứng minh hết nhu cầu điều trị.', 'Thay thuốc có rủi ro ngoài phạm vi bài.', 'Có thể ghi câu hỏi để trao đổi người kê thuốc.'], safeNextStep: 'Không tự thay hoặc ngừng thuốc; trao đổi với người kê và giữ hướng dẫn đang có trong lúc làm rõ.', commonError: 'Gọi việc tự ngừng thuốc là thử nghiệm cá nhân có trách nhiệm vì đã ghi dữ liệu.' },
    { id: 'ch20-case-privacy', title: 'Muốn dừng chia sẻ sau khóa', context: 'Người học muốn tự tiếp tục kế hoạch và không chia sẻ thêm nhật ký sinh hoạt với coach.', question: 'Điều gì cần bàn giao?', reasoning: ['Tự chủ gồm quyền kiểm soát dữ liệu và chọn hỗ trợ.', 'Có thể giữ riêng kế hoạch, câu hỏi và đường liên hệ khi cần.', 'Không dùng việc tiếp tục chia sẻ làm điều kiện công nhận bài đã học.'], safeNextStep: 'Thống nhất phạm vi chia sẻ mong muốn và đường tìm lại hỗ trợ; không hứa đã xóa lịch sử hoặc thu hồi mọi bản sao nếu chưa xác minh.', commonError: 'Ép chia sẻ vô hạn hoặc hứa xóa toàn bộ dữ liệu chỉ bằng lời nói.' },
  ],
  practice: {
    title: 'Hệ quyết định dinh dưỡng cá nhân 1.0', artifact: 'Một hệ quyết định có sáu bước, nguồn, giới hạn, hỗ trợ và lịch cập nhật; có thể dùng hoàn toàn ca giả định.',
    steps: ['Viết một ưu tiên và đi đủ 6Đ cho quyết định ít rủi ro.', 'Nối nguồn với điều được và không được kết luận.', 'Chọn dữ liệu tối thiểu, điều kiện dừng và người hỗ trợ.', 'Lập bản đồ một năm; nộp thực hành 20 trước khi ghép đủ minh chứng portfolio 20.'],
    fields: [
      { id: 'context', label: 'Định hướng và quyền chọn', prompt: 'Ghi điều quan trọng, bối cảnh và lựa chọn giữ hoặc chưa đổi; phân biệt mục tiêu đời sống với điều trị.', required: true },
      { id: 'hypothesis', label: 'Đọc và đặt ưu tiên', prompt: 'Nêu nguồn có phạm vi, điều chưa chắc, giả thuyết và vì sao chọn một ưu tiên thay vì đổi nhiều thứ.', required: true },
      { id: 'action', label: 'Đưa vào đời sống', prompt: 'Viết ai làm gì, khi nào, phương án dự phòng và câu hỏi cần đúng người hỗ trợ.', required: true },
      { id: 'minimum', label: 'Kế hoạch theo bối cảnh', prompt: 'Chia một năm thành các giai đoạn phù hợp, ưu tiên tối giản và điều kiện đổi khi nguồn lực thay.', required: true },
      { id: 'data', label: 'Đo, đánh giá và phiên bản', prompt: 'Ghi mẫu số, phần thiếu, giới hạn nhân quả và các bản nộp 16–19 sẽ nối với bản 20 sau khi nộp.', required: true },
      { id: 'stop', label: 'Ranh giới và hỗ trợ', prompt: 'Nêu điều kiện không tiếp tục thử, đường chăm sóc phù hợp, quyền chia sẻ và điều khóa học không chứng nhận.', required: true },
    ],
    modelResponse: ['Tôi chọn ca hậu cần bữa trưa: mục tiêu là bữa dùng được, không thay thuốc hoặc chỉ định. 6Đ ghi đủ ưu tiên, nguồn, phương án, dữ liệu và quyết định xem lại.', '6/8 lượt đã biết có bữa, phủ 8/10; lịch nghỉ đồng thời đổi nên chưa nói phương án mua gây kết quả. Tôi giữ kết luận về tính khả thi với giới hạn rõ.', 'Bản đồ một năm cập nhật theo bối cảnh và hướng dẫn chăm sóc. Sau khi nộp bài 20 mới ghép năm bản nộp 16–20; nhận xét cũ chỉ gắn bản cũ, hoàn thành không là bằng chuyên môn.'],
    rubric: [
      { id: 'data', label: 'Chuỗi bằng chứng', levels: ['Bỏ mẫu số, dữ liệu thiếu hoặc sao nhận xét cũ sang bản mới.', 'Có dữ kiện nhưng giới hạn nguồn/phiên bản chưa rõ.', 'Nguồn, mẫu số, phần thiếu, giới hạn và phiên bản được giữ rõ.'] },
      { id: 'mechanism', label: 'Lập luận tự chủ', levels: ['Coi trước–sau là nhân quả hoặc 6Đ là phác đồ.', 'Nêu 6Đ nhưng lựa chọn chưa nối với bằng chứng.', 'Đủ sáu bước, lựa chọn có giới hạn và biết khi chưa đủ để quyết.'] },
      { id: 'feasibility', label: 'Hệ tiếp tục dùng được', levels: ['Kế hoạch cứng một năm hoặc chỉ có mục tiêu hình thể.', 'Có lịch nhưng thiếu dự phòng và người hỗ trợ.', 'Có kế hoạch theo bối cảnh, dữ liệu tối thiểu và điều kiện mở lại hỗ trợ.'] },
      { id: 'safety', label: 'Phạm vi và quyền chọn', levels: ['Tự đổi điều trị, ép chia sẻ hoặc nhận quyền hành nghề.', 'Nhắc hỗ trợ nhưng thiếu ranh giới hoặc đường khẩn cấp.', 'Giữ chăm sóc cần thiết, quyền riêng tư và phân biệt học tập với chuyên môn.'] },
    ],
  },
  coachExtension: ['Bàn giao cách đặt câu hỏi và điều kiện rà thay vì tạo phụ thuộc vào mọi lần coach phê duyệt.', 'Không biến điểm tự soi hoặc phản hồi giáo dục thành lời xác nhận sức khỏe.', 'Kiểm tra portfolio có đúng phiên bản, không chỉ đủ số mục.'],
  safety: ['Không tự thay thuốc hoặc thử điều trị để lấy dữ liệu cho bài.', 'Không chờ đầy nhật ký hoặc hết giai đoạn mới tìm chăm sóc cần thiết.', 'Hoàn thành không cấp chứng chỉ chuyên môn hay quyền kê ăn cho bệnh lý.', 'Không ép chia sẻ vô hạn, không hứa xóa lịch sử nếu chưa có thao tác được xác minh.'],
  referenceIds: ['nice-shared-decisions', 'niddk-habits', 'ies-learning', 'cochrane-pico', 'cochrane-bias', 'cochrane-interpretation', 'nih-supplements-consumer', 'niddk-ckd-nutrition', 'cdc-maternal-warning', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'nhs-food-allergy'],
}
