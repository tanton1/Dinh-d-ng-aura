import type { AcademyLearningUnit } from './learning-unit'

export const chapter03Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 3, revision: '2026-10-24.1',
  title: 'Protein, carbohydrate và chất béo: từ chất dinh dưỡng đến bữa ăn',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên trưởng thành học kiến thức nền; PT dùng phần mở rộng để luyện giải thích, không kê dinh dưỡng điều trị.',
  scope: 'Đọc và quy đổi thông tin, xây phương án bữa ăn từ dữ liệu giả định. Chưa đặt mục tiêu gram hoặc calorie cá nhân.',
  prerequisites: [1, 2],
  objectives: [
    { id: 'ch03-functions', outcome: 'Giải thích vai trò khác nhau của ba nhóm chất mà không chia thực phẩm thành tốt và xấu tuyệt đối.', evidence: 'Phân tích một bữa ăn hỗn hợp và nêu ít nhất hai chức năng ngoài cung cấp calorie.' },
    { id: 'ch03-units', outcome: 'Phân biệt gram thực phẩm, gram dưỡng chất, khẩu phần và trạng thái sống/chín.', evidence: 'Quy đổi đúng hai nhãn về cùng đơn vị và chỉ ra dữ liệu nào còn thiếu.' },
    { id: 'ch03-energy', outcome: 'Dùng 4–4–9 như phép tính năng lượng gần đúng, không coi là phép đo cơ thể.', evidence: 'Trình bày phép tính có đơn vị và một giới hạn của phép tính.' },
    { id: 'ch03-meal', outcome: 'Đề xuất thay món theo chức năng và nguồn lực, đồng thời giữ điều kiện an toàn.', evidence: 'Lập hai phiên bản bữa ăn với lý do và các điểm không tương đương.' },
  ],
  sections: [
    {
      id: 'ch03-role', title: 'Ba nhóm chất là ba vai trò, không phải ba phe đối lập', objectiveIds: ['ch03-functions'],
      paragraphs: [
        'Một bữa cơm có đậu, cá, rau và dầu ăn không nằm gọn trong một cột. Thực phẩm thường là hỗn hợp của nước, nhiều dưỡng chất và những thành phần khác. Tên nhóm thực phẩm chỉ là cách học để nhận diện đóng góp nổi bật, không phải bản mô tả hóa học đầy đủ.',
        'Protein cung cấp các acid amin để cơ thể tạo và duy trì nhiều cấu trúc, enzyme và thành phần chức năng; không chỉ dành cho người muốn tăng cơ. Carbohydrate là một nguồn năng lượng, nhưng đường, tinh bột và chất xơ không nên bị gộp thành một khái niệm duy nhất. Chất béo cũng có vai trò sinh học ngoài năng lượng; vì thế “càng ít càng tốt” không phải nguyên tắc đủ để xây bữa ăn.',
        'Trong thực hành, hãy hỏi: bữa này đóng góp những nhóm chất nào, đến từ thực phẩm nào, lượng thực ăn là bao nhiêu và còn nhóm thực phẩm nào chưa được xem xét? Không suy từ một chỉ số macro sang kết luận bữa ăn hoàn hảo: độ đa dạng, vi chất, an toàn thực phẩm, khẩu vị và khả năng duy trì vẫn cần được cân nhắc.',
      ],
      takeaways: ['Nhãn “giàu protein” không có nghĩa thực phẩm chỉ chứa protein.', 'Đếm macro là một góc nhìn, không thay thế chất lượng và bối cảnh của cả chế độ ăn.'],
      sourceIds: ['who-healthy-diet-2026'],
    },
    {
      id: 'ch03-read-units', title: 'Đọc đúng mẫu số trước khi tính', objectiveIds: ['ch03-units'],
      paragraphs: [
        'Bắt đầu bằng dòng đơn vị: thông tin đang tính cho 100 g, một hộp hay một khẩu phần? Sau đó ghi lượng bạn thực sự dùng. Nếu một hộp gồm hai khẩu phần nhưng bạn dùng cả hộp, lấy dữ liệu của một khẩu phần sẽ làm sai phép so sánh ngay từ đầu. Khẩu phần ghi trên nhãn mô tả đơn vị của nhãn, không tự động là lượng bạn nên ăn.',
        'Tiếp theo kiểm tra trạng thái. Không ghép khối lượng thực phẩm đã nấu với dữ liệu cho thực phẩm khô hoặc sống rồi cho rằng phần mềm sẽ tự hiểu. Nước có thể làm thay đổi khối lượng của món trong khi cách ghi dữ liệu vẫn phải nhất quán. Với món hỗn hợp, cần biết dữ liệu áp dụng cho cả công thức hay một phần đã chia.',
        'Không có nhãn hoặc công thức rõ không đồng nghĩa phải đoán một con số chính xác. Có thể ghi “chưa xác định”, chọn một nguồn dữ liệu phù hợp và nêu sai số. Mục tiêu của chương là học đọc thông tin, không ép mọi bữa ăn trở thành một phép tính đến từng gram.',
      ],
      takeaways: ['Luôn ghi mẫu số và lượng thực dùng bên cạnh con số dưỡng chất.', '100 g thực phẩm không đồng nghĩa 100 g protein, carbohydrate hoặc chất béo.'],
      sourceIds: ['fda-nutrition-label'],
    },
    {
      id: 'ch03-estimate', title: 'Phép tính năng lượng kiểm tra được, nhưng không tuyệt đối', objectiveIds: ['ch03-energy'],
      paragraphs: [
        'Trong bài tập cơ bản, năng lượng gần đúng từ protein, carbohydrate và chất béo được tính lần lượt với hệ số 4, 4 và 9 kcal/g. Viết cả đơn vị giúp tránh lỗi cộng gram với calorie. Đây là phép tính từ dữ liệu đầu vào, không phải phép đo năng lượng bạn hấp thu hay tiêu hao.',
        'Tổng tính từ ba dòng macro có thể không trùng tuyệt đối với calorie trên nhãn. Làm tròn, cách tính chất xơ và các thành phần khác có thể cần được xem xét trước khi kết luận nhãn sai. Không dùng sự chênh nhỏ làm lý do loại bỏ một thực phẩm; hãy kiểm tra đơn vị và phạm vi tính trước.',
      ],
      takeaways: ['Giữ dữ liệu gốc và các bước tính để người khác kiểm tra được.', 'Kết quả gần đúng không biến thành mục tiêu ăn cá nhân chỉ vì máy tính hiển thị nhiều chữ số.'],
      sourceIds: ['ecfr-energy-factors'],
    },
    {
      id: 'ch03-substitute', title: 'Thay món theo chức năng và điều kiện thật', objectiveIds: ['ch03-meal'],
      paragraphs: [
        'Một phương án thay món cần nói rõ thứ đang muốn giữ: tiện mang đi, đóng góp protein, nguồn tinh bột, chất xơ, khẩu vị hay ngân sách. Hai món cùng một nhóm không nhất thiết tương đương từng gram dưỡng chất. Vì vậy, hãy mô tả mức tương đương và điều còn khác thay vì gọi là thay thế một-một trong mọi hoàn cảnh.',
        'Lấy bữa trưa giả định gồm cơm, đậu phụ, cá, rau và một phần chất béo dùng khi chế biến. Nếu không có cá, trước hết xem lựa chọn sẵn có và dữ liệu của lựa chọn đó; đừng mặc định tăng một lượng bất kỳ đậu phụ sẽ khớp mọi dưỡng chất. Nếu có dị ứng hoặc hướng dẫn điều trị, điều kiện đó được xét trước bài toán macro.',
        'Bài làm tốt có thể kết luận chưa đủ thông tin để thay món định lượng. Biết nêu câu hỏi còn thiếu thường hữu ích hơn một thực đơn rất chi tiết nhưng dựa trên giả định không được kiểm tra.',
      ],
      takeaways: ['Chọn chức năng muốn giữ trước khi chọn món thay.', 'Không coi macro tương tự là bảo đảm phù hợp dị ứng hoặc bệnh lý.'],
      sourceIds: ['who-healthy-diet-2026', 'niddk-ckd-nutrition'],
    },
  ],
  workedExamples: [
    {
      id: 'ch03-label-example', title: 'Một hộp hay một khẩu phần?', objectiveIds: ['ch03-units'],
      prompt: 'So sánh protein của hai đồ uống theo đúng lượng định dùng. Tất cả số liệu sau là dữ liệu giả định để học, không đại diện nhãn hàng.',
      given: ['A: một hộp 250 ml, có 8 g protein trong mỗi 100 ml.', 'B: một hộp 200 ml, ghi 12 g protein cho cả hộp.', 'Người học dự định dùng nửa hộp A hoặc một hộp B.'],
      steps: ['Nửa hộp A là 125 ml.', 'Protein từ 125 ml A = 8 × 125 / 100 = 10 g.', 'Một hộp B tương ứng đúng đơn vị ghi trên nhãn: 12 g.', 'Với lượng đã nêu, B đóng góp nhiều hơn 2 g protein; chưa đủ dữ liệu để chọn sản phẩm phù hợp tổng thể.'],
      answer: '10 g so với 12 g, không phải 8 g so với 12 g và cũng không phải 20 g so với 12 g.',
      limitation: 'Chưa xét giá, thành phần, dị ứng, các dưỡng chất khác hoặc mục tiêu cá nhân; không kết luận B luôn tốt hơn.',
    },
    {
      id: 'ch03-energy-example', title: 'Kiểm tra 4–4–9', objectiveIds: ['ch03-energy'],
      prompt: 'Một khẩu phần giả định có các lượng macro dưới đây. Tính năng lượng gần đúng từ ba nhóm chất.',
      given: ['Protein: 30 g.', 'Carbohydrate: 50 g.', 'Chất béo: 20 g.'],
      steps: ['Protein: 30 × 4 = 120 kcal.', 'Carbohydrate: 50 × 4 = 200 kcal.', 'Chất béo: 20 × 9 = 180 kcal.', 'Tổng: 120 + 200 + 180 = 500 kcal.'],
      answer: '500 kcal theo giả định của bài. Tổng khối lượng ba nhóm chất là 100 g, không phải 100 kcal.',
      limitation: 'Không dùng con số này làm mức ăn đề xuất hoặc kết luận chính xác về hấp thu năng lượng.',
    },
    {
      id: 'ch03-cooked-example', title: 'Cùng một mẻ, khác mẫu số', objectiveIds: ['ch03-units'],
      prompt: 'Luyện phép quy đổi bằng một mẻ thực phẩm giả định, không dùng các số dưới đây làm bảng thành phần của gạo thật.',
      given: ['Mẻ ban đầu: 100 g nguyên liệu, chứa 80 g carbohydrate theo dữ liệu đã cho.', 'Sau khi thêm nước và nấu, toàn bộ mẻ nặng 300 g.', 'Giả định bài tập: không thất thoát carbohydrate và món được chia đều.'],
      steps: ['Carbohydrate của toàn mẻ vẫn là 80 g theo giả định.', 'Một phần 100 g món chín là 100/300 của mẻ.', 'Carbohydrate của phần đó = 80 × 100/300 ≈ 26,7 g.'],
      answer: 'Khoảng 26,7 g carbohydrate trong phần 100 g món chín giả định.',
      limitation: 'Thực tế cần dữ liệu cho đúng món và cách chế biến; tỷ lệ tăng khối lượng không cố định cho mọi loại thực phẩm.',
    },
  ],
  cases: [
    { id: 'ch03-case-busy', title: 'Bữa trưa ở cửa hàng tiện lợi', context: 'Hà muốn mua hai món và chỉ có vài phút. Hai nhãn dùng khẩu phần khác nhau; Hà định chọn món có số protein in to hơn.', question: 'Cần làm rõ điều gì trước khi so sánh?', reasoning: ['Ghi lượng Hà sẽ dùng, không chỉ lượng ghi trên nhãn.', 'Quy đổi về cùng lượng thực dùng rồi đọc thêm thành phần phù hợp với bữa ăn.', 'Nếu thiếu dữ liệu, nêu phần chưa biết; không gắn giá trị sức khỏe cho một con số riêng lẻ.'], safeNextStep: 'Lập bảng hai cột: đơn vị nhãn và lượng định dùng; thêm một tiêu chí đời sống như giá hoặc khả năng mang đi.', commonError: 'So trực tiếp 20 g trên cả gói với 12 g trên một khẩu phần.' },
    { id: 'ch03-case-family', title: 'Món gia đình nấu cho nhiều người', context: 'Một công thức dùng dầu và nhiều nguyên liệu nhưng app chỉ nhập một món đại diện. Cả nhà chia thành các phần không đều.', question: 'Con số macro hiện có đáng tin ở điểm nào và chưa đáng tin ở điểm nào?', reasoning: ['Tên món không xác định được toàn bộ nguyên liệu hoặc lượng dầu.', 'Phải phân biệt tổng công thức với phần thực ăn.', 'Độ chính xác cần tương xứng mục đích: học mẫu hình không đòi hỏi giả vờ biết từng gram.'], safeNextStep: 'Ghi công thức hoặc mô tả phần ăn nhất quán; đánh dấu sai số thay vì tự bù bằng một số ngẫu nhiên.', commonError: 'Coi một mục có sẵn trong app là phép đo chính xác của mọi phiên bản món đó.' },
    { id: 'ch03-case-medical', title: 'Muốn tăng protein khi có hướng dẫn điều trị', context: 'Một học viên có bệnh thận hỏi PT nên dùng bao nhiêu protein sau khi đọc chương này.', question: 'Phần nào PT có thể hỗ trợ và quyết định nào không được suy từ bài học?', reasoning: ['Ví dụ người khỏe mạnh không xác định nhu cầu của người này.', 'Hỗ trợ đọc nhãn và chuẩn bị câu hỏi khác với đặt mục tiêu điều trị.', 'Cần phối hợp người phụ trách chăm sóc, không đưa một mức gram phổ thông để lấp chỗ thiếu thông tin.'], safeNextStep: 'Chuẩn bị nhãn, lượng định dùng và câu hỏi để trao đổi với chuyên môn đang phụ trách.', commonError: 'Lấy mục tiêu của một người tập khỏe mạnh rồi áp cho mọi người có cùng cân nặng.' },
  ],
  practice: {
    title: 'Phiếu đọc nhãn và bản đồ một bữa ăn', artifact: 'Một phiếu có dữ liệu gốc, hai phép quy đổi, cách thay món và giới hạn áp dụng.',
    steps: ['Chọn hai nhãn thật hoặc dùng nhãn giả định của chương.', 'Ghi đơn vị nhãn, lượng thực dùng và trạng thái thực phẩm.', 'Trình bày phép quy đổi; không điền số khi thiếu căn cứ.', 'Mô tả một bữa ăn và một phương án thay món theo chức năng.', 'Tự chấm bằng rubric, sửa một lỗi rồi nộp bản hoàn chỉnh.'],
    fields: [
      { id: 'context', label: 'Nhãn và lượng định dùng', prompt: 'Ghi nguồn, đơn vị, lượng thực dùng, trạng thái sống/chín hoặc thông tin còn thiếu.', required: true },
      { id: 'hypothesis', label: 'Điều cần so sánh', prompt: 'Bạn so sánh đóng góp nào? Vì sao phải quy đổi về cùng mẫu số?', required: true },
      { id: 'action', label: 'Hai phép tính có đơn vị', prompt: 'Viết dữ liệu đầu vào, công thức và kết quả; đánh dấu số giả định.', required: true },
      { id: 'minimum', label: 'Phương án khi thiếu thông tin', prompt: 'Bạn sẽ ghi hoặc hỏi gì thay vì đoán một con số chính xác?', required: true },
      { id: 'data', label: 'Bữa ăn và món thay', prompt: 'Nêu chức năng muốn giữ và ít nhất một điểm chưa tương đương giữa hai lựa chọn.', required: true },
      { id: 'stop', label: 'Giới hạn áp dụng', prompt: 'Ghi điều kiện dị ứng, hướng dẫn chuyên môn hoặc tình huống không tự đặt macro cá nhân.', required: true },
    ],
    modelResponse: ['Dùng nhãn giả định A và B: 125 ml A có 10 g protein, cả hộp B có 12 g.', 'Tôi không chọn B chỉ vì nhiều protein hơn; chưa có thông tin về giá, thành phần và khả năng dùng cùng bữa.', 'Với món gia đình, tôi sẽ ghi công thức và lượng thực dùng hoặc nêu phần chưa biết; không lấy số của nguyên liệu khô gán cho món chín.', 'Các phép tính không phải chỉ định cho người có bệnh; mục tiêu điều trị cần người phụ trách đánh giá.'],
    rubric: [
      { id: 'data', label: 'Dữ liệu và đơn vị', levels: ['Thiếu nguồn hoặc trộn mẫu số.', 'Có nguồn nhưng thiếu lượng thực dùng hoặc trạng thái.', 'Nguồn, mẫu số, lượng dùng và giả định đều rõ.'] },
      { id: 'mechanism', label: 'Phép tính và giải thích', levels: ['Nhầm gram thực phẩm với gram dưỡng chất hoặc cộng sai đơn vị.', 'Có phép tính đúng nhưng chưa nêu giới hạn.', 'Hai phép tính đúng, kiểm tra được và có giới hạn phù hợp.'] },
      { id: 'feasibility', label: 'Ứng dụng vào bữa ăn', levels: ['Thay món không có lý do.', 'Nêu chức năng muốn giữ nhưng chưa xét điều kiện thật.', 'Có chức năng, nguồn lực và điểm chưa tương đương.'] },
      { id: 'safety', label: 'Phạm vi an toàn', levels: ['Biến bài học thành chỉ định hoặc bỏ qua dị ứng.', 'Có nhắc an toàn nhưng chưa xác định giới hạn.', 'Nêu được quyết định không tự làm và người cần hỏi.'] },
    ],
  },
  coachExtension: ['Yêu cầu học viên tự giải thích mẫu số trước khi đưa đáp án.', 'Đánh giá cách lập luận, không thưởng cho nhiều chữ số thập phân.', 'Cho một dữ kiện còn thiếu và chấp nhận câu trả lời chưa đủ thông tin khi người học nêu được câu hỏi cần bổ sung.'],
  safety: ['Đây là bài học đọc dữ liệu, không kê mục tiêu macro hoặc calorie cá nhân.', 'Không bỏ qua dị ứng, khả năng tiếp cận thực phẩm hay hướng dẫn điều trị để khớp con số.', 'Có thể dùng dữ liệu giả định; không yêu cầu học viên công khai thông tin sức khỏe riêng tư.'],
  referenceIds: ['who-healthy-diet-2026', 'fda-nutrition-label', 'ecfr-energy-factors', 'niddk-ckd-nutrition'],
}
