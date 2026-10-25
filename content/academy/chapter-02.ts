import type { AcademyLearningUnit } from './learning-unit'

export const chapter02Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 2, revision: '2026-10-24.1',
  title: 'Cơ thể sử dụng năng lượng: hiểu dòng năng lượng trước khi tính nhu cầu',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành học nền tảng năng lượng; coach luyện diễn giải mô hình và giới hạn đo lường.',
  scope: 'Giải thích ATP, các thành phần tiêu hao và kiểm tra bảng tính giả định. Chưa tính mục tiêu giảm cân cá nhân, không dùng calorie để thưởng phạt việc ăn.',
  prerequisites: [1],
  objectives: [
    { id: 'ch02-flow', outcome: 'Phân biệt năng lượng, đơn vị kcal/kJ và vai trò ATP trong tế bào.', evidence: 'Giải thích vì sao calorie không phải một dưỡng chất và quy đổi một giá trị có đơn vị.' },
    { id: 'ch02-components', outcome: 'Phân biệt năng lượng nghỉ, xử lý thức ăn và hoạt động; nhận ra khoản bị cộng trùng.', evidence: 'Sửa một bảng tổng đã chứa phần năng lượng vận động.' },
    { id: 'ch02-estimates', outcome: 'Phân biệt số đo, số dự đoán, độ lặp lại và độ đúng.', evidence: 'Nêu một giới hạn của công thức hoặc đồng hồ mà không suy rằng dữ liệu hoàn toàn vô ích.' },
    { id: 'ch02-log', outcome: 'Lập bản đồ sinh hoạt không biến nó thành toa năng lượng.', evidence: 'Ghi được các khoảng hoạt động không chồng nhau, phần thiếu và câu hỏi cần làm rõ.' },
  ],
  sections: [
    {
      id: 'ch02-energy-flow', title: 'Năng lượng không phải tên của một chất', objectiveIds: ['ch02-flow'],
      paragraphs: [
        'kcal và kJ là đơn vị năng lượng; 1 kcal = 4,184 kJ. Chúng không cho biết thực phẩm có những dưỡng chất nào. Hai món có cùng năng lượng vẫn có thể khác thành phần và cách dùng. Trước khi so sánh, cần cùng đơn vị và cùng lượng thực phẩm đang xét.',
        'Trong tế bào, các phản ứng phân giải chất và xây dựng chất được liên kết với quá trình chuyển năng lượng. ATP tham gia cung cấp năng lượng khả dụng cho nhiều hoạt động như co cơ và vận chuyển qua màng; ATP được tái tạo từ ADP và phosphate nhờ các quá trình chuyển hóa. Đây là mô tả cơ chế, không phải lời khuyên mua sản phẩm mang tên ATP.',
        'Có thể hình dung bài học bằng ba câu hỏi: nguồn nào đóng góp năng lượng, quá trình nào chuyển hóa nó và hoạt động nào đang cần nó? Không đồng nhất ATP với calorie trên nhãn, cũng không coi một phản ứng sinh hóa được mô tả đúng là bằng chứng một sản phẩm làm cơ thể khỏe hơn.',
      ],
      takeaways: ['Đơn vị năng lượng không thay thông tin về chất lượng bữa ăn.', 'Một cơ chế hợp lý chưa đủ chứng minh hiệu quả của can thiệp.'], sourceIds: ['fao-energy-principles', 'openstax-metabolism'],
    },
    {
      id: 'ch02-parts', title: 'Tiêu hao cả ngày gồm những phần nào?', objectiveIds: ['ch02-components'],
      paragraphs: [
        'Ngay khi không tập, cơ thể vẫn cần năng lượng duy trì hoạt động sống. BMR mô tả tiêu hao nền trong điều kiện đo chuẩn; REE là tiêu hao lúc nghỉ và không nên coi hai thuật ngữ hoàn toàn đồng nhất. Xử lý thức ăn cũng cần năng lượng, thường gọi là hiệu ứng nhiệt của thức ăn. Hoạt động gồm buổi tập và chuyển động ngoài buổi tập.',
        'Trong một bảng mô hình, phải biết con số tổng đã bao gồm gì. Nếu tổng cả ngày đã tính buổi đạp xe, cộng thêm số đạp xe lần nữa là đếm trùng. Tương tự, không cộng một ước tính cho cả ngày với một tổng khác cũng mô tả chính ngày đó. Tên chỉ số và phạm vi thời gian quan trọng hơn độ dài của bảng tính.',
        'BMR hoặc REE là khái niệm tiêu hao, không tự là mức ăn nên đặt cho người học. Ở chương này, hãy dừng ở khả năng giải thích thành phần và phát hiện chồng lặp. Phần dự đoán nhu cầu ở chương 8 sẽ tiếp tục với giả định đầu vào và giới hạn áp dụng.',
      ],
      takeaways: ['Không chỉ lúc tập mới dùng năng lượng.', 'Ghi rõ “tổng” hay “một phần” trước khi cộng.'], sourceIds: ['fao-energy-principles', 'mifflin-1990'],
    },
    {
      id: 'ch02-measurement', title: 'Số nhiều chữ số chưa chắc đúng hơn', objectiveIds: ['ch02-estimates'],
      paragraphs: [
        'Một công thức cho kết quả chính xác về số học nhưng vẫn là dự đoán sinh học. Dữ liệu nhóm không xóa khác biệt giữa các cá nhân; nhu cầu cũng không bắt buộc giống nhau từng ngày. Vì vậy kết quả cần đi cùng cách tạo ra nó và điều kiện áp dụng, không chỉ có một số kcal đứng riêng.',
        'Nghiên cứu kiểm định của Shcherbina và cộng sự năm 2017 so sánh bảy thiết bị đeo trong các hoạt động ở phòng thí nghiệm: độ chính xác nhịp tim và ước lượng tiêu hao năng lượng không giống nhau. Bài học rút ra là phải kiểm định đúng chỉ số. Nghiên cứu cũ này không cho phép gán một tỷ lệ sai số cho mọi đồng hồ hiện nay.',
        'Nếu một thiết bị luôn báo 350 kcal ở cùng một bài tập, điều đó có thể cho thấy số hiển thị lặp lại, chưa chứng minh tiêu hao thật là 350. Bạn có thể dùng dữ liệu để đặt câu hỏi về xu hướng, nhưng không nên tự động ăn bù chính xác từng calorie hoặc tăng tập để xóa một bữa ăn.',
      ],
      takeaways: ['Độ lặp lại và độ đúng là hai câu hỏi khác nhau.', 'Không chuyển sai số của một nghiên cứu sang mọi thiết bị.'], sourceIds: ['fao-energy-principles', 'shcherbina-wearables-2017', 'niddk-body-weight-planner'],
    },
    {
      id: 'ch02-day-map', title: 'Bản đồ một ngày: hiểu hoàn cảnh trước con số', objectiveIds: ['ch02-log'],
      paragraphs: [
        'Vẽ các khoảng giờ của một ngày giả định: ngủ, di chuyển, làm việc, việc nhà, nghỉ và buổi tập. Mỗi khoảng chỉ xuất hiện một lần. Chỗ chưa biết ghi chưa rõ; không tự điền thành ngồi yên hoặc hoạt động mạnh. Bản đồ này luyện mô tả chứ chưa cần gán calorie cho từng phút.',
        'So sánh hai ngày bằng câu hỏi về điều kiện: ngày nào di chuyển khác, có bỏ sót một khoảng hay ghi trùng buổi tập không? Nếu thử một cách ghi đơn giản hơn, tiêu chí thành công là dữ liệu dễ hiểu và ít thiếu hơn, không phải bắt cơ thể tiêu hao nhiều hơn mỗi ngày.',
        'Trẻ em, người mang thai hoặc cho con bú và người có tình trạng cần chăm sóc riêng không được mặc định phù hợp công cụ cho người lớn khỏe mạnh. Bài tập hoàn toàn có thể làm trên dữ liệu giả định. Khi mệt hoặc có triệu chứng đáng lo, ưu tiên đánh giá phù hợp thay vì tự kết luận chuyển hóa hỏng hay cắt ăn thêm.',
      ],
      takeaways: ['Bản đồ hoạt động không phải toa ăn hoặc toa tập.', 'Đánh dấu thông tin thiếu và phạm vi đối tượng của công cụ.'], sourceIds: ['niddk-habits', 'niddk-body-weight-planner'],
    },
  ],
  workedExamples: [
    {
      id: 'ch02-units-example', title: 'Hai đơn vị của cùng một lượng', objectiveIds: ['ch02-flow'],
      prompt: 'Nhãn giả định ghi 500 kcal cho phần đang xét. Quy đổi sang kJ và giải thích điều phép đổi không cho biết.',
      given: ['500 kcal cho cùng một phần.', 'Dùng 1 kcal = 4,184 kJ.', 'Không có thông tin thành phần khác.'],
      steps: ['Giữ nguyên khẩu phần đang xét.', 'Nhân 500 kcal × 4,184 kJ/kcal = 2.092 kJ.', 'Kiểm tra chiều đổi: từ kcal sang kJ phải nhân hệ số.', 'Không cộng 500 với 2.092 vì đây là hai cách biểu diễn cùng lượng năng lượng.'],
      answer: '500 kcal = 2.092 kJ; không phải hai khoản năng lượng khác nhau.',
      limitation: 'Không suy ra protein, vitamin, mức hấp thu hoặc lượng nên ăn chỉ từ phép đổi đơn vị.',
    },
    {
      id: 'ch02-double-count-example', title: 'Phát hiện cộng trùng buổi tập', objectiveIds: ['ch02-components'],
      prompt: 'Một mô hình giả định đã chia tiêu hao một ngày thành bốn phần không chồng nhau. Người học cộng thêm buổi tập lần nữa.',
      given: ['Nghỉ: 1.400 kcal; xử lý thức ăn: 180 kcal.', 'Hoạt động ngoài tập: 320 kcal; buổi tập: 250 kcal.', 'Các số chỉ để kiểm tra phép cộng, không là tỷ lệ sinh lý cố định.'],
      steps: ['Cộng các phần: 1.400 + 180 + 320 + 250 = 2.150 kcal.', 'Xác nhận 250 kcal buổi tập đã nằm trong tổng.', 'Nếu cộng thêm lần nữa sẽ ra 2.400 kcal và đếm buổi tập hai lần.', 'Ghi tên từng thành phần và cách xây mô hình thay vì chỉ lưu con số cuối.'],
      answer: 'Tổng của dữ liệu giả định là 2.150 kcal, không phải 2.400 kcal.',
      limitation: 'Không dùng các số giả định làm mục tiêu ăn; mô hình đúng phép cộng vẫn có thể sai đầu vào.',
    },
    {
      id: 'ch02-average-example', title: 'Trung bình không có nghĩa ngày nào cũng giống nhau', objectiveIds: ['ch02-estimates', 'ch02-log'],
      prompt: 'Ba kết quả mô hình giả định là 2.100, 2.250 và 2.400 kcal/ngày. Tính trung bình và phạm vi kết luận.',
      given: ['Mỗi số mô tả một ngày khác nhau, cùng phương pháp.', 'Chưa có phép đo độc lập để kiểm tra mô hình.', 'Ba ngày được chọn để luyện toán, không là thời lượng đánh giá nhu cầu.'],
      steps: ['Tổng = 2.100 + 2.250 + 2.400 = 6.750 kcal cho ba ngày.', 'Trung bình = 6.750 / 3 = 2.250 kcal/ngày.', 'Giữ các số từng ngày để thấy biến thiên, không thay toàn bộ bằng số trung bình.', 'Nêu rõ kết quả là trung bình của mô hình, không phải nhu cầu cá nhân được xác nhận.'],
      answer: 'Trung bình ba giá trị là 2.250 kcal/ngày; không có nghĩa phải ăn đúng 2.250 kcal mỗi ngày.',
      limitation: 'Không suy tốc độ giảm cân, độ chính xác của đồng hồ hoặc nhu cầu dài hạn từ ba số giả định.',
    },
  ],
  cases: [
    { id: 'ch02-case-watch', title: 'Đồng hồ báo 400 kcal', context: 'Hà muốn ăn bù đúng 400 kcal sau buổi tập vì tin nhịp tim trên đồng hồ khá ổn.', question: 'Điều gì còn thiếu trước khi coi 400 là tiêu hao thật?', reasoning: ['Nhịp tim và năng lượng là hai chỉ số khác nhau.', 'Cần biết con số là tổng hay phần hoạt động và được ước lượng thế nào.', 'Không mặc định độ chính xác từ số chữ số hoặc cảm giác mệt.'], safeNextStep: 'Ghi rõ nguồn và giới hạn; không dùng số này để thưởng phạt bữa ăn hoặc tự đổi kế hoạch chăm sóc.', commonError: 'Cho rằng đo một chỉ số tốt nghĩa là mọi chỉ số suy ra đều chính xác.' },
    { id: 'ch02-case-rest', title: 'Ngày không đến phòng tập', context: 'Minh nghĩ hôm nay không tập nên cơ thể gần như không dùng năng lượng.', question: 'Bản đồ tiêu hao đang thiếu những gì?', reasoning: ['Hoạt động sống vẫn cần năng lượng lúc nghỉ.', 'Xử lý thức ăn và chuyển động hằng ngày không biến mất.', 'Bản đồ ngày cần gồm toàn bộ các khoảng giờ, không chỉ lịch tập.'], safeNextStep: 'Hoàn thiện mô tả ngày; không tự bỏ bữa chỉ vì không có buổi tập.', commonError: 'Đồng nhất toàn bộ tiêu hao với calorie của buổi tập.' },
    { id: 'ch02-case-scope', title: 'Công cụ không đúng đối tượng', context: 'Một người đang mang thai muốn dùng công cụ năng lượng dành cho người lớn không mang thai để đặt mức ăn.', question: 'Có nên tự hiệu chỉnh bằng cách cộng một con số tìm trên mạng?', reasoning: ['Đối tượng nằm ngoài phạm vi của công cụ được chọn.', 'Một phép cộng tùy ý không xác nhận mô hình phù hợp.', 'Bài học có thể hoàn thành bằng dữ liệu giả định, không cần tự áp dụng.'], safeNextStep: 'Trao đổi đội ngũ chăm sóc về nhu cầu cá nhân; dùng ca giả định phù hợp cho bài tính.', commonError: 'Coi công thức phổ thông là toa cho mọi giai đoạn sống.' },
  ],
  practice: {
    title: 'Bản đồ năng lượng không đếm trùng', artifact: 'Một sơ đồ ngày giả định, một phép kiểm tra đơn vị và danh sách giới hạn; không phải mức ăn đề xuất.',
    steps: ['Chọn ngày giả định và chia các khoảng giờ không chồng nhau.', 'Gắn khái niệm nghỉ, xử lý thức ăn, hoạt động ngoài tập và buổi tập.', 'Dùng dữ liệu ví dụ để kiểm tra một phép cộng hoặc quy đổi; không tự kê calorie.', 'Nêu điều chưa biết, cách rà lại dữ liệu và phạm vi không áp dụng.'],
    fields: [
      { id: 'context', label: 'Ngày đang mô tả', prompt: 'Nêu nhân vật giả định, các khoảng giờ và điều kiện; đánh dấu khoảng chưa có dữ liệu.', required: true },
      { id: 'hypothesis', label: 'Dòng năng lượng', prompt: 'Giải thích ATP khác đơn vị calorie thế nào; phân biệt các thành phần tiêu hao trong sơ đồ.', required: true },
      { id: 'action', label: 'Phép kiểm tra', prompt: 'Viết một phép quy đổi hoặc cộng từ ví dụ với đơn vị, chỉ rõ tổng đã bao gồm những phần nào.', required: true },
      { id: 'minimum', label: 'Bản đồ tối thiểu', prompt: 'Khi thiếu thiết bị hoặc dữ liệu, bạn vẫn mô tả được những gì mà không đoán ra calorie?', required: true },
      { id: 'data', label: 'Giới hạn và rà lại', prompt: 'Nêu nguồn con số, phần đo hay dự đoán, chỗ có thể trùng; đặt ngày kiểm tra lại cách ghi.', required: true },
      { id: 'stop', label: 'Không suy thành toa', prompt: 'Nêu điều không thể kết luận, nhóm ngoài phạm vi công cụ và khi nào cần hỏi người phụ trách chăm sóc.', required: true },
    ],
    modelResponse: ['Ngày giả định gồm ngủ, làm việc, di chuyển, việc nhà, nghỉ và tập; khoảng 17–18 giờ chưa rõ nên không tự gán năng lượng.', 'ATP tham gia chuyển năng lượng ở tế bào; kcal là đơn vị. Dữ liệu ví dụ cộng 1.400 + 180 + 320 + 250 = 2.150 kcal, đã có buổi tập.', 'Không có đồng hồ vẫn mô tả thời gian và hoạt động. Rà lại sơ đồ cuối tuần; không dùng tổng giả định làm mức ăn, không áp dụng công cụ ngoài đối tượng.'],
    rubric: [
      { id: 'data', label: 'Đơn vị và phạm vi', levels: ['Trộn kcal/kJ hoặc cộng trùng các phần.', 'Đơn vị đúng nhưng chưa ghi phạm vi hoặc dữ liệu thiếu.', 'Có đơn vị, khoảng thời gian, nguồn và dấu thông tin thiếu; không cộng trùng.'] },
      { id: 'mechanism', label: 'Hiểu tiêu hao', levels: ['Coi calorie là chất hoặc chỉ tập mới tiêu hao.', 'Nêu các phần nhưng chưa phân biệt tổng với thành phần.', 'Phân biệt ATP, đơn vị, thành phần tiêu hao và giới hạn dự đoán.'] },
      { id: 'feasibility', label: 'Cách ghi thực tế', levels: ['Yêu cầu dữ liệu không thể có hoặc quá chi tiết.', 'Có cách ghi nhưng thiếu phương án tối thiểu.', 'Có bản đồ không chồng lặp, cách ghi đơn giản và mốc rà lại.'] },
      { id: 'safety', label: 'Không kê từ mô hình', levels: ['Dùng số giả định để cắt ăn, bù ăn hoặc áp dụng ngoài đối tượng.', 'Nhắc giới hạn nhưng chưa chỉ rõ quyết định cần tránh.', 'Không kê calorie; nhận diện đối tượng không phù hợp và hướng hỏi chuyên môn.'] },
    ],
  },
  coachExtension: ['Yêu cầu học viên nói rõ “số này là tổng hay một phần?” trước khi kiểm tra phép toán.', 'Không dạy một tỷ lệ phần trăm tiêu hao cố định như quy luật cho mọi người.', 'Tách độ đúng của thiết bị, độ lặp lại và tính hữu ích cho một mục tiêu; không xếp hạng thiết bị mới từ nghiên cứu cũ.'],
  safety: ['Không dùng BMR/REE hoặc số giả định làm mức ăn cá nhân.', 'Không yêu cầu tập bù hay nhịn ăn để khớp con số trên thiết bị.', 'Giữ phạm vi đối tượng của công cụ; triệu chứng thật cần đánh giá phù hợp, không chẩn đoán chuyển hóa từ bài tính.'],
  referenceIds: ['fao-energy-principles', 'openstax-metabolism', 'mifflin-1990', 'shcherbina-wearables-2017', 'niddk-body-weight-planner', 'niddk-habits'],
}
