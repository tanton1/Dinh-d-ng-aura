import type { AcademyLearningUnit } from './learning-unit'

export const chapter11Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 11, revision: '2026-10-24.1',
  title: 'Ăn trước, trong và sau tập: chọn chiến lược theo buổi tập',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành khỏe mạnh tập luyện giải trí; coach học lập kế hoạch có bối cảnh, không sao chép chiến lược thi đấu.',
  scope: 'Thiết kế timeline, đọc nhãn và tính dịch mất trên dữ liệu giả định. Không kê thuốc, liều caffeine, định mức uống hoặc chiến lược ép cân; bệnh lý và thi đấu cần hướng dẫn riêng.',
  prerequisites: [3, 5, 6, 9, 10],
  objectives: [
    { id: 'ch11-context', outcome: 'Phân tích buổi tập và ba khoảng thời gian trước khi chọn món hoặc sản phẩm.', evidence: 'Lập timeline có bữa trước, giờ vận động, bữa sau và thời gian tới buổi kế tiếp.' },
    { id: 'ch11-fuel', outcome: 'Phân biệt nhiên liệu, khả năng dung nạp và sự tiện dụng của lựa chọn quanh tập.', evidence: 'Giải thích một lựa chọn có điều kiện, tính đúng carbohydrate từ nhãn giả định.' },
    { id: 'ch11-fluid', outcome: 'Ước tính dịch mất với đúng đầu vào và không biến kết quả thành lượng uống bắt buộc.', evidence: 'Tính L/giờ, ghi giả định và nhận ra nguy cơ uống quá mức hoặc bỏ qua triệu chứng.' },
    { id: 'ch11-recovery', outcome: 'Nối bữa sau tập với tổng ngày, lần tập kế tiếp và yêu cầu chăm sóc.', evidence: 'Viết phương án sau buổi và dự phòng, không chạy đua với một thời hạn vài phút.' },
  ],
  sections: [
    {
      id: 'ch11-session-map', title: 'Đọc buổi tập trước khi đọc quảng cáo', objectiveIds: ['ch11-context'],
      paragraphs: [
        'Hai buổi cùng dài một giờ có thể khác nhau về cường độ, khoảng nghỉ, nhiệt độ và mục tiêu. Ghi loại vận động, thời lượng dự kiến, môi trường và khả năng ăn uống. Không dùng riêng tên “gym” để suy ra một nhu cầu nhiên liệu hoặc dịch giống nhau.',
        'Vẽ ba khoảng thời gian: bữa gần nhất đến lúc tập, lần ăn dự tính đến lúc vận động, và kết thúc tập đến lần ăn tiếp theo. Ghi thêm lúc tập lại. Đây là khung lập kế hoạch của Aura; nó giúp tìm khoảng trống hậu cần, không phải công thức chẩn đoán thiếu năng lượng.',
        'Tổng ăn uống trong ngày là nền, còn thời điểm là một lớp điều chỉnh theo hoàn cảnh. Trong bản kế hoạch, mỗi lựa chọn phải có lý do: hỗ trợ buổi dài, tránh đói sát giờ, dễ mang theo hoặc tạo cơ hội ăn sau tập. Nếu không nêu được lý do, chưa cần thêm một sản phẩm.',
      ],
      takeaways: ['Giữ cả thông tin buổi tập lẫn lịch sống.', 'Một lịch ăn của vận động viên thi đấu không tự phù hợp người tập giải trí.'], sourceIds: ['issn-timing-2017', 'niddk-habits'],
    },
    {
      id: 'ch11-fuel-tolerance', title: 'Nhiên liệu phải dùng được, không chỉ đúng trên giấy', objectiveIds: ['ch11-fuel'],
      paragraphs: [
        'Carbohydrate hỗ trợ cung cấp nhiên liệu cho vận động; protein tham gia sửa chữa và thích nghi. Lượng cần tổ chức quanh buổi phụ thuộc tổng ngày và tải. Buổi dài, gắng sức có thể cần chiến lược carbohydrate trong buổi; không suy mọi buổi ngắn đều cần gel hay đồ uống thể thao.',
        'Khi còn ít thời gian, hãy xét lượng món và trải nghiệm tiêu hóa trước đó thay vì ép ăn một bữa lớn. Chất béo, chất xơ, lượng thức ăn và tốc độ ăn đều là thông tin cần ghi khi có khó chịu; không vì một buổi mà cấm cả nhóm thực phẩm. Nếu thử lựa chọn quen thuộc, chọn buổi thông thường, không phải lần thi đấu quan trọng.',
        'Đọc carbohydrate theo lượng thật dùng, phân biệt nhãn đồ uống thể thao với sản phẩm có chất kích thích. Caffeine có thể ảnh hưởng giấc ngủ hoặc gây tác dụng bất lợi; uống thêm không là cách sửa thiếu bữa hay thiếu ngủ. Bài này không yêu cầu dùng caffeine hoặc mua sản phẩm bổ sung.',
      ],
      takeaways: ['Chọn món theo thời gian, tải và dung nạp, không theo một nhãn tốt/xấu.', 'Đếm đúng lượng dùng; biết thành phần không đồng nghĩa đã xác định nhu cầu.'], sourceIds: ['issn-timing-2017', 'nih-sport-supplements', 'fda-nutrition-label'],
    },
    {
      id: 'ch11-hydration', title: 'Ước tính mồ hôi để hiểu bối cảnh, không ép uống', objectiveIds: ['ch11-fluid'],
      paragraphs: [
        'Một cách ước tính dịch mồ hôi là chênh cân trước–sau cộng lượng uống, trừ nước tiểu trong buổi, rồi chia thời gian. Cách quy kg sang lít dùng xấp xỉ 1 kg nước là 1 lít; phải thống nhất điều kiện cân, xử lý quần áo ướt và biết đầu vào nào còn thiếu.',
        'Kết quả chỉ mô tả buổi trong điều kiện đã ghi, còn chịu các mất mát khác và sai số. Nó không đo nồng độ sodium trong mồ hôi. Đừng lấy một lần đo làm lượng phải uống mỗi giờ ở mọi thời tiết, hoặc tự suy số gram muối cần bổ sung. Khóa học dùng dữ liệu giả định, không yêu cầu cố mất nước để đo.',
        'Thiếu dịch và uống quá nhiều đều có rủi ro. Có đường tiếp cận nước và kế hoạch phù hợp, nhưng không ép uống tới tăng cân dịch trong buổi. Nếu có đau đầu, nôn, lú lẫn hoặc dấu hiệu đáng lo, dừng và tìm trợ giúp phù hợp; không đoán nguyên nhân rồi tự chữa bằng nhiều nước hoặc muối.',
      ],
      takeaways: ['L/giờ ước tính không là toa uống và không cho biết sodium mất.', 'Triệu chứng cần được đánh giá, không giải thích bằng một công thức.'], sourceIds: ['nata-fluid-2017'],
    },
    {
      id: 'ch11-after-session', title: 'Sau tập: nối được bữa tiếp theo với lịch phục hồi', objectiveIds: ['ch11-recovery'],
      paragraphs: [
        'Sau vận động, bữa ăn giúp cung cấp chất cho sửa chữa, nạp lại nhiên liệu và bù dịch. Nếu sắp tập lại sớm sau buổi tốn nhiều glycogen, việc tổ chức ăn sớm đáng chú ý hơn khi còn cả ngày tới buổi kế tiếp. Không biến khác biệt đó thành yêu cầu mọi người phải uống shake ngay trong vài phút.',
        'Bản kế hoạch ghi bữa tiếp theo ở đâu, lúc nào, có nguồn protein và carbohydrate phù hợp ra sao. Một bữa thông thường có thể thực hiện vai trò này; sản phẩm tiện dụng chỉ là một lựa chọn. Nếu bữa bị trễ vì di chuyển, chuẩn bị phương án dự phòng có điều kiện bảo quản, dị ứng và khả năng dùng phù hợp.',
        'Với thuốc hạ glucose, hạn chế dịch hoặc yêu cầu chăm sóc khác, giữ kế hoạch riêng và hỏi người phụ trách trước thay đổi liên quan. Phản hồi sau một buổi ghi cảm giác, tiêu hóa và khả năng thực hiện, không dùng một lần tập tốt để kết luận đã tìm được chế độ tối ưu lâu dài.',
      ],
      takeaways: ['Khoảng hồi phục và tổng ngày quyết định mức ưu tiên, không phải một phút vàng chung.', 'Kế hoạch dinh dưỡng không được vượt hướng dẫn điều trị đang có.'], sourceIds: ['issn-timing-2017', 'food-safety-four-steps', 'niddk-hypoglycemia', 'niddk-ckd-nutrition'],
    },
  ],
  workedExamples: [
    {
      id: 'ch11-timeline-example', title: 'Tìm khoảng trống trong một chiều đi làm', objectiveIds: ['ch11-context', 'ch11-recovery'],
      prompt: 'Nhân vật giả định ăn trưa lúc 12:00, tập 18:00–19:00 và có bữa tối lúc 20:00; buổi sau là chiều hôm sau.',
      given: ['Từ trưa tới lúc tập chưa có thông tin về bữa khác.', 'Có chỗ cất đồ ăn an toàn ở nơi làm.', 'Chưa có dữ liệu lượng ăn, cảm giác đói hoặc dung nạp.'],
      steps: ['Từ 12:00 đến 18:00 là 6 giờ; kết thúc tập tới tối là 1 giờ.', 'Hỏi bữa trưa, cảm giác sẵn sàng và có cần tổ chức lựa chọn trước tập không.', 'Nếu chọn bữa phụ lúc 16:30 thì còn 1 giờ 30 phút tới tập; xét món và lượng đã dung nạp.', 'Ghi bữa tối cùng phương án khi tan làm trễ; không kết luận khoảng sáu giờ tự là bệnh hoặc bắt buộc mua shake.'],
      answer: 'Timeline có khoảng 6 giờ trước tập và 1 giờ sau tập; cần làm rõ điều kiện trước khi chọn bữa phụ.',
      limitation: 'Khoảng thời gian không cho biết tổng năng lượng, nhu cầu hoặc khả năng tiêu hóa của người thật.',
    },
    {
      id: 'ch11-label-example', title: 'Đọc một chai theo hai mẫu số', objectiveIds: ['ch11-fuel'],
      prompt: 'Đồ uống giả định ghi carbohydrate 6 g/100 ml và sodium 120 mg/250 ml. Tính lượng trong 500 ml, không quyết định ai cần uống.',
      given: ['Lượng định xét: 500 ml.', 'Carbohydrate và sodium dùng mẫu số khác nhau.', 'Không có thông tin về nhu cầu, caffeine hoặc thành phần khác.'],
      steps: ['Carbohydrate = 6 × 500 / 100 = 30 g.', 'Sodium = 120 × 500 / 250 = 240 mg.', 'Đây là sodium trên nhãn, không tự đổi thành cùng khối lượng muối ăn.', 'Giữ riêng phép tính hàm lượng và quyết định có cần dùng trong buổi cụ thể.'],
      answer: '500 ml chứa 30 g carbohydrate và 240 mg sodium theo nhãn giả định.',
      limitation: 'Chưa xác định lượng uống phù hợp, nồng độ mồ hôi hoặc mức an toàn cá nhân từ một nhãn.',
    },
    {
      id: 'ch11-sweat-example', title: 'Chênh cân không phải toàn bộ lượng mồ hôi', objectiveIds: ['ch11-fluid'],
      prompt: 'Dữ liệu mô phỏng một giờ tập: cân khô trước 70,0 kg, sau 69,4 kg; uống 0,4 lít, không đi tiểu.',
      given: ['Điều kiện cân được giả định tương thích.', 'Không ăn trong buổi; các mất mát khác được bỏ qua trong bài toán.', 'Không phải yêu cầu người học tự gây mất nước hoặc cân cơ thể.'],
      steps: ['Chênh cân = 70,0 − 69,4 = 0,6 kg.', 'Ước tính dịch mất = 0,6 + 0,4 − 0 = 1,0 lít.', 'Tốc độ ước tính = 1,0 / 1 = 1,0 lít/giờ.', 'Không đặt lượng bắt buộc uống là 1 lít/giờ hoặc suy lượng sodium từ kết quả.'],
      answer: 'Ước tính 1,0 lít trong một giờ theo giả định; không phải chỉ 0,6 lít từ chênh cân.',
      limitation: 'Điều kiện, đầu vào và sai số quyết định cách đọc; phép tính không là chỉ định bù dịch hoặc điều trị.',
    },
  ],
  cases: [
    { id: 'ch11-case-rush', title: 'Bữa lớn ngay trước tập', context: 'An ăn vội một bữa lớn sát giờ và khó chịu, rồi muốn bỏ mọi bữa trước tập.', question: 'Có lựa chọn nào giữa ép ăn và nhịn mặc định?', reasoning: ['Một lần khó chịu chưa chỉ ra một thành phần duy nhất.', 'Có thể rà thời điểm, lượng, tốc độ ăn và món quen.', 'Triệu chứng lặp lại hoặc đáng lo cần hỏi chuyên môn.'], safeNextStep: 'Viết một phương án hậu cần vừa sức cho buổi thường và giới hạn thử; không tự loại nhiều nhóm thực phẩm.', commonError: 'Từ một trải nghiệm suy ra phải nhịn hoặc cấm một chất cho mọi buổi.' },
    { id: 'ch11-case-fluid', title: 'Uống theo bạn rồi thấy khó chịu', context: 'Một người cố uống theo định mức của bạn, tăng cân trong buổi và có đau đầu, buồn nôn.', question: 'Có nên tự uống thêm nước hoặc muối để sửa không?', reasoning: ['Các triệu chứng có nhiều nguyên nhân.', 'Uống quá mức cũng có thể nguy hiểm.', 'Không dùng cân hoặc bài toán để tự xử trí triệu chứng.'], safeNextStep: 'Dừng tập, tìm đánh giá y tế kịp thời; nếu lú lẫn, ngất hoặc diễn biến nặng, gọi trợ giúp khẩn cấp.', commonError: 'Mặc định mọi khó chịu khi tập là thiếu nước và tiếp tục ép uống.' },
    { id: 'ch11-case-shake', title: 'Quên shake sau tập', context: 'Bình có bữa tối phù hợp sau tập nhưng nghĩ quên shake làm cả buổi vô ích.', question: 'Cần đọc lại vai trò nào của bữa sau?', reasoning: ['Sản phẩm không đồng nghĩa nhu cầu.', 'Bữa thật có thể cung cấp các chất cần tổ chức.', 'Còn phải xem tổng ngày và khi nào tập lại.'], safeNextStep: 'Kiểm tra bữa tối cùng lịch phục hồi, không mua bù hoặc tập thêm để sửa một nghi thức bị thiếu.', commonError: 'Đánh giá buổi tập chỉ bằng việc có uống một sản phẩm đúng phút hay không.' },
  ],
  practice: {
    title: 'Timeline quanh buổi tập và phương án dự phòng', artifact: 'Một kế hoạch cho buổi giả định, có phép tính nhãn hoặc dịch và giới hạn sử dụng.',
    steps: ['Mô tả buổi, môi trường và ba khoảng thời gian cùng lần tập kế tiếp.', 'Giải thích lựa chọn trước/trong/sau, không bắt buộc thêm sản phẩm.', 'Tính một ví dụ với đúng đơn vị và ghi phần chưa biết.', 'Chuẩn bị phương án khi lịch đổi, cách quan sát dung nạp và điều kiện tìm hỗ trợ.'],
    fields: [
      { id: 'context', label: 'Buổi và timeline', prompt: 'Ghi loại buổi, giờ bắt đầu/kết thúc, bữa trước/sau, môi trường và lần tập kế tiếp của ca giả định.', required: true },
      { id: 'hypothesis', label: 'Lý do chọn chiến lược', prompt: 'Vì sao lựa chọn này hợp tải, thời gian và tiêu hóa? Thông tin nào còn thiếu để quyết định?', required: true },
      { id: 'action', label: 'Trước, trong và sau', prompt: 'Mô tả cách tổ chức ăn uống cho từng thời điểm, phân biệt bữa ăn với sản phẩm tiện dụng.', required: true },
      { id: 'minimum', label: 'Khi trễ lịch', prompt: 'Nếu bữa hoặc giờ tập bị đổi, lựa chọn quen thuộc nào vẫn dùng được và bảo quản an toàn?', required: true },
      { id: 'data', label: 'Tính và kiểm tra', prompt: 'Tính từ nhãn hoặc dịch mất bằng số giả định, ghi đơn vị, giới hạn và ngày rà tính khả thi.', required: true },
      { id: 'stop', label: 'Giới hạn an toàn', prompt: 'Nêu khi nào dừng, hỏi hỗ trợ, giữ hướng dẫn thuốc/dịch riêng và không ép uống hoặc dùng chất kích thích.', required: true },
    ],
    modelResponse: ['Ca tập chiều có khoảng sáu giờ sau bữa trưa; cần hỏi tổng ăn và dung nạp trước khi thêm bữa. Bữa tối có thể thực hiện vai trò sau tập.', 'Nhãn giả định 500 ml cho 30 g carbohydrate và 240 mg sodium, chưa chứng minh cần uống lượng đó. Phép tính mồ hôi không đo sodium.', 'Dự phòng cho lịch trễ bằng món quen giữ an toàn. Không tự đổi thuốc hoặc ép uống; triệu chứng đáng lo ưu tiên hỗ trợ, không đợi ngày rà bài.'],
    rubric: [
      { id: 'data', label: 'Timeline và đơn vị', levels: ['Nhầm thời gian, mẫu số nhãn hoặc bỏ lượng uống trong tính dịch.', 'Tính đúng nhưng thiếu đầu vào hoặc giới hạn.', 'Timeline, phép tính và đơn vị rõ; phần chưa biết không bị tự điền.'] },
      { id: 'mechanism', label: 'Chiến lược có lý do', levels: ['Chọn theo nghi thức sản phẩm hoặc một phút vàng.', 'Nêu mục tiêu nhưng chưa gắn tải và tổng ngày.', 'Giải thích nhiên liệu, dung nạp và hồi phục theo buổi cụ thể.'] },
      { id: 'feasibility', label: 'Dùng được khi lịch đổi', levels: ['Kế hoạch không có nơi ăn/uống hoặc dự phòng.', 'Có lựa chọn nhưng thiếu hậu cần cần thiết.', 'Có timeline, lựa chọn quen, bảo quản và phương án khi lịch đổi.'] },
      { id: 'safety', label: 'Không biến phép tính thành toa', levels: ['Ép uống, tự đổi thuốc hoặc che triệu chứng bằng chất kích thích.', 'Có cảnh báo nhưng chưa nêu bước hỗ trợ.', 'Giữ hướng dẫn riêng, không tự trị triệu chứng; phân biệt ước tính với lượng phải dùng.'] },
    ],
  },
  coachExtension: ['Hỏi lý do cần thêm độ chính xác trước khi giao bảng gram/giờ.', 'Không suy lượng sodium từ chênh cân và không dùng nhãn đồ uống để xác nhận nhu cầu.', 'Chấm khả năng giải thích và thích ứng lịch, không bắt học viên mua thiết bị hoặc sản phẩm.'],
  safety: ['Không tự đổi thuốc hoặc hướng dẫn dịch đã có.', 'Không ép uống hoặc cố mất nước để làm phép đo; số ước tính không là định mức.', 'Triệu chứng đáng lo cần hỗ trợ phù hợp, không tự chữa bằng nước, muối hoặc caffeine.', 'Không cần dùng dữ liệu cơ thể thật để hoàn thành bài học.'],
  referenceIds: ['issn-timing-2017', 'nih-sport-supplements', 'nata-fluid-2017', 'fda-nutrition-label', 'niddk-habits', 'food-safety-four-steps', 'niddk-hypoglycemia', 'niddk-ckd-nutrition'],
}
