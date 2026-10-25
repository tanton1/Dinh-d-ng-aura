import type { AcademyLearningUnit } from './learning-unit'

export const chapter15Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 15, revision: '2026-10-24.1',
  title: 'Tái cấu trúc cơ thể: đọc nhiều tín hiệu, không ép chiếc cân kể chuyện mô',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành học cách đánh giá mục tiêu hình thể; PT luyện giải thích kết quả và độ chưa chắc.',
  scope: 'Phân tích hồ sơ giả định để phân biệt thay đổi khối lượng, ước tính mô và chức năng. Không bắt buộc giảm mỡ, tăng cơ, gửi ảnh hoặc theo một mức calorie để hoàn thành chương.',
  prerequisites: [7, 8, 10, 12, 13, 14],
  objectives: [
    { id: 'ch15-tissues', outcome: 'Phân biệt cân tổng, khối mỡ, khối không mỡ và cơ khi diễn giải recomp.', evidence: 'Tính đúng ví dụ hai ngăn và không gọi mọi thay đổi khối không mỡ là cơ.' },
    { id: 'ch15-evidence', outcome: 'Đọc bằng chứng recomp cùng đối tượng, phương pháp và giới hạn.', evidence: 'Nêu vì sao một thử nghiệm đặc thù không là thực đơn hay cam kết cá nhân.' },
    { id: 'ch15-monitor', outcome: 'Chọn tín hiệu có thể so sánh và nhận ra khi dữ liệu chưa đủ.', evidence: 'Giữ cùng phương pháp, ghi điểm đổi và phân biệt giả định sai số với khoảng tin cậy.' },
    { id: 'ch15-decision', outcome: 'Lập quyết định giữ, làm rõ, sửa hoặc tìm hỗ trợ trên hồ sơ nhiều tín hiệu.', evidence: 'Bản rà có lý do, giới hạn, mốc xem lại và ưu tiên an toàn hơn mục tiêu hình thể.' },
  ],
  sections: [
    {
      id: 'ch15-body-components', title: 'Hai mô có thể đổi khác hướng; mỡ không biến thành cơ', objectiveIds: ['ch15-tissues'],
      paragraphs: [
        'Recomp là mục tiêu giảm khối mỡ đồng thời tăng hoặc bảo vệ cơ, không phải một phản ứng biến mỡ thành cơ. Một cân tổng đứng yên có nhiều cách giải thích: các thành phần đổi bù nhau, nước thay đổi, hoặc chưa có thay đổi đủ rõ để nhận ra. Chỉ cân tổng không xác nhận được cách nào.',
        'Trong mô hình hai ngăn của bài, cân tổng = khối mỡ + khối không mỡ. Khối không mỡ không chỉ gồm cơ mà còn các thành phần khác, trong đó có nước và xương. Các báo cáo dùng thuật ngữ khối nạc và khối không mỡ cũng cần đọc định nghĩa của phương pháp; đừng đổi tên cột thành cơ theo ý mình.',
        'Nếu phần trăm mỡ là một ước tính, phép nhân ra kg vẫn là ước tính. Thêm chữ số thập phân chỉ làm phép tính chi tiết hơn, không làm thiết bị chính xác hơn. Thay đổi sức mạnh hay vòng đo có thể bổ sung bối cảnh nhưng không tự chuyển được thành kg cơ hoặc kg mỡ.',
      ],
      takeaways: ['Giữ tên đại lượng đúng với phương pháp.', 'Đứng cân không tự chứng minh thành công hoặc thất bại.'], sourceIds: ['frija-masson-scales-2021', 'longland-recomp-2016'],
    },
    {
      id: 'ch15-research-scope', title: 'Có thể xảy ra không có nghĩa ai cũng đạt cùng tốc độ', objectiveIds: ['ch15-evidence'],
      paragraphs: [
        'Longland và cộng sự năm 2016 làm thử nghiệm bốn tuần ở 40 nam trẻ với ăn được kiểm soát và lượng tập cao. Nhóm protein cao hơn có thay đổi khối nạc và khối mỡ thuận lợi hơn nhóm so sánh trong bối cảnh đó. Đây là bằng chứng về khả năng xảy ra, không phải lời hứa cho mọi học viên; kết quả khối nạc cũng không riêng mô cơ.',
        'Không sao mức hạn chế năng lượng, lượng protein hoặc lịch tập khắt khe từ một nghiên cứu sang người chưa được đánh giá. Cần xét nền tập, nguồn lực ăn, phục hồi, mục tiêu tự chọn và điều kiện sức khỏe. Một người đang thiếu nguồn lực hoặc có triệu chứng cần hỗ trợ, không cần cố chứng minh recomp bằng cách siết thêm.',
        'Damas và cộng sự nghiên cứu 10 nam trẻ chưa tập trong mười tuần: tăng kích thước cơ giai đoạn đầu đi cùng dấu hiệu sưng/phù. Kết quả nhắc ta không gọi mọi tăng kích thước sớm là phì đại; nó không cho phép tính phần phù của một người cụ thể hay nói rằng không có tăng cơ thật.',
      ],
      takeaways: ['Đọc cả mẫu, thời gian, chế độ và cách đo.', 'Khả năng sinh học không phải cam kết dịch vụ.'], sourceIds: ['longland-recomp-2016', 'damas-swelling-2016', 'ioc-reds-2023'],
    },
    {
      id: 'ch15-comparable-signals', title: 'Một bộ tín hiệu tối thiểu, không phải thu mọi dữ liệu', objectiveIds: ['ch15-monitor'],
      paragraphs: [
        'Bắt đầu bằng câu hỏi: kế hoạch có thực hiện được, chức năng có ổn, hay số đo có đáng so? Chọn dữ liệu phục vụ câu hỏi đó. Nếu người học đồng ý theo dõi cân hoặc vòng đo, ghi điều kiện và phương pháp; nếu dùng đầu ra tập, ghi cùng bài, kỹ thuật và bối cảnh. Không bắt buộc ảnh cơ thể hoặc thiết bị BIA.',
        'Đổi cân, thay cách đo, ăn/uống hoặc tập trước đo khác nhau có thể làm chuỗi khó so. Ghi dấu mốc đó; không nối mọi điểm thành một xu hướng mô chắc chắn. Độ phân giải hiển thị, độ lặp lại và độ đúng là những khái niệm khác nhau. Một nghiên cứu về cân thông minh cũng không định lượng sai số của mọi thiết bị.',
        'Mốc rà 4–8 tuần trong bài là lựa chọn tổ chức học tập của Aura, không phải thời gian tối thiểu bắt buộc để thay đổi mô hoặc để được giúp đỡ. Rà sớm hơn khi điều kiện đổi hoặc có dấu hiệu đáng lo. Khi đầu vào không đủ, kết luận tốt có thể là chưa biết, thay vì chỉnh lượng ăn cho khớp biểu đồ.',
      ],
      takeaways: ['Chỉ đo thứ cần cho một quyết định và có sự đồng ý.', 'Thiếu bằng chứng thay đổi không đồng nghĩa chứng minh không thay đổi.'], sourceIds: ['frija-masson-scales-2021', 'cochrane-interpretation', 'niddk-habits', 'nhs-eating-disorders'],
    },
    {
      id: 'ch15-review-portfolio', title: 'Rà quyết định và gom minh chứng, không chấm hình thể', objectiveIds: ['ch15-decision'],
      paragraphs: [
        'Đọc an toàn trước, rồi chất lượng dữ liệu, mức thực hiện, chức năng và mục tiêu. Cân không đổi nhưng thực hiện thuận lợi và không có dấu hiệu mới có thể dẫn tới giữ kế hoạch và tiếp tục quan sát, chưa phải xác nhận tăng cơ. Dữ liệu không so được cần làm rõ phương pháp trước khi sửa mức ăn.',
        'Nếu kế hoạch khó thực hiện, chọn một trở ngại cụ thể để sửa, chẳng hạn giờ mua bữa hoặc hỗ trợ chuẩn bị; không tự động cắt thêm hoặc tăng tập. Mệt kéo dài, chóng mặt, thay đổi kinh nguyệt, sụt cân không chủ ý hoặc lo âu quanh ăn uống cần được làm rõ với người phù hợp. Không chờ đủ block vì muốn có biểu đồ đẹp.',
        'Bài chương 15 là bản rà độc lập. Sau khi đã nộp thực hành 11–15, portfolio 15 mới ghép năm bản nộp cố định: timeline bữa tập, phục hồi, phân tích giảm mỡ, nguồn lực tăng cơ và bản rà recomp. Ghi phiên bản, điều đã sửa và điều chưa biết. Không yêu cầu portfolio được duyệt để nộp chính bài 15; đánh giá học tập không chứng nhận kết quả cơ thể.',
      ],
      takeaways: ['Có thể giữ, làm rõ, sửa hoặc tìm hỗ trợ; không chỉ có tăng/giảm calorie.', 'Portfolio nối lập luận và phiên bản, không gom ảnh để chứng minh thành tích.'], sourceIds: ['niddk-habits', 'ioc-reds-2023', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'ies-learning'],
    },
  ],
  workedExamples: [
    {
      id: 'ch15-components-example', title: 'Cân giữ nguyên, hai ngăn trong mô hình đổi', objectiveIds: ['ch15-tissues'],
      prompt: 'Hai báo cáo giả định cùng 70 kg, lần A 30% mỡ, lần B 28% mỡ. Chỉ luyện phép tính, chưa xác nhận độ đúng của báo cáo.',
      given: ['Cân A = cân B = 70 kg.', 'Mô hình hai ngăn, phần trăm là đầu vào giả định.', 'Không có phép đo riêng mô cơ.'],
      steps: ['A: khối mỡ = 70 × 0,30 = 21 kg; khối không mỡ = 49 kg.', 'B: khối mỡ = 70 × 0,28 = 19,6 kg; khối không mỡ = 50,4 kg.', 'Chênh theo mô hình: mỡ −1,4 kg, không mỡ +1,4 kg, cân tổng 0 kg.', 'Giữ chữ theo mô hình; không đổi +1,4 kg khối không mỡ thành +1,4 kg cơ thật.'],
      answer: 'Mô hình cho −1,4 kg mỡ và +1,4 kg không mỡ; chưa xác nhận thay đổi mô thật hoặc riêng cơ.',
      limitation: 'Nếu đầu vào phần trăm sai hoặc khác điều kiện, phép nhân không sửa được sai số đó.',
    },
    {
      id: 'ch15-sensitivity-example', title: 'Một giả định sai số không phải khoảng tin cậy', objectiveIds: ['ch15-monitor'],
      prompt: 'Để luyện độ nhạy, giữ cân 70 kg và giả định phần trăm mỡ đầu vào có thể là 28%, 30% hoặc 32%.',
      given: ['Ba giá trị do đề bài tự đặt, không phải độ chính xác đã kiểm định của máy.', 'Cùng 70 kg trong mọi kịch bản.', 'Không có phân phối xác suất hoặc số lần đo lặp.'],
      steps: ['70 × 0,28 = 19,6 kg; 70 × 0,30 = 21,0 kg; 70 × 0,32 = 22,4 kg.', 'Khoảng kịch bản từ 19,6 tới 22,4 kg; chênh hai đầu = 2,8 kg.', 'Đây là phân tích độ nhạy theo giả định, không phải khoảng tin cậy 95%.', 'Chưa có dữ liệu độ lặp lại thì không đặt ngưỡng khẳng định thay đổi thật từ khoảng này.'],
      answer: 'Ba ước tính là 19,6; 21,0; 22,4 kg mỡ, trải rộng 2,8 kg theo các kịch bản giả định.',
      limitation: 'Không gán sai số ±2 điểm phần trăm cho mọi cân, mọi người hoặc mọi phép đo.',
    },
    {
      id: 'ch15-review-example', title: 'Rà một hồ sơ sáu tuần mà không suy cơ từ mức tạ', objectiveIds: ['ch15-evidence', 'ch15-decision'],
      prompt: 'Ca giả định sau sáu tuần: cân trung bình gần như không đổi, cùng bài tập nâng từ 20 lên 22 kg; đổi thước và người đo eo giữa kỳ. Chưa báo dấu hiệu sức khỏe mới.',
      given: ['Đầu ra tập tăng 2 kg tải ngoài.', 'Chuỗi vòng eo có điểm thay phương pháp.', 'Không có dữ liệu mô cơ được xác nhận.'],
      steps: ['Tải ngoài tăng (22 − 20)/20 × 100 = 10%, không phải cơ tăng 10%.', 'Không dùng chuỗi eo bị đổi cách đo để khẳng định đã giảm mỡ.', 'Làm rõ kỹ thuật tập, trải nghiệm và điều kiện đo; có thể giữ kế hoạch đang dùng được thay vì siết thêm.', 'Ghi quyết định có điều kiện, mốc rà và đường tìm hỗ trợ nếu xuất hiện dấu hiệu mới.'],
      answer: 'Có tiến bộ 10% về tải ngoài trong dữ liệu, nhưng chưa đủ để kết luận tăng cơ đồng thời giảm mỡ.',
      limitation: 'Ca học tập thiếu nhiều dữ kiện; không phải chỉ định giữ hay sửa kế hoạch của người thật.',
    },
  ],
  cases: [
    { id: 'ch15-case-scale', title: 'Cân đứng nên muốn cắt thêm', context: 'Hà thực hiện bữa và tập thuận lợi nhưng thấy cân không giảm, cho rằng mọi nỗ lực vô ích.', question: 'Điều gì cần tách trước khi đổi lượng ăn?', reasoning: ['Mục tiêu hình thể khác một con số cân.', 'Cân đứng có nhiều cách giải thích, chưa chứng minh thành phần mô.', 'Rà dữ liệu và trải nghiệm trước thay đổi; không mặc định phải siết.'], safeNextStep: 'Nêu điều biết và chưa biết, trao đổi mục tiêu tự chọn và giữ hoặc làm rõ kế hoạch theo bối cảnh.', commonError: 'Gọi cân đứng là bằng chứng chắc chắn cần giảm calorie thêm.' },
    { id: 'ch15-case-photo', title: 'Không muốn gửi ảnh', context: 'Một học viên muốn dùng ca giả định và không chia sẻ ảnh cơ thể cho portfolio.', question: 'Có thể đánh giá năng lực mà không ép ảnh không?', reasoning: ['Năng lực là diễn giải dữ liệu và quyết định.', 'Ảnh không phải phép đo chính xác khối mỡ hoặc cơ.', 'Có thể dùng dữ liệu giả định và lập luận với nguồn rõ.'], safeNextStep: 'Chấp nhận minh chứng không ảnh, ghi rõ dữ liệu giả định và chấm theo rubric học tập.', commonError: 'Lấy việc gửi ảnh hoặc thay đổi hình thể làm điều kiện hoàn thành.' },
    { id: 'ch15-case-fatigue', title: 'Chờ đủ tám tuần dù có triệu chứng', context: 'Người học mệt kéo dài, chóng mặt và lo sợ bữa ngoài nhưng muốn hoàn tất block trước khi hỏi.', question: 'Mốc rà có được ưu tiên hơn dấu hiệu đáng lo không?', reasoning: ['Mốc bài học không là lịch chăm sóc.', 'Không có số đo hình thể nào xóa được triệu chứng.', 'Cần hỗ trợ phù hợp và không tự chẩn đoán nguyên nhân.'], safeNextStep: 'Tìm đánh giá phù hợp sớm; triệu chứng nặng cần chăm sóc ngay, không tiếp tục siết để hoàn thành bài.', commonError: 'Cho rằng phải chờ đủ 4–8 tuần mới được sửa hoặc tìm trợ giúp.' },
  ],
  practice: {
    title: 'Bản rà recomp và minh chứng portfolio 15', artifact: 'Một bản rà hồ sơ giả định, có dữ kiện, giới hạn và quyết định; không cần thay đổi hình thể thật.',
    steps: ['Chọn câu hỏi và quyền không dùng số đo cơ thể.', 'Phân loại cân, ước tính mô, hiệu suất và điều kiện đo.', 'Đọc một bằng chứng đúng phạm vi, nêu phần không thể suy rộng.', 'Đề xuất quyết định có điều kiện và phần portfolio nối sau khi đủ bản nộp.'],
    fields: [
      { id: 'context', label: 'Hồ sơ và mục tiêu', prompt: 'Ghi ca giả định, mục tiêu tự chọn và dữ liệu nào có hoặc không có sự đồng ý sử dụng.', required: true },
      { id: 'hypothesis', label: 'Cách giải thích cạnh tranh', prompt: 'Nêu ít nhất hai giải thích cho tín hiệu quan sát và dữ kiện còn thiếu để phân biệt chúng.', required: true },
      { id: 'action', label: 'Quyết định có điều kiện', prompt: 'Chọn giữ, làm rõ, sửa hoặc tìm hỗ trợ; viết lý do không dựa riêng một điểm cân.', required: true },
      { id: 'minimum', label: 'Phương án tối giản', prompt: 'Nêu cách vẫn rà được khi không có ảnh, BIA hoặc lịch đo dày, không tự bịa dữ liệu.', required: true },
      { id: 'data', label: 'Dữ kiện và phiên bản', prompt: 'Ghi tên đại lượng, cách đo, giới hạn và các bản nộp 11–14 sẽ nối với bản 15 này sau khi nộp.', required: true },
      { id: 'stop', label: 'Mốc rà và hỗ trợ', prompt: 'Ghi mốc tổ chức bài, dấu hiệu không chờ mốc đó và người phù hợp để tìm hỗ trợ.', required: true },
    ],
    modelResponse: ['Ca sáu tuần có tải ngoài +10%, chưa có phép đo cơ; chuỗi eo đổi cách đo nên không dùng để khẳng định giảm mỡ.', 'Tôi chọn làm rõ phương pháp và tính khả thi thay vì tự cắt thêm. Không cần ảnh để hoàn thành lập luận.', 'Bản rà có mốc xem lại, nhưng triệu chứng hoặc lo âu quanh ăn uống dẫn tới tìm hỗ trợ sớm hơn. Sau khi nộp bài 15 mới ghép đủ năm bản nộp cho portfolio.'],
    rubric: [
      { id: 'data', label: 'Đại lượng và dữ liệu', levels: ['Đổi ước tính hoặc cân thành kg cơ chắc chắn.', 'Giữ đúng tên nhưng thiếu điều kiện hoặc điểm đổi phương pháp.', 'Tên, đơn vị, điều kiện, dữ liệu thiếu và phiên bản đều rõ.'] },
      { id: 'mechanism', label: 'Lập luận về recomp', levels: ['Nói mỡ biến thành cơ hoặc sao nghiên cứu thành lời hứa.', 'Nêu giới hạn chung nhưng chưa nối vào hồ sơ.', 'Giải thích nhiều khả năng và giới hạn nghiên cứu đúng đối tượng.'] },
      { id: 'feasibility', label: 'Quyết định dùng được', levels: ['Chỉ siết thêm hoặc buộc mua thiết bị.', 'Có hướng đi nhưng thiếu điều kiện rà.', 'Có quyết định có điều kiện và phương án không ảnh/không thiết bị.'] },
      { id: 'safety', label: 'An toàn và tự nguyện', levels: ['Bắt chờ đủ block hoặc ép thay đổi hình thể.', 'Nhắc an toàn nhưng thiếu bước hỗ trợ.', 'Không chờ triệu chứng, không ép ảnh và tách hoàn thành học khỏi kết quả cơ thể.'] },
    ],
  },
  coachExtension: ['So sánh kết quả khối nạc, khối không mỡ và phép đo riêng cơ trước khi truyền thông tiến bộ.', 'Không dùng trung bình thử nghiệm để cam kết tốc độ recomp cho khách hàng.', 'Portfolio 15 phản ánh phiên bản lập luận, không tự tạo bằng chứng đã tăng cơ hoặc giảm mỡ.'],
  safety: ['Không sao giao thức nghiên cứu hạn chế năng lượng hoặc tập cường độ cao.', 'Không bắt buộc cân, ảnh, BIA hoặc thay đổi hình thể để đạt chương.', 'Dấu hiệu sức khỏe và quan hệ ăn uống xấu đi được ưu tiên hơn mốc rà.', 'Học viên có thể dùng ca giả định; coach không tự chẩn đoán từ dữ liệu này.'],
  referenceIds: ['frija-masson-scales-2021', 'longland-recomp-2016', 'damas-swelling-2016', 'ioc-reds-2023', 'cochrane-interpretation', 'niddk-habits', 'nhs-eating-disorders', 'nhs-unintentional-loss', 'ies-learning'],
}
