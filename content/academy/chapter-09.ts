import type { AcademyLearningUnit } from './learning-unit'

export const chapter09Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 9, revision: '2026-10-24.1',
  title: 'Xây thực đơn thực tế: từ nhu cầu đến lịch mua, nấu và dự phòng',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành tổ chức bữa ăn trong lịch sống thật; coach hỗ trợ lựa chọn, không kê thực đơn điều trị.',
  scope: 'Thiết kế một tuần có món thay thế, ngân sách giả định và điều kiện bảo quản. Không coi mẫu bữa là khẩu phần đủ cho mọi người hoặc thay hướng dẫn dị ứng và điều trị.',
  prerequisites: [1, 3, 4, 5, 8],
  objectives: [
    { id: 'ch09-constraints', outcome: 'Đưa lịch, nguồn lực, sở thích và điều kiện an toàn vào trước danh sách món.', evidence: 'Xác định được hai bữa khó tổ chức và tiêu chí phải giữ khi chọn phương án.' },
    { id: 'ch09-substitute', outcome: 'Thay món theo chức năng và dữ liệu, không coi cùng nhóm là tương đương tuyệt đối.', evidence: 'So sánh một lựa chọn theo lượng thực dùng rồi chỉ ra phần chưa tương đương.' },
    { id: 'ch09-logistics', outcome: 'Nối thực đơn với số suất, danh sách mua, chi phí và phương án ngày bận.', evidence: 'Lập lịch A/B/C có kiểm tra số suất và chi phí trên dữ liệu giả định.' },
    { id: 'ch09-food-safety', outcome: 'Lồng an toàn thực phẩm và dị ứng vào kế hoạch mua–nấu–mang đi.', evidence: 'Nhận ra một kế hoạch bảo quản không phù hợp và viết lại mà không cứu thực phẩm đã không an toàn.' },
  ],
  sections: [
    {
      id: 'ch09-real-week', title: 'Lịch của tuần đi trước tên món', objectiveIds: ['ch09-constraints'],
      paragraphs: [
        'Bắt đầu bằng số người ăn, các bữa cần tổ chức, thời gian có thể nấu, nơi mua và điều kiện giữ thực phẩm. Thêm sở thích, ngân sách cùng yêu cầu dị ứng hoặc chăm sóc đang có. Nếu chưa biết nơi làm có tủ lạnh hay không, đó là dữ liệu thiết kế còn thiếu, không phải chi tiết để tính sau.',
        'Một khung bữa có thể giúp xem đã nghĩ tới nguồn protein, nguồn carbohydrate, rau/quả và phần chất béo hay chưa. Nhưng khung này không tính đủ nhu cầu vi chất, lượng ăn hoặc phù hợp điều trị cho từng người. Chất lượng kế hoạch cần cả tính đa dạng, an toàn và khả năng thực hiện, không chỉ một hình đĩa đẹp.',
        'Chọn trước hai điểm khó: chẳng hạn trưa hôm họp và tối về muộn. Học viên không bắt buộc tự nấu mọi bữa hay điền kín cả tuần bằng món khác nhau. Một số lựa chọn lặp lại có giải thích, cùng phương án thay khi lịch đổi, thường làm bài dễ kiểm tra hơn danh sách dài không có cách dùng.',
      ],
      takeaways: ['Phải biết bữa này phục vụ ai, lúc nào và trong điều kiện nào.', 'Khung bữa là công cụ quan sát, không là toa khẩu phần phổ quát.'], sourceIds: ['who-healthy-diet-2026', 'niddk-habits'],
    },
    {
      id: 'ch09-role-swap', title: 'Viết rõ chức năng muốn giữ khi đổi món', objectiveIds: ['ch09-substitute'],
      paragraphs: [
        'Một món có thể được chọn vì đóng góp protein, dễ mang, giá hợp lý hoặc quen khẩu vị. Khi món không còn, hãy chọn tiêu chí nào phải giữ trước. Hai thực phẩm cùng nhóm không tự có cùng lượng dưỡng chất; so sánh cần đúng lượng ăn, trạng thái sống/chín và thông tin nhãn.',
        'Ví dụ giả định đổi nguồn protein A sang B: có thể tính lượng B cho cùng một giá trị protein nếu dữ liệu tương thích, nhưng phải ghi những thứ chưa so như năng lượng, thành phần khác, giá và dị ứng. Phép quy đổi chỉ giữ một tiêu chí, không chứng minh bữa ăn còn lại đã cân đối.',
        'Với mua ngoài, mô tả câu hỏi cho nơi bán về thành phần hoặc khả năng thay thế, không tự bảo đảm một món an toàn dị ứng từ tên gọi. Nếu không xác minh được điều kiện quan trọng, chọn phương án phù hợp khác. Không dùng việc ăn ngoài làm lý do bỏ cả kế hoạch hoặc phạt bù vào bữa sau.',
      ],
      takeaways: ['Tương đương ở một chỉ số không phải tương đương mọi mặt.', 'Điều kiện dị ứng hoặc điều trị được xét trước phép tính macro.'], sourceIds: ['fda-nutrition-label', 'who-healthy-diet-2026', 'nhs-food-allergy'],
    },
    {
      id: 'ch09-week-system', title: 'Ba cách phục vụ một nhu cầu: nấu, lắp ráp, mua sẵn', objectiveIds: ['ch09-logistics'],
      paragraphs: [
        'Phương án A có thể là nấu, B là lắp ráp từ thành phần phù hợp, C là mua sẵn có kiểm tra. Ba cách không cần giống hệt từng gram nhưng phải nêu tiêu chí còn giữ và điều cần xem lại. Bữa dự phòng giải quyết thay đổi lịch, không phải bữa trừng phạt khi ăn khác dự tính.',
        'Danh sách mua phải khớp số suất và phần đã có. Ghi rõ khối lượng mua hay khối lượng dùng sau chế biến, đơn giá giả định và chi phí nào chưa tính. Không gọi chi phí riêng một thành phần là giá của cả bữa. Đánh dấu món dễ hỏng để đặt thời điểm mua, chế biến và dùng phù hợp.',
        'Chuẩn bị trước có nhiều mức: lập danh sách, chia nguyên liệu hoặc nấu một phần. Chọn mức giải quyết nút thắt, không mặc định phải nấu sẵn bảy ngày. Cuối tuần, rà phương án nào dùng được, phần nào thừa và chỗ nào thiếu dữ liệu; chỉnh hệ thống tổ chức trước khi tự đổi mục tiêu dinh dưỡng.',
      ],
      takeaways: ['Số suất, chi phí và khả năng bảo quản phải đi cùng món.', 'Mỗi bữa khó cần một phương án dự phòng dùng được.'], sourceIds: ['niddk-habits', 'food-safety-cold-storage'],
    },
    {
      id: 'ch09-safe-storage', title: 'Kế hoạch còn phải an toàn từ bếp tới giờ ăn', objectiveIds: ['ch09-food-safety'],
      paragraphs: [
        'Giữ bốn việc: làm sạch, tách thực phẩm sống với đồ ăn sẵn, nấu đủ nhiệt theo loại thực phẩm và làm lạnh kịp. FoodSafety.gov hướng dẫn tủ lạnh ở 4°C hoặc thấp hơn; thực phẩm dễ hỏng không để ngoài lạnh quá 2 giờ, hoặc quá 1 giờ khi môi trường trên 32°C. Chia vào hộp nông để làm lạnh nhanh, không chờ cả nồi nguội lâu ngoài bàn.',
        'Bảng bảo quản của cùng cơ quan hướng dẫn thịt/gia cầm đã nấu còn lại thường 3–4 ngày trong tủ lạnh đúng nhiệt độ. Đây không là hạn chung cho mọi món hay bảo đảm nếu đã xử lý sai. Muốn chuẩn bị xa hơn cần kế hoạch đông lạnh phù hợp từ sớm hoặc nấu đợt khác; làm lạnh muộn không xóa thời gian để ngoài trước đó.',
        'Trong bài làm, ghi ai chuẩn bị, thời điểm, cách giữ lạnh hoặc nóng và cách hâm phù hợp hướng dẫn món. Đừng ghi chung “cất tủ lạnh” nếu phải mang đi nhiều giờ trước đó. Nếu không bảo đảm điều kiện, chọn bữa dự phòng phù hợp thay vì cố dùng món đã không còn an toàn để tránh lệch kế hoạch.',
      ],
      takeaways: ['Lịch nấu phải có cả lịch làm lạnh, mang đi và dùng.', 'Không coi cấp đông hoặc hâm lại là cách sửa mọi lỗi bảo quản trước đó.'], sourceIds: ['food-safety-four-steps', 'food-safety-cold-storage'],
    },
  ],
  workedExamples: [
    {
      id: 'ch09-protein-swap-example', title: 'Khớp một chỉ số, chưa khớp cả bữa', objectiveIds: ['ch09-substitute'],
      prompt: 'Hai thực phẩm giả định A và B đều có dữ liệu cho 100 g phần ăn được đã chế biến. Tính lượng B cho cùng protein với 120 g A.',
      given: ['A: 25 g protein/100 g; dự tính dùng 120 g.', 'B: 10 g protein/100 g; chưa đặt lượng dùng.', 'Tên A/B chỉ để luyện tính, không đại diện thực phẩm hay lượng ăn được khuyến nghị.'],
      steps: ['Protein từ A = 25 × 120 / 100 = 30 g.', 'Lượng B cho 30 g protein = 30 / 10 × 100 = 300 g.', 'Kiểm tra dữ liệu cùng trạng thái và cùng mẫu số.', 'Ghi rằng chỉ khớp protein, chưa khớp các dưỡng chất khác, giá hoặc khả năng dùng lượng đó.'],
      answer: '120 g A cung cấp 30 g protein; cần 300 g B theo dữ liệu giả định để khớp riêng chỉ số này.',
      limitation: 'Không khẳng định 300 g là khẩu phần phù hợp, không bỏ qua dị ứng hoặc yêu cầu chăm sóc cá nhân.',
    },
    {
      id: 'ch09-budget-example', title: 'Từ số suất đến chi phí có phạm vi', objectiveIds: ['ch09-constraints', 'ch09-logistics'],
      prompt: 'Hai người cần ba bữa trưa do nhà chuẩn bị. Mỗi suất của một thành phần X dùng 150 g khối lượng mua, giá giả định 80.000 đồng/kg.',
      given: ['Số suất: 2 người × 3 bữa.', 'X: 150 g khối lượng mua/suất, không đổi sang khối lượng chín trong đề.', 'Chưa tính các thành phần khác, gia vị, điện hoặc vận chuyển.'],
      steps: ['Cần 2 × 3 = 6 suất.', 'Lượng mua X = 6 × 150 = 900 g = 0,9 kg.', 'Chi phí X = 0,9 × 80.000 = 72.000 đồng; chia 6 là 12.000 đồng/suất.', 'Ghi đây chỉ là chi phí X và kiểm tra kế hoạch bảo quản cho các bữa tương ứng.'],
      answer: '6 suất cần 900 g X, chi phí giả định 72.000 đồng; 12.000 đồng/suất cho riêng X.',
      limitation: 'Không phải giá thị trường hiện tại hay giá đầy đủ cả bữa; không giả định mọi người cần lượng ăn giống nhau.',
    },
    {
      id: 'ch09-transport-example', title: 'Đúng món nhưng sai thời gian mang đi', objectiveIds: ['ch09-food-safety', 'ch09-logistics'],
      prompt: 'Ca giả định mang món dễ hỏng ra khỏi lạnh lúc 9:00, để ở 34°C không giữ lạnh và định ăn lúc 10:30.',
      given: ['Đã ở ngoài lạnh 90 phút.', 'Nhiệt độ môi trường 34°C, cao hơn 32°C.', 'Không có thiết bị giữ lạnh/nóng phù hợp trong khoảng đó.'],
      steps: ['Tính thời gian 9:00→10:30 là 90 phút.', 'Đối chiếu hướng dẫn ở trên 32°C: không quá 1 giờ.', '90 phút vượt 60 phút; không coi việc hâm lại hoặc ngửi thấy bình thường là đủ bảo đảm.', 'Không dùng món đó; cho lần sau thiết kế giữ nhiệt phù hợp hoặc chọn phương án mua gần giờ ăn.'],
      answer: 'Tình huống đã vượt giới hạn thời gian nêu trong hướng dẫn; chọn bữa dự phòng, không cố cứu bằng hâm lại.',
      limitation: 'Ví dụ không thay đánh giá mọi loại thực phẩm; còn phải tuân thủ nhãn, loại món và hướng dẫn an toàn phù hợp.',
    },
  ],
  cases: [
    { id: 'ch09-case-busy', title: 'Trưa họp không có chỗ hâm', context: 'Kế hoạch của Hạnh cần nấu và hâm ở công ty nhưng công ty không có dụng cụ hoặc chỗ giữ lạnh phù hợp.', question: 'Nút thắt nằm ở ý chí hay điều kiện của phương án?', reasoning: ['Kế hoạch chưa khớp điều kiện thực tế.', 'Cần lựa chọn dự phòng có điều kiện bảo quản và dùng phù hợp.', 'Không bắt Hạnh dùng món dễ hỏng mang lâu hoặc bỏ bữa để giữ thực đơn.'], safeNextStep: 'Viết phương án mua hoặc chuẩn bị phù hợp đã kiểm tra, rồi cập nhật danh sách mua và lịch.', commonError: 'Coi thiếu thiết bị là lỗi thực hiện của học viên thay vì lỗi thiết kế phương án.' },
    { id: 'ch09-case-allergy', title: 'Thay món nhưng quên thành phần', context: 'Một người có dị ứng được hướng dẫn riêng muốn đổi món vì số protein gần giống.', question: 'Phép tính nào không được vượt qua điều kiện an toàn?', reasoning: ['Protein gần giống không loại bỏ dị nguyên.', 'Cần thông tin thành phần và xử lý phù hợp, không chỉ tên món.', 'Nếu chưa xác minh được, không thử một ít để kiểm chứng.'], safeNextStep: 'Giữ kế hoạch dị ứng riêng, hỏi đúng người và chọn phương án có thông tin phù hợp.', commonError: 'Đồng nhất tương đương dinh dưỡng với an toàn dị ứng.' },
    { id: 'ch09-case-week-prep', title: 'Nấu thịt cho cả tuần rồi chỉ để ngăn mát', context: 'Một kế hoạch giả định nấu thịt chủ nhật, chia hộp và để ngăn mát dùng tới chủ nhật sau.', question: 'Vì sao cần sửa lịch chứ không chỉ thêm hộp?', reasoning: ['Hộp riêng không làm thời gian bảo quản vô hạn.', 'Hướng dẫn thịt/gia cầm chín còn lại trong tủ lạnh thường ngắn hơn cả tuần.', 'Phải thiết kế đợt nấu khác hoặc đông lạnh phù hợp từ sớm, không đợi món đã quá hạn mới chuyển ngăn.'], safeNextStep: 'Sửa kế hoạch trước khi chuẩn bị; kiểm tra nhiệt độ, ngày dùng và hướng dẫn từng món.', commonError: 'Cho rằng ngăn mát hoặc hộp kín tự bảo đảm mọi món dùng được bảy ngày.' },
  ],
  practice: {
    title: 'Một tuần có phương án A/B/C và lịch bảo quản', artifact: 'Lịch bữa, thư viện thay món và danh sách mua có chi phí giả định, kèm kiểm tra an toàn.',
    steps: ['Đánh dấu các bữa cần tổ chức và hai điểm khó trong tuần giả định.', 'Chọn phương án nấu/lắp ráp/mua cho các bữa đó, nêu tiêu chí muốn giữ.', 'Tính số suất, lượng mua và chi phí có phạm vi; chỉ quy đổi dưỡng chất khi dữ liệu tương thích.', 'Ghi lịch xử lý/bảo quản, phương án khi lịch đổi và ngày rà tính khả thi.'],
    fields: [
      { id: 'context', label: 'Tuần và nguồn lực', prompt: 'Có bao nhiêu người, bữa nào khó, ngân sách giả định, dụng cụ và điều kiện bảo quản nào?', required: true },
      { id: 'hypothesis', label: 'Khung bữa và thay món', prompt: 'Giữ chức năng gì khi thay món, dùng dữ liệu nào, phần nào chưa tương đương hoặc cần hỏi thêm?', required: true },
      { id: 'action', label: 'Lịch A/B/C và danh sách mua', prompt: 'Nêu phương án nấu/lắp ráp/mua cho bữa khó, số suất, lượng mua và các bước kiểm tra chi phí.', required: true },
      { id: 'minimum', label: 'Khi kế hoạch đổi', prompt: 'Chọn bữa dự phòng phù hợp điều kiện thật; tiêu chí nào vẫn giữ, điều gì phải xem lại?', required: true },
      { id: 'data', label: 'Theo dõi hệ thống', prompt: 'Ghi phương án đã dùng, món thừa, chi phí hoặc trở ngại; chọn ngày rà lại, không chấm bằng cân nặng.', required: true },
      { id: 'stop', label: 'Dị ứng và bảo quản', prompt: 'Nêu nhiệt độ/thời gian cần giữ, lịch nấu–cất–mang–dùng và cách xử lý khi không bảo đảm an toàn hoặc chưa rõ dị nguyên.', required: true },
    ],
    modelResponse: ['Tuần giả định có hai buổi họp; phương án A nấu chỉ dùng khi giữ lạnh/hâm phù hợp, C mua gần giờ ăn đã kiểm tra thành phần và yêu cầu riêng.', 'Hai người × ba bữa = sáu suất. Thành phần X 900 g khối lượng mua với giá giả định 80.000 đồng/kg là 72.000 đồng, chưa gồm cả bữa.', 'Không đặt thịt đã nấu trong ngăn mát dùng cả bảy ngày. Lập lịch nấu đợt khác hoặc đông lạnh phù hợp từ sớm; nếu món đã để sai điều kiện, dùng dự phòng chứ không cố cứu. Rà lịch vào cuối tuần.'],
    rubric: [
      { id: 'data', label: 'Số suất, đơn vị và chi phí', levels: ['Nhầm lượng mua/chín hoặc gọi một thành phần là giá cả bữa.', 'Tính được nhưng thiếu phạm vi hoặc nguồn dữ liệu giả định.', 'Số suất và đơn vị nhất quán, chi phí có phạm vi, nêu rõ dữ kiện thiếu.'] },
      { id: 'mechanism', label: 'Thay món có lý do', levels: ['Coi cùng nhóm là tương đương mọi mặt.', 'Có chức năng muốn giữ nhưng chưa nêu điểm khác.', 'Giải thích tiêu chí giữ, quy đổi đúng phần đủ dữ liệu và giới hạn tương đương.'] },
      { id: 'feasibility', label: 'Tuần dùng được', levels: ['Chỉ có danh sách món không khớp lịch.', 'Có lịch nhưng thiếu dự phòng hoặc danh sách mua.', 'Lịch, A/B/C, mua sắm và ngày rà khớp nguồn lực; xử lý được bữa khó.'] },
      { id: 'safety', label: 'Từ bếp tới giờ ăn', levels: ['Bỏ qua dị ứng, giữ nhiệt hoặc cứu món đã không an toàn.', 'Có nhắc an toàn nhưng thiếu lịch/thông tin cần kiểm tra.', 'Có kế hoạch xử lý/bảo quản phù hợp, giữ yêu cầu dị ứng và dùng dự phòng khi không bảo đảm.'] },
    ],
  },
  coachExtension: ['Hỏi điểm khó nhất trong tuần trước khi đưa thêm công thức nấu.', 'Chấm khả năng giải thích lựa chọn và hậu cần, không chấm mức đắt tiền hoặc độ giống ảnh mẫu.', 'Kiểm tra kế hoạch mang đi và bảo quản như phần bắt buộc của một thực đơn; không xác nhận dị ứng từ tên món.'],
  safety: ['Mẫu bữa không là thực đơn điều trị hoặc khẩu phần phù hợp mọi người.', 'Giữ kế hoạch dị ứng riêng; không tự ăn thử khi chưa rõ thành phần.', 'Không để an toàn thực phẩm phụ thuộc vào mùi, hình thức hoặc việc muốn tránh bỏ phí.', 'Khi không giữ được nhiệt độ/thời gian phù hợp, chọn phương án khác; làm lạnh muộn không xóa lỗi trước đó.'],
  referenceIds: ['who-healthy-diet-2026', 'niddk-habits', 'fda-nutrition-label', 'nhs-food-allergy', 'food-safety-four-steps', 'food-safety-cold-storage'],
}
