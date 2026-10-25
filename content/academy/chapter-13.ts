import type { AcademyLearningUnit } from './learning-unit'

export const chapter13Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 13, revision: '2026-10-24.1',
  title: 'Dinh dưỡng giảm mỡ: đọc mức thiếu hụt, giữ chức năng và biết khi dừng',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành tìm hiểu quản lý thành phần cơ thể; coach luyện hỗ trợ mục tiêu tự nguyện, không thúc ép giảm cân.',
  scope: 'Phân tích kế hoạch giả định và quyết định có căn cứ, không kê mức calorie hay tốc độ giảm cá nhân. Không dành để tự ép cân thi đấu, điều trị hoặc lập kế hoạch hạn chế ăn cho trẻ em, thai kỳ hay người có khó khăn ăn uống.',
  prerequisites: [7, 8, 9, 10, 11, 12],
  objectives: [
    { id: 'ch13-goal', outcome: 'Phân biệt giảm cân, giảm mỡ và mức phù hợp của một mục tiêu hình thể.', evidence: 'Viết mục tiêu tự nguyện có chỉ số chức năng, giới hạn và điều kiện không bắt đầu.' },
    { id: 'ch13-deficit', outcome: 'Tính phần thiếu hụt với giả định rõ, không dự báo tuyến tính số kilogram.', evidence: 'So hai kịch bản lượng ăn và tiêu hao, nói được phần chưa chắc của phép tính.' },
    { id: 'ch13-protection', outcome: 'Nối ăn uống, tập sức mạnh và phục hồi với mục tiêu giữ chức năng.', evidence: 'Đề xuất cách tổ chức bữa và hỗ trợ tập, không loại nhóm chất hoặc tăng cardio mặc định.' },
    { id: 'ch13-review', outcome: 'Đọc xu hướng có giới hạn và chọn giữ, làm rõ hoặc tìm hỗ trợ trước khi cắt thêm.', evidence: 'Tính trung bình đúng dữ liệu, nhận ra dấu hiệu phải ưu tiên chăm sóc hơn tiến độ hình thể.' },
  ],
  sections: [
    {
      id: 'ch13-goal-scope', title: 'Mục tiêu giảm mỡ phải có lý do và sự đồng thuận', objectiveIds: ['ch13-goal'],
      paragraphs: [
        'Giảm số trên cân chưa chứng minh giảm riêng mô mỡ: nước, lượng chứa trong cơ thể và các thành phần khác đều góp vào cân tổng. Không gọi mọi sụt cân là thành công. Trước một kế hoạch, hỏi người học có thật sự muốn mục tiêu đó, vì điều gì và có yêu cầu chăm sóc nào cần ưu tiên không.',
        'Một mục tiêu học tập có thể là hiểu dữ liệu và tổ chức bữa tốt hơn mà không giảm cân. Nếu chọn phân tích ca giảm mỡ, ghi cả khả năng sinh hoạt, tập luyện, trải nghiệm ăn uống và quyền đổi mục tiêu. Không dùng ảnh của người khác, lời thúc ép hoặc điểm số khóa học để bắt người học thay hình thể.',
        'Sụt cân không chủ ý, khó khăn ăn uống hoặc hoàn cảnh cần chăm sóc riêng không phải ca để tự thử hạn chế thêm. Hỏi chuyên môn phù hợp trước; triệu chứng đáng lo được xử lý theo mức khẩn cấp. Cân hoặc hình ảnh trông bình thường không đủ xác nhận một kế hoạch là an toàn.',
      ],
      takeaways: ['Cân tổng, mô mỡ và sức khỏe là các câu hỏi khác nhau.', 'Không cần giảm cân thật để hoàn thành chương này.'], sourceIds: ['frija-masson-scales-2021', 'nata-fluid-2017', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'ioc-reds-2023'],
    },
    {
      id: 'ch13-deficit-model', title: 'Thiếu hụt là một quan hệ năng lượng, không là lời hứa', objectiveIds: ['ch13-deficit'],
      paragraphs: [
        'Khi nói thiếu hụt, hãy định nghĩa rõ đang lấy tổng tiêu hao trừ lượng ăn trong cùng khoảng thời gian. Nhưng cả hai đầu vào thường là ước tính. Một phép trừ rất chính xác trên dữ liệu chưa chắc vẫn chỉ là mô hình; trước thay đổi cần biết nguồn, đơn vị và phần đang giả định.',
        'Giảm dự trữ năng lượng liên quan cân bằng tích lũy, trong khi mô hình cân nặng có thay đổi tiêu hao và thành phần theo thời gian. Không lấy một hệ số kcal/kg rồi nhân chia để hứa ngày đạt cân cụ thể. Cũng không lấy một tuần cân để suy ngược chính xác người học đã ăn bao nhiêu.',
        'Với ca học tập, thử thay một đầu vào trong khoảng giả định để thấy kết luận nhạy tới đâu. Khoảng tạo ra không phải khoảng tin cậy hoặc bảo đảm nhu cầu thật nằm trong đó. Kế hoạch thực tế cần mức thay đổi phù hợp bối cảnh, khả năng duy trì và theo dõi, không tự động chọn mức cắt lớn nhất để chắc thắng.',
      ],
      takeaways: ['Đúng số học không có nghĩa đúng nhu cầu.', 'Kiểm tra giả định trước khi tăng mức hạn chế ăn.'], sourceIds: ['hall-weight-dynamics-2011', 'nunes-adaptation-methods-2022', 'niddk-body-weight-planner'],
    },
    {
      id: 'ch13-preserve-function', title: 'Giữ khả năng ăn, tập và sống trong khi theo mục tiêu', objectiveIds: ['ch13-protection'],
      paragraphs: [
        'Chất lượng kế hoạch còn nằm ở việc hỗ trợ mô nạc và khả năng tập. Nghiên cứu Garthe năm 2011 so hai tốc độ giảm cân ở 24 vận động viên có tập sức mạnh cho thấy cần nhìn cả mô nạc và hiệu suất. Đây không phải bằng chứng cho một tốc độ tối ưu áp dụng mọi người; khối nạc cũng không đồng nghĩa riêng cơ.',
        'Tổ chức nguồn protein trong các bữa, giữ thực phẩm đa dạng và đủ điều kiện hỗ trợ tải tập thay vì cấm carbohydrate mặc định. Tập sức mạnh phù hợp là một phần của kế hoạch, nhưng lịch tập cần người có năng lực hướng dẫn. Không bù một bữa khác dự tính bằng buổi tập trừng phạt hoặc nhịn bữa sau.',
        'Thiết kế hai bữa neo dùng được vào ngày bận, một phương án mua ngoài và cách xử lý khi khó chuẩn bị. Viết trở ngại cụ thể như giờ họp hoặc thiếu tủ lạnh thay vì yêu cầu ý chí. Bữa linh hoạt vẫn giữ dị ứng, an toàn thực phẩm và yêu cầu chăm sóc; không cần gắn nhãn một ngày ăn là gian lận.',
      ],
      takeaways: ['Kết quả hình thể không được tách khỏi chức năng và trải nghiệm.', 'Tính bền vững đến từ cách tổ chức, không chỉ mức hạn chế trên giấy.'], sourceIds: ['garthe-loss-2011', 'nih-sport-supplements', 'who-healthy-diet-2026', 'niddk-habits', 'nhs-eating-disorders'],
    },
    {
      id: 'ch13-review-gates', title: 'Trước khi cắt thêm, kiểm tra điều gì đang thật sự xảy ra', objectiveIds: ['ch13-review'],
      paragraphs: [
        'Đọc xu hướng chỉ khi điều kiện, thời gian và cách chọn điểm cho phép so sánh. Nêu dữ liệu thiếu, đổi thiết bị hoặc thay lịch sinh hoạt; trung bình không xóa mọi sai số. “Chưa đủ bằng chứng thay đổi” là kết luận khác “chắc chắn đang chững” hoặc “chắc chắn vẫn giảm mỡ”.',
        'Nếu chưa có vấn đề an toàn, có thể cần giữ kế hoạch, làm rõ ghi chép hoặc sửa một trở ngại trước khi nghĩ tới lượng ăn. Một đoạn cân đứng không chứng minh chuyển hóa hỏng. Giai đoạn duy trì có thể là một lựa chọn theo hoàn cảnh, không là thủ thuật bảo đảm đặt lại chuyển hóa sau một số ngày cố định.',
        'Choáng, ngất, mệt kéo dài, giảm hiệu suất rõ, thay đổi kinh nguyệt hoặc lo âu ăn uống cần hỗ trợ phù hợp; không chờ đủ tuần để bảo vệ biểu đồ. Đừng tự chẩn đoán nguyên nhân. Khi việc theo dõi thúc đẩy hành vi có hại, dừng phần đó và chuyển sang minh chứng giả định để tiếp tục học.',
      ],
      takeaways: ['Không cắt thêm chỉ vì một điểm hoặc một đoạn ngắn đứng cân.', 'Ngày rà bài không phải thời hạn chờ tìm chăm sóc.'], sourceIds: ['cochrane-interpretation', 'hall-weight-dynamics-2011', 'ioc-reds-2023', 'nhs-eating-disorders'],
    },
  ],
  workedExamples: [
    {
      id: 'ch13-deficit-example', title: '300 kcal chỉ là kịch bản trung tâm', objectiveIds: ['ch13-deficit'],
      prompt: 'Mô hình giả định tiêu hao 2.400 kcal và ăn 2.100 kcal/ngày. Kiểm tra với tiêu hao 2.200–2.600 và ăn 2.000–2.200.',
      given: ['Các khoảng được đặt để luyện tính nhạy, không phải số đo hay khoảng tin cậy.', 'Định nghĩa thiếu hụt = tiêu hao − lượng ăn.', 'Không dự báo kilogram hoặc tốc độ từ phép tính.'],
      steps: ['Kịch bản trung tâm: 2.400 − 2.100 = 300 kcal/ngày.', 'Nhỏ nhất trong các tổ hợp đề cho: 2.200 − 2.200 = 0.', 'Lớn nhất: 2.600 − 2.000 = 600 kcal/ngày.', 'Khoảng 0–600 chỉ phản ánh các giả định; không bảo đảm mức thật ở trong hoặc cho phép cắt thêm.'],
      answer: '300 kcal/ngày ở kịch bản trung tâm; các tổ hợp giả định cho 0–600 kcal/ngày.',
      limitation: 'Không phải mục tiêu nên áp dụng, độ bất định đã đo hoặc lịch dự báo cân nặng cá nhân.',
    },
    {
      id: 'ch13-trend-example', title: 'Điểm cuối tăng, trung bình mẫu giảm', objectiveIds: ['ch13-goal', 'ch13-review'],
      prompt: 'Hai tập dữ liệu giả định có bảy điểm cân với điều kiện tương thích. So điểm cuối và trung bình, không gọi chúng là đo mỡ.',
      given: ['A: 70,6; 70,8; 70,4; 70,7; 70,5; 70,9; 70,3 kg.', 'B: 70,3; 70,5; 70,1; 70,4; 70,2; 70,0; 70,6 kg.', 'Không có dữ liệu thành phần cơ thể hoặc sức khỏe.'],
      steps: ['Tổng A = 494,2 kg; chia 7 được 70,6 kg.', 'Tổng B = 492,1 kg; chia 7 được 70,3 kg.', 'Điểm cuối B cao hơn A 0,3 kg nhưng trung bình B thấp hơn A 0,3 kg.', 'Mô tả đúng hai phép so; chưa xác nhận giảm mỡ hoặc một tốc độ sẽ tiếp diễn.'],
      answer: 'Trung bình mẫu giảm 0,3 kg dù điểm cuối tăng 0,3 kg; cả hai đều là thông tin về cân tổng.',
      limitation: 'Bảy điểm giả định không xác nhận thành phần mô, nhân quả hoặc mức an toàn của kế hoạch.',
    },
    {
      id: 'ch13-safety-example', title: 'Cân giảm nhưng bước tiếp không phải cắt nữa', objectiveIds: ['ch13-protection', 'ch13-review'],
      prompt: 'Ca giả định có xu hướng cân giảm, đồng thời choáng khi tập, bỏ bữa và sợ các bữa xã hội.',
      given: ['Chưa có đánh giá y tế hoặc nguyên nhân xác định.', 'Kế hoạch cũ đặt ngày rà vào tuần sau.', 'Mục tiêu bài là chọn ưu tiên, không kê cách điều trị.'],
      steps: ['Không dùng xu hướng cân để gắn nhãn thành công toàn diện.', 'Không chờ tuần sau hoặc tăng hạn chế để bám mục tiêu.', 'Dừng hoạt động khi choáng và tìm hỗ trợ phù hợp; tình trạng nặng/ngất cần trợ giúp khẩn cấp.', 'Chuyển câu hỏi cho chuyên môn, giữ minh chứng học bằng ca giả định nếu cân đo đang gây hại.'],
      answer: 'Ưu tiên an toàn và hỗ trợ thay cho tăng mức cắt ăn; chưa thể đặt tên nguyên nhân chỉ từ mô tả.',
      limitation: 'Không thay kế hoạch cấp cứu, điều trị hoặc quy trình trở lại tập của người phụ trách.',
    },
  ],
  cases: [
    { id: 'ch13-case-water', title: 'Mồ hôi và chiếc cân', context: 'Một người cân nhẹ hơn sau buổi nóng và muốn mặc thêm áo để giảm nhanh hơn.', question: 'Chênh cân tức thời đang bị diễn giải thành điều gì?', reasoning: ['Cân không tách được lượng mô mỡ.', 'Mất dịch không là bằng chứng giảm mỡ tương ứng.', 'Cố gây mất nước tạo rủi ro không phục vụ mục tiêu học.'], safeNextStep: 'Không dùng ép mất nước để theo mục tiêu; giữ kế hoạch an toàn và đọc dữ liệu đúng phạm vi.', commonError: 'Đổi kilogram sau một buổi ra kilogram mỡ hoặc coi nóng hơn luôn tốt hơn.' },
    { id: 'ch13-case-plateau', title: 'Ba ngày chưa đổi', context: 'Nhân vật thấy cân gần như đứng ba ngày và muốn giảm mạnh cả bữa lẫn tăng cardio.', question: 'Trước quyết định đó còn thiếu điều gì?', reasoning: ['Chưa biết thời gian, điều kiện và độ đầy đủ có đáp ứng câu hỏi không.', 'Không thể đo cơ chế chuyển hóa riêng bằng ba điểm.', 'Sửa nhiều thứ cùng lúc còn làm khó đọc điều đã thay đổi.'], safeNextStep: 'Rà dữ liệu, trải nghiệm và tính khả thi, không tự cắt mạnh từ một đoạn ngắn.', commonError: 'Gọi mọi cân đứng là thất bại chắc chắn và tăng mức can thiệp để bù.' },
    { id: 'ch13-case-pressure', title: 'Giảm cân để được điểm cao', context: 'Học viên không muốn giảm cân nhưng nghĩ phải có ảnh trước–sau mới đạt bài.', question: 'Minh chứng học tập phù hợp là gì?', reasoning: ['Mục tiêu hình thể cần sự tự nguyện.', 'Năng lực đọc dữ liệu có thể chứng minh bằng ca giả định.', 'Ảnh hoặc mức cân giảm không thay chất lượng lập luận.'], safeNextStep: 'Nộp phân tích giả định có nguồn và giới hạn; không yêu cầu ảnh cơ thể hoặc thay cân để được chấm.', commonError: 'Dùng tiêu chí khóa học để thúc ép giảm cân hoặc chia sẻ dữ liệu nhạy cảm.' },
  ],
  practice: {
    title: 'Bản phân tích giảm mỡ có cổng an toàn', artifact: 'Một quyết định trên ca giả định, có mô hình thiếu hụt, dữ liệu xu hướng và điều kiện giữ/sửa/dừng.',
    steps: ['Nêu mục tiêu tự nguyện, phạm vi và lý do ca có thể hoặc chưa nên theo kế hoạch.', 'Tính mô hình với giả định rõ; không hứa ngày đạt số cân.', 'Thiết kế bữa neo và hỗ trợ tập/phục hồi có tính khả thi.', 'Rà dữ liệu cùng trải nghiệm, chọn một quyết định và điều kiện tìm hỗ trợ.'],
    fields: [
      { id: 'context', label: 'Mục tiêu và phạm vi', prompt: 'Mô tả ca giả định, mục tiêu tự nguyện, chỉ số chức năng và điều kiện không bắt đầu hạn chế ăn.', required: true },
      { id: 'hypothesis', label: 'Mô hình và bất định', prompt: 'Giải thích phần thiếu hụt đang tính, nguồn đầu vào và vì sao chưa đổi được thành lời hứa kilogram.', required: true },
      { id: 'action', label: 'Bảo vệ khả năng thực hiện', prompt: 'Nêu bữa neo, phương án ngày bận và cách phối hợp tập/phục hồi; không tự kê mức ăn hoặc tập bù phạt.', required: true },
      { id: 'minimum', label: 'Ngày khó tổ chức', prompt: 'Khi có họp hoặc ăn ngoài, giữ điều gì quan trọng và chọn phương án nào không kéo theo nhịn bù?', required: true },
      { id: 'data', label: 'Xu hướng và quyết định', prompt: 'Tính hoặc đọc dữ liệu giả định, nêu số điểm, giới hạn, quyết định có lý do và ngày rà bài.', required: true },
      { id: 'stop', label: 'Ưu tiên sức khỏe', prompt: 'Nêu dấu hiệu cần dừng hạn chế/tập, tìm hỗ trợ và thay dữ liệu thật bằng ca giả định khi theo dõi gây hại.', required: true },
    ],
    modelResponse: ['Mục tiêu của ca là hiểu kế hoạch, không ép một người giảm cân. Cân tổng không chứng minh mô mỡ thay đổi.', 'Mô hình trung tâm thiếu hụt 300 kcal/ngày nhưng tổ hợp đề cho là 0–600; không xem đó là khoảng tin cậy hay tốc độ.', 'Tổ chức bữa neo và ngày bận, rà trải nghiệm cùng dữ liệu. Nếu có choáng hoặc hành vi ăn uống có hại, ưu tiên hỗ trợ chứ không chờ ngày rà hay cắt thêm.'],
    rubric: [
      { id: 'data', label: 'Dữ liệu có phạm vi', levels: ['Gọi chênh cân là mỡ hoặc xem khoảng giả định như đo chính xác.', 'Tính đúng nhưng chưa ghi nguồn, thời gian hoặc giới hạn.', 'Giữ đúng chỉ số, mẫu số, giả định và điều chưa thể kết luận.'] },
      { id: 'mechanism', label: 'Không ngoại suy tuyến tính', levels: ['Hứa ngày đạt cân hoặc quy mọi chững cho chuyển hóa hỏng.', 'Nêu thiếu hụt nhưng chưa giải thích biến động và giới hạn.', 'Giải thích mô hình động, chức năng và giới hạn suy từ cân tổng.'] },
      { id: 'feasibility', label: 'Hỗ trợ thay vì bù phạt', levels: ['Chỉ tăng hạn chế, cấm món hoặc tập bù.', 'Có bữa neo nhưng chưa xử lý trở ngại và lịch rà.', 'Có bữa neo, dự phòng, phối hợp tập và quyết định rà lại vừa sức.'] },
      { id: 'safety', label: 'Tự nguyện và điều kiện dừng', levels: ['Ép mục tiêu, mất nước hoặc trì hoãn hỗ trợ khi có dấu hiệu đáng lo.', 'Có nhắc an toàn nhưng chưa rõ hành động.', 'Giữ sự tự nguyện, nhận ra khi cần hỗ trợ và không dùng điểm học thúc ép hình thể.'] },
    ],
  },
  coachExtension: ['Không chuyển tốc độ của một nghiên cứu vận động viên thành tiêu chuẩn cho mọi học viên.', 'Khi dữ liệu và trải nghiệm không cùng tốt lên, giải thích ưu tiên và giới hạn trước khi nói tới lượng ăn.', 'Duy trì hoặc đổi mục tiêu có thể là quyết định hợp lý; không đặt giá trị con người vào con số cân.'],
  safety: ['Không yêu cầu giảm cân thật, ảnh cơ thể hoặc ép cân để đạt bài.', 'Không tự hạn chế ăn trong hoàn cảnh cần chăm sóc riêng hoặc sụt cân không chủ ý.', 'Không nhịn bù, tập trừng phạt hay gây mất nước để tăng tốc.', 'Choáng, ngất hoặc dấu hiệu đáng lo ưu tiên hỗ trợ, không đợi ngày rà bài.'],
  referenceIds: ['frija-masson-scales-2021', 'nata-fluid-2017', 'nhs-unintentional-loss', 'nhs-eating-disorders', 'ioc-reds-2023', 'hall-weight-dynamics-2011', 'nunes-adaptation-methods-2022', 'niddk-body-weight-planner', 'garthe-loss-2011', 'nih-sport-supplements', 'who-healthy-diet-2026', 'niddk-habits', 'cochrane-interpretation'],
}
