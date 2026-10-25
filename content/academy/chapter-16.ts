import type { AcademyLearningUnit } from './learning-unit'

export const chapter16Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 16, revision: '2026-10-24.1',
  title: 'Dinh dưỡng qua các giai đoạn sống phụ nữ: ưu tiên đúng và phối hợp chăm sóc',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Học viên trưởng thành tìm hiểu giai đoạn sống; PT/coach luyện hỗ trợ hậu cần và trao đổi đúng phạm vi.',
  scope: 'Dùng hồ sơ giả định để nhận diện ưu tiên, đọc nhãn và chuẩn bị trao đổi chăm sóc. Không tự kê calorie, thuốc, hormone hoặc liều bổ sung; không yêu cầu tiết lộ thai kỳ, chu kỳ hay thông tin sinh sản của người học.',
  prerequisites: [4, 6, 9, 10, 12],
  objectives: [
    { id: 'ch16-stage', outcome: 'Phân biệt ưu tiên theo tăng trưởng, chu kỳ, sinh sản, chuyển tiếp và tuổi cao.', evidence: 'Đặt câu hỏi phù hợp bối cảnh thay vì suy nhu cầu từ tuổi hoặc một nhãn hormone.' },
    { id: 'ch16-nutrients', outcome: 'Giải thích vai trò một số vi chất và đọc đúng đơn vị folate trên nhãn.', evidence: 'Không cộng DFE với folic acid như hai chất và không biến tham chiếu thành liều cá nhân.' },
    { id: 'ch16-coordination', outcome: 'Phân biệt hỗ trợ bữa ăn với vấn đề cần đánh giá và dấu hiệu khẩn cấp.', evidence: 'Chọn đúng bước phối hợp, không trì hoãn chăm sóc vì chờ lịch học hoặc coach.' },
    { id: 'ch16-privacy', outcome: 'Lập hộ chiếu giai đoạn sống tối thiểu và có quyền kiểm soát chia sẻ.', evidence: 'Chỉ ghi dữ liệu cần thiết, người nhận, câu hỏi và mốc cập nhật trên ca giả định.' },
  ],
  sections: [
    {
      id: 'ch16-life-map', title: 'Giai đoạn sống đổi câu hỏi, không tạo một thực đơn mặc định', objectiveIds: ['ch16-stage'],
      paragraphs: [
        'Tuổi không nói hết một người đang trải qua điều gì. Tăng trưởng, có kinh, chuẩn bị mang thai, thai kỳ, sau sinh, cho con bú, chuyển tiếp mãn kinh và tuổi cao có thể đổi ưu tiên. Không phải ai cũng trải qua mọi giai đoạn; chỉ hỏi thông tin liên quan và được đồng ý, không suy từ ngoại hình hoặc tên gọi.',
        'Ở tuổi vị thành niên, tăng trưởng và chăm sóc theo lứa tuổi là bối cảnh khác người trưởng thành. Chương này để người lớn hiểu giới hạn hỗ trợ, không đưa công thức giảm cân người lớn cho trẻ. Dữ liệu tham chiếu vi chất cũng phân theo tuổi và giai đoạn; một nhãn sản phẩm cho người lớn không xác định nhu cầu của thiếu niên.',
        'Với người trưởng thành, bắt đầu bằng nhiệm vụ hiện tại: có bữa dùng được, biết hướng dẫn chăm sóc đang có, ai hỗ trợ và khó khăn nào cần hỏi. Bệnh, thuốc, điều kiện ăn, ngân sách và trách nhiệm chăm sóc gia đình cùng quan trọng. Giai đoạn sống là bối cảnh để phối hợp, không phải chẩn đoán.',
      ],
      takeaways: ['Không coi mọi phụ nữ có cùng tiến trình sinh sản hoặc nhu cầu.', 'Không lấy kế hoạch người lớn áp cho vị thành niên.'], sourceIds: ['nih-dri', 'nih-iron', 'niddk-body-weight-planner', 'nice-shared-decisions'],
    },
    {
      id: 'ch16-cycle-context', title: 'Chu kỳ kinh: lắng nghe trải nghiệm, không lập bốn thực đơn cứng', objectiveIds: ['ch16-stage', 'ch16-coordination'],
      paragraphs: [
        'Biến đổi hormone qua chu kỳ không cho phép suy chính xác cảm giác, hiệu suất hay lượng ăn của từng người từ một ngày trên lịch. Nếu muốn ghi, có thể ghi ảnh hưởng đến ăn, ngủ và hoạt động ở mức cần thiết; không cần chia sẻ toàn bộ lịch chu kỳ cho coach để được học.',
        'Tổng quan McNulty năm 2020 về hiệu suất ở người có chu kỳ đều ghi nhận hiệu ứng trung bình nhỏ và bằng chứng chất lượng thấp, với khác biệt giữa nghiên cứu. Tác giả khuyến khích cách tiếp cận theo đáp ứng cá nhân. Đây không phải nghiên cứu thực đơn: không thể dùng nó để chứng minh bốn menu bắt buộc hoặc nói chu kỳ không bao giờ ảnh hưởng.',
        'Kinh nhiều, thay đổi đáng lo hoặc ảnh hưởng sinh hoạt cần trao đổi với người chăm sóc. Sắt liên quan tạo hemoglobin và vận chuyển oxy, nhưng mệt không tự xác định thiếu sắt; không tự uống liều điều trị từ triệu chứng. Hỗ trợ hợp lý có thể là ghi câu hỏi, sắp xếp bữa và giúp tiếp cận đánh giá, không gán mọi khó chịu cho hormone.',
      ],
      takeaways: ['Theo đáp ứng không đồng nghĩa tự chẩn đoán nội tiết.', 'Không kê sắt từ một chữ mệt hoặc một bảng chu kỳ.'], sourceIds: ['mcnulty-cycle-2020', 'nih-iron', 'nhs-heavy-periods'],
    },
    {
      id: 'ch16-folate-label', title: 'Trước thai: hiểu folate và đọc nhãn không đếm hai lần', objectiveIds: ['ch16-nutrients'],
      paragraphs: [
        'Folate là nhóm dạng vitamin B9; folic acid là một dạng dùng trong bổ sung và tăng cường thực phẩm. Folate tham gia tạo tế bào; folic acid có vai trò được xác lập trong phòng dị tật ống thần kinh trước và đầu thai kỳ. Vì quá trình này xảy ra sớm, việc chuẩn bị không chỉ bắt đầu sau khi bụng lớn.',
        'CDC nêu tham chiếu y tế công cộng 400 microgram folic acid mỗi ngày cho người có khả năng mang thai. Đây là khuyến cáo có phạm vi, không là quy tắc tự kê cho mọi tình huống. Tiền sử nguy cơ, bệnh hoặc thuốc có thể cần hướng dẫn khác; hỏi người chăm sóc trước sinh hoặc dược sĩ về sản phẩm và tổng dùng, không tự chọn liều cao hay ngừng thuốc.',
        'Trên một số nhãn Hoa Kỳ, folate được ghi bằng mcg DFE và số folic acid nằm trong ngoặc. DFE phản ánh tương đương theo khả dụng sinh học, không phải một thành phần thứ hai để cộng. Đọc khẩu phần, dạng chất và lượng của cùng chất qua các sản phẩm; không tự áp chuẩn nhãn này cho mọi nhãn Việt Nam hoặc quy đổi mọi dạng folate như nhau.',
      ],
      takeaways: ['DFE và folic acid có thể là hai cách mô tả cùng thành phần.', 'Chuẩn bị câu hỏi về tổng sản phẩm, không tự tăng liều.'], sourceIds: ['nih-folate', 'cdc-folic-acid', 'nhs-pregnancy-supplements', 'fda-nutrition-label'],
    },
    {
      id: 'ch16-pregnancy-postpartum', title: 'Thai kỳ và sau sinh: nguồn lực ăn uống đi cùng chăm sóc', objectiveIds: ['ch16-nutrients', 'ch16-coordination'],
      paragraphs: [
        'Trong thai kỳ, nhu cầu và dung nạp cần được xem cùng chăm sóc trước sinh. Folate, sắt và vitamin D có vai trò khác nhau; thêm nhiều sản phẩm không tự làm kế hoạch tốt hơn. Nguồn NHS lưu ý tránh bổ sung retinol không phù hợp; mang nhãn các sản phẩm đi rà với người chăm sóc, không tự phối nhiều loại hoặc dùng lịch bổ sung theo khí hậu Anh cho Việt Nam.',
        'Khi cho con bú, tổng năng lượng và một số vi chất như iodine, choline, B12 cần được chú ý theo tổng ăn và kiểu nuôi con. CDC khuyến khích bữa đa dạng, không mặc định phải loại hàng loạt thực phẩm. Người ăn chay hoặc có hạn chế riêng nên trao đổi để tránh khoảng thiếu; bài học không kê lượng bổ sung hoặc điều trị triệu chứng của em bé qua thay bữa của mẹ.',
        'Sau sinh cần cả người mua, chuẩn bị và giữ bữa an toàn, cơ hội nghỉ và đường liên hệ chăm sóc. Khó thở, đau ngực hoặc đau đầu nặng kéo dài là ví dụ dấu hiệu cần chăm sóc ngay trong thai kỳ và năm sau sinh theo CDC. Không coi đã qua sáu tuần là hết nguy cơ, không chờ đủ mọi triệu chứng hoặc cuộc hẹn coach; đây không phải danh sách đầy đủ.',
      ],
      takeaways: ['Hỗ trợ hậu cần bữa ăn không thay đánh giá y khoa.', 'Không gộp sau sinh và cho con bú thành cùng một công thức calorie.'], sourceIds: ['nhs-pregnancy-supplements', 'cdc-breastfeeding-diet', 'cdc-maternal-warning', 'food-safety-four-steps'],
    },
    {
      id: 'ch16-menopause-aging', title: 'Chuyển tiếp mãn kinh và tuổi cao: giữ chức năng, không chỉ đuổi theo cân', objectiveIds: ['ch16-stage', 'ch16-coordination'],
      paragraphs: [
        'Chuyển tiếp mãn kinh có thể ảnh hưởng giấc ngủ và trải nghiệm sinh hoạt; không vì vậy mà mọi triệu chứng đều do hormone hoặc một sản phẩm có thể giải quyết tất cả. Bữa cân đối, nguồn calcium, nghỉ ngơi và hoạt động phù hợp là phần hỗ trợ. Triệu chứng ảnh hưởng đời sống cần trao đổi về lựa chọn chăm sóc, không tự chọn hay dừng điều trị hormone.',
        'Sức khỏe xương và khả năng hoạt động là mục tiêu khác số cân. Nguồn NHS đề cập vận động chịu tải và kháng lực phù hợp, cùng thực phẩm cung cấp calcium; cần tính tới khả năng, bệnh và hướng dẫn riêng. Không bắt đầu tải nặng hoặc mua thảo dược chỉ vì được gọi là dành cho mãn kinh.',
        'Ở tuổi cao, bữa đủ đa dạng và nguồn protein trong ngày cần đi cùng khả năng mua, nấu, nhai, nuốt và sử dụng. NIA gợi ý hỗ trợ chuẩn bị thức ăn khi thao tác khó. Sụt cân không chủ ý hoặc khó ăn kéo dài cần đánh giá; không coi đó là thành quả giảm mỡ. Người có bệnh thận hoặc chỉ định dịch vẫn giữ kế hoạch chăm sóc riêng.',
      ],
      takeaways: ['Chăm sóc cơ, xương và sinh hoạt không thu gọn thành mục tiêu giảm cân.', 'Thay đổi bất thường cần được làm rõ, không gán hết cho tuổi.'], sourceIds: ['nhs-menopause-lifestyle', 'nia-older-meals', 'nhs-unintentional-loss', 'niddk-ckd-nutrition'],
    },
    {
      id: 'ch16-private-passport', title: 'Hộ chiếu giai đoạn sống là phiếu trao đổi, không phải hồ sơ bắt buộc công khai', objectiveIds: ['ch16-privacy'],
      paragraphs: [
        'Hộ chiếu của bài gồm: bối cảnh cần biết, ưu tiên do người học chọn, hướng dẫn chăm sóc đang có, một khó khăn hậu cần, câu hỏi chưa rõ và người nhận phù hợp. Dùng ca giả định cũng đạt mục tiêu. Không cần chép xét nghiệm, hình ảnh cơ thể, lịch sinh sản hoặc chi tiết nhạy cảm vào bài nộp nếu không cần cho lập luận.',
        'Phân quyền theo câu hỏi: coach hỗ trợ thói quen và bữa dùng được; bác sĩ và chuyên gia dinh dưỡng phù hợp đánh giá vấn đề chăm sóc; dược sĩ giúp rà thuốc và sản phẩm. Hỏi người học muốn chia sẻ gì với ai. Trong thảo luận, diễn đạt lại điều đã hiểu để kiểm tra cách giải thích, không xem một cái gật đầu là đã hiểu hết.',
        'Ghi ngày, nguồn và phiên bản để biết khi nào hộ chiếu cần sửa, chẳng hạn khi bối cảnh hoặc hướng dẫn chăm sóc thay đổi. Không giữ một checklist cũ như giấy chứng nhận an toàn vĩnh viễn. Dấu hiệu khẩn cấp dẫn tới chăm sóc ngay; hoàn thành bài hoặc được coach phản hồi không tạo quyền tự điều trị.',
      ],
      takeaways: ['Chỉ lưu thông tin cần cho mục đích học và được đồng ý.', 'Hộ chiếu hỗ trợ cuộc trao đổi, không thay người chăm sóc.'], sourceIds: ['nice-shared-decisions', 'cdc-maternal-warning', 'nih-supplements-consumer'],
    },
  ],
  workedExamples: [
    {
      id: 'ch16-folate-example', title: 'Hai cách ghi không phải hai phần bổ sung', objectiveIds: ['ch16-nutrients'],
      prompt: 'Nhãn giả định theo cách ghi Hoa Kỳ: mỗi viên “Folate 680 mcg DFE (400 mcg folic acid)”. Sản phẩm B ghi 200 mcg folic acid/viên. Chỉ kiểm kê nếu một người dự định dùng một viên mỗi loại.',
      given: ['A: 680 mcg DFE, trong ngoặc 400 mcg folic acid cho cùng khẩu phần.', 'B: 200 mcg folic acid/viên.', 'Chưa biết chỉ định, tổng thực phẩm hoặc thành phần khác.'],
      steps: ['Không cộng 680 + 400: hai đơn vị đang mô tả cùng thành phần của A.', 'Lượng folic acid từ hai sản phẩm theo đề là 400 + 200 = 600 mcg.', '600 mcg = 0,6 mg; chưa cộng folate từ thực phẩm hoặc đánh giá tổng DFE.', 'Ghi nhãn và tổng đã kiểm kê để hỏi người chăm sóc; không kết luận nên phối hoặc nên ngừng loại nào.'],
      answer: '600 mcg folic acid = 0,6 mg từ hai sản phẩm giả định, không phải 1.280 mcg; chưa phải liều được khuyến nghị.',
      limitation: 'Không chứng nhận phối hợp an toàn, không cộng khác đơn vị hoặc thay chỉ định trước sinh bằng bài toán.',
    },
    {
      id: 'ch16-support-example', title: 'Cùng bối cảnh sau sinh, câu hỏi hậu cần và khẩn cấp khác nhau', objectiveIds: ['ch16-stage', 'ch16-coordination'],
      prompt: 'Ca A sau sinh cần người chuẩn bị bữa trưa. Ca B đã sinh tám tuần, nay đau ngực và khó thở. Hai ca có cùng bước đầu không?',
      given: ['A chưa nêu dấu hiệu khẩn cấp, khó khăn là người chuẩn bị bữa.', 'B có dấu hiệu đáng lo ngay lúc hiện tại.', 'Không có chẩn đoán qua mô tả.'],
      steps: ['Với A, làm rõ bữa, điều kiện giữ an toàn và người có thể giúp theo kế hoạch chăm sóc.', 'Với B, tìm trợ giúp y tế khẩn cấp tại địa phương, không chờ coach hoặc tự quy cho thiếu ngủ.', 'Thông báo đang ở giai đoạn sau sinh cho đội ngũ tiếp nhận.', 'Không dùng mốc đã qua sáu tuần để loại trừ nguy cơ.'],
      answer: 'A cần phối hợp hậu cần; B cần chăm sóc khẩn cấp ngay, dù đã tám tuần sau sinh.',
      limitation: 'Đây là phân biệt ưu tiên, không chẩn đoán bệnh; nếu chưa chắc mức nghiêm trọng cần hỏi chăm sóc phù hợp, không tự trấn an.',
    },
    {
      id: 'ch16-passport-example', title: 'Hai người cùng tuổi, hai câu hỏi khác nhau', objectiveIds: ['ch16-stage', 'ch16-privacy'],
      prompt: 'Hai ca giả định cùng 50 tuổi: A muốn bữa tiện sau ca tối; B có triệu chứng ảnh hưởng giấc ngủ và đang dùng nhiều sản phẩm. Hãy chọn dữ liệu tối thiểu cho từng cuộc trao đổi.',
      given: ['Tuổi bằng nhau không xác định giai đoạn hoặc nguyên nhân triệu chứng.', 'A cần hậu cần; B cần rà triệu chứng và sản phẩm với người phù hợp.', 'Không có sự đồng ý chia sẻ dữ liệu sinh sản.'],
      steps: ['A: hỏi giờ, ngân sách, điều kiện cất bữa và ưu tiên được chọn.', 'B: chuẩn bị thời gian triệu chứng và danh sách sản phẩm để trao đổi riêng với người chăm sóc.', 'Không yêu cầu cả hai nộp lịch chu kỳ hoặc cùng thực đơn theo tuổi.', 'Ghi phần nào là giả định, người nhận và mốc sửa khi có hướng dẫn mới.'],
      answer: 'Chọn dữ liệu theo câu hỏi và sự đồng ý; không suy cùng nhu cầu chỉ vì cùng tuổi.',
      limitation: 'Không xác định mãn kinh hoặc chỉ định sản phẩm từ tuổi và vài dòng mô tả.',
    },
  ],
  cases: [
    { id: 'ch16-case-adolescent', title: 'Sao kế hoạch giảm mỡ người lớn cho thiếu niên', context: 'Một người lớn muốn cho em 15 tuổi dùng bảng calorie của mình vì hai người gần bằng chiều cao.', question: 'Vì sao chưa thể chuyển kế hoạch?', reasoning: ['Đang tăng trưởng là bối cảnh khác.', 'Cùng chiều cao không xác định nhu cầu hoặc chỉ định.', 'Bài này không phải công cụ kê ăn cho trẻ.'], safeNextStep: 'Không áp bảng người lớn; phối hợp người chăm sóc và chuyên môn phù hợp lứa tuổi nếu có lo ngại.', commonError: 'Coi gần bằng chiều cao là đủ điều kiện dùng cùng chế độ giảm cân.' },
    { id: 'ch16-case-period', title: 'Mệt và kinh nhiều nên tự tăng sắt', context: 'Người học có kinh ảnh hưởng sinh hoạt, mệt và định tự phối thêm sắt liều cao.', question: 'Coach nên giúp theo hướng nào?', reasoning: ['Triệu chứng không xác định nguyên nhân hoặc mức thiếu.', 'Cần đánh giá thay vì tự phối sản phẩm.', 'Có thể hỗ trợ chuẩn bị câu hỏi và thông tin tối thiểu.'], safeNextStep: 'Trao đổi chăm sóc phù hợp sớm, mang danh sách sản phẩm và triệu chứng; dấu hiệu nặng cần chăm sóc ngay.', commonError: 'Kết luận chắc chắn thiếu sắt rồi kê liều từ bảng học tập.' },
    { id: 'ch16-case-breastfeeding', title: 'Kiêng nhiều món để tự xử lý triệu chứng của bé', context: 'Người đang cho con bú muốn bỏ nhiều nhóm thức ăn vì lời khuyên trên mạng, chưa trao đổi với người chăm sóc mẹ và bé.', question: 'Vì sao cần phối hợp trước?', reasoning: ['Không mặc định mọi triệu chứng của bé do món mẹ ăn.', 'Kiêng rộng có thể làm bữa khó đủ và khó dùng.', 'Hướng dẫn cần xét mẹ, bé và dữ kiện thực tế.'], safeNextStep: 'Hỏi người chăm sóc phù hợp, giữ hướng dẫn đang có và không tự dùng chế độ loại trừ để chẩn đoán.', commonError: 'Dùng nhật ký vài bữa để kết luận dị ứng của bé và loại hàng loạt thực phẩm.' },
  ],
  practice: {
    title: 'Hộ chiếu giai đoạn sống — hồ sơ phối hợp giả định', artifact: 'Phiếu trao đổi tối thiểu, không phải thử chế độ ăn, chẩn đoán hoặc hồ sơ sinh sản bắt buộc của người học.',
    steps: ['Chọn một ca giả định và phân biệt bối cảnh với điều chưa biết.', 'Nêu ưu tiên dinh dưỡng và hậu cần, giữ hướng dẫn chăm sóc đang có.', 'Chuẩn bị một câu hỏi và dữ kiện cần cho đúng người nhận.', 'Ghi quyền chia sẻ, đường hỗ trợ và lúc cần cập nhật.'],
    fields: [
      { id: 'context', label: 'Bối cảnh tối thiểu', prompt: 'Ghi giai đoạn và điều cần biết của ca giả định; không suy chẩn đoán từ tuổi hoặc tên gọi.', required: true },
      { id: 'hypothesis', label: 'Ưu tiên và điều chưa rõ', prompt: 'Nêu ưu tiên có lý do và câu hỏi còn mở, không dùng triệu chứng để tự kết luận thiếu chất.', required: true },
      { id: 'action', label: 'Bước phối hợp', prompt: 'Chọn hỗ trợ hậu cần hoặc trao đổi chăm sóc phù hợp, không kê thuốc, calorie hay liều bổ sung.', required: true },
      { id: 'minimum', label: 'Hỗ trợ dùng được', prompt: 'Nêu người và phương án chuẩn bị bữa khả thi khi thiếu thời gian, ngân sách hoặc thông tin.', required: true },
      { id: 'data', label: 'Dữ liệu và quyền chia sẻ', prompt: 'Chọn thông tin cần cho câu hỏi, người nhận, sự đồng ý và phần nhạy cảm không cần ghi.', required: true },
      { id: 'stop', label: 'Điều kiện hỗ trợ ngay', prompt: 'Ghi dấu hiệu cần chăm sóc ngay, đường liên hệ địa phương và lúc cập nhật hộ chiếu.', required: true },
    ],
    modelResponse: ['Ca giả định sau sinh đang cần người lo bữa, không dùng mục tiêu giảm mỡ. Tôi hỏi kế hoạch chăm sóc và điều kiện giữ thức ăn, không hỏi chi tiết sinh sản ngoài mục đích.', 'Người thân phụ trách bữa trưa theo món phù hợp; câu hỏi về sản phẩm đưa cho người chăm sóc hoặc dược sĩ với nhãn và lượng dùng.', 'Đau ngực/khó thở cần trợ giúp khẩn cấp, không chờ lịch rà; chỉ chia sẻ nội dung đã đồng ý và cập nhật khi hướng dẫn đổi.'],
    rubric: [
      { id: 'data', label: 'Bối cảnh và quyền riêng tư', levels: ['Suy nhu cầu từ tuổi hoặc buộc lộ dữ liệu nhạy cảm.', 'Có bối cảnh nhưng chưa rõ dữ kiện thiếu và người nhận.', 'Có dữ kiện tối thiểu, điều chưa biết, sự đồng ý và phiên bản.'] },
      { id: 'mechanism', label: 'Giải thích đúng phạm vi', levels: ['Đếm trùng nhãn hoặc chẩn đoán từ hormone/triệu chứng.', 'Nêu ưu tiên nhưng chưa rõ đơn vị hoặc giới hạn.', 'Giải thích ưu tiên, đơn vị và giới hạn tham chiếu đúng bối cảnh.'] },
      { id: 'feasibility', label: 'Phối hợp thực tế', levels: ['Chỉ đưa thực đơn chung hoặc danh sách sản phẩm.', 'Có người hỗ trợ nhưng thiếu hành động cụ thể.', 'Có hậu cần bữa, câu hỏi và người phụ trách phù hợp.'] },
      { id: 'safety', label: 'Ranh giới chăm sóc', levels: ['Tự kê hoặc trì hoãn dấu hiệu khẩn cấp.', 'Nhắc hỏi chuyên môn nhưng thiếu bước khi có dấu hiệu.', 'Giữ chỉ định riêng, không tự thử điều trị và biết khi nào cần chăm sóc ngay.'] },
    ],
  },
  coachExtension: ['Dùng ngôn ngữ tôn trọng, không giả định lịch sinh sản hoặc mục tiêu hình thể.', 'Tách kiến thức về giai đoạn sống khỏi quyền chẩn đoán và kê bổ sung.', 'Khi hỏi dữ liệu nhạy cảm, giải thích mục đích và tôn trọng quyền dùng ca giả định.'],
  safety: ['Thai kỳ, sau sinh, vị thành niên và bệnh lý cần hướng dẫn theo bối cảnh, không dùng bài này kê chế độ.', 'Không tự ngừng thuốc, chọn hormone hoặc phối bổ sung liều cao.', 'Dấu hiệu khẩn cấp cần chăm sóc ngay tại địa phương, không chờ coach hay hoàn thành biểu mẫu.', 'Không bắt buộc khai chu kỳ, kế hoạch sinh sản, ảnh hoặc xét nghiệm để đạt bài.'],
  referenceIds: ['nih-dri', 'nih-iron', 'niddk-body-weight-planner', 'nice-shared-decisions', 'mcnulty-cycle-2020', 'nhs-heavy-periods', 'nih-folate', 'cdc-folic-acid', 'nhs-pregnancy-supplements', 'fda-nutrition-label', 'cdc-breastfeeding-diet', 'cdc-maternal-warning', 'food-safety-four-steps', 'nhs-menopause-lifestyle', 'nia-older-meals', 'nhs-unintentional-loss', 'niddk-ckd-nutrition', 'nih-supplements-consumer'],
}
