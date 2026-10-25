import type { AcademyLearningUnit } from './learning-unit'

export const chapter07Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 7, revision: '2026-10-24.1',
  title: 'Vì sao mỗi người thay đổi cân nặng khác nhau: tách nguyên nhân khỏi phán xét',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành muốn hiểu khác biệt đáp ứng; coach luyện so sánh công bằng và không quy kết ý chí.',
  scope: 'Phân tích dữ liệu và mô hình giả định để nhận ra điểm xuất phát, thực hiện, đáp ứng và phép đo. Không đặt tốc độ giảm cân, mức thiếu hụt hoặc chẩn đoán chuyển hóa cá nhân.',
  prerequisites: [1, 2, 3, 6],
  objectives: [
    { id: 'ch07-compare', outcome: 'Phân biệt kế hoạch trên giấy, việc thực hiện và nhu cầu của mỗi người.', evidence: 'Giải thích vì sao cùng lượng ăn được báo không bảo đảm cùng chênh lệch năng lượng.' },
    { id: 'ch07-dynamic', outcome: 'Hiểu cân nặng là hệ động, không ngoại suy một tốc độ mãi mãi.', evidence: 'Nêu vì sao kết quả ban đầu hoặc công thức tĩnh không tạo lời hứa số kg.' },
    { id: 'ch07-measure', outcome: 'Tách thay đổi cân tổng, thay đổi mỡ và chất lượng dữ liệu.', evidence: 'Tính thay đổi theo kg và phần trăm với đúng mẫu số, rồi chỉ ra giới hạn.' },
    { id: 'ch07-next', outcome: 'Chọn thông tin cần làm rõ hoặc cách hỗ trợ thay vì mặc định cắt ăn.', evidence: 'Lập phiếu bốn lớp có bước tiếp theo vừa sức và điều kiện tìm chuyên môn.' },
  ],
  sections: [
    {
      id: 'ch07-four-layers', title: 'Mở chữ “cơ địa” thành bốn lớp có thể hỏi', objectiveIds: ['ch07-compare'],
      paragraphs: [
        'Cân nặng chịu tác động của sinh hoạt, môi trường, giấc ngủ, thuốc, tình trạng sức khỏe và di truyền. Từ “cơ địa” không sai vì thừa nhận khác biệt, nhưng quá rộng để biết bước tiếp theo. Trong bài này, ta tổ chức câu hỏi thành điểm xuất phát, thực hiện, đáp ứng và phép đo.',
        'Điểm xuất phát gồm mục tiêu và hoàn cảnh; thực hiện là điều thật sự làm được, không phải bản kế hoạch đã nhận. Đáp ứng gồm trải nghiệm và thay đổi quan sát được. Phép đo hỏi cách số liệu được tạo ra và phần bị thiếu. Đây là khung học tập do Aura tổ chức, không là thang chẩn đoán hay thuật toán tìm nguyên nhân.',
        'Hai người cùng báo một lượng ăn có thể khác nhu cầu và độ đầy đủ của bản ghi. Hãy hỏi trung tính về khẩu phần, công thức hoặc lịch sống, không mặc định ai đang nói dối. Sửa một cách ghi dễ nhầm hoặc một kế hoạch quá khó thực hiện có thể là bước đầu hợp lý hơn yêu cầu cố gắng hơn.',
      ],
      takeaways: ['Kế hoạch giống nhau chưa chứng minh thực hiện và đáp ứng giống nhau.', 'Dữ liệu chưa rõ cần câu hỏi tốt hơn, không cần phán xét người học.'], sourceIds: ['niddk-weight-factors', 'hall-weight-dynamics-2011', 'niddk-habits'],
    },
    {
      id: 'ch07-changing-system', title: 'Một chênh lệch năng lượng không tạo tốc độ cố định mãi mãi', objectiveIds: ['ch07-dynamic'],
      paragraphs: [
        'Khi cơ thể và hành vi thay đổi, tiêu hao cũng có thể thay đổi. Vì thế mô hình động của Hall và cộng sự không xem việc giảm một lượng năng lượng là lời hứa giảm cùng số kg mỗi tuần mãi mãi. Dự đoán còn phụ thuộc dữ liệu ban đầu và giả định về thực hiện.',
        'Giảm tiêu hao khi khối lượng cơ thể thay đổi không đồng nghĩa mọi phần đều là “thích nghi chuyển hóa”. Cần phân biệt phần thay đổi dự kiến theo cơ thể với phần tiêu hao khác mức dự đoán trong điều kiện đánh giá. Nghiên cứu Nunes và cộng sự năm 2022 dùng tiêu hao lúc nghỉ đo được và 13 cách tính cho kết quả ước lượng khác nhau. Một đoạn cân đứng không đo riêng được cơ chế này, càng không chứng minh cơ thể đã hỏng.',
        'Trong bài mẫu, ta chỉ dùng mô hình để thấy vì sao lời hứa tuyến tính không vững. Không lấy một đường dự đoán làm tiêu chuẩn phán xét người thật hoặc suy ngược ra lượng ăn chính xác từ vài ngày cân. Khi cần đánh giá cá nhân, mức độ bất định phải đi cùng kết luận và quyết định hỗ trợ.',
      ],
      takeaways: ['Tốc độ ban đầu không phải hợp đồng cho các tuần sau.', 'Không chẩn đoán thích nghi chuyển hóa từ việc cân đứng.'], sourceIds: ['hall-weight-dynamics-2011', 'niddk-body-weight-planner', 'nunes-adaptation-methods-2022'],
    },
    {
      id: 'ch07-scale-context', title: 'Cân tổng không cân riêng mô mỡ', objectiveIds: ['ch07-measure'],
      paragraphs: [
        'Một con số trên cân mô tả tổng khối lượng ở lần đo đó. Nó không tách được mô mỡ, các mô khác và lượng nước hay chất chứa trong cơ thể. Đổi điều kiện hoặc thiết bị làm việc so sánh khó hơn. Giữ cách đo nhất quán có thể giảm một phần nhiễu, không biến cân thành phép đo mỡ chính xác.',
        'Thay đổi tuyệt đối theo kg và thay đổi tương đối theo phần trăm trả lời hai câu hỏi khác nhau. Phần trăm cần mẫu số ban đầu được ghi rõ. Cùng giảm 2 kg từ 90 kg và 60 kg không có cùng tỷ lệ, nhưng tỷ lệ khác nhau cũng chưa xác định ai khỏe hơn, giảm mỡ nhiều hơn hoặc có kế hoạch phù hợp hơn.',
        'Không điền số không vào ngày thiếu cân, không bỏ điểm chỉ vì không thích và không so hai khoảng thời gian khác nhau mà giấu điều đó. Nếu việc cân gây lo âu hoặc thúc đẩy hạn chế ăn có hại, bài học có thể dùng dữ liệu giả định và chỉ số không liên quan hình thể; không bắt phải cân nhiều hơn để đủ điểm.',
      ],
      takeaways: ['Ghi mẫu số và thời gian khi tính phần trăm thay đổi.', 'Chuẩn hóa giúp so sánh, không xác nhận thay đổi mô mỡ.'], sourceIds: ['frija-masson-scales-2021', 'cochrane-interpretation', 'nhs-eating-disorders'],
    },
    {
      id: 'ch07-investigate', title: 'Chọn điều cần làm rõ trước điều cần thay đổi', objectiveIds: ['ch07-next'],
      paragraphs: [
        'Sau khi nhìn bốn lớp, viết một giả thuyết có thể kiểm tra bằng dữ liệu ít gây phiền. Ví dụ hồ sơ trưa thiếu ở ngày họp gợi câu hỏi về cách ghi và khả năng chuẩn bị; chưa chứng minh kế hoạch dinh dưỡng không hiệu quả. Có thể sửa biểu mẫu hoặc phương án mua bữa trước, không cần tự giảm lượng ăn.',
        'Nếu chọn thay đổi một việc ít rủi ro, viết lý do, điều sẽ quan sát và ngày rà lại. Một thay đổi mỗi lần giúp câu chuyện dễ kiểm tra hơn nhưng không biến đời sống thành thử nghiệm kiểm soát; các yếu tố khác vẫn có thể đổi. Mốc rà là lịch học, không là thời hạn cơ thể phải đạt một tốc độ.',
        'Cân giảm không chủ ý kéo dài hoặc đi kèm triệu chứng cần được đánh giá, không tự coi là thành tích. Nếu có khó khăn với ăn uống hoặc cân đo, tìm hỗ trợ chuyên môn phù hợp. Không tự dừng thuốc để loại một yếu tố “gây nhiễu”; ghi câu hỏi đó cho người kê hoặc phụ trách điều trị.',
      ],
      takeaways: ['Có thể cần thêm dữ liệu, đơn giản hóa hoặc tìm hỗ trợ, không chỉ cắt ăn.', 'An toàn có quyền thay đổi kế hoạch trước ngày rà đã hẹn.'], sourceIds: ['niddk-habits', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'niddk-weight-factors'],
    },
  ],
  workedExamples: [
    {
      id: 'ch07-same-intake-example', title: 'Cùng lượng ăn giả định, khác phần chênh', objectiveIds: ['ch07-compare'],
      prompt: 'Hai nhân vật trong mô hình có cùng lượng ăn. Dùng phép trừ để chỉ ra điều câu “cùng kế hoạch” chưa nói.',
      given: ['A: tiêu hao mô hình 2.200 kcal/ngày, lượng ăn giả định 1.900 kcal/ngày.', 'B: tiêu hao mô hình 2.500 kcal/ngày, lượng ăn giả định 1.900 kcal/ngày.', 'Giả định đầu vào đúng chỉ để luyện toán; không khuyến nghị các mức này.'],
      steps: ['Định nghĩa phần chênh đang tính là tiêu hao trừ lượng ăn.', 'A: 2.200 − 1.900 = 300 kcal/ngày.', 'B: 2.500 − 1.900 = 600 kcal/ngày.', 'Chỉ kết luận cùng đầu vào ăn chưa tạo cùng phần chênh; không đổi thành lời hứa B giảm gấp đôi.'],
      answer: 'Mô hình cho phần chênh 300 và 600 kcal/ngày; không dự đoán tốc độ cá nhân hoặc chỉ định mức ăn.',
      limitation: 'Không xác nhận dữ liệu thực tế, cách thực hiện hoặc lượng mỡ mất; mô hình tĩnh này chỉ minh họa phép so sánh.',
    },
    {
      id: 'ch07-percent-example', title: 'Hai kilogram và hai mẫu số', objectiveIds: ['ch07-measure'],
      prompt: 'Tính tỷ lệ thay đổi cân tổng trong dữ liệu giả định cùng khoảng thời gian, không xếp hạng người học.',
      given: ['A từ 90 kg xuống 88 kg.', 'B từ 60 kg xuống 58 kg.', 'Chưa có dữ liệu thành phần cơ thể, triệu chứng hoặc điều kiện đo.'],
      steps: ['Thay đổi theo kg của cả hai là −2 kg.', 'A: (88 − 90) / 90 × 100 ≈ −2,22%.', 'B: (58 − 60) / 60 × 100 ≈ −3,33%.', 'Giữ dấu âm, mẫu số và giới hạn: đây là thay đổi cân tổng, không là mỡ hoặc sức khỏe.'],
      answer: 'Cả hai giảm 2 kg; tương ứng khoảng 2,22% và 3,33% khối lượng ban đầu.',
      limitation: 'Tỷ lệ lớn hơn không tự là tốt hơn; không suy ra tốc độ an toàn hoặc hiệu quả điều trị từ ví dụ.',
    },
    {
      id: 'ch07-missing-days-example', title: 'Tỷ lệ ghi đủ không phải tỷ lệ thực hiện', objectiveIds: ['ch07-dynamic', 'ch07-next'],
      prompt: 'Trong lịch giả định năm ngày, người học ghi chuẩn bị bữa ba ngày, không chuẩn bị một ngày và để trống một ngày.',
      given: ['3 ngày ghi có, 1 ngày ghi không.', '1 ngày chưa rõ, không được tự điền.', 'Chưa có kết quả sức khỏe hoặc số liệu dài hạn.'],
      steps: ['Độ phủ ghi chép là 4/5 = 80%.', 'Trong bốn ngày có dữ liệu, tỷ lệ ghi đã chuẩn bị là 3/4 = 75%.', 'Không gọi 75% là tỷ lệ chắc chắn của cả năm ngày.', 'Bước tiếp theo là làm rõ ô thiếu hoặc sửa cách ghi, không ngoại suy tốc độ giảm cân.'],
      answer: 'Độ phủ 80%; tỷ lệ ghi có trong các ngày đã biết là 75%, còn một ngày chưa rõ.',
      limitation: 'Nhật ký giả định mô tả việc chuẩn bị, không đo năng lượng thực ăn hoặc chứng minh nguyên nhân thay đổi cân.',
    },
  ],
  cases: [
    { id: 'ch07-case-comparison', title: 'Bạn giảm nhanh hơn', context: 'Hai người nhận cùng bản thực đơn nhưng có công việc, lịch nghỉ và khả năng chuẩn bị khác nhau.', question: 'Có nên kết luận người giảm chậm ít quyết tâm hơn?', reasoning: ['Bản kế hoạch không là dữ liệu thực hiện.', 'Điểm xuất phát và hoàn cảnh có thể khác.', 'Cần hỏi từng người điều làm được và khó khăn, không dùng tốc độ để chấm phẩm chất.'], safeNextStep: 'Lập phiếu bốn lớp của từng ca, chọn thông tin thiếu; không ép mức hạn chế ăn của người khác.', commonError: 'Dùng kết quả của một người để suy nhu cầu, rủi ro và ý chí của người còn lại.' },
    { id: 'ch07-case-plateau', title: 'Ba lần cân không đổi', context: 'Một người có ba điểm cân gần nhau và nghĩ chuyển hóa đã hỏng nên phải cắt ăn mạnh.', question: 'Ba điểm có đo riêng được cơ chế chuyển hóa không?', reasoning: ['Cân tổng không tách các thành phần hoặc cơ chế.', 'Chưa rõ điều kiện đo và khoảng thời gian có phù hợp câu hỏi không.', 'Cần xem bối cảnh và chất lượng dữ liệu trước mọi quyết định ăn uống.'], safeNextStep: 'Giữ giới hạn kết luận, rà dữ liệu hoặc hỏi chuyên môn khi cần; không tự dùng mức cắt ăn cực đoan.', commonError: 'Biến một đoạn số liệu ngắn thành chẩn đoán và lý do tăng mức hạn chế.' },
    { id: 'ch07-case-unintentional', title: 'Giảm cân nhưng không định giảm', context: 'Một nhân vật tiếp tục sụt cân dù không chủ ý đổi ăn hoặc vận động, đồng thời thấy mệt.', question: 'Có nên chúc mừng và giữ nguyên theo dõi tới cuối tháng?', reasoning: ['Sụt cân không chủ ý không phải mục tiêu học đã đạt.', 'Triệu chứng kèm theo làm cần đánh giá phù hợp sớm.', 'Không đoán nguyên nhân hoặc đặt mốc phải chờ đủ dữ liệu.'], safeNextStep: 'Khuyến khích liên hệ nhân viên y tế sớm; nếu triệu chứng cấp nặng, ưu tiên trợ giúp khẩn cấp.', commonError: 'Coi mọi giảm cân là tốt và để lịch rà bài trì hoãn chăm sóc.' },
  ],
  practice: {
    title: 'Phiếu bốn lớp giải thích khác biệt', artifact: 'Một phân tích hai nhân vật giả định và câu hỏi tiếp theo, không phải kế hoạch giảm cân.',
    steps: ['Chọn hai nhân vật có cùng kế hoạch nhưng khác điều kiện.', 'Điền bốn lớp: điểm xuất phát, thực hiện, đáp ứng, phép đo; đánh dấu chưa rõ.', 'Tính một phép so sánh với đúng mẫu số rồi ghi giới hạn.', 'Chọn thông tin cần thêm hoặc hành động tổ chức ít rủi ro, ngày rà bài và điều kiện tìm hỗ trợ.'],
    fields: [
      { id: 'context', label: 'Hai bối cảnh', prompt: 'Mô tả điểm xuất phát và điều kiện của hai ca giả định; không yêu cầu cân nặng hoặc hồ sơ thật.', required: true },
      { id: 'hypothesis', label: 'Bốn lớp và giả thuyết', prompt: 'Tách thực hiện, đáp ứng, phép đo khỏi kế hoạch; nêu một giả thuyết và điều chưa biết.', required: true },
      { id: 'action', label: 'Bước làm rõ', prompt: 'Sẽ hỏi thêm thông tin nào hoặc sửa cách tổ chức nào trước khi nghĩ tới đổi mức ăn?', required: true },
      { id: 'minimum', label: 'Cách ghi ít phiền', prompt: 'Nếu không cân hoặc không có nhật ký đủ, có thể dùng minh chứng giả định hay tín hiệu nào phù hợp?', required: true },
      { id: 'data', label: 'Phép tính và mốc rà', prompt: 'Viết phép so sánh kg/phần trăm hoặc độ phủ ghi chép, nêu mẫu số, giới hạn và ngày rà bài.', required: true },
      { id: 'stop', label: 'Dừng so tốc độ khi cần', prompt: 'Nêu cách xử lý sụt cân không chủ ý, lo âu cân đo hoặc câu hỏi về thuốc mà không tự điều trị.', required: true },
    ],
    modelResponse: ['Hai ca cùng nhận thực đơn nhưng khác giờ làm; lớp thực hiện có ngày chưa ghi. Chưa biết phần chênh năng lượng thực tế, không quy kết ý chí.', 'Nếu dùng dữ liệu 90→88 kg và 60→58 kg, phần trăm lần lượt khoảng −2,22% và −3,33%; không suy ra lượng mỡ mất hoặc kế hoạch tốt hơn.', 'Ưu tiên sửa cách ghi ở ngày bận và rà bài cuối tuần. Dùng dữ liệu giả định nếu cân đo gây căng thẳng; sụt cân không chủ ý cần hỏi y tế, không tự đổi thuốc.'],
    rubric: [
      { id: 'data', label: 'So sánh đúng phạm vi', levels: ['Trộn kg/phần trăm, điền ô thiếu hoặc so khác thời gian mà không ghi.', 'Tính đúng nhưng thiếu nguồn hoặc giới hạn.', 'Đúng mẫu số, thời gian và dữ liệu thiếu; không gọi cân tổng là mỡ.'] },
      { id: 'mechanism', label: 'Hệ động và khác biệt', levels: ['Quy mọi khác biệt cho ý chí hoặc chuyển hóa hỏng.', 'Nêu yếu tố khác nhau nhưng còn hứa tốc độ cố định.', 'Phân biệt kế hoạch, thực hiện và đáp ứng; nêu giới hạn dự đoán động.'] },
      { id: 'feasibility', label: 'Bước làm rõ vừa sức', levels: ['Chỉ yêu cầu cố hơn hoặc cắt ăn.', 'Có câu hỏi nhưng chưa có cách ghi hay ngày rà.', 'Chọn được thông tin hữu ích, cách ghi ít phiền và ngày rà bài.'] },
      { id: 'safety', label: 'Không xếp hạng sức khỏe bằng cân', levels: ['Coi sụt cân bất thường là thành công hoặc tự sửa thuốc.', 'Có nhắc hỗ trợ nhưng chưa rõ khi nào cần ưu tiên.', 'Nhận ra sụt cân không chủ ý, khó khăn ăn uống và ranh giới thuốc; không trì hoãn hỗ trợ.'] },
    ],
  },
  coachExtension: ['Tránh dùng nhãn tuân thủ như phẩm chất đạo đức; hỏi điều kiện thực hiện cụ thể.', 'Phân biệt giải thích cơ chế khả dĩ với khẳng định cơ chế đã được đo ở cá nhân.', 'Cho phép dùng ca giả định và không yêu cầu ảnh cơ thể hoặc cân đo nếu không cần cho mục tiêu học.'],
  safety: ['Không hứa số kg hoặc kê mức ăn từ ví dụ số học.', 'Không tự giảm thuốc hay tăng mức hạn chế ăn để theo tốc độ người khác.', 'Sụt cân không chủ ý hoặc triệu chứng đáng lo cần đánh giá phù hợp, không đợi đủ điểm dữ liệu.', 'Nếu cân đo gây lo âu hoặc hành vi ăn uống có hại, dừng phần theo dõi đó và tìm hỗ trợ; có thể học bằng ca giả định.'],
  referenceIds: ['niddk-weight-factors', 'hall-weight-dynamics-2011', 'niddk-habits', 'niddk-body-weight-planner', 'frija-masson-scales-2021', 'cochrane-interpretation', 'nhs-eating-disorders', 'nhs-unintentional-loss', 'nunes-adaptation-methods-2022'],
}
