import type { AcademyLearningUnit } from './learning-unit'

export const chapter12Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 12, revision: '2026-10-24.1',
  title: 'Dinh dưỡng phục hồi: nhìn cả nhiên liệu, giấc ngủ và tải',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành đang học tổ chức phục hồi; coach nhận ra giới hạn hỗ trợ dinh dưỡng và lúc cần chuyển đánh giá.',
  scope: 'Lập kế hoạch 24–48 giờ trên ca giả định, phân biệt chỉ số học tập với đánh giá sức khỏe. Không chẩn đoán REDs, chấn thương, rối loạn giấc ngủ hoặc kê quy trình trở lại tập.',
  prerequisites: [6, 7, 10, 11],
  objectives: [
    { id: 'ch12-repair', outcome: 'Phân biệt sửa chữa mô, nạp lại nhiên liệu và bù dịch trong một lịch phục hồi.', evidence: 'Nối từng nhiệm vụ với thời gian, bữa ăn và lần tập tiếp theo thay vì một sản phẩm.' },
    { id: 'ch12-availability', outcome: 'Phân biệt năng lượng sẵn có với cân bằng năng lượng và giới hạn tính EA.', evidence: 'Tính đúng trên số giả định, không dùng kết quả để xác nhận hoặc loại trừ REDs.' },
    { id: 'ch12-sleep', outcome: 'Tách cơ hội ngủ, thời gian ngủ và cảm giác hồi phục khỏi điểm thiết bị.', evidence: 'Đọc một lịch ngủ, tính phần thời gian biết được và chọn bước tổ chức vừa sức.' },
    { id: 'ch12-triage', outcome: 'Nhận ra khi cần sửa hậu cần, tìm đánh giá hoặc trợ giúp ngay.', evidence: 'Không gọi mọi đau cơ là DOMS và không chờ đủ bảng khi có dấu hiệu đáng lo.' },
  ],
  sections: [
    {
      id: 'ch12-recovery-tasks', title: 'Ba nhiệm vụ dinh dưỡng trong một hệ phục hồi', objectiveIds: ['ch12-repair'],
      paragraphs: [
        'Protein cung cấp amino acid cho sửa chữa và thích nghi; carbohydrate hỗ trợ tái tạo glycogen; dịch cần được cân bằng phù hợp. Các nhiệm vụ có thể cùng được phục vụ bởi bữa ăn, không cần ba sản phẩm tách biệt. Tổng nguồn lực và lịch tập quan trọng hơn việc chọn một món được quảng cáo là phục hồi.',
        'Hãy bắt đầu từ lúc kết thúc buổi tới buổi kế tiếp. Một người cần vận động lại sau vài giờ có bài toán hậu cần khác người nghỉ tới hôm sau. Lập chỗ ăn, đồ sẵn dùng và thời gian di chuyển trước; chiến lược nạp nhanh của vận động viên thi đấu không là mặc định cho mọi lịch tập.',
        'Ngày nghỉ không đồng nghĩa cơ thể hết việc thích nghi. Lịch 24–48 giờ của bài học vẫn có các bữa, điều kiện uống và thời gian nghỉ, nhưng không hứa một số giờ sẽ làm mọi mô hồi phục. Kế hoạch cũng ghi phần thuộc người hướng dẫn tập hoặc nhân viên y tế, không coi dinh dưỡng thay được mọi điều chỉnh tải.',
      ],
      takeaways: ['Giải thích nhiệm vụ trước khi chọn công cụ.', '24–48 giờ là khung lập lịch bài tập, không phải thời gian lành mọi chấn thương.'], sourceIds: ['issn-timing-2017', 'nih-sport-supplements', 'nata-fluid-2017'],
    },
    {
      id: 'ch12-energy-availability', title: 'EA không phải calorie còn lại trên ứng dụng', objectiveIds: ['ch12-availability'],
      paragraphs: [
        'Năng lượng sẵn có, viết tắt EA, được biểu diễn bằng năng lượng ăn vào trừ tiêu hao riêng của vận động, chia khối không mỡ. Đơn vị là kcal/kg khối không mỡ/ngày. Cân bằng năng lượng lại so lượng ăn với tổng tiêu hao cả ngày; hai phép tính không thay nhau và không dùng cùng mẫu số.',
        'IOC mô tả REDs là vấn đề sức khỏe và hiệu suất liên quan phơi nhiễm thiếu năng lượng có vấn đề, có thể gặp ở nữ và nam. Không có một kết quả EA đơn lẻ áp cho mọi người để chứng nhận an toàn hoặc chẩn đoán. Mức độ, thời gian và hoàn cảnh cần được đánh giá cùng nhiều dữ kiện.',
        'Ngoài đời, lượng ăn, tiêu hao vận động và khối không mỡ đều khó đo chính xác; vài ngày ghi không kể toàn bộ quá khứ. Do đó bài chỉ luyện phân biệt khái niệm bằng dữ liệu giả định. Không lấy “calorie hoạt động” không rõ định nghĩa của đồng hồ rồi đặt nhãn REDs hoặc yêu cầu tự bù một con số.',
      ],
      takeaways: ['EA dùng tiêu hao vận động và khối không mỡ; không dùng TDEE hoặc cân nặng thay tùy tiện.', 'Không có số tính đẹp nào thay đánh giá khi sức khỏe hoặc hiệu suất có vấn đề.'], sourceIds: ['ioc-reds-2023', 'ioc-reds-methods-2023'],
    },
    {
      id: 'ch12-sleep-opportunity', title: 'Tạo cơ hội ngủ, không săn điểm ngủ', objectiveIds: ['ch12-sleep'],
      paragraphs: [
        'Thời gian từ lên giường tới thức dậy là cơ hội ngủ, không chắc là thời gian ngủ thật. Ghi thời gian khó vào giấc và thức giữa đêm nếu đã biết. CDC nêu người 18–60 tuổi thường cần ít nhất bảy giờ, đồng thời nhấn mạnh chất lượng; đây không là một mức chính xác đủ cho mọi người hoặc mọi tải tập.',
        'Trong bài lập lịch, tìm trở ngại có thể đổi: giờ kết thúc công việc, đường đi, đồ ăn chuẩn bị hoặc lịch buổi tập. Chọn một việc giảm trở ngại mà vẫn khả thi. Đừng dùng điểm của ứng dụng làm mệnh lệnh hoặc ép khai báo dữ liệu nhạy cảm; mô tả giả định vẫn đủ để luyện suy luận.',
        'Nếu thường xuyên khó ngủ hoặc vẫn mệt dù đã tạo cơ hội ngủ, tìm đánh giá phù hợp thay vì chỉ tăng quyết tâm. Caffeine không thay giấc ngủ và có thể làm khó ngủ hơn; không tăng liều chất kích thích để cố hoàn thành lịch. Bài không kê thuốc ngủ hoặc tự xử trí bệnh giấc ngủ.',
      ],
      takeaways: ['Cơ hội ngủ, giấc ngủ thật và trải nghiệm ban ngày là ba thông tin khác nhau.', 'Kế hoạch phục hồi phải khớp lịch sống, không chỉ đủ ô trong bảng.'], sourceIds: ['cdc-sleep', 'nih-sport-supplements'],
    },
    {
      id: 'ch12-support-decisions', title: 'Đau và mệt là thông tin cần đọc, không phải điểm thành tích', objectiveIds: ['ch12-triage'],
      paragraphs: [
        'Đau cơ khởi phát muộn có thể xuất hiện sau tải không quen, nhưng thời điểm đau không đủ phân biệt chắc với chấn thương. Ghi khởi đầu, diễn biến và ảnh hưởng hoạt động. Đau kéo dài, xấu đi hoặc có biểu hiện bất thường cần hỏi người có chuyên môn, không tự gọi là đau tốt rồi cố vượt qua.',
        'Đau cơ nặng hơn dự kiến, yếu rõ hoặc nước tiểu sẫm sau vận động là những dấu hiệu cần chăm sóc ngay; không cần chờ đủ cả ba. Có thể có nhiều nguyên nhân, trong đó có tiêu cơ vân. Không chẩn đoán qua màu nước tiểu, không tự xử trí bằng uống nhiều nước rồi đợi hôm sau.',
        'Khi mệt kéo dài, hiệu suất suy giảm, chấn thương lặp lại, thay đổi kinh nguyệt hoặc khó khăn ăn uống, ưu tiên đánh giá phù hợp. Bài cho ba lựa chọn tổ chức: giữ khi dữ kiện hỗ trợ, sửa điều kiện thực hiện, hoặc tìm hỗ trợ; đây không phải thang phân loại y khoa hay công cụ IOC CAT2.',
      ],
      takeaways: ['Không cần chờ đủ dấu hiệu hoặc đủ ngày ghi trước chăm sóc cần thiết.', 'Một bảng tự soi không cho quyền chẩn đoán hoặc cho phép quay lại tập.'], sourceIds: ['nhs-doms', 'cdc-rhabdo-signs', 'ioc-reds-2023', 'nhs-eating-disorders'],
    },
  ],
  workedExamples: [
    {
      id: 'ch12-gap-example', title: 'Ba giờ và hai mươi bốn giờ không cùng bài toán', objectiveIds: ['ch12-repair'],
      prompt: 'Hai nhân vật cùng kết thúc buổi lúc 10:00. A tập lại lúc 13:00 cùng ngày; B tập lại lúc 10:00 hôm sau.',
      given: ['Khoảng di chuyển của A là 60 phút.', 'Chưa có định lượng bữa, dữ liệu tiêu hóa hoặc dịch mất.', 'Không mặc định hai buổi đầu có tải giống nhau.'],
      steps: ['A có 3 giờ giữa hai buổi; B có 24 giờ.', 'Với A, xác định nơi và thời gian ăn/uống trong khoảng di chuyển, cùng yêu cầu của buổi sau.', 'Với B, tổ chức các bữa cùng giấc ngủ thay vì sao lịch nạp gấp của A.', 'Hỏi thêm tải và dung nạp trước khi đặt lượng; không tự hứa đã phục hồi hoàn toàn sau ba giờ.'],
      answer: 'Khoảng hồi phục khác nhau làm thay đổi ưu tiên hậu cần; dữ liệu chưa đủ để kê gram/giờ cho A hoặc B.',
      limitation: 'Lịch đồng hồ không đo glycogen, mức tổn thương hoặc khả năng trở lại thi đấu an toàn.',
    },
    {
      id: 'ch12-ea-example', title: 'Tính hai chỉ số, giữ hai ý nghĩa', objectiveIds: ['ch12-availability'],
      prompt: 'Dữ liệu hoàn toàn giả định: ăn 2.400 kcal/ngày, tiêu hao vận động 600, tổng tiêu hao 2.600 và khối không mỡ 50 kg.',
      given: ['Các con số được cho chính xác chỉ để luyện công thức.', 'Tiêu hao vận động là đầu vào riêng, không phải tổng tiêu hao.', 'Không có triệu chứng hoặc dữ liệu thời gian dài.'],
      steps: ['EA = (2.400 − 600) / 50 = 36 kcal/kg khối không mỡ/ngày.', 'Cân bằng năng lượng = 2.400 − 2.600 = −200 kcal/ngày.', 'Ghi khác nhau về tử số, mẫu số và đơn vị.', 'Không gọi 36 là xác nhận an toàn hay REDs; −200 cũng không cho mức độ nguy cơ cá nhân.'],
      answer: 'EA giả định là 36 kcal/kg khối không mỡ/ngày; cân bằng năng lượng là −200 kcal/ngày.',
      limitation: 'Ngoài đời các đầu vào có sai số; không dùng phép tính này làm chẩn đoán hoặc toa tăng/giảm ăn.',
    },
    {
      id: 'ch12-sleep-example', title: 'Tám giờ trên giường, chưa chắc tám giờ ngủ', objectiveIds: ['ch12-sleep', 'ch12-triage'],
      prompt: 'Nhật ký giả định lên giường 22:30, dậy 06:30; mất 30 phút vào giấc và thức giữa đêm tổng cộng 45 phút.',
      given: ['Cơ hội ngủ qua nửa đêm là 8 giờ.', 'Thời gian thức được giả định ghi đủ trong đề.', 'Một đêm không là đánh giá toàn bộ giấc ngủ.'],
      steps: ['Đổi 8 giờ thành 480 phút.', 'Thời gian ngủ suy ra theo dữ liệu = 480 − 30 − 45 = 405 phút.', '405 phút = 6 giờ 45 phút, không phải 8 giờ.', 'Ghi giới hạn tự báo cáo và hỏi diễn biến; nếu vấn đề lặp lại, tìm hỗ trợ thay vì che mệt bằng chất kích thích.'],
      answer: 'Cơ hội ngủ 8 giờ; thời gian ngủ suy ra 6 giờ 45 phút theo giả định, chưa xác định chất lượng hay bệnh.',
      limitation: 'Không chẩn đoán từ một đêm hoặc coi phép trừ như một phép đo giấc ngủ lâm sàng.',
    },
  ],
  cases: [
    { id: 'ch12-case-soreness', title: 'Đau nhiều mới thấy tập có tác dụng', context: 'Một người đổi bài tập, hôm sau đau và muốn tăng tải để đau nhiều hơn.', question: 'Đau có đủ là thước đo tiến bộ không?', reasoning: ['Đau là trải nghiệm cần mô tả, không đo riêng thích nghi.', 'Tải mới và thời điểm chưa loại trừ vấn đề khác.', 'Diễn biến xấu hoặc bất thường cần đánh giá.'], safeNextStep: 'Trao đổi người hướng dẫn về tải và mô tả diễn biến; không cố gây đau hoặc tự chẩn đoán.', commonError: 'Đồng nhất đau cơ với chất lượng buổi tập hoặc thiếu một loại thực phẩm.' },
    { id: 'ch12-case-urgent', title: 'Yếu rõ và nước tiểu sẫm sau buổi nặng', context: 'Ca giả định có đau cơ nặng hơn bình thường và nước tiểu màu trà sau vận động.', question: 'Có nên chỉ uống thêm nước rồi đợi bảng ngày mai?', reasoning: ['Dấu hiệu cần chăm sóc ngay, không cần chờ đủ bộ triệu chứng.', 'Các nguyên nhân có thể trùng nhau nên không tự đặt tên bệnh.', 'Công thức dịch hoặc bổ sung không thay được đánh giá.'], safeNextStep: 'Dừng hoạt động và tìm chăm sóc y tế ngay; không chờ coach hoặc tự điều trị bằng dịch.', commonError: 'Gọi là DOMS hay mất nước thông thường chỉ vì xảy ra sau tập.' },
    { id: 'ch12-case-fatigue', title: 'Mệt kéo dài dù có nhiều sản phẩm', context: 'Nhân vật ngủ ngắn, tăng số buổi, bỏ bữa và thấy hiệu suất giảm kéo dài.', question: 'Bước nào cần ưu tiên trước khi mua thêm?', reasoning: ['Nền ăn, ngủ và tải cùng thay đổi.', 'Không xác định một thiếu chất hay REDs từ mô tả này.', 'Cần hỗ trợ đánh giá và sửa lịch trong phạm vi phù hợp.'], safeNextStep: 'Chuẩn bị thông tin để hỏi chuyên môn và người hướng dẫn tập; không tăng chất kích thích để giữ lịch bằng mọi giá.', commonError: 'Biến mọi mệt mỏi thành chỉ định bổ sung hoặc bỏ qua vì cân nặng còn bình thường.' },
  ],
  practice: {
    title: 'Kế hoạch phục hồi 24–48 giờ có điều kiện hỗ trợ', artifact: 'Một lịch ăn–ngủ–di chuyển và phiếu phân biệt dữ kiện với quyết định chăm sóc trên ca giả định.',
    steps: ['Ghi buổi vừa xong, lịch kế tiếp và các trở ngại ăn/ngủ.', 'Nối ba nhiệm vụ phục hồi với thời điểm và cách tổ chức.', 'Tính EA hoặc cơ hội ngủ từ dữ liệu giả định, chỉ rõ giới hạn.', 'Chọn giữ, sửa hậu cần hoặc tìm hỗ trợ; dấu hiệu cần chăm sóc không chờ lịch rà bài.'],
    fields: [
      { id: 'context', label: 'Tải và lịch sống', prompt: 'Mô tả ca giả định, buổi vừa xong, lần tập sau và điều kiện ăn, ngủ, di chuyển.', required: true },
      { id: 'hypothesis', label: 'Nhiệm vụ phục hồi', prompt: 'Giải thích phần cần tổ chức: mô, nhiên liệu, dịch, ngủ; điều nào chưa thể suy từ đau hoặc mệt?', required: true },
      { id: 'action', label: 'Lịch và bước phối hợp', prompt: 'Lập lịch 24–48 giờ; nêu phần tự tổ chức và phần cần người hướng dẫn hoặc nhân viên y tế đánh giá.', required: true },
      { id: 'minimum', label: 'Một trở ngại ưu tiên', prompt: 'Khi lịch bận, sẽ giảm trở ngại nào để bữa hoặc cơ hội ngủ dùng được mà không thêm chất kích thích?', required: true },
      { id: 'data', label: 'Phép tính có giới hạn', prompt: 'Tính EA hoặc thời gian ngủ từ số giả định, nêu đơn vị, thông tin thiếu và ngày rà bài.', required: true },
      { id: 'stop', label: 'Không chờ đủ bảng', prompt: 'Nêu dấu hiệu cần tìm chăm sóc ngay hoặc đánh giá sớm; không tự chẩn đoán hay quyết định trở lại tập.', required: true },
    ],
    modelResponse: ['Ca có ba giờ trước buổi tiếp; ưu tiên chỗ ăn và di chuyển, không sao mọi lượng nạp của vận động viên khác.', 'EA trong ví dụ là 36 kcal/kg khối không mỡ/ngày, khác cân bằng −200 kcal/ngày; không xác nhận tình trạng sức khỏe.', 'Lịch ngủ tám giờ chỉ suy ra sáu giờ bốn mươi lăm phút nếu trừ phần thức đã biết. Đau nặng bất thường, yếu hoặc nước tiểu sẫm cần chăm sóc, không đợi hoàn tất bài.'],
    rubric: [
      { id: 'data', label: 'Đúng chỉ số', levels: ['Dùng TDEE trong EA hoặc gọi thời gian trên giường là ngủ thật.', 'Tính đúng nhưng thiếu đơn vị hoặc dữ kiện còn thiếu.', 'Tách chỉ số, đầu vào và giới hạn; không dùng kết quả làm chẩn đoán.'] },
      { id: 'mechanism', label: 'Nhiều nhiệm vụ phục hồi', levels: ['Quy mọi vấn đề cho một chất hoặc một sản phẩm.', 'Nêu các trụ nhưng chưa nối với lịch tập.', 'Giải thích mô, nhiên liệu, dịch và ngủ theo khoảng hồi phục của ca.'] },
      { id: 'feasibility', label: 'Lịch thực hiện được', levels: ['Chỉ liệt kê sản phẩm hoặc lời khuyên chung.', 'Có lịch nhưng chưa xử lý trở ngại chính.', 'Có lịch, lựa chọn dự phòng, người cần phối hợp và mốc rà phù hợp.'] },
      { id: 'safety', label: 'Hỗ trợ đúng lúc', levels: ['Trì hoãn chăm sóc, tự chẩn đoán hoặc ép tập qua dấu hiệu nặng.', 'Có nhắc hỗ trợ nhưng còn chờ đủ ngày ghi.', 'Nhận ra khi cần chăm sóc, không cần đủ mọi dấu hiệu và không tự cho phép quay lại tập.'] },
    ],
  },
  coachExtension: ['Không dùng khung tự soi của bài thay công cụ lâm sàng hoặc thẩm quyền cho phép thi đấu.', 'Giải thích EA bằng đơn vị trước khi nói về con số; không chuyển ngưỡng trên mạng thành chẩn đoán.', 'Phản hồi chất lượng kế hoạch và cách chuyển thông tin, không nhận vai điều trị triệu chứng.'],
  safety: ['Không chẩn đoán REDs, DOMS hay chấn thương từ bảng tự ghi.', 'Đau cơ nặng bất thường, yếu rõ hoặc nước tiểu sẫm cần chăm sóc ngay, không chờ đủ mọi dấu hiệu.', 'Không tự tăng dịch, muối hoặc chất kích thích để xử lý triệu chứng.', 'Có thể dùng toàn bộ dữ liệu giả định; không yêu cầu khai báo chu kỳ hoặc hồ sơ y tế thật.'],
  referenceIds: ['issn-timing-2017', 'nih-sport-supplements', 'nata-fluid-2017', 'ioc-reds-2023', 'ioc-reds-methods-2023', 'cdc-sleep', 'nhs-doms', 'cdc-rhabdo-signs', 'nhs-eating-disorders'],
}
