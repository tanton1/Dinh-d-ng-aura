import type { AcademyLessonMemory, CourseLessonDraft, CourseModuleDraft } from '../types'

type QuizQuestion = {
  question: string
  options: [string, string, string]
  correctIndex: number
}

type CurriculumChapter = {
  number: number
  title: string
  promise: string
  minutes: number
  objectives: [string, string, string]
  takeaways: [string, string, string]
  glossary: Array<[string, string]>
  practiceTitle: string
  practiceSteps: [string, string, string]
  practiceResult: string
  safety: string
  quiz: [QuizQuestion, QuizQuestion, QuizQuestion]
}

export type AuraNutritionPhase = {
  id: string
  title: string
  range: string
  description: string
}

export const auraNutritionPhases: AuraNutritionPhase[] = [
  { id: 'foundation', title: 'Hiểu nền tảng', range: 'Chương 1–5', description: 'Đọc cơ thể, năng lượng, dưỡng chất và tiêu hóa bằng ngôn ngữ đúng.' },
  { id: 'personalize', title: 'Cá nhân hóa', range: 'Chương 6–10', description: 'Biến công thức và phép đo thành giả thuyết có thể kiểm chứng.' },
  { id: 'performance', title: 'Ăn cho mục tiêu', range: 'Chương 11–15', description: 'Thiết kế dinh dưỡng quanh tập luyện, phục hồi và hình thể.' },
  { id: 'mastery', title: 'Tự chủ bền vững', range: 'Chương 16–20', description: 'Ra quyết định an toàn qua từng giai đoạn sống và bối cảnh sức khỏe.' },
]

const chapters: CurriculumChapter[] = [
  {
    number: 1,
    title: 'Khởi đầu đúng',
    promise: 'Tách dinh dưỡng khỏi ăn kiêng và xây một cách quan sát cơ thể không phán xét.',
    minutes: 28,
    objectives: [
      'Phân biệt dinh dưỡng, thực phẩm, chất dinh dưỡng, chế độ ăn và ăn kiêng.',
      'Dùng La bàn AURA: Đủ – Cân đối – Điều độ – Đa dạng – An toàn.',
      'Tìm một điểm gãy trong ngày sống thật và chọn một thử nghiệm bảy ngày.',
    ],
    takeaways: [
      'Một lần lệch là dữ liệu về đói, bối cảnh và ma sát, không phải bằng chứng thiếu ý chí.',
      'Mẫu hình theo thời gian có ý nghĩa hơn việc gắn nhãn tốt – xấu cho một món ăn.',
      'Khởi đầu đúng là chọn thay đổi nhỏ, có dữ liệu theo dõi và ngày rà cụ thể.',
    ],
    glossary: [
      ['Mẫu hình ăn uống', 'Cách lượng ăn, tần suất và bối cảnh lặp lại theo thời gian.'],
      ['Ma sát', 'Yếu tố trong môi trường hoặc lịch sống làm hành vi mong muốn khó xảy ra hơn.'],
      ['La bàn AURA', 'Năm câu hỏi về đủ, cân đối, điều độ, đa dạng và an toàn.'],
    ],
    practiceTitle: 'Bản chụp dinh dưỡng 10 phút',
    practiceSteps: [
      'Ghi lại một ngày ăn thật gồm giờ ăn, mức đói, giấc ngủ và bối cảnh.',
      'Khoanh một điểm gãy thường lặp lại nhưng chưa vội sửa toàn bộ ngày.',
      'Chọn một hành vi tối thiểu, một tín hiệu theo dõi và ngày rà sau bảy ngày.',
    ],
    practiceResult: 'Một bản đồ khởi đầu gồm 1 điểm gãy, 1 hành vi tối thiểu, 1 dữ liệu và 1 ngày rà.',
    safety: 'Sụt cân không chủ ý, ngất, nôn chủ động, dấu hiệu rối loạn ăn uống hoặc triệu chứng bất thường cần được chuyển đến chuyên môn phù hợp.',
    quiz: [
      { question: 'Điều gì nên được dùng để đánh giá một cách ăn?', options: ['Một món ăn riêng lẻ', 'Mẫu hình và bối cảnh theo thời gian', 'Mức độ nghiêm khắc'], correctIndex: 1 },
      { question: 'La bàn AURA không bao gồm yếu tố nào?', options: ['An toàn', 'Đa dạng', 'Hoàn hảo'], correctIndex: 2 },
      { question: 'Sau một lần lệch kế hoạch, bước phù hợp nhất là gì?', options: ['Nhịn bù', 'Quan sát điểm gãy và thử một thay đổi nhỏ', 'Đổi toàn bộ thực đơn'], correctIndex: 1 },
    ],
  },
  {
    number: 2,
    title: 'Cơ thể sử dụng năng lượng',
    promise: 'Hiểu calorie, ATP và ngân sách tiêu hao 24 giờ trước khi dùng công thức.',
    minutes: 31,
    objectives: [
      'Giải thích calorie là đơn vị đo năng lượng và ATP là dạng năng lượng tế bào sử dụng.',
      'Phân biệt BMR/RMR, TEF, NEAT, năng lượng tập luyện và TDEE.',
      'Đọc cân bằng năng lượng như một hệ thống động theo xu hướng dài hạn.',
    ],
    takeaways: [
      'Năng lượng nghỉ thường là phần lớn nhất của tổng tiêu hao nhưng NEAT có thể biến động mạnh.',
      'Công thức, máy tập và thiết bị đeo đều cho ước tính cần được kiểm chứng.',
      'Cân bằng năng lượng đúng về nguyên lý nhưng các đầu vào và phản hồi thay đổi theo thời gian.',
    ],
    glossary: [
      ['TDEE', 'Tổng năng lượng cơ thể tiêu hao trong một ngày.'],
      ['NEAT', 'Năng lượng cho hoạt động không phải tập luyện có chủ đích.'],
      ['TEF', 'Năng lượng dùng để tiêu hóa, hấp thu và xử lý thực phẩm.'],
    ],
    practiceTitle: 'Bản đồ ngân sách năng lượng 24 giờ',
    practiceSteps: [
      'Vẽ một ngày từ lúc thức dậy đến khi ngủ và đánh dấu các khoảng vận động.',
      'Phân loại từng hoạt động vào nghỉ, NEAT, tập luyện hoặc tiêu hóa.',
      'Chọn một khoảng ít vận động có thể thay đổi mà chưa cần gán calories.',
    ],
    practiceResult: 'Một bản đồ cho thấy năng lượng nghỉ, TEF, NEAT và tập luyện cùng tồn tại trong ngày.',
    safety: 'Mệt kéo dài, sụt cân không chủ ý hoặc dấu hiệu sức khỏe bất thường không nên được tự gắn nhãn “trao đổi chất chậm”.',
    quiz: [
      { question: 'NEAT mô tả điều gì?', options: ['Chuyển hóa khi nghỉ', 'Vận động ngoài buổi tập', 'Năng lượng trong protein'], correctIndex: 1 },
      { question: 'Số calories từ đồng hồ thông minh nên được hiểu là gì?', options: ['Con số chính xác', 'Ước tính cần đối chiếu', 'Mức phải ăn bù'], correctIndex: 1 },
      { question: 'Cân bằng năng lượng nên được đọc ở khung thời gian nào?', options: ['Một bữa', 'Một ngày duy nhất', 'Xu hướng đủ dài'], correctIndex: 2 },
    ],
  },
  {
    number: 3,
    title: 'Protein, carbohydrate và chất béo',
    promise: 'Đưa ba chất đa lượng trở lại đúng vai thay vì biến chúng thành ba phe đối đầu.',
    minutes: 36,
    objectives: [
      'Nhớ giá trị năng lượng gần đúng: protein 4, carbohydrate 4 và chất béo 9 kcal mỗi gram.',
      'Hiểu vai trò của amino acid, glucose, glycogen, chất xơ và acid béo thiết yếu.',
      'Đọc một bữa ăn bằng chức năng và bối cảnh thay vì phán xét tốt – xấu.',
    ],
    takeaways: [
      'Protein còn tham gia enzyme, vận chuyển, miễn dịch, sửa chữa và thích nghi.',
      'Đường, tinh bột và chất xơ đều là carbohydrate nhưng nằm trong các gói thực phẩm khác nhau.',
      'Chất lượng nguồn, lượng ăn và chất được dùng thay thế đều quan trọng với chất béo.',
    ],
    glossary: [
      ['Amino acid thiết yếu', 'Amino acid cơ thể không tự tổng hợp đủ và cần nhận từ chế độ ăn.'],
      ['Glycogen', 'Dạng dự trữ carbohydrate chủ yếu ở gan và cơ.'],
      ['Chất béo trans', 'Dạng chất béo cần hạn chế, đặc biệt từ quá trình hydro hóa một phần.'],
    ],
    practiceTitle: 'Soi bữa ăn bằng bốn câu hỏi',
    practiceSteps: [
      'Xác định nguồn protein trong bữa và xem lượng có phù hợp bối cảnh hay không.',
      'Tìm nguồn carbohydrate/chất xơ, rau quả và chất béo thay vì chỉ đếm một chất.',
      'Đặt bữa ăn vào mục tiêu, thời điểm tập, sở thích và cả ngày ăn.',
    ],
    practiceResult: 'Một bản mô tả trung tính về chức năng của bữa ăn và một điều chỉnh hợp lý nếu cần.',
    safety: 'Không dùng một tỷ lệ macro duy nhất cho người có bệnh lý, thai kỳ hoặc nhu cầu dinh dưỡng điều trị.',
    quiz: [
      { question: 'Một gram chất béo cung cấp gần đúng bao nhiêu kcal?', options: ['4 kcal', '7 kcal', '9 kcal'], correctIndex: 2 },
      { question: 'Glycogen được dự trữ chủ yếu ở đâu?', options: ['Gan và cơ', 'Xương và da', 'Dạ dày'], correctIndex: 0 },
      { question: 'Cách đọc bữa ăn phù hợp nhất là gì?', options: ['Loại bỏ mọi chất béo', 'Xem nguồn, lượng và bối cảnh', 'Chỉ nhìn lượng đường'], correctIndex: 1 },
    ],
  },
  {
    number: 4,
    title: 'Vitamin, khoáng chất và nước',
    promise: 'Quan sát vi chất, nước và viên bổ sung bằng một quy trình có bối cảnh và an toàn.',
    minutes: 38,
    objectives: [
      'Phân biệt vitamin, khoáng chất và các mức tham chiếu EAR, RDA, AI, UL.',
      'Hiểu vai trò của sắt, canxi, vitamin D, folate, B12, i-ốt và điện giải.',
      'Xây nhịp uống nước dựa trên điều kiện thực tế thay vì một con số cố định.',
    ],
    takeaways: [
      'Vi chất không cung cấp calories nhưng tham gia nhiều hệ thống sống còn.',
      'Nhu cầu nước thay đổi theo cơ thể, thức ăn, môi trường, mồ hôi, bệnh lý và thuốc.',
      'Thực phẩm là nền; bổ sung chỉ hữu ích khi đúng người, đúng chất, đúng liều và đúng theo dõi.',
    ],
    glossary: [
      ['RDA', 'Mức khuyến nghị đáp ứng nhu cầu của phần lớn người khỏe mạnh trong một nhóm.'],
      ['UL', 'Ngưỡng dung nạp tối đa; không phải mục tiêu nên cố đạt.'],
      ['Điện giải', 'Khoáng chất mang điện như natri và kali tham gia cân bằng dịch và hoạt động thần kinh cơ.'],
    ],
    practiceTitle: 'Rà soát bảy ngày về vi chất và nước',
    practiceSteps: [
      'Đánh dấu độ đa dạng của rau, quả, đạm, sữa hoặc nguồn thay thế trong tuần.',
      'Ghi nhịp uống, thời tiết, buổi tập và tín hiệu khát thay vì ép một chỉ tiêu cứng.',
      'Lập danh sách mọi viên bổ sung đang dùng, liều và lý do sử dụng.',
    ],
    practiceResult: 'Một bản rà soát giúp chọn đúng một khoảng trống cần cải thiện hoặc câu hỏi cần mang đến chuyên môn.',
    safety: 'Không tự dùng liều cao, chồng nhiều sản phẩm hoặc suy nguyên nhân từ triệu chứng mơ hồ; dấu hiệu cấp tính cần được đánh giá y khoa.',
    quiz: [
      { question: 'UL được hiểu đúng là gì?', options: ['Mục tiêu tối ưu', 'Ngưỡng dung nạp tối đa', 'Nhu cầu tối thiểu'], correctIndex: 1 },
      { question: 'Nhu cầu nước có giống nhau mỗi ngày không?', options: ['Có, luôn cố định', 'Không, thay đổi theo bối cảnh', 'Chỉ phụ thuộc cân nặng'], correctIndex: 1 },
      { question: 'Vai trò phù hợp của viên bổ sung là gì?', options: ['Thay thế toàn bộ bữa ăn', 'Lấp khoảng trống xác định khi phù hợp', 'Điều trị mọi triệu chứng'], correctIndex: 1 },
    ],
  },
  {
    number: 5,
    title: 'Tiêu hóa và hấp thu',
    promise: 'Kể đúng hành trình của bữa ăn và biến triệu chứng mơ hồ thành dữ liệu có cấu trúc.',
    minutes: 40,
    objectives: [
      'Phân biệt tiêu hóa, hấp thu, vận chuyển, chuyển hóa và thải bỏ.',
      'Mô tả vai trò của miệng, dạ dày, ruột, gan, mật và tuyến tụy.',
      'Phân biệt khó tiêu, không dung nạp, dị ứng và kém hấp thu.',
    ],
    takeaways: [
      'Ăn vào không đồng nghĩa hấp thu hết; hấp thu cũng không đồng nghĩa được dùng ngay.',
      'Ruột non là nơi hấp thu phần lớn dưỡng chất, còn ruột già xử lý nước và phần chất xơ còn lại.',
      'Đầy hơi không tự động chứng minh “độc tố”, “rò rỉ ruột” hay hấp thu kém.',
    ],
    glossary: [
      ['Khả dụng sinh học', 'Tỷ lệ và tốc độ một chất được hấp thu rồi sẵn sàng cho cơ thể sử dụng.'],
      ['Nhu động', 'Co bóp phối hợp giúp trộn và đẩy thức ăn trong ống tiêu hóa.'],
      ['Không dung nạp', 'Khó xử lý một thành phần, khác với phản ứng miễn dịch của dị ứng.'],
    ],
    practiceTitle: 'Nhật ký triệu chứng có cấu trúc',
    practiceSteps: [
      'Ghi món, lượng ước tính, thời điểm và tốc độ ăn.',
      'Ghi triệu chứng, thời điểm xuất hiện, mức độ và dấu hiệu đi kèm.',
      'Tìm mẫu lặp lại nhưng không tự loại trừ nhiều nhóm thực phẩm hoặc tự chẩn đoán.',
    ],
    practiceResult: 'Một mô tả đủ rõ để tự quan sát an toàn hoặc trao đổi hiệu quả với người có chuyên môn.',
    safety: 'Dị ứng nghiêm trọng, đau dữ dội, nôn kéo dài, phân có máu, mất nước hoặc sụt cân không chủ ý cần được khám.',
    quiz: [
      { question: 'Phần lớn dưỡng chất được hấp thu ở đâu?', options: ['Thực quản', 'Ruột non', 'Ruột già'], correctIndex: 1 },
      { question: 'Không dung nạp khác dị ứng chủ yếu ở điểm nào?', options: ['Dị ứng liên quan phản ứng miễn dịch', 'Không có khác biệt', 'Không dung nạp luôn nguy hiểm hơn'], correctIndex: 0 },
      { question: 'Nhật ký triệu chứng nên ghi gì?', options: ['Chỉ tên món', 'Món, lượng, thời điểm, mức độ và bối cảnh', 'Chỉ số cân nặng'], correctIndex: 1 },
    ],
  },
  {
    number: 6,
    title: 'Hormone, insulin và kiểm soát đường huyết',
    promise: 'Đọc tín hiệu và đường cong có bối cảnh, không biến mọi dao động thành bệnh.',
    minutes: 42,
    objectives: [
      'Hiểu vai trò phối hợp của glucose, insulin, glucagon, incretin, adrenaline và cortisol.',
      'Phân biệt phản ứng sau ăn bình thường, kháng insulin và thiếu insulin.',
      'Đọc xét nghiệm và thiết bị như dữ liệu có giới hạn, không phải công cụ tự chẩn đoán.',
    ],
    takeaways: [
      'Glucose tăng sau bữa có carbohydrate là phản ứng sinh lý; ý nghĩa nằm ở toàn bộ đường cong và bối cảnh.',
      'Cơ, gan, mô mỡ và tụy phối hợp giữ nhiên liệu sẵn có đúng lúc.',
      'Bữa cân đối, vận động, tập sức mạnh và giấc ngủ là đòn bẩy thực tế nhưng không thay thế điều trị.',
    ],
    glossary: [
      ['Insulin', 'Hormone của tụy giúp điều phối sử dụng và dự trữ glucose cùng nhiều quá trình chuyển hóa khác.'],
      ['HbA1c', 'Chỉ dấu phản ánh mức glucose trung bình ước tính trong vài tháng và có những giới hạn diễn giải.'],
      ['CGM', 'Thiết bị theo dõi glucose dịch kẽ liên tục, có độ trễ và sai số.'],
    ],
    practiceTitle: 'Kế hoạch nhịp ổn định bảy ngày',
    practiceSteps: [
      'Chọn một bữa thường gây đói hoặc mệt và mô tả đầy đủ thành phần, thời điểm, giấc ngủ.',
      'Thử ghép carbohydrate với protein, rau/chất xơ và vận động nhẹ nếu phù hợp.',
      'Theo dõi cảm giác và khả năng thực hiện; không săn từng “đỉnh đường”.',
    ],
    practiceResult: 'Một thử nghiệm đời sống có bối cảnh, không phải một chẩn đoán hay phác đồ điều trị.',
    safety: 'Người dùng thuốc hạ glucose hoặc có đái tháo đường phải theo kế hoạch của đội ngũ điều trị; dấu hiệu hạ/tăng glucose cấp cần xử trí y khoa.',
    quiz: [
      { question: 'Glucose tăng sau một bữa có carbohydrate luôn có nghĩa là bệnh?', options: ['Có', 'Không, cần đọc đường cong và bối cảnh', 'Chỉ ở người tập luyện'], correctIndex: 1 },
      { question: 'CGM đo trực tiếp glucose ở đâu?', options: ['Dịch kẽ', 'Trong xương', 'Trong dạ dày'], correctIndex: 0 },
      { question: 'PT có nên tự chỉnh thuốc hạ đường huyết cho học viên?', options: ['Có nếu đã xem CGM', 'Không', 'Có nếu học viên đồng ý'], correctIndex: 1 },
    ],
  },
  {
    number: 7,
    title: 'Vì sao mỗi người giảm cân khác nhau',
    promise: 'Mở chữ “cơ địa” thành bốn lớp dữ liệu thay vì so tốc độ với người khác.',
    minutes: 40,
    objectives: [
      'Phân tích điểm xuất phát, mức thực hiện, phản ứng cơ thể và sai số phép đo.',
      'Hiểu tác động của NEAT, đói, ngủ, stress, chu kỳ, thuốc và tình trạng sức khỏe.',
      'Dùng vòng lặp cá nhân hóa: quan sát, giả thuyết, đổi một biến và đánh giá lại.',
    ],
    takeaways: [
      'Cùng một kế hoạch trên giấy hiếm khi tạo cùng mức thâm hụt thực tế.',
      'Thích nghi chuyển hóa có thật nhưng không đồng nghĩa cơ thể đã “hỏng”.',
      'Dao động cân do nước, glycogen và tiêu hóa phải được tách khỏi xu hướng mỡ.',
    ],
    glossary: [
      ['Thích nghi chuyển hóa', 'Các thay đổi tiêu hao và hành vi xuất hiện khi cân nặng hoặc năng lượng nạp thay đổi.'],
      ['Tuân thủ', 'Mức độ kế hoạch thực sự được sống trong đời thật, không phải phẩm chất đạo đức.'],
      ['Nhiễu đo lường', 'Dao động hoặc sai số che khuất tín hiệu thật của tiến trình.'],
    ],
    practiceTitle: 'Bảng điều khiển bốn lớp',
    practiceSteps: [
      'Chuẩn hóa cách cân và ghi xu hướng thay vì chọn con số thuận mắt.',
      'Ghi mức thực hiện, đói, ngủ, vận động và bối cảnh theo tuần.',
      'Viết một giả thuyết và đổi duy nhất một biến trong khoảng đủ dài.',
    ],
    practiceResult: 'Một bảng điều khiển giúp so dữ liệu của chính mình qua thời gian thay vì so với người khác.',
    safety: 'Thuốc, bệnh lý, mất kinh, chóng mặt, kiệt sức hoặc sụt cân bất thường cần được trao đổi với người có chuyên môn.',
    quiz: [
      { question: '“Cùng kế hoạch” có đảm bảo cùng thâm hụt thực tế không?', options: ['Có', 'Không', 'Chỉ khi cùng tuổi'], correctIndex: 1 },
      { question: 'Cân tăng ngắn hạn luôn là tăng mỡ?', options: ['Có', 'Không, còn có nước và glycogen', 'Chỉ sau ngày nghỉ'], correctIndex: 1 },
      { question: 'Vòng lặp cá nhân hóa nên thay bao nhiêu biến mỗi lần?', options: ['Một biến có lý do', 'Mọi biến', 'Không biến nào'], correctIndex: 0 },
    ],
  },
  {
    number: 8,
    title: 'Tôi cần ăn bao nhiêu',
    promise: 'Biến con số từ máy tính thành giả thuyết khởi đầu được kiểm chứng trong 14 ngày.',
    minutes: 48,
    objectives: [
      'Chuẩn hóa dữ liệu và so sánh EER, Mifflin – St Jeor cùng dữ liệu đời thật.',
      'Chọn protein, chất béo và để carbohydrate nhận phần năng lượng còn lại rồi kiểm tra ngược.',
      'Thiết kế thử nghiệm 14 ngày bằng số, khẩu phần hoặc cách kết hợp.',
    ],
    takeaways: [
      'Công thức đúng ở cấp nhóm vẫn có thể sai đáng kể với một cá nhân.',
      'Nên dùng một khoảng năng lượng làm việc thay vì độ chính xác giả của một con số.',
      'Làm tròn và chọn cách theo dõi có thể duy trì thường hữu ích hơn tính toán cầu kỳ.',
    ],
    glossary: [
      ['EER', 'Nhu cầu năng lượng ước tính dựa trên đặc điểm cơ thể và mức hoạt động.'],
      ['Mifflin – St Jeor', 'Phương trình phổ biến để ước tính năng lượng nghỉ ở người trưởng thành.'],
      ['AMDR', 'Khoảng phân bố chấp nhận được cho các chất đa lượng ở cấp quần thể.'],
    ],
    practiceTitle: 'Thử nghiệm nhu cầu 14 ngày',
    practiceSteps: [
      'Kiểm tra đơn vị, chọn cân nặng đại diện và tính ít nhất hai cách phù hợp.',
      'Đặt một khoảng năng lượng, protein và cách theo dõi đủ nhẹ để thực hiện.',
      'Rà trung bình cân, vòng eo, đói, năng lượng, hiệu suất và mức thực hiện sau 14 ngày.',
    ],
    practiceResult: 'Một khoảng khởi đầu cùng quy tắc giữ hoặc điều chỉnh một biến nhỏ.',
    safety: 'Dấu hiệu thiếu năng lượng, bệnh lý, thai kỳ, rối loạn ăn uống hoặc nhu cầu điều trị không phù hợp với tự tính và tự giảm calories.',
    quiz: [
      { question: 'Con số từ công thức năng lượng là gì?', options: ['Mệnh lệnh chính xác', 'Giả thuyết khởi đầu', 'Mức tối thiểu bắt buộc'], correctIndex: 1 },
      { question: 'Vì sao không cộng calories tập từ đồng hồ vào TDEE một cách máy móc?', options: ['Có thể bị tính trùng và sai số', 'Tập không tốn năng lượng', 'TDEE chỉ dùng cho nam'], correctIndex: 0 },
      { question: 'Sau 14 ngày nên làm gì?', options: ['Đổi toàn bộ kế hoạch', 'Đọc nhiều chỉ số và chỉnh một biến nếu cần', 'Chỉ nhìn một lần cân'], correctIndex: 1 },
    ],
  },
  {
    number: 9,
    title: 'Xây thực đơn thực tế',
    promise: 'Từ một tờ menu đẹp đến hệ thống bữa ăn sống được trong tuần thật.',
    minutes: 50,
    objectives: [
      'Dùng lịch, khả năng nấu, ngân sách, sở thích và gia đình làm dữ liệu thiết kế.',
      'Xây thư viện món thay thế theo chức năng và mở rộng ba ngày mẫu thành một tuần.',
      'Chuẩn bị danh sách mua, meal prep, bữa cứu hộ và chiến lược ăn ngoài.',
    ],
    takeaways: [
      'Tuần sống đi trước món ăn; kế hoạch phải chứa cả khoảng trống và ngày bận.',
      'Đĩa ăn AURA là công cụ quan sát linh hoạt, không phải tỷ lệ bắt buộc.',
      'Hậu cần, bảo quản và đường quay lại là một phần của dinh dưỡng.',
    ],
    glossary: [
      ['Điểm neo', 'Bữa hoặc cấu phần ổn định giúp cả tuần dễ tổ chức hơn.'],
      ['Bữa cứu hộ', 'Bữa đủ dùng, dễ tiếp cận khi kế hoạch chính không thể thực hiện.'],
      ['Meal prep', 'Chuẩn bị trước nguyên liệu, cấu phần hoặc bữa hoàn chỉnh theo mức phù hợp.'],
    ],
    practiceTitle: 'Hệ thống thực đơn một tuần',
    practiceSteps: [
      'Đánh dấu lịch bận, bữa gia đình, buổi tập và khả năng nấu trong tuần.',
      'Tạo ba ngày mẫu rồi lập nhóm món thay thế theo protein, tinh bột, rau quả và chất béo.',
      'Viết danh sách mua, chọn mức prep và chuẩn bị ít nhất hai bữa cứu hộ.',
    ],
    practiceResult: 'Một tuần có thể dùng, đổi món, ăn ngoài và nối lại khi kế hoạch thay đổi.',
    safety: 'Thực đơn chạm đến bệnh lý, dị ứng, thai kỳ hoặc quan hệ rối loạn với thức ăn cần được thiết kế cùng chuyên môn phù hợp.',
    quiz: [
      { question: 'Dữ liệu nào nên đi trước khi chọn món?', options: ['Lịch sống và khả năng nấu', 'Ảnh trên mạng', 'Một tỷ lệ cố định'], correctIndex: 0 },
      { question: 'Bữa cứu hộ có mục đích gì?', options: ['Trừng phạt sau khi ăn nhiều', 'Giữ hệ thống hoạt động khi kế hoạch đổi', 'Thay mọi bữa chính'], correctIndex: 1 },
      { question: 'Một thực đơn tốt được đánh giá bằng gì?', options: ['Số ô điền kín', 'Khả năng dùng và tự điều chỉnh', 'Độ đắt của nguyên liệu'], correctIndex: 1 },
    ],
  },
  {
    number: 10,
    title: 'Theo dõi tiến độ và điều chỉnh',
    promise: 'Đo đúng thứ, đủ nhẹ và biến dashboard thành một quyết định có lý do.',
    minutes: 44,
    objectives: [
      'Phân biệt kết quả, quá trình, bối cảnh và tín hiệu an toàn.',
      'Chuẩn hóa cân, vòng, ảnh, hiệu suất và hiểu giới hạn của phép đo thành phần cơ thể.',
      'Dùng cổng điều chỉnh trước khi thay calories, khẩu phần, vận động hoặc lịch tập.',
    ],
    takeaways: [
      'Sai số đo và biến động sinh học phải được xem trước khi kết luận.',
      'Cân đứng chưa chắc cơ thể đứng; cân giảm chưa chắc kế hoạch tốt.',
      'Mức thực hiện là dữ liệu để sửa hệ thống, không phải điểm hạnh kiểm.',
    ],
    glossary: [
      ['RPE/RIR', 'Cách mô tả độ gắng sức hoặc số lần lặp còn dự trữ trong tập luyện.'],
      ['BIA', 'Ước tính thành phần cơ thể qua trở kháng điện, nhạy với trạng thái nước và điều kiện đo.'],
      ['Cổng điều chỉnh', 'Chuỗi kiểm tra độ tin cậy, thời gian, thực hiện và an toàn trước khi đổi kế hoạch.'],
    ],
    practiceTitle: 'Dashboard tiến độ tối giản',
    practiceSteps: [
      'Chọn một chỉ số kết quả, hai chỉ số quá trình và một tín hiệu an toàn.',
      'Chuẩn hóa thời điểm, dụng cụ và cách ghi cho từng phép đo.',
      'Hẹn buổi rà, viết trước điều kiện tiếp tục, điều chỉnh, tạm dừng hoặc chuyển tuyến.',
    ],
    practiceResult: 'Một dashboard đủ dùng và một quyết định nhỏ có thể giải thích bằng dữ liệu.',
    safety: 'Dừng tối ưu hình thể khi dữ liệu cho thấy đau, mất kinh, kiệt sức, rối loạn ăn uống hoặc suy giảm sức khỏe.',
    quiz: [
      { question: 'Khi cân đứng, kết luận đúng nhất là gì?', options: ['Không có tiến bộ', 'Cần đọc thêm vòng, ảnh, hiệu suất và bối cảnh', 'Phải cắt calories ngay'], correctIndex: 1 },
      { question: 'BIA cho kết quả gì?', options: ['Ước tính có sai số', 'Khối mỡ chính xác tuyệt đối', 'Chẩn đoán y khoa'], correctIndex: 0 },
      { question: 'Trước khi điều chỉnh cần làm gì?', options: ['Qua cổng kiểm tra dữ liệu và an toàn', 'Đổi nhiều biến', 'Tăng cardio mặc định'], correctIndex: 0 },
    ],
  },
  {
    number: 11,
    title: 'Ăn trước, trong và sau tập',
    promise: 'Đọc buổi tập, timeline và tiêu hóa để xây giao thức linh hoạt thay vì sao chép thực đơn.',
    minutes: 46,
    objectives: [
      'Phân biệt nền dinh dưỡng cả ngày với chiến lược quanh một buổi tập.',
      'Chọn bữa chính, bữa phụ hoặc món cứu hộ theo thời gian còn lại và khả năng dung nạp.',
      'Biết khi nào nước, carbohydrate, sodium hoặc caffeine có thể hữu ích.',
    ],
    takeaways: [
      'Mục tiêu trước tập là đủ nhiên liệu, dễ tiêu, đủ nước và cảm giác sẵn sàng.',
      'Nước thường đủ cho nhiều buổi; đồ uống thể thao có vai trò ở bối cảnh cụ thể.',
      '“Cửa sổ đồng hóa” linh hoạt hơn một cuộc chạy đua vài phút sau tập.',
    ],
    glossary: [
      ['Ba chiếc đồng hồ', 'Thời gian từ bữa trước đến tập, từ lúc ăn đến vận động và từ cuối buổi đến lần nạp tiếp theo.'],
      ['Tốc độ ra mồ hôi', 'Ước tính lượng dịch mất theo thời gian vận động trong một điều kiện cụ thể.'],
      ['Tập lúc đói', 'Tập sau khoảng không nạp năng lượng; không tự động tạo giảm mỡ nhiều hơn.'],
    ],
    practiceTitle: 'Giao thức quanh một buổi tập',
    practiceSteps: [
      'Ghi loại buổi, thời lượng, cường độ, môi trường và thời điểm.',
      'Chọn mục tiêu cho trước, trong và sau tập dựa trên ba chiếc đồng hồ.',
      'Thử, ghi tiêu hóa, năng lượng và hiệu suất rồi điều chỉnh một yếu tố.',
    ],
    practiceResult: 'Một giao thức có phiên bản đầy đủ và phiên bản cứu hộ cho đúng lịch tập.',
    safety: 'Caffeine, bột bổ sung và chiến lược dịch điện giải cần xét thuốc, bệnh lý, thai kỳ, giấc ngủ và độ tin cậy sản phẩm.',
    quiz: [
      { question: 'Mục tiêu trước tập phù hợp nhất là gì?', options: ['Ăn càng ít càng tốt', 'Đủ nhiên liệu và dễ tiêu', 'Luôn dùng supplement'], correctIndex: 1 },
      { question: 'Nước thường có đủ cho mọi buổi tập không?', options: ['Không bao giờ', 'Đủ cho nhiều buổi, tùy thời lượng và môi trường', 'Chỉ đủ khi tập sáng'], correctIndex: 1 },
      { question: 'Tập lúc đói có tự động giảm mỡ nhiều hơn?', options: ['Có', 'Không', 'Chỉ với cardio'], correctIndex: 1 },
    ],
  },
  {
    number: 12,
    title: 'Dinh dưỡng để phục hồi',
    promise: 'Đọc tải và xây kế hoạch phục hồi 24–48 giờ thay vì đi tìm một sản phẩm thần kỳ.',
    minutes: 45,
    objectives: [
      'Phân biệt mệt cấp, DOMS, đau bất thường, chấn thương và suy giảm phục hồi kéo dài.',
      'Phối hợp năng lượng, protein, carbohydrate, dịch, sodium và giấc ngủ.',
      'Dùng đèn xanh – vàng – đỏ để giữ, chỉnh buổi tập hoặc chuyển tuyến.',
    ],
    takeaways: [
      'Thích nghi tiếp tục nhiều giờ và nhiều ngày sau khi buổi tập kết thúc.',
      'Tổng năng lượng là nền; ngày nghỉ không đồng nghĩa ngày bỏ bữa.',
      'Protein nên được phân phối trong ngày, còn carbohydrate tùy tải và lần vận động kế tiếp.',
    ],
    glossary: [
      ['DOMS', 'Đau cơ khởi phát muộn thường xuất hiện sau hoạt động mới hoặc tải cao.'],
      ['REDs', 'Hội chứng thiếu năng lượng tương đối trong thể thao ảnh hưởng nhiều hệ cơ thể.'],
      ['Tải phục hồi', 'Nhu cầu phục hồi tạo bởi loại buổi, độ mới, khối lượng, cường độ và môi trường.'],
    ],
    practiceTitle: 'Kế hoạch phục hồi 24–48 giờ',
    practiceSteps: [
      'Chấm tải buổi tập và khoảng cách tới buổi tiếp theo.',
      'Lập nhịp bữa, protein, carbohydrate, dịch và giấc ngủ trong 24–48 giờ.',
      'Đánh dấu đèn xanh, vàng hoặc đỏ theo đau, mệt, hiệu suất và dấu hiệu an toàn.',
    ],
    practiceResult: 'Một kế hoạch phục hồi có điều kiện điều chỉnh thay vì một danh sách sản phẩm.',
    safety: 'Đau bất thường, chấn thương, ngất, suy giảm kéo dài hoặc dấu hiệu REDs cần giảm tải và được đánh giá phù hợp.',
    quiz: [
      { question: 'Ngày nghỉ có nên bỏ bữa để “cân” calories?', options: ['Có', 'Không, năng lượng vẫn là nền phục hồi', 'Chỉ bỏ protein'], correctIndex: 1 },
      { question: 'DOMS là gì?', options: ['Đau cơ khởi phát muộn', 'Chẩn đoán rách cơ', 'Thiếu protein chắc chắn'], correctIndex: 0 },
      { question: 'Đèn đỏ trong phục hồi dẫn đến hành động nào?', options: ['Cố hoàn thành buổi', 'Dừng và chuyển đánh giá phù hợp', 'Tăng caffeine'], correctIndex: 1 },
    ],
  },
  {
    number: 13,
    title: 'Dinh dưỡng giảm mỡ',
    promise: 'Tạo thâm hụt có cửa an toàn, bảo vệ khối cơ và đọc chững trước khi cắt thêm.',
    minutes: 50,
    objectives: [
      'Phân biệt giảm mỡ với mất nước, glycogen hoặc khối không mỡ.',
      'Chọn khoảng thâm hụt và tốc độ khởi đầu có thể duy trì.',
      'Bảo vệ cơ bằng tập sức mạnh, protein, carbohydrate theo tải và phục hồi.',
    ],
    takeaways: [
      'Thâm hụt là điều kiện giảm mỡ nhưng không cho phép cắt ăn cực đoan.',
      'Quy tắc 7.700 kcal không dự báo tuyến tính tiến độ của một người.',
      'Chững giả do nước, chu kỳ, sodium, táo bón hoặc tải tập phải được loại trừ trước.',
    ],
    glossary: [
      ['Thâm hụt năng lượng', 'Trạng thái năng lượng nạp thấp hơn tiêu hao trong một khoảng thời gian.'],
      ['Khối không mỡ', 'Các mô và thành phần cơ thể không thuộc khối mỡ.'],
      ['Chững giả', 'Cân tạm đứng do nhiễu dù xu hướng mô mỡ có thể vẫn thay đổi.'],
    ],
    practiceTitle: 'Cổng giảm mỡ bảy bước',
    practiceSteps: [
      'Khóa mục tiêu, thời hạn, chỉ số thành công và cửa an toàn.',
      'Theo dõi xu hướng cân, vòng, hiệu suất, đói, ngủ và mức thực hiện.',
      'Kiểm tra nhiễu và thời gian trước khi giữ, đổi một biến hoặc về duy trì.',
    ],
    practiceResult: 'Một quyết định giảm mỡ dựa trên xu hướng và sức khỏe, không dựa trên hoảng hốt vì một lần cân.',
    safety: 'Mất kinh, kiệt sức, choáng, ám ảnh thức ăn, đau hoặc giảm hiệu suất kéo dài là lý do dừng siết và chuyển hỗ trợ.',
    quiz: [
      { question: 'Điều kiện nền của giảm mỡ là gì?', options: ['Thâm hụt năng lượng', 'Loại bỏ carbohydrate', 'Tập lúc đói'], correctIndex: 0 },
      { question: 'Quy tắc 7.700 kcal có dự báo chính xác tuyến tính cho mọi người không?', options: ['Có', 'Không', 'Chỉ cho nữ'], correctIndex: 1 },
      { question: 'Khi cân đứng ngắn hạn nên làm gì?', options: ['Cắt mạnh ngay', 'Kiểm tra nhiễu và xu hướng', 'Nhịn bù'], correctIndex: 1 },
    ],
  },
  {
    number: 14,
    title: 'Dinh dưỡng tăng cơ, tăng cân',
    promise: 'Ghép tín hiệu tập kháng lực với nguồn lực dinh dưỡng và tốc độ tăng có thể kiểm soát.',
    minutes: 49,
    objectives: [
      'Phân biệt tăng cân, tăng cơ, tăng glycogen – nước và tăng mỡ.',
      'Chọn thặng dư thận trọng, protein đủ và carbohydrate hỗ trợ tải tập.',
      'Thiết kế bữa cho người ít đói, nhanh no hoặc lịch làm việc dày.',
    ],
    takeaways: [
      'Tập kháng lực là tín hiệu chính; dinh dưỡng và phục hồi cung cấp nguồn lực.',
      'Không có công thức chính xác đổi một lượng calories thừa thành một kilogram cơ.',
      'Tốc độ tăng cân là tín hiệu hiệu chỉnh, không chứng minh toàn bộ phần tăng là cơ.',
    ],
    glossary: [
      ['Thặng dư năng lượng', 'Trạng thái năng lượng nạp cao hơn tiêu hao trong một khoảng thời gian.'],
      ['Phì đại cơ', 'Sự tăng kích thước mô cơ do thích nghi với tập và nguồn lực phục hồi.'],
      ['Mật độ năng lượng', 'Năng lượng chứa trong một khối lượng thực phẩm nhất định.'],
    ],
    practiceTitle: 'Bản đồ tăng cân có chất lượng',
    practiceSteps: [
      'Xác định vùng duy trì từ dữ liệu thật và chọn thặng dư khởi đầu thận trọng.',
      'Phân phối protein, thêm carbohydrate quanh tải tập và tăng mật độ bữa khi cần.',
      'Rà cân trung bình, vòng, ảnh, hiệu suất, tiêu hóa, ngủ và chu kỳ.',
    ],
    practiceResult: 'Một kế hoạch tăng có tốc độ, chỉ số chất lượng và điều kiện giữ hoặc điều chỉnh.',
    safety: 'Sụt cân không chủ ý, không thể tăng dù đã theo dõi, triệu chứng tiêu hóa hoặc bệnh lý cần được đánh giá thay vì chỉ tăng thêm calories.',
    quiz: [
      { question: 'Tín hiệu chính cho tăng cơ là gì?', options: ['Tập kháng lực tiến triển', 'Mass gainer', 'Cân tăng thật nhanh'], correctIndex: 0 },
      { question: 'Cân tăng có đồng nghĩa toàn bộ là cơ?', options: ['Có', 'Không', 'Chỉ khi ăn nhiều protein'], correctIndex: 1 },
      { question: 'Người nhanh no có thể bắt đầu bằng gì?', options: ['Bỏ bữa', 'Tăng mật độ năng lượng và chia bữa phù hợp', 'Uống caffeine'], correctIndex: 1 },
    ],
  },
  {
    number: 15,
    title: 'Tái cấu trúc cơ thể',
    promise: 'Theo dõi hai xu hướng mô trong một giai đoạn đủ dài thay vì đòi chiếc cân kể toàn bộ câu chuyện.',
    minutes: 48,
    objectives: [
      'Phân biệt recomp với giảm cân, tăng cân, giữ cân và dao động nước.',
      'Chọn làn năng lượng quanh duy trì, thâm hụt nhỏ hoặc thặng dư nhỏ theo đối tượng.',
      'Đọc dashboard 4–8 tuần gồm eo, ảnh, hiệu suất, phục hồi và mức thực hiện.',
    ],
    takeaways: [
      'Mỡ không biến thành cơ; hai mô có thể thay đổi theo hai hướng song song.',
      'Người mới tập, quay lại tập hoặc vừa cải thiện mạnh chương trình thường có cơ hội thuận lợi hơn.',
      'Tín hiệu kỹ thuật, thần kinh, glycogen và phù cơ sớm chưa đủ chứng minh tăng mô cơ.',
    ],
    glossary: [
      ['Body recomposition', 'Giai đoạn hướng tới giảm mỡ đồng thời tăng hoặc bảo vệ khối cơ.'],
      ['Normal-weight obesity', 'Thuật ngữ nghiên cứu về tỷ lệ mỡ cao ở người có BMI bình thường; không đồng nghĩa nhãn “skinny fat”.'],
      ['Dashboard recomp', 'Tập hợp tín hiệu mô, hiệu suất, thực hiện, phục hồi và an toàn.'],
    ],
    practiceTitle: 'Cổng quyết định recomp 4–8 tuần',
    practiceSteps: [
      'Xác định mình có phải ứng viên phù hợp và chọn làn năng lượng khởi đầu.',
      'Khóa chương trình tập, protein và mức vận động đủ ổn định để đọc dữ liệu.',
      'Sau 4–8 tuần, tiếp tục, đổi một biến hoặc chuyển sang giai đoạn mục tiêu rõ hơn.',
    ],
    practiceResult: 'Một block recomp có giả thuyết, chỉ số, thời hạn và quy tắc đổi hướng.',
    safety: 'Ưu tiên phục hồi năng lượng hoặc chuyển tuyến nếu có dấu hiệu thiếu năng lượng, bệnh lý hay quan hệ rối loạn với thức ăn.',
    quiz: [
      { question: 'Trong recomp, mỡ có biến trực tiếp thành cơ không?', options: ['Có', 'Không, đó là hai mô khác nhau', 'Chỉ ở người mới tập'], correctIndex: 1 },
      { question: 'Tín hiệu tiến bộ sớm về sức mạnh luôn chứng minh tăng cơ?', options: ['Có', 'Không, còn có thích nghi kỹ thuật và thần kinh', 'Chỉ khi cân đứng'], correctIndex: 1 },
      { question: 'Khi nào nên rà một block recomp?', options: ['Sau một ngày', 'Sau khoảng 4–8 tuần', 'Chỉ sau một năm'], correctIndex: 1 },
    ],
  },
  {
    number: 16,
    title: 'Dinh dưỡng theo từng giai đoạn cuộc sống phụ nữ',
    promise: 'Dùng giai đoạn sống như một lăng kính ưu tiên, không biến phụ nữ thành một công thức hormone.',
    minutes: 52,
    objectives: [
      'Đọc nhu cầu qua tăng trưởng, sinh sản, phục hồi, chuyển tiếp và bảo vệ chức năng.',
      'Ưu tiên đúng ở tuổi dậy thì, chu kỳ, trước thai, thai kỳ, sau sinh, mãn kinh và tuổi cao.',
      'Xây hộ chiếu giai đoạn sống với ngôn ngữ trung lập và dữ liệu vừa đủ.',
    ],
    takeaways: [
      'Tuổi theo giấy tờ không đủ để quyết định nhu cầu của một phụ nữ.',
      'Không tồn tại bốn thực đơn bắt buộc cho bốn pha chu kỳ kinh.',
      'Giai đoạn sống đổi câu hỏi ưu tiên chứ không tạo một thực đơn cố định.',
    ],
    glossary: [
      ['Folate/folic acid', 'Folate là dạng tự nhiên; folic acid là dạng dùng trong thực phẩm tăng cường và bổ sung với vai trò đặc biệt trước thai.'],
      ['Chuyển tiếp mãn kinh', 'Giai đoạn biến đổi trước thời điểm mãn kinh, có khác biệt lớn giữa cá nhân.'],
      ['Hộ chiếu giai đoạn sống', 'Bản tóm tắt nhiệm vụ hiện tại, ưu tiên, ranh giới và hỗ trợ cần thiết.'],
    ],
    practiceTitle: 'Hộ chiếu giai đoạn sống',
    practiceSteps: [
      'Xác định nhiệm vụ sinh học và đời sống hiện tại mà không gán mọi triệu chứng cho hormone.',
      'Chọn ưu tiên về năng lượng, dưỡng chất, bữa ăn, vận động và theo dõi.',
      'Ghi cổng an toàn, người hỗ trợ và thời điểm cần đánh giá lại.',
    ],
    practiceResult: 'Một hộ chiếu cá nhân hóa đủ riêng tư, không chẩn đoán và có thể cập nhật khi giai đoạn đổi.',
    safety: 'Thai kỳ, cho con bú, tuổi vị thành niên, bệnh thận, sụt cân không chủ ý và đa thuốc cần phối hợp đội ngũ chuyên môn.',
    quiz: [
      { question: 'Giai đoạn sống nên được dùng như gì?', options: ['Một thực đơn cố định', 'Một lăng kính để đặt câu hỏi ưu tiên', 'Một chẩn đoán hormone'], correctIndex: 1 },
      { question: 'Có bốn thực đơn bắt buộc cho bốn pha chu kỳ không?', options: ['Có', 'Không', 'Chỉ khi giảm mỡ'], correctIndex: 1 },
      { question: 'Điều gì đặc biệt quan trọng trước thai?', options: ['Folic acid trong bối cảnh phù hợp', 'Detox', 'Nhịn ăn dài'], correctIndex: 0 },
    ],
  },
  {
    number: 17,
    title: 'Dinh dưỡng khi có bệnh lý và tình trạng đặc biệt',
    promise: 'Giữ nền, nhận diện ngoại lệ và phối hợp đúng người trước khi thay một bữa ăn.',
    minutes: 55,
    objectives: [
      'Phân biệt giáo dục phổ thông, hỗ trợ hành vi và dinh dưỡng điều trị.',
      'Xác minh chẩn đoán, thuốc, triệu chứng, biến chứng và đội ngũ với sự đồng ý.',
      'Phân tầng dấu hiệu và lập bản đồ dinh dưỡng có điều kiện với chủ sở hữu rõ.',
    ],
    takeaways: [
      'Một chẩn đoán không tự động tạo ra một thực đơn duy nhất.',
      'PT có thể giúp triển khai hướng dẫn vào đời sống nhưng không tự chẩn đoán, kê đơn hoặc chỉnh thuốc.',
      'Ngoại lệ liên quan đái tháo đường, tim mạch, thận, tiêu hóa hay thuốc phải có đúng người sở hữu quyết định.',
    ],
    glossary: [
      ['Dinh dưỡng điều trị', 'Can thiệp dinh dưỡng để quản lý bệnh, cần người có phạm vi chuyên môn phù hợp.'],
      ['Chủ sở hữu quyết định', 'Người hoặc chuyên môn chịu trách nhiệm cho một quyết định cụ thể.'],
      ['Bản đồ có điều kiện', 'Kế hoạch nền kèm ngoại lệ, cổng hành động và người cần liên hệ.'],
    ],
    practiceTitle: 'Sáu quyết định trước khi thay bữa ăn',
    practiceSteps: [
      'Xác minh thông tin sức khỏe, thuốc, triệu chứng và kế hoạch của đội ngũ điều trị.',
      'Sàng lọc cấp cứu, nhu cầu lượng giá sớm và điều kiện cần phối hợp.',
      'Giữ nền an toàn, ghi ngoại lệ, chủ sở hữu và tín hiệu phải dừng.',
    ],
    practiceResult: 'Một bản đồ phối hợp không tự chẩn đoán, không tự đổi thuốc và không bỏ rơi người học.',
    safety: 'Nội dung này chỉ phục vụ giáo dục; cấp cứu, thuốc và dinh dưỡng điều trị phải do chuyên môn có thẩm quyền quản lý.',
    quiz: [
      { question: 'Một chẩn đoán có tạo ra một thực đơn giống nhau cho mọi người không?', options: ['Có', 'Không', 'Chỉ với đái tháo đường'], correctIndex: 1 },
      { question: 'Ai nên chỉnh thuốc?', options: ['PT', 'Người kê đơn hoặc đội ngũ điều trị', 'Học viên tự chỉnh'], correctIndex: 1 },
      { question: 'Bước đầu trước khi thay bữa ăn là gì?', options: ['Xác minh và sàng lọc an toàn', 'Loại bỏ carbohydrate', 'Mua supplement'], correctIndex: 0 },
    ],
  },
  {
    number: 18,
    title: 'Đọc bằng chứng và tự bảo vệ trước thông tin dinh dưỡng',
    promise: 'Biến một lời hứa hấp dẫn thành câu hỏi có thể kiểm tra và hành động tương xứng.',
    minutes: 56,
    objectives: [
      'Dùng PICO-T và truy nội dung về nghiên cứu gốc.',
      'Đọc thiết kế, đối tượng, hiệu ứng, độ bất định, tài trợ và giới hạn.',
      'Kiểm toán quảng cáo chế độ ăn, xét nghiệm và supplement bằng bộ lọc AURA 6C.',
    ],
    takeaways: [
      'Có trích dẫn không đồng nghĩa nguồn hỗ trợ đúng điều đang được quảng cáo.',
      'Ý nghĩa thống kê khác ý nghĩa thực tế; nguy cơ tương đối cần được đặt cạnh chênh lệch tuyệt đối.',
      'Meta-analysis không tự sửa được nghiên cứu đầu vào kém.',
    ],
    glossary: [
      ['PICO-T', 'Khung xác định đối tượng, can thiệp/phơi nhiễm, so sánh, kết quả và thời gian.'],
      ['Khoảng tin cậy', 'Khoảng thể hiện độ bất định quanh một ước tính hiệu ứng.'],
      ['GRADE', 'Khung đánh giá độ chắc chắn của bằng chứng qua nhiều miền giới hạn.'],
    ],
    practiceTitle: 'Kiểm toán tuyên bố bằng AURA 6C',
    practiceSteps: [
      'Chốt lời hứa thành một câu có thể kiểm tra và xác định quyết định bạn đang cân nhắc.',
      'Chạm nguồn gốc, kiểm tra độ khớp về đối tượng, liều, so sánh, kết quả và thời gian.',
      'Cân hiệu ứng, độ chắc chắn, chi phí, rủi ro rồi chọn hành động tương xứng.',
    ],
    practiceResult: 'Một phiếu AURA 6C cho biết nên tin đến đâu, hành động gì và điều gì còn chưa chắc.',
    safety: 'Không tự thử sản phẩm ở người có bệnh, thuốc, thai kỳ/cho con bú, vấn đề gan thận hoặc nguy cơ rối loạn ăn uống nếu chưa được đánh giá.',
    quiz: [
      { question: 'Một bài có trích dẫn chắc chắn hỗ trợ lời quảng cáo?', options: ['Có', 'Không, phải kiểm tra độ khớp', 'Chỉ khi là tiếng Anh'], correctIndex: 1 },
      { question: 'Ý nghĩa thống kê có đồng nghĩa hiệu quả thực tế lớn?', options: ['Có', 'Không', 'Luôn luôn với RCT'], correctIndex: 1 },
      { question: 'PICO-T giúp làm gì?', options: ['Đặt câu hỏi nghiên cứu có cấu trúc', 'Tính TDEE', 'Chẩn đoán bệnh'], correctIndex: 0 },
    ],
  },
  {
    number: 19,
    title: 'Biến quyết định đúng thành thói quen bền vững',
    promise: 'Thiết kế hành vi có tín hiệu, môi trường và đường nối lại thay vì dựa vào ý chí.',
    minutes: 47,
    objectives: [
      'Dùng COM-B để tìm trở ngại về năng lực, cơ hội và động lực.',
      'Thiết kế hành vi nhỏ có ý nghĩa, tín hiệu, kế hoạch nếu–thì và ba chế độ vận hành.',
      'Tổ chức buổi rà tuần không phán xét và giao thức nối lại trong 24 giờ.',
    ],
    takeaways: [
      'Kiến thức và ý định cần thiết nhưng thường chưa đủ để tạo hành vi.',
      'Nỗ lực khác kiến trúc; môi trường và ma sát quyết định hành vi có dễ lặp lại hay không.',
      'Một lần trượt nhịp không cần nhịn bù, tập bù hoặc chờ ngày hoàn hảo.',
    ],
    glossary: [
      ['COM-B', 'Mô hình xem hành vi qua năng lực, cơ hội và động lực.'],
      ['Kế hoạch nếu–thì', 'Quy tắc nối một tình huống cụ thể với hành động đã chọn trước.'],
      ['Ba chế độ', 'Phiên bản tiêu chuẩn, duy trì và tối thiểu của cùng một hành vi.'],
    ],
    practiceTitle: 'Bản thiết kế thói quen AURA 6N',
    practiceSteps: [
      'Nhắm một hành vi quan sát được và tìm điểm nghẽn bằng COM-B.',
      'Nối hành vi với tín hiệu, giảm ma sát và viết phiên bản ba chế độ.',
      'Lập kế hoạch nếu–thì cùng giao thức nối lại ở cơ hội kế tiếp.',
    ],
    practiceResult: 'Một hệ hành vi có thể sống qua tuần bận và tự nối lại mà không cần giám sát liên tục.',
    safety: 'Tự theo dõi phải dừng hoặc giảm khi gây ám ảnh, lo âu, bù trừ hoặc làm xấu quan hệ với thức ăn.',
    quiz: [
      { question: 'COM-B không bao gồm yếu tố nào?', options: ['Năng lực', 'Cơ hội', 'May mắn'], correctIndex: 2 },
      { question: 'Sau một lần trượt nhịp nên làm gì?', options: ['Nhịn bù', 'Nối lại ở cơ hội kế tiếp', 'Chờ thứ Hai'], correctIndex: 1 },
      { question: 'Ba chế độ hành vi gồm gì?', options: ['Nhanh, vừa, chậm', 'Tiêu chuẩn, duy trì, tối thiểu', 'Ăn, tập, ngủ'], correctIndex: 1 },
    ],
  },
  {
    number: 20,
    title: 'Trở thành chuyên gia dinh dưỡng của chính mình',
    promise: 'Xây hệ điều hành cá nhân biết định hướng, đọc dữ liệu, thử, rà và gọi đúng người.',
    minutes: 55,
    objectives: [
      'Phân biệt tự chủ với tự cô lập, tự chẩn đoán hoặc từ chối hỗ trợ.',
      'Dùng AURA 6Đ để quản trị một quyết định dinh dưỡng từ định hướng đến đánh giá.',
      'Xây kế hoạch 12 tháng và Hệ điều hành dinh dưỡng cá nhân phiên bản 1.0.',
    ],
    takeaways: [
      'Tự chủ gồm biết khi nào cần PT, chuyên gia dinh dưỡng, bác sĩ, dược sĩ hoặc hỗ trợ tâm lý.',
      'Một thử nghiệm cá nhân cần giả thuyết, thời hạn, dữ liệu tối thiểu, điều kiện dừng và ranh giới an toàn.',
      'Tốt nghiệp là nhận lại quyền quyết định có cấu trúc, không phải biến mất khỏi mọi mạng lưới hỗ trợ.',
    ],
    glossary: [
      ['AURA 6Đ', 'Định hướng – Đọc – Đặt ưu tiên – Đưa vào đời sống – Đo – Đánh giá.'],
      ['Tự chủ dinh dưỡng', 'Khả năng hiểu, lựa chọn, thích nghi và tìm đúng hỗ trợ trong phạm vi an toàn.'],
      ['Hệ điều hành cá nhân', 'Bộ nguyên tắc, dữ liệu, quy trình và mạng lưới hỗ trợ có thể cập nhật.'],
    ],
    practiceTitle: 'Hệ điều hành dinh dưỡng cá nhân 1.0',
    practiceSteps: [
      'Lập hồ sơ hiện trạng gồm an toàn, hành vi, kết quả và trải nghiệm–bối cảnh.',
      'Chọn một ưu tiên, thiết kế thử nghiệm cùng quy tắc giữ, sửa, dừng hoặc chuyển tuyến.',
      'Lập bản đồ hỗ trợ và kế hoạch 12 tháng theo các mùa đời sống.',
    ],
    practiceResult: 'Một hệ điều hành có thể cập nhật, một cam kết kiểm chứng được và tiêu chí giảm dần coaching dày.',
    safety: 'Tự hiểu cơ thể không thay thế xét nghiệm, chẩn đoán hoặc điều trị; tự chủ thật sự bao gồm biết gọi đúng người.',
    quiz: [
      { question: 'Tự chủ dinh dưỡng có nghĩa là gì?', options: ['Không bao giờ cần hỗ trợ', 'Biết tự quyết và gọi đúng người khi cần', 'Tự chẩn đoán'], correctIndex: 1 },
      { question: 'Một thử nghiệm cá nhân an toàn cần gì?', options: ['Đổi nhiều biến', 'Giả thuyết, dữ liệu và điều kiện dừng', 'Không cần thời hạn'], correctIndex: 1 },
      { question: 'Tốt nghiệp coaching nghĩa là gì?', options: ['Mất mọi hỗ trợ', 'Nhận lại quyền quyết định có cấu trúc', 'Không theo dõi nữa'], correctIndex: 1 },
    ],
  },
]

function phaseForChapter(number: number) {
  return auraNutritionPhases[Math.min(auraNutritionPhases.length - 1, Math.floor((number - 1) / 5))]
}

function lessonMemory(chapter: CurriculumChapter): AcademyLessonMemory {
  const chapterId = `chapter-${String(chapter.number).padStart(2, '0')}`
  return {
    recap: chapter.promise,
    takeaways: chapter.takeaways,
    glossary: chapter.glossary.map(([term, definition], index) => ({ id: `${chapterId}-term-${index + 1}`, term, definition })),
    recallPrompts: [
      {
        id: `${chapterId}-recall-1`,
        prompt: `Hãy giải thích ý chính của “${chapter.title}” bằng lời của bạn.`,
        answer: chapter.takeaways.join(' '),
      },
      {
        id: `${chapterId}-recall-2`,
        prompt: 'Trong đời sống của bạn, dữ liệu nào cần quan sát trước khi điều chỉnh?',
        answer: `${chapter.practiceSteps[0]} ${chapter.practiceSteps[1]}`,
      },
    ],
    flashcards: chapter.glossary.map(([term, definition], index) => ({
      id: `${chapterId}-card-${index + 1}`,
      front: term,
      back: definition,
      hint: `Thuật ngữ trọng tâm của Chương ${chapter.number}`,
    })),
  }
}

function chapterBody(chapter: CurriculumChapter) {
  return [
    `## Vì sao chương này quan trọng`,
    chapter.promise,
    '',
    '## Bạn sẽ làm được',
    ...chapter.objectives.map((item) => `- ${item}`),
    '',
    `> **Lưu ý an toàn:** ${chapter.safety}`,
    '',
    '## Cách học chương này',
    'Đọc để hiểu cơ chế, tự diễn đạt lại trong tab **Ghi nhớ sâu**, sau đó hoàn thành bài thực hành trước khi làm checkpoint. Không dùng nội dung như chẩn đoán hoặc đơn điều trị cá nhân.',
  ].join('\n')
}

function practiceBody(chapter: CurriculumChapter) {
  return [
    `## ${chapter.practiceTitle}`,
    'Bài thực hành này biến kiến thức thành một vòng quan sát có thể dùng trong đời sống thật.',
    '',
    '## Kết quả cần có',
    chapter.practiceResult,
    '',
    `> **Cổng an toàn:** ${chapter.safety}`,
  ].join('\n')
}

function chapterLessons(chapter: CurriculumChapter): CourseLessonDraft[] {
  const chapterId = `chapter-${String(chapter.number).padStart(2, '0')}`
  const phase = phaseForChapter(chapter.number)
  const quizId = `${chapterId}-checkpoint`
  return [
    {
      id: `${chapterId}-core`,
      title: `Nắm lõi: ${chapter.title}`,
      type: 'Bài đọc',
      duration: `${chapter.minutes} phút`,
      preview: chapter.number === 1,
      summary: chapter.promise,
      tags: [`Chương ${chapter.number}`, phase.title, 'Giáo trình 2026'],
      coachNotes: `Nội dung học trên app được biên tập từ AURA Fitness Academy – Chương ${chapter.number}. Khuyến khích học viên dùng tab Ghi nhớ sâu trước khi chuyển sang thực hành.`,
      memory: lessonMemory(chapter),
      primaryContent: { kind: 'rich-text', body: chapterBody(chapter) },
      completionPolicy: { mode: 'manual' },
    },
    {
      id: `${chapterId}-practice`,
      title: `Thực hành: ${chapter.practiceTitle}`,
      type: 'Bài đọc',
      duration: '12 phút',
      summary: chapter.practiceResult,
      tags: [`Chương ${chapter.number}`, 'Thực hành', phase.title],
      coachNotes: 'Không chấm sự hoàn hảo. Chỉ cần đầu ra đủ rõ để học viên quan sát, thử nhỏ và rà lại.',
      memory: {
        recap: chapter.practiceResult,
        takeaways: chapter.practiceSteps,
        glossary: [],
        recallPrompts: [{
          id: `${chapterId}-practice-recall`,
          prompt: 'Bước nhỏ nào bạn sẽ thực hiện và khi nào bạn rà lại?',
          answer: 'Một hành vi cụ thể, dữ liệu tối thiểu, thời hạn và điều kiện giữ, chỉnh hoặc dừng.',
        }],
        flashcards: [],
      },
      primaryContent: { kind: 'rich-text', body: practiceBody(chapter) },
      completionPolicy: { mode: 'manual' },
    },
    {
      id: quizId,
      title: `Checkpoint Chương ${chapter.number}`,
      type: 'Quiz',
      duration: '6 phút',
      summary: `Ba câu hỏi kiểm tra khả năng hiểu và áp dụng nội dung “${chapter.title}”.`,
      tags: [`Chương ${chapter.number}`, 'Checkpoint', phase.title],
      quiz: {
        id: `${quizId}-quiz`,
        passPercent: 67,
        questionOrder: 'sequential',
        publicSettings: { maxAttempts: 5, revealMode: 'after-submit' },
        questions: chapter.quiz.map((item, index) => ({
          id: `${quizId}-question-${index + 1}`,
          question: item.question,
          options: item.options,
          correctIndex: item.correctIndex,
        })),
      },
      completionPolicy: { mode: 'quiz-pass', quizId: `${quizId}-quiz` },
    },
  ]
}

export function buildAuraNutritionModules(): CourseModuleDraft[] {
  return chapters.map((chapter) => ({
    id: `nutrition-chapter-${String(chapter.number).padStart(2, '0')}`,
    order: chapter.number,
    title: `Chương ${chapter.number} · ${chapter.title}`,
    lessons: chapterLessons(chapter),
  }))
}

export const auraNutritionCurriculumStats = {
  chapters: chapters.length,
  lessons: chapters.length * 3,
  phases: auraNutritionPhases.length,
  estimatedMinutes: chapters.reduce((total, chapter) => total + chapter.minutes + 18, 0),
}
