export type AuraNutritionStudySection = {
  title: string
  explanation: string
  points: string[]
}

export type AuraNutritionStudyGuide = {
  bigQuestion: string
  opening: string
  sections: AuraNutritionStudySection[]
  misconceptions: Array<[string, string]>
  evidenceNote: string
  workedExample: string
  practiceExample: string
  reviewQuestions: [string, string, string]
}

/**
 * Mobile reading guides distilled from the 2026 AURA Fitness Academy
 * handbooks. The complete illustrated handbook remains the canonical source
 * and is attached to each chapter as a private PDF resource.
 */
export const auraNutritionStudyGuides: Record<number, AuraNutritionStudyGuide> = {
  1: {
    bigQuestion: 'Nếu đã thử nhiều chế độ ăn nhưng luôn quay lại điểm cũ, vấn đề có thật sự là thiếu ý chí?',
    opening: 'Một kế hoạch thường thất bại trước khi bắt đầu khi nó chỉ sửa món ăn cuối ngày mà bỏ qua giấc ngủ, lịch làm việc, mức đói và môi trường. Chương này đổi góc nhìn từ “chấm điểm bản thân” sang quan sát hệ thống đang tạo ra lựa chọn.',
    sections: [
      {
        title: 'Gọi đúng tên trước khi sửa',
        explanation: 'Dinh dưỡng là toàn bộ quá trình cơ thể nhận, tiêu hóa, hấp thu, vận chuyển và sử dụng chất dinh dưỡng. Giảm cân chỉ là một mục tiêu hình thể trong bức tranh lớn hơn gồm sống, khỏe và thích nghi.',
        points: [
          'Thực phẩm là thứ ta ăn; chất dinh dưỡng là các thành phần cơ thể sử dụng; chế độ ăn là mẫu hình lặp lại theo thời gian.',
          'Một món ăn riêng lẻ không đại diện cho cả chế độ ăn và không quyết định giá trị của người ăn.',
          'Thiếu năng lượng, thiếu vi chất, thừa năng lượng và mất cân bằng đều có thể là vấn đề dinh dưỡng.',
        ],
      },
      {
        title: 'La bàn AURA năm hướng',
        explanation: 'Một cách ăn có thể sống được cần đồng thời trả lời năm câu hỏi. Không hướng nào là điểm số hoàn hảo; hãy dùng chúng để tìm chân yếu nhất cần gia cố.',
        points: [
          'Đủ: có đáp ứng năng lượng, dưỡng chất và nhu cầu của giai đoạn hiện tại không?',
          'Cân đối: các nhóm thực phẩm và nguồn lực có được phân bổ hợp lý trong cả ngày hoặc tuần không?',
          'Điều độ và đa dạng: có giới hạn hợp lý mà vẫn dùng nhiều nguồn thực phẩm quen thuộc, vừa túi tiền không?',
          'An toàn: lựa chọn, chế biến, bảo quản và bối cảnh sức khỏe có được tôn trọng không?',
        ],
      },
      {
        title: 'Đọc mẫu hình thay vì phán xét món ăn',
        explanation: 'Ba thấu kính lượng, tần suất và bối cảnh giúp biến câu hỏi “tốt hay xấu” thành câu hỏi có thể hành động. Một bữa khác kế hoạch không đòi hỏi nhịn bù; nó cung cấp dữ liệu về điểm gãy.',
        points: [
          'Quan sát thời điểm đói, khoảng cách giữa các bữa, giấc ngủ và tình huống xã hội.',
          'Thiết kế phương án cho ngày bận, không chỉ cho ngày lý tưởng có đủ thời gian nấu.',
          'Giảm ma sát bằng đồ ăn dự phòng, tín hiệu nhắc và lựa chọn tối thiểu có thể lặp lại.',
        ],
      },
    ],
    misconceptions: [
      ['“Ăn sạch” tuyệt đối mới có kết quả', 'Chất lượng quan trọng nhưng mẫu hình đủ, linh hoạt và duy trì được mới tạo nền dài hạn.'],
      ['Lệch một bữa nghĩa là mất kiểm soát', 'Một lần lệch là điểm dữ liệu; hãy tìm điểm gãy trước đó thay vì trừng phạt bằng nhịn ăn.'],
      ['Cần động lực thật cao để bắt đầu', 'Môi trường và hành vi tối thiểu đáng tin cậy hơn việc chờ động lực.'],
    ],
    evidenceNote: 'Bằng chứng dinh dưỡng mạnh thường nhìn mẫu hình ăn uống, nguy cơ dài hạn và bối cảnh cá nhân; nó hiếm khi biến một món đơn lẻ thành nguyên nhân duy nhất.',
    workedExample: 'Mai thường ăn nhiều vào tối. Khi vẽ lại ngày sống, điểm gãy xuất hiện từ việc bỏ bữa sáng, bữa trưa muộn và thiếu đồ ăn dự phòng. Thử nghiệm đầu tiên là tạo một bữa sáng đủ dùng trong ba ngày làm việc, không phải cắt bữa tối.',
    practiceExample: 'Điểm gãy: đói mạnh lúc 17 giờ. Hành vi tối thiểu: chuẩn bị một bữa phụ có protein vào ba ngày họp muộn. Dữ liệu: mức đói trước tối từ 1–10. Ngày rà: Chủ nhật.',
    reviewQuestions: ['Điểm gãy của bạn xảy ra trước hành vi muốn sửa bao lâu?', 'Hướng nào trong La bàn AURA đang yếu nhất?', 'Bước nhỏ nào vẫn làm được trong một ngày bận?'],
  },
  2: {
    bigQuestion: 'Năng lượng từ thức ăn đi đâu và vì sao calories nạp vào – tiêu hao đúng nhưng chưa đủ để dự đoán từng người?',
    opening: 'Calorie là đơn vị đo, không phải một chất nằm trong thức ăn. Tế bào dùng chất dinh dưỡng để tái tạo ATP, còn cơ thể tiêu hao năng lượng suốt 24 giờ cho sống, tiêu hóa, vận động hằng ngày và tập luyện.',
    sections: [
      {
        title: 'Từ thức ăn đến năng lượng tế bào',
        explanation: 'Carbohydrate, chất béo, protein và cồn cung cấp năng lượng với hệ số ước tính khác nhau. Sau tiêu hóa và hấp thu, chúng đi vào các con đường chuyển hóa để tạo ATP, xây mô hoặc dự trữ.',
        points: [
          'ATP là “đồng tiền chi tiêu” được sử dụng và tái tạo liên tục, không phải kho dự trữ lớn.',
          'Glycogen ở gan và cơ là kho carbohydrate có giới hạn; mô mỡ là kho năng lượng lớn hơn.',
          'Cùng calories không có nghĩa hai thực phẩm giống nhau về no, vi chất, tiêu hóa hoặc hiệu ứng nhiệt.',
        ],
      },
      {
        title: 'Bốn ngăn tiêu hao trong 24 giờ',
        explanation: 'TDEE/TEE là tổng của năng lượng nghỉ, hiệu ứng nhiệt của thức ăn, hoạt động không chủ đích và tập luyện. Tỷ lệ từng ngăn thay đổi theo kích thước cơ thể, công việc và hành vi.',
        points: [
          'BMR/RMR hoặc REE thường là phần lớn nhất và được đo trong điều kiện khác nhau.',
          'TEF là chi phí xử lý thức ăn; protein thường có hiệu ứng nhiệt cao hơn nhưng không phải “calories miễn phí”.',
          'NEAT gồm đi lại, đứng, làm việc nhà và cử động nhỏ; nó có thể giảm khi ăn thiếu hoặc mệt.',
          'Buổi tập quan trọng cho sức khỏe và hiệu suất nhưng không đại diện cho 23 giờ còn lại.',
        ],
      },
      {
        title: 'Cân bằng năng lượng là hệ động',
        explanation: 'Nguyên lý bảo toàn năng lượng vẫn đúng, nhưng cả lượng nạp, tiêu hao và nước cơ thể đều có sai số và phản hồi. Vì vậy dự đoán tuyến tính thường lệch khỏi đời thật.',
        points: [
          'Cân tăng nhanh sau bữa mặn có thể đến từ nước, glycogen và khối lượng thức ăn, không phải toàn bộ là mỡ.',
          'Khi lượng ăn hoặc cân nặng thay đổi, TEF, NEAT, hiệu suất và cảm giác đói cũng có thể đổi.',
          'Đồng hồ, máy tập và công thức là ước tính; cần đối chiếu với xu hướng đủ dài.',
        ],
      },
    ],
    misconceptions: [
      ['Calories đồng hồ báo là lượng được ăn bù chính xác', 'Thiết bị có sai số; dùng như một tín hiệu vận động, không như hóa đơn năng lượng.'],
      ['Một tuần không giảm chứng minh trao đổi chất hỏng', 'Nhiễu nước và dữ liệu thực hiện có thể che xu hướng; cần kiểm tra trước khi kết luận.'],
      ['Tập càng nhiều thì giảm càng nhanh', 'Tăng tập có thể kéo theo mệt, đói và giảm NEAT; tổng hệ mới quyết định kết quả.'],
    ],
    evidenceNote: 'Đo tiêu hao chính xác cần phương pháp chuyên môn như nhiệt lượng gián tiếp hoặc nước đánh dấu kép. Công thức phổ thông phù hợp để khởi tạo giả thuyết, không phải xác nhận chân lý cá nhân.',
    workedExample: 'Hương cộng toàn bộ 500 kcal đồng hồ báo sau buổi tập vào khẩu phần. Khi xem cả tuần, cô vận động ít hơn ở ngày mệt và thiết bị chỉ là ước tính. Kế hoạch được đổi sang theo dõi lượng ăn nhất quán và xu hướng cân thay vì ăn bù tự động.',
    practiceExample: 'Vẽ ngày 24 giờ, tô bốn màu cho nghỉ, TEF, NEAT và tập. Chọn 10 phút đi bộ sau bữa trưa ở ba ngày ít vận động, rồi rà mức thực hiện và năng lượng cuối ngày.',
    reviewQuestions: ['Ngăn tiêu hao nào dễ thay đổi nhất trong đời sống của bạn?', 'Con số nào hiện là phép đo và con số nào chỉ là ước tính?', 'Dao động cân gần đây có thể chịu ảnh hưởng của nước hay glycogen không?'],
  },
  3: {
    bigQuestion: 'Protein, carbohydrate và chất béo phối hợp thế nào thay vì cạnh tranh để trở thành chất “tốt nhất”?',
    opening: 'Ba chất đa lượng vừa cung cấp năng lượng vừa đảm nhiệm các chức năng khác nhau. Một bữa hợp lý không được quyết định chỉ bằng tỷ lệ macro, mà bằng nguồn thực phẩm, lượng, thời điểm và mục tiêu của cả ngày.',
    sections: [
      {
        title: 'Protein: cấu trúc và tín hiệu thích nghi',
        explanation: 'Protein được phân giải thành amino acid để xây và sửa mô, tạo enzyme, chất vận chuyển và nhiều thành phần miễn dịch. Cơ thể không có kho protein chuyên dụng giống glycogen hay mỡ.',
        points: [
          'Amino acid thiết yếu phải đến từ chế độ ăn với lượng và chất lượng phù hợp.',
          'Phân bố nguồn protein qua các bữa thường thực tế hơn dồn phần lớn vào một bữa.',
          'Nhu cầu phụ thuộc cân nặng, tuổi, mức tập, mục tiêu và tình trạng sức khỏe.',
        ],
      },
      {
        title: 'Carbohydrate: nhiên liệu, dự trữ và chất xơ',
        explanation: 'Đường, tinh bột và chất xơ đều thuộc carbohydrate nhưng có cấu trúc và gói thực phẩm khác nhau. Glucose được dùng ngay hoặc dự trữ dưới dạng glycogen.',
        points: [
          'Carbohydrate hỗ trợ vận động cường độ cao và có thể được điều chỉnh quanh lịch tập.',
          'Chất xơ hỗ trợ tiêu hóa, cảm giác no và hệ vi sinh, nhưng tăng quá nhanh có thể gây khó chịu.',
          'Không nên đánh đồng đường tự nhiên trong trái cây nguyên quả với mọi nguồn đường thêm vào.',
        ],
      },
      {
        title: 'Chất béo: màng tế bào, hormone và hấp thu',
        explanation: 'Chất béo cung cấp năng lượng đậm đặc, acid béo thiết yếu và giúp hấp thu vitamin tan trong dầu. Cần nhìn loại chất béo và thực phẩm thay thế, không chỉ tổng số gram.',
        points: [
          'Ưu tiên nguồn không bão hòa từ cá, hạt, quả hạch và dầu phù hợp bối cảnh.',
          'Hạn chế chất béo trans công nghiệp và đọc toàn bộ mẫu hình thay vì sợ mọi chất béo bão hòa.',
          'Vì có 9 kcal mỗi gram, khẩu phần nguồn chất béo dễ làm tổng năng lượng thay đổi đáng kể.',
        ],
      },
    ],
    misconceptions: [
      ['Carbohydrate tự động biến thành mỡ', 'Thay đổi dự trữ mỡ phụ thuộc cân bằng năng lượng và bối cảnh dài hạn, không chỉ một chất.'],
      ['Ăn càng nhiều protein càng tốt', 'Lợi ích có khoảng hữu ích; tăng vô hạn có thể lấn chỗ thực phẩm khác và không phù hợp mọi bệnh lý.'],
      ['Chất béo làm tăng mỡ cơ thể', 'Chất béo là dưỡng chất cần thiết; lượng, nguồn và tổng năng lượng mới là điều cần đọc.'],
    ],
    evidenceNote: 'Các mục tiêu macro nên là khoảng có thể điều chỉnh. Dữ liệu về hiệu suất, đói, tiêu hóa và mức thực hiện giúp chọn tỷ lệ phù hợp hơn một công thức cứng.',
    workedExample: 'Một bữa cơm có cá, cơm, rau luộc và ít dầu đã có đủ ba macro cùng vi chất. Thay vì bỏ cơm vì “carb xấu”, người học điều chỉnh lượng cơm theo mục tiêu và lịch tập, đồng thời giữ protein và rau.',
    practiceExample: 'Chụp một bữa thật. Đánh dấu nguồn protein, carbohydrate/chất xơ, chất béo và rau quả. Chỉ chọn một khoảng trống rõ nhất để sửa ở lần ăn tiếp theo.',
    reviewQuestions: ['Macro nào đang thiếu vai trò chức năng trong cách bạn nhìn bữa ăn?', 'Nguồn thực phẩm nào có thể nâng chất lượng mà vẫn quen thuộc?', 'Lượng và thời điểm cần đổi hay chỉ cần đổi nhãn “tốt–xấu”?'],
  },
  4: {
    bigQuestion: 'Làm sao nhận đủ vi chất và nước mà không biến viên bổ sung hay một con số uống nước thành giải pháp cho mọi người?',
    opening: 'Vitamin và khoáng chất không cung cấp năng lượng nhưng tham gia tạo máu, xương, miễn dịch, thần kinh và chuyển hóa. Nước là môi trường của hầu hết phản ứng sống; nhu cầu thay đổi theo ngày và bối cảnh.',
    sections: [
      {
        title: 'Đọc mức tham chiếu đúng mục đích',
        explanation: 'EAR, RDA, AI và UL trả lời các câu hỏi khác nhau cho nhóm dân số. Chúng không phải bốn mức mục tiêu để người dùng cố đạt càng cao càng tốt.',
        points: [
          'RDA được thiết kế để đáp ứng phần lớn người khỏe mạnh trong một nhóm, không phải đơn thuốc cá nhân.',
          'AI được dùng khi chưa đủ dữ liệu để đặt RDA; UL là ngưỡng trên, không phải mức tối ưu.',
          'Hấp thu phụ thuộc nguồn, dạng hóa học, bữa ăn và tương tác giữa dưỡng chất.',
        ],
      },
      {
        title: 'Những vi chất thường cần chú ý',
        explanation: 'Sắt, canxi, vitamin D, folate, B12, i-ốt, natri và kali có vai trò khác nhau. Nguy cơ thiếu hoặc thừa thay đổi theo giới, tuổi, cách ăn, thai kỳ, thuốc và bệnh lý.',
        points: [
          'Sắt liên quan vận chuyển oxy; thiếu sắt không nên tự chẩn đoán chỉ từ cảm giác mệt.',
          'Canxi và vitamin D tham gia sức khỏe xương nhưng không thể tách khỏi vận động, hormone và tổng chế độ ăn.',
          'Người ăn thuần chay cần kế hoạch đáng tin cậy cho B12 và nên trao đổi chuyên môn khi cần.',
          'Natri, kali và dịch phải được điều chỉnh thận trọng ở người có bệnh tim, thận hoặc dùng thuốc liên quan.',
        ],
      },
      {
        title: 'Hydration là một quy trình',
        explanation: 'Không có một số lít cố định tối ưu cho mọi người và mọi ngày. Cơ thể nhận nước từ đồ uống lẫn thức ăn và mất nước qua nước tiểu, mồ hôi, hô hấp và tiêu hóa.',
        points: [
          'Dùng khát, màu nước tiểu, thời tiết, mồ hôi và thay đổi khối lượng quanh buổi tập như các tín hiệu có giới hạn.',
          'Uống quá nhiều trong thời gian ngắn cũng có rủi ro; không ép nước để đạt một con số.',
          'Điện giải có thể hữu ích trong buổi dài, nóng hoặc ra mồ hôi nhiều nhưng không bắt buộc cho mọi buổi tập.',
        ],
      },
    ],
    misconceptions: [
      ['Nước tiểu phải luôn trong suốt', 'Quá trong kéo dài có thể phản ánh uống quá mức; hãy đọc cùng khát và bối cảnh.'],
      ['Vitamin tự nhiên luôn an toàn ở mọi liều', 'Liều cao vẫn có thể gây độc hoặc tương tác thuốc.'],
      ['Viên bổ sung bù được chế độ ăn đơn điệu', 'Thực phẩm còn cung cấp protein, chất xơ và ma trận dưỡng chất mà một viên không thay thế.'],
    ],
    evidenceNote: 'Xét nghiệm và chỉ định bổ sung nên được diễn giải bởi người có chuyên môn. Triệu chứng mơ hồ không đủ xác định thiếu vi chất cụ thể.',
    workedExample: 'Một người tập chiều trong thời tiết nóng thấy đau đầu và mệt. Thay vì mua nhiều loại điện giải, họ ghi lượng uống, thời lượng tập, mồ hôi và bữa ăn; đồng thời chuyển tuyến nếu triệu chứng lặp lại hoặc nặng.',
    practiceExample: 'Trong bảy ngày, đánh dấu độ đa dạng thực phẩm, nhịp uống và mọi viên bổ sung. Chọn một khoảng trống rõ ràng như thiếu nguồn canxi quen thuộc, không tự tăng liều thuốc hay viên bổ sung.',
    reviewQuestions: ['Bạn đang dùng chỉ số tham chiếu nào và nó trả lời câu hỏi gì?', 'Ngày nào nhu cầu dịch của bạn tăng rõ?', 'Sản phẩm bổ sung nào chưa có lý do, liều hoặc người theo dõi rõ ràng?'],
  },
  5: {
    bigQuestion: 'Ăn vào, tiêu hóa, hấp thu và sử dụng dưỡng chất là bốn việc khác nhau như thế nào?',
    opening: 'Ống tiêu hóa không chỉ là một đường ống. Cơ học, enzyme, acid, mật, hormone, hệ thần kinh và vi sinh cùng biến bữa ăn thành các phân tử có thể hấp thu, rồi gan và mô tiếp tục xử lý.',
    sections: [
      {
        title: 'Hành trình của bữa ăn',
        explanation: 'Miệng nghiền và bắt đầu tiêu hóa; dạ dày trộn và kiểm soát tốc độ đi xuống; ruột non hoàn tất phần lớn tiêu hóa và hấp thu; ruột già thu hồi nước và xử lý phần còn lại.',
        points: [
          'Tụy cung cấp enzyme và bicarbonate; gan tạo mật, túi mật dự trữ và phóng thích mật khi phù hợp.',
          'Các nếp gấp và nhung mao ruột non tạo diện tích lớn cho hấp thu.',
          'Dưỡng chất sau hấp thu được vận chuyển, chuyển hóa, sử dụng hoặc dự trữ; không phải tất cả đi thẳng vào cơ.',
        ],
      },
      {
        title: 'Triệu chứng không tự nói nguyên nhân',
        explanation: 'Đầy hơi, đau bụng, táo bón hoặc tiêu chảy có nhiều nguyên nhân và chịu ảnh hưởng của lượng ăn, tốc độ, stress, thuốc, chu kỳ và bệnh lý.',
        points: [
          'Không dung nạp là khó xử lý một thành phần; dị ứng liên quan miễn dịch và có thể nguy hiểm.',
          'Kém hấp thu là khái niệm lâm sàng, không thể kết luận chỉ vì đầy bụng sau một bữa.',
          'Loại trừ nhiều nhóm thực phẩm cùng lúc làm khó tìm nguyên nhân và có thể gây thiếu dinh dưỡng.',
        ],
      },
      {
        title: 'Nhật ký có cấu trúc',
        explanation: 'Dữ liệu tốt ghi món, lượng ước tính, thời điểm, tốc độ ăn, triệu chứng, thời gian xuất hiện và yếu tố đi kèm. Mục tiêu là thấy mẫu lặp lại, không săn thủ phạm từ một lần.',
        points: [
          'Đổi một biến an toàn khi có thể để biết điều gì thực sự liên quan.',
          'Không dùng nhật ký để trì hoãn khám khi có cờ đỏ.',
          'Mang bản ghi ngắn, rõ đến bác sĩ hoặc chuyên gia giúp cuộc trao đổi hiệu quả hơn.',
        ],
      },
    ],
    misconceptions: [
      ['Đầy hơi nghĩa là “rò rỉ ruột”', 'Đầy hơi là triệu chứng không đặc hiệu và cần bối cảnh trước khi giải thích.'],
      ['Detox giúp ruột loại độc', 'Gan, thận, phổi và ruột đã đảm nhiệm thải loại; sản phẩm detox không thay thế điều trị.'],
      ['Càng nhiều men vi sinh càng tốt', 'Lợi ích phụ thuộc chủng, liều và tình trạng; không phải sản phẩm nào cũng tương đương.'],
    ],
    evidenceNote: 'Khả dụng sinh học và triệu chứng tiêu hóa thay đổi giữa người. Một quan sát cá nhân hữu ích để tạo câu hỏi, nhưng chưa chứng minh chẩn đoán hay quan hệ nhân quả.',
    workedExample: 'Lan thấy đầy bụng sau bữa tối và định bỏ gluten, sữa, đậu cùng lúc. Nhật ký cho thấy triệu chứng chủ yếu ở bữa rất lớn ăn nhanh sau ngày bỏ bữa. Bước đầu là chỉnh nhịp và lượng, giữ cổng chuyển tuyến nếu triệu chứng tiếp diễn.',
    practiceExample: 'Ghi ba lần triệu chứng theo mẫu: ăn gì, khoảng bao nhiêu, lúc nào, tốc độ, triệu chứng, thời điểm bắt đầu, mức 1–10 và dấu hiệu đi kèm.',
    reviewQuestions: ['Bạn đang mô tả triệu chứng hay đang tự gán nguyên nhân?', 'Có mẫu lặp lại qua nhiều lần không?', 'Dấu hiệu nào yêu cầu dừng thử và đi khám?'],
  },
  6: {
    bigQuestion: 'Insulin và đường huyết là hệ điều phối nhiên liệu bình thường hay là “kẻ thù” cần triệt tiêu?',
    opening: 'Glucose tăng sau bữa có carbohydrate là phản ứng sinh lý. Insulin, glucagon, incretin, gan, cơ và mô mỡ phối hợp giữ nhiên liệu trong khoảng phù hợp; ý nghĩa nằm ở toàn bộ đường cong và bối cảnh sức khỏe.',
    sections: [
      {
        title: 'Điều phối sau bữa và lúc nhịn',
        explanation: 'Sau ăn, insulin giúp tế bào sử dụng và dự trữ dưỡng chất. Giữa các bữa, glucagon và các tín hiệu khác giúp gan duy trì glucose sẵn có.',
        points: [
          'Insulin còn tác động lên tổng hợp protein và chuyển hóa chất béo; nó không chỉ là hormone “tích mỡ”.',
          'Cơ hoạt động có thể tăng sử dụng glucose, vì vậy vận động là một đòn bẩy thực tế.',
          'Stress, thiếu ngủ, bệnh cấp và thuốc có thể làm dữ liệu glucose thay đổi.',
        ],
      },
      {
        title: 'Đường cong quan trọng hơn một đỉnh',
        explanation: 'Một điểm đo không cho biết tốc độ tăng, mức đỉnh, thời gian trở về và bối cảnh. Cùng một bữa có thể tạo phản ứng khác theo giấc ngủ, buổi tập và thời điểm.',
        points: [
          'CGM đo glucose dịch kẽ nên có độ trễ so với máu và có sai số kỹ thuật.',
          'HbA1c phản ánh trung bình ước tính trong vài tháng nhưng có giới hạn ở một số tình trạng.',
          'Không tự chẩn đoán kháng insulin từ cảm giác buồn ngủ hoặc một đỉnh CGM.',
        ],
      },
      {
        title: 'Đòn bẩy đời sống có giới hạn rõ',
        explanation: 'Bữa có protein, rau/chất xơ, nguồn carbohydrate phù hợp, vận động nhẹ và giấc ngủ có thể hỗ trợ ổn định trải nghiệm sau ăn. Chúng không thay thế thuốc hoặc kế hoạch điều trị.',
        points: [
          'Không loại toàn bộ carbohydrate để “không tiết insulin”.',
          'Người dùng thuốc hạ glucose cần phối hợp chuyên môn trước khi đổi lượng ăn hoặc tập.',
          'Dấu hiệu hạ đường huyết cần xử trí theo kế hoạch y khoa đã được hướng dẫn.',
        ],
      },
    ],
    misconceptions: [
      ['Insulin là nguyên nhân duy nhất gây tăng mỡ', 'Dự trữ mỡ chịu tác động của toàn hệ năng lượng, hành vi và sinh học.'],
      ['Mọi đỉnh glucose đều gây hại', 'Đáp ứng sau ăn bình thường có dao động; cần đọc mức, thời gian và bối cảnh.'],
      ['CGM ở người khỏe mạnh cho thực đơn hoàn hảo', 'Thiết bị tạo dữ liệu nhưng cũng tạo nhiễu; chưa đủ để tự chẩn đoán hay cấm món.'],
    ],
    evidenceNote: 'Chẩn đoán tiền đái tháo đường hoặc đái tháo đường dựa trên tiêu chuẩn và đánh giá y khoa, không dựa vào diễn giải tự do từ thiết bị tiêu dùng.',
    workedExample: 'Một học viên thấy CGM tăng sau cơm và muốn bỏ cơm hoàn toàn. Khi xem lại, bữa đó thiếu rau, ăn rất nhanh và sau đêm ngủ ngắn. Thử nghiệm an toàn là chỉnh cấu trúc bữa và đi bộ nhẹ, không tự đổi thuốc.',
    practiceExample: 'Chọn một bữa thường làm đói sớm. Ghi thành phần, lượng, giấc ngủ và vận động. Thử ghép protein, rau/chất xơ và rà cảm giác trong bảy ngày.',
    reviewQuestions: ['Bạn có đang dùng một điểm đo để kết luận cả hệ không?', 'Yếu tố gây nhiễu nào xảy ra cùng bữa?', 'Thay đổi nào cần hỏi đội ngũ điều trị trước?'],
  },
  7: {
    bigQuestion: 'Vì sao hai người theo cùng một kế hoạch trên giấy lại giảm cân với tốc độ khác nhau?',
    opening: '“Cơ địa” thường gom nhiều lớp dữ liệu vào một từ: điểm xuất phát, mức thực hiện, phản ứng sinh học và sai số đo. Mở bốn lớp này giúp cá nhân hóa mà không đổ lỗi hoặc hứa hẹn tốc độ.',
    sections: [
      {
        title: 'Cùng kế hoạch không phải cùng liều thực tế',
        explanation: 'Khẩu phần, cuối tuần, đồ uống, cách nấu và mức vận động ngoài tập làm mức thiếu hụt thật khác nhau. Tuân thủ là dữ liệu vận hành, không phải phẩm chất đạo đức.',
        points: [
          'Người có khối lượng, công việc và lịch ngủ khác nhau có TDEE khác nhau.',
          'Cảm giác “ăn rất ít” có thể đúng về trải nghiệm nhưng chưa mô tả đủ năng lượng hoặc độ nhất quán.',
          'Kế hoạch quá khó sống dễ tạo chu kỳ siết chặt rồi ăn bù.',
        ],
      },
      {
        title: 'Phản hồi sinh học và hành vi',
        explanation: 'Khi ăn thiếu và giảm cân, đói có thể tăng, NEAT và tiêu hao có thể giảm, hiệu suất hoặc giấc ngủ có thể thay đổi. Đây là thích nghi, không phải cơ thể “hỏng”.',
        points: [
          'Chu kỳ kinh, stress, thuốc và tình trạng sức khỏe có thể ảnh hưởng cân và trải nghiệm.',
          'Khác biệt về đáp ứng không xóa nguyên lý năng lượng, nhưng làm liều thực tế cần được theo dõi.',
          'Tốc độ phù hợp phải cân bằng kết quả, sức khỏe, hiệu suất và khả năng duy trì.',
        ],
      },
      {
        title: 'Sai số phép đo',
        explanation: 'Cân nặng thay đổi vì nước, glycogen, lượng thức ăn và thời điểm đo. Một tuần hoặc một điểm đơn có thể làm hai người trông rất khác dù xu hướng mỡ chưa khác tương ứng.',
        points: [
          'Chuẩn hóa điều kiện đo và dùng trung bình nếu việc cân không gây hại tâm lý.',
          'Đối chiếu thêm vòng eo, ảnh, hiệu suất, đói, ngủ và mức thực hiện.',
          'Đổi một biến, đặt ngày rà và giữ đủ lâu trước khi kết luận.',
        ],
      },
    ],
    misconceptions: [
      ['Giảm chậm nghĩa là thiếu kỷ luật', 'Tốc độ chịu ảnh hưởng của điểm xuất phát, dữ liệu, thích nghi và phép đo.'],
      ['Chững cân luôn cần cắt thêm', 'Cần kiểm tra xu hướng, nhiễu và mức thực hiện trước khi thay liều.'],
      ['Người khác giảm nhanh nên cách của họ hợp với mình', 'Kết quả của người khác không xác định nhu cầu, rủi ro hay bối cảnh của bạn.'],
    ],
    evidenceNote: 'Các mô hình dự đoán cân nặng có giá trị ở mức quần thể nhưng sai số ở cá nhân. Cá nhân hóa tốt là vòng lặp giả thuyết – thử – rà, không phải đoán trước hoàn hảo.',
    workedExample: 'Hai người cùng báo ăn 1.700 kcal. Một người có công việc đứng nhiều, người kia ngồi cả ngày; cách cân dầu và cuối tuần cũng khác. Thay vì so tốc độ, mỗi người chuẩn hóa dữ liệu của chính mình.',
    practiceExample: 'Lập bảng bốn lớp: điểm xuất phát, thực hiện, phản ứng, sai số. Chọn lớp có bằng chứng yếu nhất và thu thêm đúng một dữ liệu trong bảy ngày.',
    reviewQuestions: ['Bạn đang thiếu dữ liệu ở lớp nào?', 'Kết luận hiện tại có dựa vào một tuần nhiễu không?', 'Điều chỉnh nào nhỏ nhất nhưng kiểm chứng được?'],
  },
  8: {
    bigQuestion: 'Làm sao ước tính “tôi cần ăn bao nhiêu” mà không biến công thức thành mệnh lệnh?',
    opening: 'Nhu cầu năng lượng và dưỡng chất là một khoảng khởi đầu. Công thức đưa ra giả thuyết dựa trên dữ liệu đầu vào; cơ thể và đời sống cung cấp phản hồi để hiệu chỉnh.',
    sections: [
      {
        title: 'Từ RMR đến TDEE',
        explanation: 'Ước tính thường bắt đầu bằng RMR/BMR rồi nhân hệ số hoạt động. Sai số có thể đến từ tuổi, chiều cao, cân nặng, thành phần cơ thể và việc chọn hệ số.',
        points: [
          'Không cộng calories đồng hồ và hệ số hoạt động hai lần.',
          'Chọn hệ số theo tuần sống thật, không theo danh tính “người tập chăm”.',
          'Đặt khoảng thay vì một số tuyệt đối để có chỗ cho biến thiên ngày.',
        ],
      },
      {
        title: 'Chuyển mục tiêu thành liều khởi đầu',
        explanation: 'Giảm mỡ cần mức thiếu hụt phù hợp; tăng cân cần mức dư có kiểm soát; duy trì vẫn là một mục tiêu chủ động. Liều lớn hơn không tự động tốt hơn.',
        points: [
          'Giữ protein, chất xơ, vi chất và trải nghiệm ăn khi điều chỉnh tổng năng lượng.',
          'Phân bổ macro theo mục tiêu, sở thích, hiệu suất và khả năng tiêu hóa.',
          'Người có cân nặng bình thường nhưng dấu hiệu ăn thiếu không nên tiếp tục cắt chỉ vì công thức.',
        ],
      },
      {
        title: 'Hiệu chỉnh bằng xu hướng',
        explanation: 'Theo dõi đủ lâu để tách tín hiệu khỏi nhiễu. Nếu xu hướng không phù hợp, kiểm tra dữ liệu và mức thực hiện trước khi thay đổi nhỏ.',
        points: [
          'Đánh giá cả cân, vòng eo, hiệu suất, đói, ngủ, chu kỳ và mức thực hiện.',
          'Thay đổi nhỏ giúp biết phản ứng đến từ đâu và giảm rủi ro quá liều.',
          'Đặt điều kiện giữ, chỉnh, dừng hoặc chuyển tuyến từ trước.',
        ],
      },
    ],
    misconceptions: [
      ['TDEE là con số cố định suốt đời', 'Nó thay đổi theo cân nặng, vận động, sinh lý và giai đoạn sống.'],
      ['Ăn đúng từng kcal mới có kết quả', 'Sai số nhãn, cân đong và nhu cầu khiến khoảng nhất quán thực tế hơn.'],
      ['Cắt 1.000 kcal nhanh gấp đôi cắt 500', 'Phản hồi đói, mệt, giảm NEAT và rủi ro sức khỏe làm quan hệ không tuyến tính.'],
    ],
    evidenceNote: 'Công thức nhu cầu được xây từ nhóm người và có sai số dự đoán. Nó hữu ích để bắt đầu khi được kiểm chứng bằng xu hướng cá nhân và cổng an toàn.',
    workedExample: 'Một phép tính cho 2.050 kcal duy trì không có nghĩa mọi ngày phải đúng 2.050. Người học bắt đầu bằng khoảng 1.950–2.150, giữ cấu trúc bữa và rà xu hướng sau thời gian đã định.',
    practiceExample: 'Ghi nguồn dữ liệu, công thức, hệ số, khoảng kết quả và ba điều có thể làm ước tính sai. Chọn ngày rà thay vì đổi mục tiêu mỗi sáng.',
    reviewQuestions: ['Đầu vào nào của phép tính đang yếu nhất?', 'Bạn đang cần duy trì, giảm hay tăng trong giai đoạn này?', 'Điều kiện nào cho biết nên giữ, chỉnh hoặc dừng?'],
  },
  9: {
    bigQuestion: 'Làm sao biến mục tiêu dinh dưỡng thành thực đơn có thể sống qua ngày bận, ăn ngoài và thay đổi lịch?',
    opening: 'Thực đơn tốt là hệ thống quyết định, không phải danh sách món cố định. Nó cần cấu trúc bữa, khẩu phần linh hoạt, phương án thay thế và cách mua – chuẩn bị phù hợp đời sống.',
    sections: [
      {
        title: 'Xây khung trước khi chọn món',
        explanation: 'Mỗi cơ hội ăn có thể bắt đầu từ protein, rau/quả, nguồn carbohydrate và chất béo phù hợp. Số bữa và cách phân bổ tùy lịch, không có một nhịp bắt buộc.',
        points: [
          'Neo protein giúp giữ cấu trúc khi món thay đổi.',
          'Rau, quả và nguồn tinh bột nguyên hạt hỗ trợ chất xơ và vi chất.',
          'Khẩu phần phải phù hợp tổng ngày và cảm giác, không cần chiếc đĩa hoàn hảo.',
        ],
      },
      {
        title: 'Hệ thay thế tương đương theo chức năng',
        explanation: 'Thay món nên dựa trên vai trò và khẩu phần, không chỉ tên nhóm. Cơm, bún, khoai có thể thay nhau trong ngữ cảnh nhưng lượng và cách nấu làm giá trị khác.',
        points: [
          'Chuẩn bị ba mức: nấu đủ, lắp ráp nhanh và mua ngoài.',
          'Giữ danh sách nguồn đạm, rau và tinh bột quen thuộc quanh nhà hoặc nơi làm.',
          'Ăn ngoài dùng nguyên tắc ưu tiên, không dùng tâm lý “hỏng cả ngày”.',
        ],
      },
      {
        title: 'Meal prep theo nút thắt',
        explanation: 'Không cần nấu đủ bảy ngày nếu nút thắt chỉ là bữa trưa thứ Ba và thứ Năm. Chuẩn bị thành phần linh hoạt thường bền hơn hộp giống nhau.',
        points: [
          'Chọn một đến hai protein, một nền tinh bột và rau dễ luân chuyển.',
          'Dự phòng thực phẩm bảo quản được cho ngày lịch vỡ.',
          'Tính cả chi phí, tủ lạnh, dụng cụ, người ăn cùng và an toàn thực phẩm.',
        ],
      },
    ],
    misconceptions: [
      ['Thực đơn càng chi tiết càng dễ theo', 'Quá chi tiết có thể vỡ khi lịch đổi; quy tắc thay thế tạo tính bền.'],
      ['Meal prep nghĩa là ăn một món cả tuần', 'Có thể chuẩn bị thành phần nền rồi phối món khác nhau.'],
      ['Ăn ngoài không thể kiểm soát', 'Ước tính hợp lý và ưu tiên cấu trúc bữa vẫn tạo được tính nhất quán.'],
    ],
    evidenceNote: 'Một thực đơn chỉ có giá trị nếu vừa đáp ứng dinh dưỡng vừa được thực hiện. Tính khả thi là kết quả cần đo riêng, không phải chi tiết phụ.',
    workedExample: 'Thay vì giao bảy ngày món cố định, An có ba mẫu bữa trưa: cơm nhà, tô bún có thêm đạm và rau, hoặc sữa chua – trái cây – bánh mì – trứng khi họp liên tục.',
    practiceExample: 'Thiết kế một ngày với ba lớp: phương án A nấu, B lắp ráp, C mua ngoài. Viết quy tắc thay thế cho nguồn đạm và tinh bột.',
    reviewQuestions: ['Bữa nào là nút thắt thật sự?', 'Phương án dự phòng của bạn cần ít hơn năm phút là gì?', 'Quy tắc thay món có giữ đúng chức năng và khẩu phần không?'],
  },
  10: {
    bigQuestion: 'Dữ liệu nào đủ để biết kế hoạch đang hiệu quả mà không biến theo dõi thành giám sát ám ảnh?',
    opening: 'Tiến độ là tập hợp nhiều tín hiệu: kết quả, hành vi, trải nghiệm và an toàn. Một chỉ số không có quyền đại diện toàn bộ cơ thể hoặc quyết định giá trị của kế hoạch.',
    sections: [
      {
        title: 'Bốn lớp bảng điều khiển',
        explanation: 'Kết quả cho biết hướng; hành vi cho biết kế hoạch có được làm; trải nghiệm cho biết giá phải trả; an toàn quyết định có được tiếp tục.',
        points: [
          'Cân, vòng eo và ảnh trả lời các câu hỏi khác nhau và đều có sai số.',
          'Hiệu suất, đói, ngủ, tiêu hóa và chu kỳ giúp nhìn chất lượng quá trình.',
          'Mức thực hiện cần được đo trung tính để phân biệt liều không hiệu quả với kế hoạch chưa chạy.',
        ],
      },
      {
        title: 'Chuẩn hóa để đọc xu hướng',
        explanation: 'Điều kiện đo nhất quán làm giảm nhiễu nhưng không xóa hết. Trung bình nhiều điểm có thể hữu ích khi việc cân phù hợp tâm lý.',
        points: [
          'So các giai đoạn tương đương thay vì một ngày sau ăn mặn với một ngày bình thường.',
          'Ghi yếu tố gây nhiễu như kỳ kinh, tập nặng, đi xa hoặc táo bón.',
          'Đặt lịch rà trước để tránh đổi kế hoạch theo cảm xúc từng ngày.',
        ],
      },
      {
        title: 'Sáu quyết định sau rà soát',
        explanation: 'Kết quả không chỉ có thành công hoặc thất bại. Có thể giữ, điều chỉnh, đơn giản hóa, nghỉ duy trì, dừng hoặc chuyển tuyến.',
        points: [
          'Chỉ đổi một biến chính để giữ khả năng học từ dữ liệu.',
          'Nếu kết quả tốt nhưng trải nghiệm xấu, kế hoạch vẫn cần sửa.',
          'Nếu có cờ đỏ hoặc xung đột điều trị, an toàn vượt lịch rà.',
        ],
      },
    ],
    misconceptions: [
      ['Cân không giảm tuần này là thất bại', 'Một tuần có thể bị che bởi nước và nhiễu; cần xu hướng cùng chỉ số hỗ trợ.'],
      ['Càng ghi nhiều dữ liệu càng chính xác', 'Quá tải ghi chép có thể làm giảm thực hiện và tăng ám ảnh.'],
      ['Kết quả đúng nghĩa là kế hoạch tốt', 'Nếu đói, mệt, chu kỳ hoặc sức khỏe xấu đi, giá phải trả không phù hợp.'],
    ],
    evidenceNote: 'Độ tin cậy của phép đo, độ nhạy với thay đổi và tác động tâm lý đều cần cân nhắc. Bảng điều khiển tối thiểu thường tốt hơn thu thập mọi thứ.',
    workedExample: 'Cân trung bình của Mai đứng yên hai tuần nhưng vòng eo giảm, mức tạ tăng và cô vừa bước vào giai đoạn trước kỳ kinh. Quyết định là giữ thêm một chu kỳ đo thay vì cắt ăn ngay.',
    practiceExample: 'Chọn tối đa bốn chỉ số: một kết quả, một hành vi, một trải nghiệm, một an toàn. Viết tần suất đo và ngày quyết định.',
    reviewQuestions: ['Mỗi chỉ số của bạn đang trả lời câu hỏi gì?', 'Nhiễu nào cần ghi chú?', 'Kết quả và trải nghiệm đang đi cùng hay ngược hướng?'],
  },
  11: {
    bigQuestion: 'Ăn trước, trong và sau tập cần chính xác đến đâu để hỗ trợ hiệu suất mà không làm đời sống phức tạp?',
    opening: 'Dinh dưỡng quanh buổi tập phụ thuộc loại buổi, thời lượng, cường độ, mục tiêu và khả năng tiêu hóa. Tổng ngày vẫn là nền; timing là lớp tối ưu thêm khi có nhu cầu thật.',
    sections: [
      {
        title: 'Trước tập: đủ nhiên liệu và dễ chịu',
        explanation: 'Bữa trước tập cung cấp carbohydrate, protein và dịch; lượng chất béo, chất xơ hoặc khẩu phần lớn cần điều chỉnh theo thời gian còn lại và dung nạp.',
        points: [
          'Càng gần giờ tập, bữa thường càng nhỏ và dễ tiêu hơn.',
          'Không cần tập bụng đói để đốt mỡ nếu điều đó làm giảm chất lượng buổi tập.',
          'Thử trong buổi tập thường, không thử món mới trước thi đấu hoặc buổi quan trọng.',
        ],
      },
      {
        title: 'Trong tập: phần lớn buổi ngắn chỉ cần đơn giản',
        explanation: 'Nước thường đủ cho buổi sức mạnh hoặc vận động ngắn trong điều kiện bình thường. Carbohydrate và điện giải trở nên đáng cân nhắc hơn khi buổi dài, nóng hoặc cường độ cao.',
        points: [
          'Kế hoạch dịch dựa trên mồ hôi, thời tiết và khả năng uống, không ép theo người khác.',
          'Đồ uống thể thao là công cụ có bối cảnh, không mặc định tốt hoặc xấu.',
          'Đau đầu, chóng mặt hoặc chuột rút không có một nguyên nhân duy nhất.',
        ],
      },
      {
        title: 'Sau tập: bắt đầu phục hồi, không chạy đua phút vàng',
        explanation: 'Protein, carbohydrate, dịch và bữa ăn tiếp theo hỗ trợ sửa chữa và tái tạo. Mức khẩn cấp phụ thuộc thời gian tới buổi kế tiếp và tổng ngày.',
        points: [
          'Phân bố protein qua ngày quan trọng hơn săn một cửa sổ vài phút.',
          'Carbohydrate cần ưu tiên hơn khi phải tập lại sớm hoặc khối lượng cao.',
          'Một bữa ăn bình thường có thể thay shake nếu thuận tiện và đáp ứng nhu cầu.',
        ],
      },
    ],
    misconceptions: [
      ['Không uống whey ngay sẽ mất cơ', 'Cửa sổ đồng hóa rộng hơn; tổng protein và phân bố mới là nền.'],
      ['Tập dưới một giờ bắt buộc uống điện giải', 'Nhiều buổi chỉ cần nước; xem nhiệt, mồ hôi và bữa ăn.'],
      ['Ăn trước tập làm không đốt mỡ', 'Sử dụng nhiên liệu trong buổi không đồng nghĩa kết quả mỡ dài hạn.'],
    ],
    evidenceNote: 'Khuyến nghị thể thao thường đưa khoảng theo kg và thời gian. Người học nên bắt đầu ở mức đơn giản, thử dung nạp và tăng độ chính xác khi khối lượng tập đòi hỏi.',
    workedExample: 'Buổi tập 18 giờ sau ngày làm việc: bữa trưa lúc 12 giờ quá xa. Một bữa phụ lúc 16 giờ có sữa chua và chuối giúp dễ thực hiện hơn việc cố ăn bữa lớn sát giờ.',
    practiceExample: 'Chọn một buổi thật. Viết mục tiêu, thời lượng, bữa trước, kế hoạch trong buổi và bữa sau. Đánh giá năng lượng, tiêu hóa và hiệu suất.',
    reviewQuestions: ['Buổi tập này có thật sự cần chiến lược trong buổi không?', 'Khoảng cách từ bữa trước đến giờ tập là bao lâu?', 'Điều gì cần thử trước ở buổi ít quan trọng?'],
  },
  12: {
    bigQuestion: 'Phục hồi tốt là ăn gì sau tập hay là khả năng cân bằng toàn bộ stress, giấc ngủ và năng lượng?',
    opening: 'Tập luyện tạo kích thích; phục hồi cho phép thích nghi. Dinh dưỡng là một trụ cùng giấc ngủ, quản lý tải tập và thời gian. Không thực phẩm hoặc viên bổ sung nào bù được hệ phục hồi đang vỡ.',
    sections: [
      {
        title: 'Ba nhiệm vụ dinh dưỡng phục hồi',
        explanation: 'Cơ thể cần sửa chữa mô, tái tạo nhiên liệu và bù dịch. Mức ưu tiên mỗi nhiệm vụ phụ thuộc loại buổi và lịch tập kế tiếp.',
        points: [
          'Protein cung cấp amino acid cho sửa chữa và thích nghi.',
          'Carbohydrate tái tạo glycogen, đặc biệt quan trọng khi tập dày hoặc sức bền.',
          'Dịch và natri được cá nhân hóa theo lượng mồ hôi và điều kiện.',
        ],
      },
      {
        title: 'Năng lượng sẵn có và tải tổng',
        explanation: 'Ăn thiếu kéo dài trong khi tập nặng có thể ảnh hưởng hiệu suất, hormone, xương, miễn dịch và tâm trạng. Cần nhìn tổng tải từ tập, công việc và đời sống.',
        points: [
          'Mệt kéo dài không tự động do thiếu một viên bổ sung.',
          'Chu kỳ thay đổi, chấn thương lặp lại, hiệu suất giảm và ám ảnh thức ăn là tín hiệu cần chú ý.',
          'Ngày nghỉ vẫn cần dinh dưỡng; phục hồi không chỉ xảy ra ngay sau tập.',
        ],
      },
      {
        title: 'Bổ sung đứng sau nền',
        explanation: 'Một số sản phẩm có bằng chứng trong bối cảnh cụ thể, nhưng chất lượng, liều, tương tác và kiểm nghiệm đều quan trọng. Ưu tiên giải quyết nền ăn và ngủ trước.',
        points: [
          'Không dùng chất kích thích để che thiếu ngủ hoặc quá tải.',
          'Chọn sản phẩm có kiểm nghiệm bên thứ ba khi thi đấu có quy định chống doping.',
          'Không dùng nhiều sản phẩm cùng hoạt chất mà không kiểm tổng liều.',
        ],
      },
    ],
    misconceptions: [
      ['Đau cơ nhiều chứng minh buổi tập hiệu quả', 'Đau cơ không đo chính xác kích thích hay tiến bộ.'],
      ['Ngày nghỉ nên cắt mạnh đồ ăn', 'Ngày nghỉ là lúc cơ thể sửa chữa; nhu cầu có thể khác nhưng không biến mất.'],
      ['Thực phẩm chống viêm xóa được quá tải', 'Một món không thay thế quản lý tải, ngủ và năng lượng.'],
    ],
    evidenceNote: 'Phục hồi là kết quả đa yếu tố. Khi một dấu hiệu thay đổi, cần kiểm cả tải tập, năng lượng, ngủ, bệnh lý và thuốc thay vì quy cho một chất.',
    workedExample: 'Một học viên tăng buổi tập, ngủ năm giờ và dùng pre-workout để cố hoàn thành. Thay vì thêm supplement, kế hoạch giảm tải tạm thời, ưu tiên bữa và ngủ, đồng thời đánh giá chuyên môn nếu triệu chứng kéo dài.',
    practiceExample: 'Chấm bốn trụ trong bảy ngày: năng lượng ăn, protein/carbohydrate, dịch, ngủ/tải. Chọn trụ yếu nhất có thể sửa mà không thêm sản phẩm.',
    reviewQuestions: ['Dấu hiệu phục hồi nào đang xấu đi?', 'Tổng tải ngoài phòng tập có tăng không?', 'Can thiệp đang sửa nguyên nhân hay chỉ che triệu chứng?'],
  },
  13: {
    bigQuestion: 'Giảm mỡ thế nào để kết quả không được mua bằng đói cực đoan, mất cơ hoặc mối quan hệ xấu với thức ăn?',
    opening: 'Giảm mỡ cần thâm hụt năng lượng đủ lâu, nhưng chất lượng kế hoạch được đánh giá thêm bằng sức khỏe, hiệu suất, trải nghiệm và khả năng duy trì. Tốc độ nhanh không phải mục tiêu cao nhất.',
    sections: [
      {
        title: 'Thiết kế mức thiếu hụt có thể chịu được',
        explanation: 'Mức thiếu hụt nhỏ đến vừa thường tạo khoảng cho protein, rau quả, chất xơ và bữa ăn xã hội. Điểm xuất phát và thời hạn làm tốc độ phù hợp khác nhau.',
        points: [
          'Người ít mỡ hoặc tập hiệu suất cao thường cần thận trọng hơn.',
          'Theo dõi đói, ngủ, chu kỳ, tâm trạng và sức mạnh cùng xu hướng hình thể.',
          'Dùng giai đoạn duy trì khi tải đời sống cao hoặc tín hiệu phục hồi xấu.',
        ],
      },
      {
        title: 'Giữ mô nạc và khả năng tập',
        explanation: 'Protein đủ, tập sức mạnh và mức giảm hợp lý hỗ trợ giữ khối nạc. Không có thực phẩm riêng lẻ “đốt” mỡ đúng vùng.',
        points: [
          'Phân bố protein và lựa chọn nguồn phù hợp giúp dễ đạt tổng ngày.',
          'Carbohydrate có thể hỗ trợ hiệu suất, nên không cần loại mặc định.',
          'NEAT dễ giảm khi mệt; theo dõi vận động nền thay vì chỉ thêm cardio.',
        ],
      },
      {
        title: 'Môi trường và chiến lược đói',
        explanation: 'Cấu trúc bữa, thực phẩm giàu thể tích, protein, chất xơ và kế hoạch cho dịp xã hội giúp giảm gánh nặng ý chí. Không cần cấm tuyệt đối món yêu thích.',
        points: [
          'Nhận diện giờ đói mạnh và đặt bữa trước điểm gãy.',
          'Duy trì linh hoạt có kế hoạch tốt hơn chu kỳ hoàn hảo – vỡ kế hoạch.',
          'Dừng giảm khi xuất hiện dấu hiệu rối loạn ăn uống hoặc rủi ro sức khỏe.',
        ],
      },
    ],
    misconceptions: [
      ['Ra mồ hôi nhiều nghĩa là đốt nhiều mỡ', 'Mồ hôi chủ yếu điều nhiệt và làm thay đổi nước ngắn hạn.'],
      ['Không giảm từng tuần nghĩa là phải siết', 'Nhiễu và thích nghi cần được đánh giá trước khi đổi liều.'],
      ['Cheat day giúp tăng trao đổi chất', 'Một ngày ăn quá mức có thể phá tính nhất quán và củng cố tư duy cấm đoán.'],
    ],
    evidenceNote: 'Các nghiên cứu giảm cân cho thấy nhiều cấu trúc ăn có thể hiệu quả khi tạo thâm hụt và được duy trì. Chọn cách phù hợp cá nhân quan trọng hơn tên chế độ.',
    workedExample: 'Mai giảm đều nhưng bắt đầu đói mạnh, ngủ kém và sức mạnh tụt. Thay vì cắt thêm, cô chuyển sang hai tuần duy trì, chuẩn hóa giấc ngủ và rà lại mục tiêu.',
    practiceExample: 'Viết bản thiết kế giảm mỡ gồm tốc độ dự kiến, ba tín hiệu bảo vệ, hai bữa neo, một phương án xã hội và điều kiện tạm dừng.',
    reviewQuestions: ['Giá phải trả hiện tại có tương xứng mục tiêu không?', 'Bạn đang giữ mô nạc bằng những trụ nào?', 'Khi nào giai đoạn duy trì là quyết định tốt hơn tiếp tục cắt?'],
  },
  14: {
    bigQuestion: 'Tăng cơ, tăng cân thế nào để phần tăng phục vụ hiệu suất và sức khỏe thay vì chỉ đẩy con số trên cân?',
    opening: 'Tăng cơ cần kích thích tập luyện, năng lượng, protein và thời gian. Cân tăng nhanh không đồng nghĩa cơ tăng nhanh; mức dư quá lớn thường làm phần mỡ tăng nhiều hơn mà không rút ngắn sinh học thích nghi.',
    sections: [
      {
        title: 'Mức dư vừa đủ và tốc độ phù hợp',
        explanation: 'Bắt đầu bằng mức dư nhỏ, theo dõi xu hướng và điều chỉnh. Người mới, người đã tập lâu và người có điểm xuất phát khác nhau sẽ có tốc độ đáp ứng khác.',
        points: [
          'Cân tăng đầu giai đoạn còn gồm glycogen, nước và lượng thức ăn.',
          'Tốc độ quá nhanh cần kiểm tra tổng năng lượng trước khi coi là “tăng cơ tốt”.',
          'Người khó ăn cần tăng mật độ năng lượng mà vẫn bảo đảm tiêu hóa và vi chất.',
        ],
      },
      {
        title: 'Protein và phân bố bữa',
        explanation: 'Tổng protein đủ là nền, phân bố qua các bữa tạo nhiều cơ hội cung cấp amino acid. Nguồn thực vật có thể đáp ứng khi tổng lượng và độ đa dạng phù hợp.',
        points: [
          'Không cần ép protein rất cao làm mất chỗ của carbohydrate và chất béo.',
          'Bữa sau tập có giá trị nhưng không thay thế cả ngày ăn.',
          'Carbohydrate hỗ trợ khối lượng tập và tái tạo glycogen.',
        ],
      },
      {
        title: 'Giải quyết khó khăn khi ăn nhiều hơn',
        explanation: 'Khẩu phần quá lớn, nhiều chất xơ hoặc quá nhiều bữa có thể làm đầy bụng. Có thể dùng bữa nhỏ hơn, đồ uống giàu dinh dưỡng và nguồn năng lượng đậm đặc.',
        points: [
          'Thêm dầu, hạt, sữa hoặc nguồn phù hợp thay vì chỉ tăng rau và thực phẩm quá no.',
          'Tách dịch lớn khỏi bữa nếu làm giảm khả năng ăn.',
          'Sụt cân không chủ ý hoặc chán ăn kéo dài cần được đánh giá, không chỉ “cố ăn”.',
        ],
      },
    ],
    misconceptions: [
      ['Bulk càng mạnh càng lên cơ nhanh', 'Tốc độ tổng hợp cơ có giới hạn; mức dư lớn tăng nguy cơ tích mỡ.'],
      ['Chỉ cần protein, không cần carbohydrate', 'Tập chất lượng và glycogen góp phần tạo kích thích tăng cơ.'],
      ['Cân không tăng mỗi tuần là thất bại', 'Xu hướng, sai số và hiệu suất cần được đọc cùng nhau.'],
    ],
    evidenceNote: 'Tăng cơ không thể đo trực tiếp bằng cân gia đình. Dùng xu hướng cân, vòng đo, ảnh chuẩn hóa, hiệu suất và thời gian đủ dài để suy luận thận trọng.',
    workedExample: 'Một học viên tăng 2 kg trong hai tuần và cho rằng toàn bộ là cơ. Phần đầu có thể gồm nước và glycogen; kế hoạch giữ thêm dữ liệu thay vì tăng năng lượng tiếp.',
    practiceExample: 'Thiết kế hai cách tăng 200–300 kcal từ thực phẩm quen thuộc: một bữa phụ và một điều chỉnh vào bữa chính. Theo dõi tiêu hóa và hiệu suất.',
    reviewQuestions: ['Tốc độ tăng hiện tại có phù hợp kinh nghiệm tập không?', 'Nút thắt là tổng năng lượng, protein hay khả năng ăn?', 'Chỉ số nào giúp phân biệt tăng cân và tăng cơ?'],
  },
  15: {
    bigQuestion: 'Có thể vừa giảm mỡ vừa tăng cơ không, và khi nào mục tiêu tái cấu trúc cơ thể là thực tế?',
    opening: 'Tái cấu trúc mô tả thay đổi tỷ lệ mỡ và khối nạc, không nhất thiết làm cân đổi nhiều. Khả năng xảy ra phụ thuộc lịch sử tập, điểm xuất phát, năng lượng, protein và chất lượng chương trình.',
    sections: [
      {
        title: 'Ai có cửa sổ thuận lợi hơn',
        explanation: 'Người mới tập, quay lại sau nghỉ, có dự trữ mỡ cao hơn hoặc trước đó ăn/tập chưa phù hợp thường có tiềm năng thấy hai hướng cùng lúc rõ hơn.',
        points: [
          'Người đã tập lâu và khá nạc thường cần kỳ vọng chậm hơn.',
          'Cân đứng yên không chứng minh không có tiến bộ nếu vòng eo và sức mạnh đổi.',
          'Mục tiêu cần đủ dài để vượt sai số đo thành phần cơ thể.',
        ],
      },
      {
        title: 'Các trụ không thể thay thế nhau',
        explanation: 'Tập sức mạnh tạo kích thích; protein cung cấp nguyên liệu; năng lượng và phục hồi cho phép thích nghi. Thiếu một trụ làm kế hoạch yếu dù macro đẹp.',
        points: [
          'Không dùng thâm hụt lớn nếu mục tiêu còn muốn xây cơ.',
          'Theo dõi tiến bộ bài tập thay vì chỉ số cân.',
          'Giấc ngủ và tải đời sống ảnh hưởng khả năng thực hiện lẫn phục hồi.',
        ],
      },
      {
        title: 'Đo tiến độ không bị máy dẫn dắt',
        explanation: 'BIA và các máy thành phần cơ thể nhạy với nước, bữa ăn và điều kiện. Một lần đo không xác nhận lượng cơ tăng hay mỡ giảm.',
        points: [
          'Chuẩn hóa thời điểm và điều kiện nếu lặp máy.',
          'Dùng nhiều kênh: vòng eo, ảnh, quần áo, hiệu suất và cảm nhận.',
          'Nếu dữ liệu xung đột, kéo dài quan sát trước khi đổi lớn.',
        ],
      },
    ],
    misconceptions: [
      ['Recomp luôn nhanh hơn chia giai đoạn', 'Nó thường chậm và phù hợp một số điểm xuất phát hơn.'],
      ['Máy báo tăng cơ 1 kg là sự thật chính xác', 'Hydration và thuật toán có thể tạo thay đổi lớn ngắn hạn.'],
      ['Cần giữ cân tuyệt đối', 'Cân có thể dao động; mục tiêu là hướng của mô và hiệu suất.'],
    ],
    evidenceNote: 'Sai số đo thành phần cơ thể ở cá nhân thường lớn so với thay đổi ngắn hạn. Kết luận nên dựa trên phép đo lặp và các kênh hỗ trợ.',
    workedExample: 'Trong tám tuần cân của Ngọc không đổi, vòng eo giảm, số lần squat tăng và ảnh chuẩn hóa thay đổi nhẹ. Dữ liệu phù hợp với tiến bộ nhưng không cho phép tuyên bố chính xác số kg cơ.',
    practiceExample: 'Chọn bốn kênh theo dõi và viết điều kiện đo. Đặt mốc rà đủ dài, kèm tín hiệu phục hồi để tránh biến recomp thành giảm cân trá hình.',
    reviewQuestions: ['Điểm xuất phát của bạn có thuận lợi cho recomp không?', 'Bạn đang đo kích thích tập bằng gì?', 'Sai số của phép đo hiện tại lớn đến mức nào?'],
  },
  16: {
    bigQuestion: 'Nhu cầu dinh dưỡng của phụ nữ thay đổi thế nào qua chu kỳ, thai kỳ, sau sinh và mãn kinh mà không rơi vào định kiến?',
    opening: 'Phụ nữ không phải một nhóm đồng nhất. Tuổi, chu kỳ, thai kỳ, cho con bú, thuốc, triệu chứng, văn hóa và mục tiêu làm nhu cầu thay đổi. Cá nhân hóa bắt đầu bằng dữ liệu và phối hợp chăm sóc.',
    sections: [
      {
        title: 'Chu kỳ và triệu chứng',
        explanation: 'Cảm giác đói, dịch cơ thể, tiêu hóa và hiệu suất có thể dao động theo chu kỳ nhưng mức độ rất khác giữa người. Không dùng lịch chung để dự đoán chắc chắn.',
        points: [
          'Theo dõi mẫu nhiều chu kỳ trước khi điều chỉnh lớn.',
          'Cân tăng trước kỳ kinh thường liên quan dịch, không tự động là tăng mỡ.',
          'Mất kinh hoặc chu kỳ thay đổi rõ trong bối cảnh tập và ăn thiếu cần được đánh giá.',
        ],
      },
      {
        title: 'Thai kỳ, sau sinh và cho con bú',
        explanation: 'Nhu cầu năng lượng và một số dưỡng chất thay đổi theo giai đoạn, nhưng không có nghĩa “ăn cho hai người”. An toàn thực phẩm, folate, sắt, i-ốt và phối hợp tiền sản rất quan trọng.',
        points: [
          'Không áp dụng giảm cân nhanh hoặc sản phẩm detox trong thai kỳ.',
          'Sau sinh cần tính phục hồi, giấc ngủ, cho con bú, hỗ trợ gia đình và sức khỏe tinh thần.',
          'Supplement và thảo dược cần được kiểm với đội ngũ chăm sóc.',
        ],
      },
      {
        title: 'Tiền mãn kinh và mãn kinh',
        explanation: 'Thay đổi hormone có thể ảnh hưởng triệu chứng, giấc ngủ, xương và phân bố mỡ. Tập sức mạnh, protein, canxi, vitamin D và sức khỏe tim mạch là các trụ đáng chú ý.',
        points: [
          'Không quy mọi tăng cân cho hormone; đồng thời không phủ nhận thay đổi sinh lý thật.',
          'Theo dõi huyết áp, lipid, đường huyết và xương theo hướng dẫn y khoa.',
          'Kế hoạch phải thích nghi với triệu chứng và khả năng phục hồi.',
        ],
      },
    ],
    misconceptions: [
      ['Mọi phụ nữ nên ăn theo từng pha chu kỳ giống nhau', 'Biến thiên cá nhân lớn; theo dõi triệu chứng thật có giá trị hơn lịch cứng.'],
      ['Mãn kinh làm giảm mỡ bất khả thi', 'Khó khăn có thể tăng nhưng hành vi, tập luyện và chăm sóc vẫn tạo thay đổi.'],
      ['Sau sinh phải nhanh lấy lại vóc dáng', 'Phục hồi, nuôi con và sức khỏe tinh thần có ưu tiên cao hơn áp lực hình thể.'],
    ],
    evidenceNote: 'Nhiều tuyên bố “cycle syncing” vượt quá bằng chứng hiện có. Dữ liệu cá nhân giúp điều chỉnh trải nghiệm nhưng không thay thế khám và hướng dẫn sản khoa.',
    workedExample: 'Một học viên thấy cân tăng 1 kg trước kỳ kinh và muốn cắt ăn. Nhật ký ba chu kỳ cho thấy cân trở lại sau vài ngày; quyết định là giữ kế hoạch và dùng trung bình theo pha tương đương.',
    practiceExample: 'Lập dòng thời gian 4–8 tuần về chu kỳ/giai đoạn sống, giấc ngủ, triệu chứng, tập và bữa ăn. Đánh dấu điều cần tự điều chỉnh và điều cần hỏi chuyên môn.',
    reviewQuestions: ['Dữ liệu nào lặp lại qua nhiều chu kỳ?', 'Giai đoạn sống hiện tại đổi ưu tiên nào?', 'Nội dung nào vượt phạm vi coach và cần chuyển tuyến?'],
  },
  17: {
    bigQuestion: 'Khi có bệnh lý hoặc tình trạng đặc biệt, đâu là ranh giới giữa giáo dục dinh dưỡng và điều trị?',
    opening: 'Bệnh lý làm thay đổi rủi ro, mục tiêu và quyền quyết định. Nội dung chương chỉ phục vụ giáo dục: không chẩn đoán, kê đơn, đổi thuốc hoặc thay kế hoạch dinh dưỡng điều trị.',
    sections: [
      {
        title: 'Bắt đầu bằng hồ sơ an toàn',
        explanation: 'Cần biết chẩn đoán đã xác nhận, thuốc và supplement, dị ứng, triệu chứng, hướng dẫn đang có và người phụ trách điều trị. Không suy đoán từ tên bệnh hoặc mạng xã hội.',
        points: [
          'Thuốc có thể ảnh hưởng glucose, huyết áp, tiêu hóa, đói hoặc điện giải.',
          'Bệnh thận, tim, gan và nội tiết có thể thay đổi cách dùng protein, dịch, natri hoặc carbohydrate.',
          'Một lời khuyên phổ thông có thể không còn ít rủi ro trong bối cảnh bệnh lý.',
        ],
      },
      {
        title: 'Phân vai và bàn giao',
        explanation: 'Coach có thể hỗ trợ ghi chép, chuẩn bị câu hỏi, thực hiện hướng dẫn đã có và xây môi trường. Chẩn đoán và điều trị thuộc người có thẩm quyền phù hợp.',
        points: [
          'Không tự diễn giải xét nghiệm để đặt phác đồ.',
          'Không yêu cầu dừng hoặc đổi thuốc vì kết quả tập luyện.',
          'Ghi rõ ai quyết định gì và đường liên lạc khi dữ liệu thay đổi.',
        ],
      },
      {
        title: 'Cờ đỏ có quyền dừng mọi thử nghiệm',
        explanation: 'Đau ngực, khó thở bất thường, ngất, phản ứng dị ứng nặng, dấu hiệu hạ glucose hoặc triệu chứng cấp cần hành động theo kế hoạch y khoa, không chờ ngày rà.',
        points: [
          'Sụt cân không chủ ý, nôn kéo dài, máu trong phân hoặc hành vi ăn uống nguy cơ cần được đánh giá.',
          'Chuyển tuyến không phải thất bại coaching; đó là quyết định đúng phạm vi.',
          'Sau khi có hướng dẫn chuyên môn, coach hỗ trợ biến hướng dẫn thành hành vi thực tế.',
        ],
      },
    ],
    misconceptions: [
      ['Thực phẩm tự nhiên không tương tác thuốc', 'Thực phẩm và thảo dược vẫn có thể ảnh hưởng hấp thu hoặc tác dụng thuốc.'],
      ['Giảm cân luôn cải thiện mọi bệnh', 'Mục tiêu và mức an toàn phụ thuộc bệnh, thuốc và tình trạng cá nhân.'],
      ['Coach có dữ liệu nhiều thì có thể chẩn đoán', 'Dữ liệu hỗ trợ mô tả và chuyển tuyến, không tạo quyền điều trị.'],
    ],
    evidenceNote: 'Khuyến nghị lâm sàng được xây cho chẩn đoán và mức độ cụ thể. Không sao chép hướng dẫn của một bệnh sang người chưa được lượng giá.',
    workedExample: 'Một học viên dùng thuốc hạ đường huyết muốn bỏ toàn bộ tinh bột khi tăng tập. Coach không tự chỉnh bữa; họ giúp ghi lịch ăn – tập và chuyển câu hỏi đến đội ngũ điều trị trước khi thay đổi.',
    practiceExample: 'Tạo hộ chiếu an toàn một trang: chẩn đoán đã xác nhận, thuốc/supplement, dị ứng, hướng dẫn hiện có, cờ đỏ, liên hệ và phần coach được phép hỗ trợ.',
    reviewQuestions: ['Quyết định này là giáo dục hay điều trị?', 'Ai đang phụ trách kế hoạch y khoa?', 'Dấu hiệu nào phải dừng và liên hệ ngay?'],
  },
  18: {
    bigQuestion: 'Làm sao đọc một tuyên bố dinh dưỡng để không bị thuyết phục bởi sự tự tin, ảnh trước–sau hay một nghiên cứu đơn lẻ?',
    opening: 'Bằng chứng không chỉ là “có nghiên cứu”. Câu hỏi, thiết kế, đối tượng, phép đo, độ lớn hiệu ứng, giới hạn và tổng thể tài liệu quyết định kết luận có dùng được hay không.',
    sections: [
      {
        title: 'Tách tuyên bố thành câu hỏi kiểm chứng',
        explanation: 'Hỏi sản phẩm hoặc chế độ được so với gì, ở ai, trong bao lâu và đo kết quả nào. Tuyên bố càng tuyệt đối càng cần tiêu chuẩn bằng chứng cao.',
        points: [
          'Cơ chế hợp lý không tự chứng minh hiệu quả ngoài đời.',
          'Liên hệ quan sát không tự chứng minh nguyên nhân.',
          'Kết quả thay thế như một biomarker không luôn đồng nghĩa kết quả sức khỏe quan trọng.',
        ],
      },
      {
        title: 'Đọc thiết kế và sai lệch',
        explanation: 'Thử nghiệm ngẫu nhiên, nghiên cứu quan sát, tổng quan hệ thống và báo cáo ca trả lời các loại câu hỏi khác nhau. Không có thiết kế nào hoàn hảo.',
        points: [
          'Cỡ mẫu, bỏ cuộc, thời gian và cách đo ảnh hưởng độ tin cậy.',
          'Nguy cơ sai lệch, tài trợ và xung đột lợi ích cần được công khai nhưng không tự động vô hiệu kết quả.',
          'Kết quả có ý nghĩa thống kê chưa chắc có ý nghĩa thực tế lớn.',
        ],
      },
      {
        title: 'Tam giác bằng chứng – chuyên môn – giá trị',
        explanation: 'Quyết định tốt kết hợp bằng chứng tốt nhất hiện có, năng lực chuyên môn và ưu tiên cá nhân. Khi bất định cao, hành động nên thận trọng và dễ đảo ngược.',
        points: [
          'Tìm sự nhất quán giữa nhiều nguồn thay vì trích một nghiên cứu thuận ý.',
          'Kiểm xem đối tượng nghiên cứu có giống người đang áp dụng không.',
          'Cập nhật kết luận khi bằng chứng mới mạnh hơn xuất hiện.',
        ],
      },
    ],
    misconceptions: [
      ['Có DOI nghĩa là nghiên cứu chắc chắn đúng', 'Xuất bản không xóa sai lệch, giới hạn hay khả năng không lặp lại.'],
      ['Nghiên cứu quan sát là vô dụng', 'Nó hữu ích cho câu hỏi dài hạn và tín hiệu, nhưng cần giới hạn suy luận nhân quả.'],
      ['Chuyên gia bất đồng nghĩa khoa học vô nghĩa', 'Bất đồng có thể đến từ câu hỏi, ngưỡng bằng chứng hoặc giá trị khác nhau.'],
    ],
    evidenceNote: 'Một kết luận tốt phải nói được cả điều bằng chứng hỗ trợ, điều chưa biết và hành động tương xứng. Ngôn ngữ chắc chắn vượt dữ liệu là tín hiệu cảnh báo.',
    workedExample: 'Quảng cáo nói một loại trà “tăng đốt mỡ 30%”. Người học hỏi: 30% của chỉ số nào, trong bao lâu, có làm giảm mỡ thực tế không, mẫu bao nhiêu người và so với gì.',
    practiceExample: 'Chọn một bài đăng. Viết PICO đơn giản, loại thiết kế, kết quả chính, độ lớn, giới hạn, xung đột và câu kết luận thận trọng một câu.',
    reviewQuestions: ['Tuyên bố chính xác đang nói về kết quả nào?', 'Thiết kế cho phép kết luận nhân quả không?', 'Hành động đề xuất có tương xứng độ chắc chắn không?'],
  },
  19: {
    bigQuestion: 'Vì sao biết điều đúng chưa đủ và làm sao biến quyết định tốt thành hành vi lặp lại trong đời thật?',
    opening: 'Hành vi xuất hiện khi năng lực, cơ hội và động lực gặp nhau trong một bối cảnh cụ thể. Kế hoạch bền vững làm hành vi mong muốn dễ hơn, có tín hiệu rõ và có cách nối lại sau gián đoạn.',
    sections: [
      {
        title: 'Chẩn đoán hành vi, không phán xét người',
        explanation: 'Hỏi người học có biết cách làm, có công cụ – thời gian – môi trường và có lý do đủ gần không. Cùng một hành vi bỏ bữa có thể cần giải pháp khác nhau.',
        points: [
          'Thiếu kỹ năng cần làm mẫu; thiếu cơ hội cần đổi môi trường; thiếu động lực cần nối hành vi với giá trị.',
          'Ý chí dao động theo ngủ, stress và cảm giác tiến bộ.',
          'Mục tiêu mơ hồ phải được đổi thành hành vi có thời điểm và bối cảnh.',
        ],
      },
      {
        title: 'Thiết kế tín hiệu và ma sát',
        explanation: 'Đặt hành vi sau một thói quen sẵn có, chuẩn bị vật dụng trước và giảm số quyết định. Đồng thời tăng ma sát cho lựa chọn muốn hạn chế mà không tạo cấm đoán.',
        points: [
          '“Sau khi pha cà phê, tôi lấy bữa sáng đã chuẩn bị” rõ hơn “ăn lành mạnh”.',
          'Môi trường cần phù hợp cả nhà, ngân sách và lịch làm việc.',
          'Phiên bản tối thiểu giữ chuỗi trong ngày khó, phiên bản đầy đủ dùng khi có nguồn lực.',
        ],
      },
      {
        title: 'Nối lại là một phần của kế hoạch',
        explanation: 'Gián đoạn do du lịch, ốm hoặc công việc không phải ngoại lệ hiếm. Viết quy tắc quay lại giúp tránh tư duy phải bắt đầu từ số 0.',
        points: [
          'Rà theo tuần, không tự xét xử sau từng bữa.',
          'Đo mức thực hiện và độ khó, không chỉ kết quả hình thể.',
          'Khi hành vi không chạy, giảm độ khó hoặc sửa bối cảnh trước khi tăng kỷ luật.',
        ],
      },
    ],
    misconceptions: [
      ['Làm 21 ngày sẽ tự thành thói quen', 'Thời gian khác nhau theo hành vi, bối cảnh và mức lặp lại.'],
      ['Kỷ luật là làm đúng dù thế nào', 'Hệ tốt có phương án cho ngày khó và biết khi nào cần nghỉ.'],
      ['Bỏ một lần làm mất chuỗi', 'Khả năng nối lại mới là kỹ năng dự báo tính bền.'],
    ],
    evidenceNote: 'Can thiệp hành vi hiệu quả thường cụ thể hóa bối cảnh, phản hồi và môi trường. Không có một kỹ thuật duy nhất phù hợp mọi hành vi.',
    workedExample: 'Mục tiêu “uống đủ nước” được đổi thành đặt chai cạnh máy tính, uống vài ngụm sau mỗi cuộc họp và có mức tối thiểu cho ngày đi ngoài. Sau một tuần, người học rà độ thuận tiện.',
    practiceExample: 'Viết một kế hoạch Nếu–Thì, phiên bản tối thiểu, tín hiệu, ma sát cần giảm và quy tắc nối lại trong 24 giờ sau gián đoạn.',
    reviewQuestions: ['Nút thắt là năng lực, cơ hội hay động lực?', 'Hành vi đã gắn với tín hiệu cụ thể chưa?', 'Quy tắc nối lại của bạn là gì?'],
  },
  20: {
    bigQuestion: 'Trở thành “chuyên gia của chính mình” là tự quyết mọi thứ hay biết điều hành, kiểm chứng và gọi đúng người?',
    opening: 'Tự chủ không phải tự cô lập hoặc tự chẩn đoán. Đó là khả năng hiểu dữ liệu đủ dùng, đặt ưu tiên, thử thay đổi rủi ro thấp, rà kết quả và chuyển tuyến đúng lúc.',
    sections: [
      {
        title: 'Hệ điều hành dinh dưỡng cá nhân',
        explanation: 'Một hệ tốt có hướng sức khỏe, mùa hiện tại, bữa mặc định, hộ chiếu an toàn, bảng điều khiển tối thiểu và mạng lưới hỗ trợ. Nó giảm quyết định không cần thiết nhưng vẫn cập nhật được.',
        points: [
          'Sao Bắc Đẩu sức khỏe nói điều muốn bảo vệ, không chỉ con số muốn đạt.',
          'Mùa xây, giảm, duy trì hoặc phục hồi có ưu tiên khác nhau.',
          'Danh sách thuốc, supplement, dị ứng và cờ đỏ phải là dữ liệu sống.',
        ],
      },
      {
        title: 'Thử nghiệm rủi ro thấp theo AURA 6Đ',
        explanation: 'Bắt đầu từ dữ kiện, đặt giả thuyết, chọn một điều chỉnh, theo dõi dữ liệu, đến ngày rà rồi quyết định. Viết trước điều kiện dừng để kỳ vọng không kéo kết luận đi.',
        points: [
          'Tách kết quả sinh học, mức thực hiện và trải nghiệm.',
          'Ghi yếu tố gây nhiễu thay vì cố kiểm soát đời sống hoàn hảo.',
          'Kết quả hỗn hợp cho phép giữ một phần và sửa một phần.',
        ],
      },
      {
        title: 'Tốt nghiệp vẫn giữ mạng lưới',
        explanation: 'Năng lực trưởng thành đi từ làm theo, giải thích, thích nghi đến chuyển tuyến. Người học không cần biết hết; cần biết giới hạn và chuẩn bị cuộc trao đổi tốt.',
        points: [
          'Coach giảm dần quyết định thay và tăng câu hỏi có cấu trúc.',
          'Bác sĩ, chuyên gia dinh dưỡng, PT và người học có vai trò khác nhau.',
          'Kế hoạch năm cần các mùa, mốc rà và phương án khi đời sống thay đổi.',
        ],
      },
    ],
    misconceptions: [
      ['Tự chủ nghĩa là không cần chuyên gia', 'Tự chủ mạnh gồm khả năng gọi hỗ trợ đúng lúc và chuẩn bị dữ liệu tốt.'],
      ['Cá nhân hóa là cần thật nhiều thiết bị', 'Dữ liệu tối thiểu, câu hỏi rõ và vòng thử tốt thường có giá trị hơn dashboard quá tải.'],
      ['Kế hoạch tốt dùng mãi không đổi', 'Mục tiêu, sức khỏe và mùa đời sống đổi nên hệ phải được rà và cập nhật.'],
    ],
    evidenceNote: 'Tự quản và ra quyết định chia sẻ là năng lực có thể phát triển. Dữ liệu tự báo cáo có sai số nhưng vẫn hữu ích khi được dùng để tạo câu hỏi thay vì tuyên bố chắc chắn.',
    workedExample: 'Mai bước vào ba tuần bận và đổi mục tiêu từ giảm mỡ sang duy trì năng lượng. Cô chọn ba phương án bữa trưa, đặt ngày rà và nhờ coach kiểm cổng an toàn thay vì xin phép từng món.',
    practiceExample: 'Tạo Hệ điều hành 1.0 một trang: Sao Bắc Đẩu, mùa hiện tại, ba bữa mặc định, hộ chiếu an toàn, bốn dữ liệu, một thẻ thử nghiệm và mạng lưới đúng người.',
    reviewQuestions: ['Quyết định nào bạn đã có thể tự giải thích và thích nghi?', 'Dữ liệu tối thiểu nào thật sự giúp quyết định?', 'Tình huống nào phải chuyển tuyến thay vì tự thử?'],
  },
}
