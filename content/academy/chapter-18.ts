import type { AcademyLearningUnit } from './learning-unit'

export const chapter18Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 18, revision: '2026-10-24.1',
  title: 'Đọc bằng chứng dinh dưỡng: từ tuyên bố đến kết luận có giới hạn',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên muốn đọc thông tin có trách nhiệm; PT luyện giải thích độ chắc chắn và phạm vi áp dụng.',
  scope: 'Thẩm định một tuyên bố bằng số liệu giả định. Không chứng minh hiệu quả của sản phẩm cụ thể và không thay tư vấn điều trị.',
  prerequisites: [3, 7, 17],
  objectives: [
    { id: 'ch18-question', outcome: 'Chuyển câu quảng cáo thành câu hỏi PICO có thời gian và kết quả rõ.', evidence: 'Ghi đối tượng, can thiệp, đối chứng, kết quả và thời gian.' },
    { id: 'ch18-effect', outcome: 'Phân biệt hiệu ứng tương đối và tuyệt đối.', evidence: 'Tính đúng từ số người và mẫu số, dùng đúng điểm phần trăm.' },
    { id: 'ch18-uncertainty', outcome: 'Đọc khoảng tin cậy, nguy cơ sai lệch và giới hạn áp dụng.', evidence: 'Viết kết luận không đồng nhất p nhỏ với lợi ích lớn hoặc p lớn với không hiệu quả.' },
    { id: 'ch18-decision', outcome: 'Đánh giá tuyên bố sản phẩm mà không suy từ đăng ký hay cơ chế sang hiệu quả.', evidence: 'Phiếu kiểm chứng có nguồn, điều chưa biết và bước tiếp theo an toàn.' },
  ],
  sections: [
    {
      id: 'ch18-pico', title: 'Làm rõ câu hỏi trước khi tìm nghiên cứu', objectiveIds: ['ch18-question'],
      paragraphs: [
        '“Tốt cho sức khỏe” quá rộng để kiểm tra. PICO tách câu hỏi thành đối tượng, can thiệp, đối chứng và kết quả. Thêm thời gian để tránh ghép một thay đổi sau hai giờ với lợi ích lâu dài. Nêu cả tác dụng không mong muốn, không chỉ lợi ích quảng cáo.',
        'Ví dụ học tập: ở người trưởng thành khỏe mạnh làm văn phòng, chương trình chuẩn bị bữa trưa tại nhà so với thói quen hiện có có thay đổi số bữa có rau sau tám tuần không? Đây là câu hỏi giả định do Aura xây để luyện cấu trúc, không phải mô tả một thử nghiệm đã có.',
        'Kết quả phải khớp lời hứa. Nghiên cứu thay đổi một chỉ dấu sinh học không tự chứng minh giảm biến cố bệnh; nghiên cứu một thành phần không tự chứng minh mọi hỗn hợp chứa thành phần đó. Ghi phần suy rộng còn thiếu trước khi kết luận.',
      ],
      takeaways: ['Đặt một câu hỏi trả lời được.', 'Cùng từ khóa không có nghĩa cùng đối tượng, liều, kết quả hoặc thời gian.'],
      sourceIds: ['cochrane-pico'],
    },
    {
      id: 'ch18-effects', title: '25% và 1 điểm phần trăm có thể cùng đúng', objectiveIds: ['ch18-effect'],
      paragraphs: [
        'Hiệu ứng tương đối so thay đổi với nguy cơ nền; hiệu ứng tuyệt đối giữ chênh lệch trên cùng mẫu số. Khi đọc “giảm 25%”, phải hỏi giảm từ bao nhiêu xuống bao nhiêu, trong bao lâu và với kết quả nào.',
        'Trong ví dụ giả định, 40/1.000 so với 30/1.000 là 4% so với 3%: giảm tuyệt đối 1 điểm phần trăm, tức 10 trường hợp trên 1.000; giảm tương đối là 25%. Hai cách nói bổ sung cho nhau, không được tráo thành giảm 25 điểm phần trăm.',
        'Những phép tính này chưa xác định độ chắc chắn, tính nhân quả hoặc mức lợi ích của một người. Cần đọc thiết kế nghiên cứu, tác hại, khoảng bất định và khả năng áp dụng trước quyết định.',
      ],
      takeaways: ['Luôn giữ mẫu số và thời gian bên cạnh hiệu ứng.', 'Phần trăm tương đối không thay thế chênh lệch tuyệt đối.'],
      sourceIds: ['cochrane-interpretation'],
    },
    {
      id: 'ch18-interval', title: 'Khoảng tin cậy nói về độ bất định, không bảo đảm kết quả cá nhân', objectiveIds: ['ch18-uncertainty'],
      paragraphs: [
        'Đọc ước lượng cùng khoảng tin cậy và đơn vị. Với tỷ số nguy cơ, giá trị không khác biệt là 1; với chênh lệch trung bình, đó là 0. Khoảng rộng cho thấy nhiều mức hiệu ứng còn phù hợp với dữ liệu và giả định của phân tích.',
        'Khoảng tin cậy 95% không có nghĩa 95% học viên sẽ nhận được lợi ích, cũng không phải xác suất 95% để tác dụng của một cá nhân nằm trong khoảng. Không biến p < 0,05 thành chứng nhận lợi ích quan trọng, hoặc p ≥ 0,05 thành bằng chứng chắc chắn không có tác dụng.',
        'Trong bài tập, hãy viết “ước lượng là…, khoảng là…, còn chưa chắc về…”. Cách diễn đạt này hữu ích hơn việc chọn duy nhất nhãn có hoặc không hiệu quả.',
      ],
      takeaways: ['Đọc giá trị không khác biệt đúng với loại đại lượng.', 'Độ chính xác thống kê và tầm quan trọng thực tế là hai câu hỏi.'],
      sourceIds: ['cochrane-interpretation'],
    },
    {
      id: 'ch18-bias', title: 'Đọc cách nghiên cứu được làm, không chỉ tên nghiên cứu', objectiveIds: ['ch18-uncertainty'],
      paragraphs: [
        'Nhãn “RCT” hay “phân tích gộp” không miễn trừ việc xem nguy cơ sai lệch. Hãy hỏi cách phân nhóm, dữ liệu bị thiếu, đo kết quả và lựa chọn kết quả báo cáo có thể làm ước lượng lệch đi không. Một bản tổng hợp vẫn chịu ảnh hưởng từ chất lượng và tính tương đồng của các nghiên cứu thành phần.',
        'Nguồn tài trợ và xung đột lợi ích cần được ghi nhận, nhưng không tự chứng minh kết quả đúng hay sai. Chúng gợi ý những điểm cần kiểm tra thêm: ai kiểm soát dữ liệu, kết quả nào được đăng ký và kết quả nào cuối cùng được báo cáo.',
        'Tách hai cột: chất lượng suy luận trong nghiên cứu và mức giống với câu hỏi của mình. Một nghiên cứu làm tốt ở nhóm rất khác vẫn có thể chưa trả lời được câu hỏi hiện tại.',
      ],
      takeaways: ['Không chấm bằng chứng chỉ bằng thứ bậc hoặc danh tiếng.', '“Chưa rõ” là kết quả hợp lệ khi thiếu báo cáo cần thiết.'],
      sourceIds: ['cochrane-bias', 'cochrane-pico'],
    },
    {
      id: 'ch18-product', title: 'Nhãn, cơ chế và hiệu quả là ba loại thông tin', objectiveIds: ['ch18-decision'],
      paragraphs: [
        'Một nhãn có thành phần cho biết sản phẩm công bố chứa gì; một cơ chế gợi ý điều có thể xảy ra; một nghiên cứu kết quả kiểm tra điều đã quan sát trong điều kiện cụ thể. Không thay bằng chứng ở cấp này bằng một câu khẳng định ở cấp khác.',
        'FDA nêu rằng cơ quan này không phê duyệt trước thực phẩm bổ sung về an toàn và hiệu quả như cách nhiều người hiểu về thuốc. Đăng ký cơ sở, tuân thủ sản xuất hoặc thông báo sản phẩm không đồng nghĩa sản phẩm đã được chứng minh chữa bệnh. Đây là bối cảnh Hoa Kỳ, không phải kết luận pháp lý cho một nhãn tại Việt Nam.',
        'Phiếu kiểm chứng kết thúc bằng hành động có giới hạn: tìm báo cáo gốc, hỏi người có chuyên môn hoặc chưa sử dụng khi chưa đủ thông tin. Không khuyến khích tự thử để kiểm chứng lời quảng cáo nếu có nguy cơ tương tác thuốc hoặc ảnh hưởng điều trị.',
      ],
      takeaways: ['Chứng cứ về thành phần không tự trở thành chứng cứ về hỗn hợp.', 'Không dùng bài tập để thay thuốc bằng sản phẩm bổ sung.'],
      sourceIds: ['fda-supplements-qa', 'cochrane-pico'],
    },
  ],
  workedExamples: [
    {
      id: 'ch18-risk-example', title: 'Tính cả hai loại giảm nguy cơ', objectiveIds: ['ch18-effect'],
      prompt: 'Số liệu hoàn toàn giả định: kết quả bất lợi được ghi nhận sau cùng một thời gian ở hai nhóm có cùng cỡ mẫu.',
      given: ['Nhóm đối chứng: 40/1.000.', 'Nhóm can thiệp: 30/1.000.', 'Chưa có thông tin thiết kế hoặc khoảng tin cậy.'],
      steps: ['Nguy cơ đối chứng = 40/1.000 = 4%.', 'Nguy cơ can thiệp = 30/1.000 = 3%.', 'Giảm tuyệt đối = 4% − 3% = 1 điểm phần trăm.', 'Giảm tương đối = (4% − 3%)/4% = 25%.', 'Chênh lệch đếm được là 10 trường hợp trên 1.000, không phải 250 trên 1.000.'],
      answer: 'Giảm tương đối 25%, tuyệt đối 1 điểm phần trăm trong thời gian giả định; chưa đủ thông tin để khẳng định quan hệ nhân quả.',
      limitation: 'Không suy ra hiệu quả hoặc khuyến nghị của bất kỳ sản phẩm thật nào.',
    },
    {
      id: 'ch18-ci-example', title: 'Khoảng đi qua giá trị 1', objectiveIds: ['ch18-uncertainty'],
      prompt: 'Đọc một ước lượng giả định cho kết quả bất lợi.',
      given: ['Tỷ số nguy cơ RR = 0,80.', 'Khoảng tin cậy 95%: 0,55–1,16.'],
      steps: ['Ước lượng điểm gợi ý nguy cơ thấp hơn ở nhóm can thiệp.', 'Khoảng gồm 1 và các giá trị ở cả hai phía.', 'Không kết luận chắc chắn có lợi, cũng không tuyên bố hai nhóm giống hệt.', 'Cần xem thêm độ tin cậy phương pháp, kết quả khác và tác hại.'],
      answer: 'Ước lượng còn bất định, phù hợp với nhiều mức hiệu ứng theo giả định của phân tích.',
      limitation: 'Đây không phải khoảng dự đoán cho từng học viên hoặc xác suất thành công của sản phẩm.',
    },
    {
      id: 'ch18-comparator', title: 'Giảm từ trước tới sau chưa đủ', objectiveIds: ['ch18-question', 'ch18-uncertainty'],
      prompt: 'Một quảng cáo chỉ đưa cân nặng trước và sau của nhóm sử dụng sản phẩm.',
      given: ['Nhóm A giảm trung bình 2 kg.', 'Trong bài toán giả định này, nhóm đối chứng cũng giảm 2 kg.', 'Chưa có độ biến thiên, cỡ mẫu hoặc khoảng tin cậy.'],
      steps: ['Phân biệt thay đổi trong nhóm với chênh lệch giữa nhóm.', 'Chênh lệch thay đổi trung bình A so với đối chứng = −2 − (−2) = 0 kg.', 'Không thể gán toàn bộ 2 kg cho sản phẩm.', 'Không suy từ ước lượng 0 thành chứng minh tương đương khi thiếu bất định và thiết kế phù hợp.'],
      answer: 'Quảng cáo bỏ mất đối chứng nên không hỗ trợ kết luận riêng về sản phẩm.',
      limitation: 'Ví dụ dạy cách đặt câu hỏi, không phải phân tích hoàn chỉnh một thử nghiệm.',
    },
  ],
  cases: [
    { id: 'ch18-case-mice', title: 'Từ mô hình tới người tập', context: 'Bài viết dẫn nghiên cứu ở chuột rồi nói hiệu quả đã chắc chắn ở người tập gym.', question: 'Mắt xích nào chưa được chứng minh?', reasoning: ['Đối tượng khác câu hỏi thực tế.', 'Cơ chế hoặc kết quả ở mô hình không bảo đảm hiệu quả lâm sàng.', 'Cần dữ liệu phù hợp ở người và thông tin an toàn.'], safeNextStep: 'Ghi bằng chứng gián tiếp, tìm nghiên cứu đúng đối tượng.', commonError: 'Cơ chế hợp lý đồng nghĩa lợi ích chắc chắn.' },
    { id: 'ch18-case-percent', title: 'Quảng cáo chỉ ghi 25%', context: 'Một ảnh quảng cáo không nói nguy cơ nền, kết quả hoặc thời gian.', question: 'Có thể dùng con số để quyết định không?', reasoning: ['Chưa rõ tương đối hay tuyệt đối.', 'Thiếu mẫu số và kết quả cụ thể.', 'Không tính được lợi ích thực tế từ ảnh này.'], safeNextStep: 'Yêu cầu nguồn gốc và các số ở hai nhóm.', commonError: 'Hiểu giảm 25% là 25 người trong mỗi 100 người chắc chắn hưởng lợi.' },
    { id: 'ch18-case-label', title: 'Dấu xác nhận trên hộp', context: 'Người bán nói nhà máy đã đăng ký nên sản phẩm được chứng minh điều trị bệnh.', question: 'Thông tin nào bị đánh tráo?', reasoning: ['Tình trạng cơ sở khác hiệu quả của sản phẩm.', 'Cần xác minh đúng loại tài liệu và khu vực pháp lý.', 'Không thay thuốc dựa trên lời khẳng định này.'], safeNextStep: 'Kiểm tra tài liệu gốc và trao đổi bác sĩ hoặc dược sĩ nếu đang điều trị.', commonError: 'Một giấy tờ bất kỳ thay thế toàn bộ dữ liệu an toàn và hiệu quả.' },
  ],
  practice: {
    title: 'Phiếu kiểm chứng một tuyên bố dinh dưỡng', artifact: 'Câu hỏi PICO, phép tính hiệu ứng, giới hạn và quyết định tạm thời.',
    steps: ['Chọn một tuyên bố giả định của chương.', 'Viết PICO và thời gian.', 'Tính hiệu ứng với mẫu số rõ hoặc ghi chưa đủ số liệu.', 'Kiểm tra độ bất định, sai lệch và khả năng áp dụng.', 'Viết kết luận có giới hạn và nguồn cần tìm thêm.'],
    fields: [
      { id: 'context', label: 'Tuyên bố và nguồn', prompt: 'Ghi nguyên ý, đường dẫn hoặc đánh dấu tình huống giả định; không đăng thông tin riêng tư.', required: true },
      { id: 'hypothesis', label: 'Câu hỏi PICO', prompt: 'Ai, dùng gì, so với gì, kết quả nào, trong bao lâu?', required: true },
      { id: 'action', label: 'Hiệu ứng và phép tính', prompt: 'Nêu nguy cơ nền, tương đối, tuyệt đối; nếu thiếu mẫu số hãy ghi chưa tính được.', required: true },
      { id: 'minimum', label: 'Khi chưa có báo cáo gốc', prompt: 'Cần tìm hoặc hỏi gì? Không lấp dữ liệu thiếu bằng lời quảng cáo.', required: true },
      { id: 'data', label: 'Độ chắc chắn và khả năng áp dụng', prompt: 'Nêu ít nhất một điểm về khoảng bất định, sai lệch và đối tượng.', required: true },
      { id: 'stop', label: 'Kết luận và giới hạn hành động', prompt: 'Điều gì có thể nói, chưa thể nói; khi nào cần chuyên môn thay vì tự thử sản phẩm?', required: true },
    ],
    modelResponse: ['Với số giả định 40/1.000 và 30/1.000: giảm tương đối 25%, tuyệt đối 1 điểm phần trăm.', 'Chưa có thiết kế, thời gian cụ thể hoặc khoảng tin cậy nên không khẳng định lợi ích cá nhân.', 'Tôi sẽ tìm báo cáo gốc và dữ liệu tác hại; không coi nhãn quảng cáo là bằng chứng.', 'Không đổi thuốc hoặc tự thử sản phẩm để chứng minh tuyên bố.'],
    rubric: [
      { id: 'data', label: 'Câu hỏi và nguồn', levels: ['Chỉ chép quảng cáo.', 'Có nguồn nhưng thiếu đối chứng hoặc kết quả.', 'Có PICO, thời gian, nguồn và dữ liệu thiếu.'] },
      { id: 'mechanism', label: 'Diễn giải hiệu ứng', levels: ['Nhầm tương đối và tuyệt đối hoặc suy nhân quả vô căn cứ.', 'Tính đúng nhưng thiếu giới hạn.', 'Đúng phép tính, đơn vị và mức chắc chắn.'] },
      { id: 'feasibility', label: 'Bước kiểm chứng', levels: ['Quyết định mua/dùng ngay.', 'Có ý tìm hiểu nhưng chưa rõ dữ liệu cần tìm.', 'Có câu hỏi cụ thể, nguồn gốc và quyết định tạm thời.'] },
      { id: 'safety', label: 'Ứng dụng có giới hạn', levels: ['Dùng bài học để thay điều trị.', 'Có cảnh báo chung.', 'Không suy rộng đối tượng hoặc thay điều trị; chỉ rõ người cần hỏi.'] },
    ],
  },
  coachExtension: ['Chấp nhận kết luận chưa đủ bằng chứng nếu chỉ ra đúng phần thiếu.', 'Đổi nguy cơ nền nhưng giữ hiệu ứng tương đối để học viên tính lại tuyệt đối.', 'Yêu cầu tách phê bình phương pháp khỏi đánh giá người đưa thông tin.'],
  safety: ['Ví dụ số học là giả định, không quảng bá sản phẩm.', 'Không biến giấy đăng ký hoặc cơ chế thành bảo đảm điều trị.', 'Không ngừng thuốc hoặc dùng thử sản phẩm nguy cơ để hoàn thành bài.'],
  referenceIds: ['cochrane-pico', 'cochrane-interpretation', 'cochrane-bias', 'fda-supplements-qa'],
}
