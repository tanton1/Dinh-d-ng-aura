import type { AcademyLearningUnit } from './learning-unit'

export const chapter14Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 14, revision: '2026-10-24.1',
  title: 'Dinh dưỡng tăng cơ, tăng cân: đủ nguồn lực, không chạy theo cân nhanh',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành khỏe mạnh tìm hiểu tập kháng lực và tổ chức ăn uống; coach luyện đọc đáp ứng có giới hạn.',
  scope: 'Giải thích thích nghi cơ, protein và phương án bữa bằng số giả định; không kê lượng dư hoặc hứa số kilogram cơ. Sụt cân không chủ ý, bệnh lý và khó ăn kéo dài cần đánh giá riêng.',
  prerequisites: [3, 7, 8, 9, 10, 11, 12],
  objectives: [
    { id: 'ch14-adaptation', outcome: 'Phân biệt kích thích tập, nguồn lực và các thành phần có thể làm cân tăng.', evidence: 'Giải thích vì sao tăng cân hoặc tăng mức tạ chưa xác nhận riêng lượng cơ tăng.' },
    { id: 'ch14-protein', outcome: 'Đọc khoảng protein theo phạm vi đối tượng và tổ chức tổng ngày.', evidence: 'Quy đổi g/kg/ngày đúng đơn vị, không coi khoảng tham chiếu là toa hay giới hạn hấp thu.' },
    { id: 'ch14-feasibility', outcome: 'Dùng mật độ năng lượng và hậu cần để giải quyết trở ngại ăn uống có điều kiện.', evidence: 'So hai phương án cùng năng lượng, nêu phần khác về lượng dùng, thành phần và khả năng dung nạp.' },
    { id: 'ch14-review', outcome: 'Chọn chỉ số và bước rà để không tăng lượng ăn theo một điểm cân.', evidence: 'Đọc cả khả năng tập, trải nghiệm và giới hạn đo; nhận ra khi cần hỗ trợ thay vì cố ăn thêm.' },
  ],
  sections: [
    {
      id: 'ch14-stimulus-resources', title: 'Tín hiệu tập và nguồn lực không đổi một-một thành cơ', objectiveIds: ['ch14-adaptation'],
      paragraphs: [
        'Tập kháng lực tạo kích thích thích nghi, còn dinh dưỡng và nghỉ ngơi cung cấp điều kiện hỗ trợ. Cơ thể vẫn liên tục tổng hợp và phân giải protein. Một bữa hoặc một buổi không cho biết lượng cơ ròng đã tăng; kế hoạch cần nhìn quá trình đủ dài và cách đo phù hợp.',
        'Tăng cân có thể gồm mỡ, nước, glycogen, lượng chứa trong cơ thể và mô khác. Không lấy kilogram trên cân làm kilogram cơ, cũng không dùng một lần nâng được tạ lớn hơn để suy toàn bộ tăng trưởng mô. Học kỹ thuật, sự quen bài và điều kiện kiểm tra cũng làm việc so hiệu suất cần thận trọng.',
        'Nghiên cứu Helms năm 2023 có 17 người hoàn thành tám tuần tập: tăng cân nhanh liên quan rõ hơn với tăng nếp gấp da, không bảo đảm cơ tăng tương ứng. Mẫu nhỏ và thời gian ngắn không xác định lượng dư tối ưu cho mọi người. Vì thế không dùng logic “ăn dư gấp đôi thì cơ tăng gấp đôi”.',
      ],
      takeaways: ['Cân, sức mạnh và mô cơ là ba đầu ra khác nhau.', 'Chưa có phép quy đổi chính xác calorie dư thành kilogram cơ cá nhân.'], sourceIds: ['nih-sport-supplements', 'helms-surplus-2023', 'frija-masson-scales-2021'],
    },
    {
      id: 'ch14-protein-context', title: 'Tổng protein có phạm vi, phân bố theo lịch dùng được', objectiveIds: ['ch14-protein'],
      paragraphs: [
        'Đồng thuận ISSN năm 2017 đưa khoảng tổng protein 1,4–2,0 g/kg/ngày cho phần lớn người khỏe mạnh có tập luyện. Đây là tham chiếu theo đối tượng, không là mục tiêu bắt buộc cho ai cùng cân nặng. Cần xét tổng ăn, mục tiêu, nguồn thực phẩm và các yêu cầu chăm sóc; người có bệnh thận không tự áp khoảng này.',
        'Tổng ngày cần được nối với các bữa thực sự có thể ăn. Phân bố giúp tránh đặt toàn bộ nhiệm vụ vào một bữa khó dùng, nhưng không cần chia bằng nhau tuyệt đối hoặc hiểu một mức gram/bữa là giới hạn hấp thu. Nguồn ăn phải phù hợp sở thích, dị ứng và các chất khác trong bữa; protein không thay mọi nhiệm vụ dinh dưỡng.',
        'Phân tích gộp Morton năm 2018 xem việc bổ sung protein cùng tập kháng lực ở người trưởng thành khỏe mạnh. Kết quả trung bình không chứng minh ai cũng cần mua bột protein hoặc tăng thêm bất kể đang ăn bao nhiêu. Điểm gãy hồi quy của một nghiên cứu không là trần sinh học hay đơn thuốc cá nhân.',
      ],
      takeaways: ['Đọc cả đối tượng và đơn vị trước khi dùng khoảng tham chiếu.', 'Thêm sản phẩm chỉ có ý nghĩa khi giải quyết một nhu cầu thật, không vì tên gọi tăng cơ.'], sourceIds: ['issn-protein-2017', 'morton-protein-2018', 'niddk-ckd-nutrition', 'nhs-food-allergy'],
    },
    {
      id: 'ch14-meal-density', title: 'Khó ăn: sửa phương án, không chỉ yêu cầu cố hơn', objectiveIds: ['ch14-feasibility'],
      paragraphs: [
        'Mật độ năng lượng là năng lượng trên một khối lượng thực phẩm. Hai lượng khác nhau có thể cho cùng năng lượng, nhưng chưa chắc cùng protein, vi chất, thể tích hoặc mức dễ chịu. Dùng phép tính để so phương án, rồi hỏi liệu món đó có hợp khẩu vị, lịch và khả năng sử dụng không.',
        'Một cách tổ chức có thể là bữa nhỏ hơn hoặc thêm thành phần phù hợp vào bữa đang có, thay vì ép một phần ăn rất lớn. Ghi lựa chọn cụ thể, thành phần cần xác minh và cách bảo quản. Không lấy “đậm năng lượng” đồng nghĩa đủ dưỡng chất hoặc bỏ qua dị ứng vì món được gọi là lành mạnh.',
        'Nhanh no, chán ăn, khó nuốt, đau tiêu hóa hoặc sụt cân không chủ ý kéo dài cần đánh giá, không chỉ tăng thêm món. Với ca khỏe mạnh chưa có dấu hiệu đáng lo, lựa chọn hậu cần có thể thử ở mức vừa sức và rà dung nạp. Bài không yêu cầu vượt cảm giác khó chịu để đạt một chỉ tiêu.',
      ],
      takeaways: ['Khớp năng lượng không có nghĩa hai phương án tương đương mọi mặt.', 'Khó ăn kéo dài là thông tin cần hỏi, không là thiếu ý chí.'], sourceIds: ['fda-nutrition-label', 'who-healthy-diet-2026', 'nhs-food-allergy', 'nhs-unintentional-loss'],
    },
    {
      id: 'ch14-review-response', title: 'Theo dõi để hiểu đáp ứng, không để đuổi số', objectiveIds: ['ch14-review'],
      paragraphs: [
        'Chọn một câu hỏi trước chỉ số: bữa có dùng được không, lịch tập có thực hiện được không, hoặc dữ liệu cân có so được không. Không bắt buộc ảnh cơ thể hay cân BIA. Nếu dùng số đo, giữ điều kiện và ghi thay phương pháp; cân gia đình không xác nhận chính xác cơ đã tăng bao nhiêu.',
        'Một thay đổi cân ngắn hạn sau đổi bữa hoặc lịch tập chưa cho phép tăng lượng ăn tiếp. Xem chất lượng dữ liệu, thời gian, thực hiện và trải nghiệm. Có thể giữ, làm rõ, sửa bữa khó dùng hoặc tìm hỗ trợ; không tự tăng dư chỉ vì một ngày chưa nhích hoặc tự khen mọi tăng cân nhanh.',
        'Ghi quyết định cùng lý do, điều chưa biết và mốc rà; sự an toàn luôn đi trước ngày hẹn. Khi có triệu chứng hoặc quan hệ với ăn uống xấu đi, ưu tiên hỗ trợ và giữ bài học bằng ca giả định. Tăng cơ không phải điều kiện để chứng minh học tốt hoặc giá trị bản thân.',
      ],
      takeaways: ['Đầu ra tập luyện hỗ trợ diễn giải, không thay phép đo mô.', 'Bước tiếp theo có thể là giữ hoặc làm rõ, không nhất thiết ăn thêm.'], sourceIds: ['frija-masson-scales-2021', 'helms-surplus-2023', 'niddk-habits', 'nhs-unintentional-loss', 'nhs-eating-disorders'],
    },
  ],
  workedExamples: [
    {
      id: 'ch14-protein-example', title: 'Quy đổi một khoảng tham chiếu, chưa chọn mục tiêu', objectiveIds: ['ch14-protein'],
      prompt: 'Nhân vật khỏe mạnh giả định 70 kg có tập luyện. Chỉ luyện quy đổi khoảng 1,4–2,0 g/kg/ngày được nêu trong bài.',
      given: ['Khối lượng giả định: 70 kg.', 'Khoảng dùng từ đồng thuận ISSN 2017, không là chỉ định cá nhân.', 'Chưa có dữ liệu tổng ăn, bệnh lý hoặc nhu cầu cụ thể.'],
      steps: ['Đầu dưới: 70 × 1,4 = 98 g/ngày.', 'Đầu trên: 70 × 2,0 = 140 g/ngày.', 'Ghi đây là gram protein, không phải gram thịt, bột hoặc một thực phẩm.', 'Trước áp dụng cần xác nhận đối tượng và bối cảnh; không tự lấy 140 làm mức phải đạt hoặc vượt.'],
      answer: 'Khoảng quy đổi là 98–140 g protein/ngày trong bài toán, chưa phải mục tiêu của một người thật.',
      limitation: 'Không áp dụng nguyên khoảng cho bệnh thận hoặc hoàn cảnh cần chỉ định riêng; không chứng minh phải dùng supplement.',
    },
    {
      id: 'ch14-density-example', title: 'Cùng năng lượng với khối lượng khác nhau', objectiveIds: ['ch14-feasibility'],
      prompt: 'A giả định 90 kcal/100 g và B 180 kcal/100 g, cùng trạng thái ăn được. So 300 g A với lượng B cho cùng năng lượng.',
      given: ['A: 300 g.', 'B: chưa đặt lượng; chỉ có dữ liệu năng lượng.', 'Tên A/B không đại diện nhãn hàng hay mức ăn nên dùng.'],
      steps: ['Năng lượng A = 90 × 300 / 100 = 270 kcal.', 'Lượng B = 270 / 180 × 100 = 150 g.', 'Khối lượng B bằng một nửa A nhưng chưa biết thể tích, dưỡng chất khác hoặc dung nạp.', 'Kiểm tra thành phần, sở thích và điều kiện dùng trước chọn phương án.'],
      answer: '300 g A và 150 g B đều cho 270 kcal theo dữ liệu giả định; chỉ khớp năng lượng.',
      limitation: 'Không suy hai món tương đương dinh dưỡng hoặc B tốt hơn cho mọi người nhanh no.',
    },
    {
      id: 'ch14-two-outcomes-example', title: 'Tạ tăng 20%, cơ không được suy tăng 20%', objectiveIds: ['ch14-adaptation', 'ch14-review'],
      prompt: 'Ca giả định có cùng bài kiểm tra, số lần và kỹ thuật được ghi: mức tạ từ 20 lên 24 kg, cân từ 60 lên 60,6 kg.',
      given: ['Mức tạ là đầu ra hiệu suất, không là khối cơ.', 'Cân là tổng khối lượng cơ thể.', 'Chưa có phương pháp đo mô hoặc thông tin độ đúng.'],
      steps: ['Mức tạ tăng (24 − 20) / 20 × 100 = 20%.', 'Cân tăng (60,6 − 60) / 60 × 100 = 1%.', 'Giữ hai mẫu số và tên chỉ số riêng, không gán 20% cho cơ.', 'Đọc thêm điều kiện kiểm tra, thực hiện và trải nghiệm; chưa suy 0,6 kg tăng đều là cơ.'],
      answer: 'Hiệu suất theo bài kiểm tra tăng 20%, cân tổng tăng 1%; chưa xác định phần cơ tăng.',
      limitation: 'Tiến bộ kỹ thuật và điều kiện kiểm tra có thể ảnh hưởng; không dùng hai số để xác nhận tăng trưởng mô.',
    },
  ],
  cases: [
    { id: 'ch14-case-fast-gain', title: 'Tăng nhanh rồi muốn ăn thêm nữa', context: 'Một người tăng cân ngay sau đổi bữa và nghĩ điều đó chứng minh cơ đang lên rất nhanh.', question: 'Bằng chứng nào đang còn thiếu?', reasoning: ['Cân chưa tách nước, mỡ và mô cơ.', 'Thời gian ngắn và thay đổi điều kiện làm diễn giải khó hơn.', 'Kết quả nghiên cứu không tạo công thức dư calorie thành cơ cho cá nhân.'], safeNextStep: 'Rà bối cảnh, dữ liệu và trải nghiệm trước điều chỉnh; không tăng lượng ăn chỉ để đuổi một tốc độ.', commonError: 'Gọi toàn bộ phần tăng ngắn hạn là cơ rồi nhân lượng dư theo tốc độ mong muốn.' },
    { id: 'ch14-case-kidney', title: 'Cùng cân nặng, khác yêu cầu chăm sóc', context: 'Người có bệnh thận muốn lấy ngay kết quả protein của nhân vật 70 kg trong bài.', question: 'Phép nhân đúng có đủ để áp dụng không?', reasoning: ['Đối tượng của khoảng tham chiếu khác hoàn cảnh điều trị.', 'Cần hướng dẫn dinh dưỡng riêng và thông tin bệnh.', 'Coach không sửa chỉ định bằng một công thức học tập.'], safeNextStep: 'Giữ hướng dẫn hiện có và hỏi người phụ trách; dùng ca giả định để hoàn thành phép tính.', commonError: 'Coi cân nặng giống nhau đồng nghĩa mọi nhu cầu và giới hạn đều giống nhau.' },
    { id: 'ch14-case-appetite', title: 'Chán ăn và sụt cân không chủ ý', context: 'Nhân vật ăn khó hơn kéo dài, đang sụt cân và được khuyên cứ thêm mass gainer.', question: 'Vì sao cần bước khác trước chọn sản phẩm?', reasoning: ['Đây không chỉ là câu hỏi mật độ năng lượng.', 'Triệu chứng và sụt cân không chủ ý cần đánh giá.', 'Không nên để lời khuyên cố ăn che vấn đề chưa rõ.'], safeNextStep: 'Tìm đánh giá y tế phù hợp sớm; nếu có biểu hiện cấp nặng thì ưu tiên trợ giúp khẩn cấp.', commonError: 'Coi mọi khó tăng cân là thiếu quyết tâm hoặc thiếu một loại bột.' },
  ],
  practice: {
    title: 'Bản đồ nguồn lực cho mục tiêu tăng cơ', artifact: 'Một phân tích ca giả định, có phép tính protein hoặc mật độ, phương án bữa và cách rà đáp ứng.',
    steps: ['Tách mục tiêu cơ, cân và khả năng tập; ghi kích thích tập và hoàn cảnh.', 'Quy đổi tham chiếu protein đúng phạm vi hoặc so hai món bằng dữ liệu giả định.', 'Thiết kế phương án cho một trở ngại ăn uống, giữ dị ứng và giới hạn chăm sóc.', 'Chọn dữ kiện cần rà cùng điều chưa thể kết luận, ngày xem lại và điều kiện tìm hỗ trợ.'],
    fields: [
      { id: 'context', label: 'Mục tiêu và điều kiện', prompt: 'Mô tả ca giả định, mục tiêu tự nguyện, kinh nghiệm tập và trở ngại bữa ăn; không đòi ảnh cơ thể.', required: true },
      { id: 'hypothesis', label: 'Kích thích và nguồn lực', prompt: 'Giải thích điều tập luyện, protein và năng lượng có thể hỗ trợ; vì sao cân hoặc tạ không đo riêng cơ?', required: true },
      { id: 'action', label: 'Phương án bữa', prompt: 'Nêu cách tổ chức nguồn protein, các thành phần khác và phương án giải quyết trở ngại cụ thể.', required: true },
      { id: 'minimum', label: 'Khi khó ăn hoặc bận', prompt: 'So lựa chọn nhỏ gọn hay thuận tiện hơn, giữ điều kiện nào và khi nào không nên chỉ cố ăn thêm?', required: true },
      { id: 'data', label: 'Tính và rà đáp ứng', prompt: 'Viết phép quy đổi đúng đơn vị, chỉ số sẽ xem, giới hạn diễn giải và ngày rà tính khả thi.', required: true },
      { id: 'stop', label: 'Khi cần đánh giá riêng', prompt: 'Nêu ranh giới bệnh thận, sụt cân không chủ ý, khó ăn kéo dài hoặc theo dõi gây hại; không tự kê mức dư.', required: true },
    ],
    modelResponse: ['Ca tập kháng lực cần nguồn lực và lịch dùng được, nhưng cân tăng không xác nhận cơ. Khoảng protein quy đổi cho 70 kg là 98–140 g/ngày chỉ trong bài toán.', '300 g A và 150 g B giả định đều cho 270 kcal; cần kiểm tra dưỡng chất khác, dị ứng và dung nạp trước chọn.', 'Mức tạ tăng 20% và cân tăng 1% là hai chỉ số riêng. Rà điều kiện và trải nghiệm; khó ăn kéo dài hoặc sụt cân không chủ ý cần hỗ trợ, không tăng sản phẩm mặc định.'],
    rubric: [
      { id: 'data', label: 'Đúng lượng và mẫu số', levels: ['Nhầm gram protein với gram món hoặc gán phần trăm tạ cho cơ.', 'Tính đúng nhưng thiếu phạm vi đối tượng hoặc giới hạn.', 'Đúng đơn vị, mẫu số và tên chỉ số; không suy lượng cơ chưa đo.'] },
      { id: 'mechanism', label: 'Nguồn lực không là bảo đảm', levels: ['Coi dư càng nhiều càng tăng cơ tương ứng.', 'Nêu tập và ăn nhưng còn đồng nhất cân với mô.', 'Giải thích kích thích, nguồn lực và giới hạn dự đoán tăng trưởng mô.'] },
      { id: 'feasibility', label: 'Bữa hợp điều kiện', levels: ['Chỉ yêu cầu cố ăn hoặc mua sản phẩm.', 'Có lựa chọn nhưng chưa xét trở ngại và thành phần.', 'Có phương án cụ thể, phép so có phạm vi và mốc rà dung nạp.'] },
      { id: 'safety', label: 'Không ép tăng bằng mọi giá', levels: ['Áp khoảng cho bệnh lý hoặc bỏ qua triệu chứng và sụt cân không chủ ý.', 'Có nhắc hỏi chuyên môn nhưng chưa chỉ rõ khi nào.', 'Giữ hướng dẫn riêng, nhận ra khi cần đánh giá và không buộc đổi hình thể để đạt bài.'] },
    ],
  },
  coachExtension: ['Nêu giới hạn mẫu, thời gian và phép đo trước diễn giải nghiên cứu mức dư.', 'Không dùng điểm gãy của phân tích gộp để bảo đảm protein tối ưu cho một người.', 'Đánh giá khả năng chọn và giải thích bữa; không yêu cầu cân tăng để được nhận xét tốt.'],
  safety: ['Không tự kê lượng dư hoặc ép ăn qua triệu chứng để đạt tốc độ.', 'Khoảng protein cho người khỏe mạnh không thay chỉ định ở bệnh thận hay hoàn cảnh chăm sóc riêng.', 'Khó ăn kéo dài hoặc sụt cân không chủ ý cần đánh giá phù hợp, không chờ đủ thử nghiệm.', 'Không bắt buộc cân, BIA hoặc ảnh cơ thể; có thể hoàn thành bằng ca giả định.'],
  referenceIds: ['nih-sport-supplements', 'helms-surplus-2023', 'frija-masson-scales-2021', 'issn-protein-2017', 'morton-protein-2018', 'niddk-ckd-nutrition', 'nhs-food-allergy', 'fda-nutrition-label', 'who-healthy-diet-2026', 'nhs-unintentional-loss', 'niddk-habits', 'nhs-eating-disorders'],
}
