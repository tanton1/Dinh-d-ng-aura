import type { AcademyLearningUnit } from './learning-unit'

export const chapter04Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 4, revision: '2026-10-24.1',
  title: 'Vitamin, khoáng chất và nước: đọc đúng nhu cầu, tránh bổ sung theo cảm tính',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành đọc thông tin vi chất và nước; coach hỗ trợ lập câu hỏi, không kê sản phẩm hoặc liều điều trị.',
  scope: 'Hiểu vai trò, hệ giá trị tham chiếu và kiểm kê nguồn cung trên nhãn giả định. Không chẩn đoán thiếu chất, không chỉ định xét nghiệm hay thay hướng dẫn dùng thuốc và dịch.',
  prerequisites: [1, 2, 3],
  objectives: [
    { id: 'ch04-role', outcome: 'Nêu ví dụ chức năng vi chất mà không suy từ một triệu chứng sang thiếu chất.', evidence: 'Phân biệt vai trò vitamin D, sắt với lời hứa tăng năng lượng của một sản phẩm.' },
    { id: 'ch04-reference', outcome: 'Phân biệt RDA, AI, EAR, UL và %DV; kiểm tra mg/µg.', evidence: 'Giải thích vì sao UL không phải mục tiêu và %DV không là phần trăm nhu cầu cá nhân.' },
    { id: 'ch04-audit', outcome: 'Kiểm kê lượng từ nhiều nguồn có cùng đơn vị và dạng chất.', evidence: 'Tìm một thành phần trùng lặp và viết câu hỏi cần xác minh trước khi cộng hoặc dùng.' },
    { id: 'ch04-water', outcome: 'Đặt lượng nước trong bối cảnh thay vì dùng một mục tiêu chung cho mọi người.', evidence: 'Phân biệt nước từ đồ uống và thức ăn, nhận diện giới hạn dịch cần giữ.' },
  ],
  sections: [
    {
      id: 'ch04-functions', title: 'Cần lượng nhỏ không có nghĩa vai trò nhỏ', objectiveIds: ['ch04-role'],
      paragraphs: [
        'Vi chất không được dùng như ba nguồn năng lượng 4–4–9 ở chương trước. Ví dụ, vitamin D hỗ trợ hấp thu calcium và liên quan sức khỏe xương; sắt tham gia hemoglobin vận chuyển oxygen. Hiểu chức năng giúp đặt câu hỏi đúng, không có nghĩa tăng thật nhiều một chất sẽ tăng tương ứng chức năng ấy.',
        'Một người báo mệt chưa đủ để kết luận thiếu sắt hay vitamin D. Hãy tách “triệu chứng được báo” khỏi “nguyên nhân đã được xác định”. Trong bài học, điều cần làm là kiểm tra thông tin và nhận ra khi cần đánh giá chuyên môn, không chọn viên bổ sung bằng cách đối chiếu một triệu chứng trên mạng.',
        'Đọc sản phẩm “hỗ trợ năng lượng” theo hai lớp: nhãn ghi chất gì, lượng bao nhiêu; lời quảng cáo có chứng cứ gì cho đúng đối tượng và kết quả đó? Cơ thể cần một chất không tự chứng minh người đang đọc thiếu chất ấy hoặc sản phẩm cụ thể sẽ giúp họ.',
      ],
      takeaways: ['Vai trò sinh học không phải chỉ định bổ sung.', 'Triệu chứng đơn lẻ không xác nhận thiếu vi chất.'], sourceIds: ['nih-vitamin-d', 'nih-iron', 'nih-supplements-consumer'],
    },
    {
      id: 'ch04-values', title: 'Đọc đúng tên giá trị tham chiếu', objectiveIds: ['ch04-reference'],
      paragraphs: [
        'Trong hệ DRI, RDA hướng tới đáp ứng gần như toàn bộ người khỏe mạnh trong nhóm; AI được dùng khi chưa đủ bằng chứng đặt RDA; EAR là mức đáp ứng nhu cầu ước tính của một nửa nhóm. UL là giới hạn trên của lượng dùng hằng ngày ít có khả năng gây hại, không phải mục tiêu cần đạt. Phải đọc đúng nhóm tuổi, giai đoạn sống và phạm vi của từng giá trị.',
        'Trên nhãn theo chuẩn Hoa Kỳ, %DV là phần trăm giá trị tham chiếu của dưỡng chất trong một khẩu phần. Nó không đo phần trăm nhu cầu riêng của người cầm hộp. Nhãn ở nơi khác có thể dùng hệ tham chiếu khác; đọc chú thích thay vì mặc định mọi phần trăm cùng mẫu số.',
        'Giữ đơn vị trước khi cộng: 1 mg = 1.000 µg, còn mcg cũng ký hiệu microgram. Với IU hoặc các dạng chất được quy đổi theo quy ước riêng, không dùng một hệ số chung cho mọi chất. Nếu nhãn không đủ thông tin về dạng và đơn vị, đánh dấu cần xác minh thay vì tự làm cho các số khớp nhau.',
      ],
      takeaways: ['Không dùng UL làm đích bổ sung.', 'So sánh lượng chỉ có nghĩa khi đơn vị, dạng chất và phạm vi tham chiếu phù hợp.'], sourceIds: ['nih-dri', 'fda-nutrition-label', 'nih-vitamin-d'],
    },
    {
      id: 'ch04-sources', title: 'Kiểm kê nguồn trước khi quyết định', objectiveIds: ['ch04-audit'],
      paragraphs: [
        'Một dưỡng chất có thể xuất hiện trong thực phẩm, món tăng cường vi chất và nhiều sản phẩm bổ sung cùng lúc. Lập bảng tên nguồn, thành phần, lượng mỗi khẩu phần, số khẩu phần dùng và điều chưa rõ. Cộng đúng nhãn vẫn chưa phải đánh giá hấp thu hoặc quyết định người đó nên dùng thêm.',
        'Sản phẩm bổ sung có thể tương tác với thuốc và với kế hoạch chăm sóc. Không xem chữ “tự nhiên” hay liều dưới một ngưỡng chung là bảo đảm an toàn cho mọi người. Khi rà soát thực tế, mang danh sách sản phẩm và thuốc đang dùng đến bác sĩ hoặc dược sĩ; không tự ngừng thuốc để làm bảng kiểm kê đơn giản hơn.',
        'Bài tập dưới đây dùng dưỡng chất X giả định để luyện đơn vị và phát hiện trùng. X không có RDA hoặc UL thật trong bài. Cách thiết kế này tránh biến một phép tính vào vai liều khuyến nghị; kết quả có thể là “cần xác minh” chứ không buộc phải chọn mua hoặc loại một sản phẩm.',
      ],
      takeaways: ['Kiểm kê không đồng nghĩa kê bổ sung.', 'Không bỏ qua nguồn tăng cường hoặc sản phẩm dùng đồng thời.'], sourceIds: ['nih-supplements-consumer'],
    },
    {
      id: 'ch04-hydration', title: 'Nước: tổng nguồn và hoàn cảnh', objectiveIds: ['ch04-water'],
      paragraphs: [
        'Nước đến từ đồ uống và thức ăn; không chỉ có nước lọc mới đóng góp. Nhu cầu thay đổi theo hoàn cảnh như nhiệt độ, hoạt động, bệnh và giai đoạn sống. Một hướng dẫn chung không phải lượng chính xác cần ép mọi người uống, cũng không thể bỏ qua nước đã có trong các nguồn khác.',
        'Trong bảng ghi, tách thể tích đồ uống đã biết với lượng nước từ thức ăn chưa ước tính; không gọi tổng đồ uống là toàn bộ tổng nước. Nếu mục tiêu chỉ là hiểu thói quen, ghi loại và thời điểm uống có thể đủ cho bài học, không bắt buộc đo mọi món ăn.',
        'Người được hướng dẫn giới hạn dịch cần giữ kế hoạch riêng và hỏi đội ngũ chăm sóc cách tính các nguồn. Bài học không đưa quy tắc cố định theo kilogram hoặc yêu cầu tăng nước để “thải độc”. Khi có tình trạng cần bù dịch y tế, hướng dẫn phổ thông này không thay đánh giá và xử trí chuyên môn.',
      ],
      takeaways: ['Tổng đồ uống không phải toàn bộ tổng nước.', 'Không sửa giới hạn dịch vì một quy tắc chung trên mạng.'], sourceIds: ['nhs-hydration', 'niddk-ckd-nutrition'],
    },
  ],
  workedExamples: [
    {
      id: 'ch04-unit-example', title: 'Cộng mg với µg sau khi đổi đơn vị', objectiveIds: ['ch04-reference', 'ch04-audit'],
      prompt: 'Hai nguồn giả định chứa cùng dạng dưỡng chất X. Cộng lượng ghi trên nhãn; không đánh giá liều dùng.',
      given: ['A có 0,4 mg X trong lượng đang xét.', 'B có 250 µg X trong lượng đang xét.', 'X là ký hiệu học tập, không có mức nhu cầu hoặc giới hạn an toàn trong đề.'],
      steps: ['Đổi A: 0,4 mg × 1.000 µg/mg = 400 µg.', 'Cộng cùng đơn vị: 400 + 250 = 650 µg.', 'Nếu viết bằng mg: 650 / 1.000 = 0,65 mg.', 'Ghi đây là lượng từ hai nguồn đã nêu, không phải tổng khẩu phần hoặc nhu cầu.'],
      answer: 'Tổng hai nguồn là 650 µg = 0,65 mg X; không phải 250,4 mg.',
      limitation: 'Không có cơ sở kết luận thiếu, thừa, an toàn hoặc nên bổ sung từ dữ liệu giả định này.',
    },
    {
      id: 'ch04-dv-example', title: 'Phần trăm của mẫu số nào?', objectiveIds: ['ch04-reference'],
      prompt: 'Một nhãn giả định dùng cùng chuẩn %DV, ghi 30% DV cho mỗi khẩu phần của dưỡng chất Y. Người học đang tính hai khẩu phần.',
      given: ['Một khẩu phần: 30% DV của Y.', 'Hai khẩu phần bằng nhau.', 'Chưa có thông tin nhu cầu cá nhân hoặc các nguồn khác.'],
      steps: ['Xác nhận phần trăm đang tính theo một khẩu phần.', 'Hai khẩu phần: 2 × 30% = 60% DV của Y.', 'Giữ nguyên mẫu số là giá trị tham chiếu của nhãn.', 'Không cộng %DV của Y với %DV của chất khác để tạo “phần trăm dinh dưỡng tổng”.'],
      answer: 'Hai khẩu phần đóng góp 60% DV của Y theo chuẩn nhãn, không phải chắc chắn 60% nhu cầu của người dùng.',
      limitation: 'Phần trăm nhãn không xác định lượng nên dùng; cần đúng hệ tham chiếu và bối cảnh trước diễn giải.',
    },
    {
      id: 'ch04-water-example', title: 'Tổng biết được và tổng chưa biết', objectiveIds: ['ch04-water'],
      prompt: 'Một nhật ký giả định liệt kê các đồ uống. Tính thể tích đã ghi, không đặt mục tiêu uống.',
      given: ['Nước lọc 800 ml, trà 250 ml, một đồ uống khác 200 ml.', 'Chưa ước tính nước trong thức ăn.', 'Không có thông tin về nhu cầu hoặc giới hạn dịch.'],
      steps: ['Cộng thể tích đồ uống: 800 + 250 + 200 = 1.250 ml.', 'Đổi đơn vị: 1.250 ml = 1,25 lít.', 'Đặt tên kết quả là tổng thể tích đồ uống được ghi.', 'Giữ nước từ thức ăn và phần bị quên ở trạng thái chưa biết.'],
      answer: 'Đã ghi 1.250 ml = 1,25 lít đồ uống; chưa biết tổng nước cả ngày và chưa thể kết luận đủ hay thiếu.',
      limitation: 'Thể tích đồ uống là cách ghi thực hành, không phải phép đo chính xác nước hấp thu hoặc chỉ định bù dịch.',
    },
  ],
  cases: [
    { id: 'ch04-case-fatigue', title: 'Mệt nên mua sắt?', context: 'Lan thấy mệt và đọc quảng cáo viên sắt giúp lấy lại năng lượng.', question: 'Có đủ dữ kiện để kết luận Lan thiếu sắt không?', reasoning: ['Mệt là điều được báo, nguyên nhân chưa xác định.', 'Vai trò của sắt không chứng minh tình trạng của Lan.', 'Quyết định xét nghiệm hoặc điều trị cần đánh giá phù hợp, không dựa quảng cáo.'], safeNextStep: 'Trao đổi nhân viên y tế nếu triệu chứng kéo dài hoặc đáng lo; không tự dùng sắt liều cao để kiểm chứng.', commonError: 'Đi từ một triệu chứng không đặc hiệu đến chẩn đoán thiếu vi chất.' },
    { id: 'ch04-case-stack', title: 'Ba sản phẩm, một thành phần', context: 'Nam dùng viên đa chất, đồ uống tăng cường và một sản phẩm riêng nhưng chỉ đọc từng nhãn độc lập.', question: 'Bảng kiểm kê cần bổ sung gì?', reasoning: ['Liệt kê các nguồn dùng thực tế và lượng mỗi nguồn.', 'Đối chiếu tên, dạng chất, đơn vị và số khẩu phần.', 'Đánh dấu chỗ trùng hoặc chưa rõ để trao đổi chuyên môn, chưa tự kê thay đổi.'], safeNextStep: 'Chuẩn bị danh sách cho bác sĩ hoặc dược sĩ, giữ thuốc được kê và không thêm sản phẩm chỉ vì mỗi nhãn trông thấp.', commonError: 'Cho rằng từng sản phẩm riêng lẻ không cao nghĩa là dùng chung luôn an toàn.' },
    { id: 'ch04-case-fluid', title: 'Quy tắc uống nước và giới hạn dịch', context: 'Một người có giới hạn dịch từ đội ngũ điều trị nghe bạn khuyên ai cũng phải uống thêm hai lít nước lọc.', question: 'Quy tắc nào nên được ưu tiên?', reasoning: ['Lời khuyên chung không thay kế hoạch cá nhân.', 'Nguồn dịch không chỉ nước lọc.', 'Cần hỏi cách tính nguồn dịch trong chính kế hoạch điều trị.'], safeNextStep: 'Giữ giới hạn đã được hướng dẫn và hỏi đội ngũ chăm sóc trước mọi điều chỉnh.', commonError: 'Coi nước luôn có lợi theo lượng tăng không giới hạn và bỏ qua bối cảnh bệnh.' },
  ],
  practice: {
    title: 'Bảng kiểm kê vi chất và nước: biết gì, còn thiếu gì', artifact: 'Bảng nhãn giả định kèm phép đổi đơn vị và câu hỏi chuyên môn; không phải danh sách sản phẩm nên mua.',
    steps: ['Dùng hai nguồn X và nhật ký đồ uống của ví dụ, hoặc nhãn giả định tương đương.', 'Ghi lượng mỗi khẩu phần, số khẩu phần, đơn vị và dạng chất.', 'Tính phần có đủ dữ liệu; phân biệt lượng ghi, giá trị tham chiếu và nhu cầu cá nhân.', 'Viết phần chưa biết, giới hạn của phép tính và hướng hỏi an toàn.'],
    fields: [
      { id: 'context', label: 'Nguồn đang kiểm kê', prompt: 'Liệt kê nguồn giả định, lượng mỗi khẩu phần và lượng đang xét; không cần nêu thuốc hay bệnh thật.', required: true },
      { id: 'hypothesis', label: 'Ý nghĩa con số', prompt: 'Giải thích một vai trò vi chất và vì sao RDA, UL hoặc %DV không được dùng thay cho nhau.', required: true },
      { id: 'action', label: 'Phép đổi và tổng', prompt: 'Trình bày mg/µg cùng các bước cộng; nếu khác dạng hoặc thiếu thông tin, ghi rõ chưa thể cộng.', required: true },
      { id: 'minimum', label: 'Khi nhãn không đầy đủ', prompt: 'Nếu chỉ có ảnh nhãn thiếu một phần, sẽ giữ dữ liệu nào và hỏi thêm gì thay vì đoán?', required: true },
      { id: 'data', label: 'Nước và thông tin thiếu', prompt: 'Ghi thể tích đồ uống biết được, phân biệt nước từ thức ăn chưa biết; nêu cách và ngày rà lại bảng.', required: true },
      { id: 'stop', label: 'Ranh giới sử dụng', prompt: 'Nêu vì sao chưa kết luận thiếu chất hoặc đặt liều; xử lý thế nào nếu có thuốc hoặc giới hạn dịch?', required: true },
    ],
    modelResponse: ['X giả định cùng dạng: A 0,4 mg, B 250 µg; đổi A thành 400 µg rồi cộng được 650 µg. Không có ngưỡng nhu cầu của X trong đề.', 'UL không phải đích bổ sung. Nếu thiếu dạng chất hoặc đơn vị, giữ nguyên dữ liệu và hỏi thêm thay vì đổi tùy ý.', 'Đồ uống đã ghi là 1.250 ml, chưa có nước từ thức ăn. Rà lại nhãn vào buổi học tới; không kê liều hay sửa giới hạn dịch, chỉ lập câu hỏi cho chuyên môn khi cần.'],
    rubric: [
      { id: 'data', label: 'Nhãn và đơn vị', levels: ['Cộng khác đơn vị hoặc bỏ qua khẩu phần.', 'Đổi đúng nhưng thiếu một nguồn hoặc phần chưa biết.', 'Giữ đơn vị, dạng, khẩu phần và nguồn; tính được phần đủ dữ kiện.'] },
      { id: 'mechanism', label: 'Vai trò và tham chiếu', levels: ['Đồng nhất vai trò với nhu cầu bổ sung hoặc UL với mục tiêu.', 'Phân biệt được một số thuật ngữ nhưng chưa nêu giới hạn.', 'Phân biệt chức năng, lượng ghi, tham chiếu và nhu cầu cá nhân.'] },
      { id: 'feasibility', label: 'Kiểm kê dùng được', levels: ['Bảng không thể đối chiếu với dữ liệu gốc.', 'Có bảng nhưng chưa nêu cách xử lý nhãn thiếu.', 'Bảng kiểm tra được, có câu hỏi bổ sung và lịch rà lại.'] },
      { id: 'safety', label: 'Không tự kê', levels: ['Tự đặt liều, dừng thuốc hoặc sửa giới hạn dịch.', 'Nhắc hỏi chuyên môn nhưng còn kết luận thiếu chất không đủ căn cứ.', 'Không chẩn đoán hoặc kê liều; chỉ rõ điểm cần bác sĩ/dược sĩ và giữ hướng dẫn chăm sóc.'] },
    ],
  },
  coachExtension: ['Đánh giá khả năng đọc nguồn và đặt câu hỏi, không yêu cầu học viên mua sản phẩm để hoàn thành bài.', 'Không dùng tổng số học đúng như bằng chứng hấp thu hoặc an toàn.', 'Nếu người học đưa hồ sơ thật, chỉ giữ thông tin cần thiết có đồng ý; ưu tiên ca giả định trong giáo dục nhóm.'],
  safety: ['Không tự bổ sung liều cao hoặc chẩn đoán thiếu chất từ triệu chứng.', 'Không tự đổi thuốc hoặc bỏ qua khả năng tương tác của sản phẩm bổ sung.', 'Không dùng quy tắc uống nước chung để sửa kế hoạch giới hạn dịch; bài tập không thay tư vấn cá nhân.'],
  referenceIds: ['nih-vitamin-d', 'nih-iron', 'nih-supplements-consumer', 'nih-dri', 'fda-nutrition-label', 'nhs-hydration', 'niddk-ckd-nutrition'],
}
