import type { AcademyLearningUnit } from './learning-unit'

export const chapter05Unit: AcademyLearningUnit = {
  schemaVersion: 1, chapter: 5, revision: '2026-10-24.1',
  title: 'Tiêu hóa và hấp thu: từ đường đi của thức ăn đến cách ghi nhận triệu chứng',
  review: { status: 'draft-needs-review', requiresQualifiedReviewer: true },
  audience: 'Người trưởng thành học sinh lý tiêu hóa cơ bản; coach luyện ghi nhận và chuyển câu hỏi đúng phạm vi.',
  scope: 'Phân biệt tiêu hóa, hấp thu, không dung nạp và dị ứng qua ca giả định. Không chẩn đoán bệnh tiêu hóa, không thử kích thích triệu chứng hoặc thiết kế chế độ loại trừ điều trị.',
  prerequisites: [1, 2, 3, 4],
  objectives: [
    { id: 'ch05-pathway', outcome: 'Mô tả đường đi của thức ăn và phân biệt tiêu hóa với hấp thu.', evidence: 'Sửa một sơ đồ nhầm vai trò dạ dày, ruột non và cơ quan hỗ trợ.' },
    { id: 'ch05-causality', outcome: 'Không suy quan hệ nhân quả từ một lần khó chịu sau ăn.', evidence: 'Lập dòng thời gian gồm dữ kiện, yếu tố chưa biết và câu hỏi cần đánh giá.' },
    { id: 'ch05-distinguish', outcome: 'Phân biệt không dung nạp lactose, dị ứng sữa và celiac ở mức cơ chế.', evidence: 'Giải thích vì sao nhãn không lactose không tự bảo đảm phù hợp dị ứng sữa.' },
    { id: 'ch05-handoff', outcome: 'Chọn bước tiếp theo an toàn, không tự thử thức ăn hoặc làm sai lệch đánh giá.', evidence: 'Nêu cách chuyển câu hỏi chuyên môn, ranh giới xét nghiệm và tình huống cần cấp cứu.' },
  ],
  sections: [
    {
      id: 'ch05-digest-absorb', title: 'Phân giải và đi qua thành ruột là hai việc khác nhau', objectiveIds: ['ch05-pathway'],
      paragraphs: [
        'Thức ăn đi qua miệng, thực quản, dạ dày, ruột non rồi ruột già; phần thải đi tới trực tràng và hậu môn. Nhai, nhào trộn và dịch tiêu hóa giúp phân giải thức ăn. Hấp thu là bước các thành phần đi qua thành ruột vào hệ vận chuyển của cơ thể; không đồng nghĩa chỉ làm thức ăn nhỏ hơn.',
        'Ruột non hấp thu phần lớn dưỡng chất. Ruột già tiếp tục hấp thu nước và hình thành phân. Gan tạo mật, túi mật lưu trữ mật, tụy cung cấp dịch chứa enzyme tiêu hóa. Các cơ quan hỗ trợ không phải những ngăn mà toàn bộ thức ăn lần lượt đi xuyên qua.',
        'Khi tự vẽ sơ đồ, dùng một đường liền cho đường đi thức ăn và chú thích riêng nơi dịch tiêu hóa được đưa vào. Mục tiêu là giải thích đúng mối liên hệ, không thuộc một thời gian cố định cho mọi bữa ăn. Một sơ đồ sinh lý không thể tự chỉ ra nguyên nhân của cơn đau ở một người.',
      ],
      takeaways: ['Tiêu hóa tạo điều kiện cho hấp thu nhưng hai khái niệm không giống nhau.', 'Không vẽ thức ăn đi qua gan hoặc tụy như một phần ống tiêu hóa.'], sourceIds: ['niddk-digestion'],
    },
    {
      id: 'ch05-timeline', title: 'Sau bữa ăn không luôn có nghĩa do bữa ăn', objectiveIds: ['ch05-causality'],
      paragraphs: [
        'Một lần đầy bụng sau một bữa hỗn hợp cho biết trình tự thời gian, chưa xác định thành phần gây ra. Nếu thay đồng thời nhiều món rồi thấy khác đi, càng khó biết điều gì liên quan. Triệu chứng có thể giống nhau giữa nhiều tình trạng, nên nhật ký không thay đánh giá lâm sàng.',
        'Bài học dùng dòng thời gian gồm giờ ăn, các thành phần biết được, giờ xuất hiện biểu hiện, diễn biến và thông tin còn thiếu. Ghi lời mô tả thay cho nhãn bệnh. Ví dụ “báo đầy bụng lúc 14 giờ, chưa rõ thời gian kéo dài” giữ được giới hạn tốt hơn “dị ứng bữa trưa”.',
        'Không cần gây lại triệu chứng để có dữ liệu đẹp. Với tình huống thật kéo dài, tái diễn hoặc đáng lo, đem ghi nhận hiện có trao đổi nhân viên y tế. Trong khóa học có thể dùng ca giả định; không bắt người học công khai nhật ký triệu chứng hoặc kết quả xét nghiệm để đạt điểm.',
      ],
      takeaways: ['Thứ tự thời gian là dữ kiện, không tự là quan hệ nhân quả.', 'Nhật ký hỗ trợ trao đổi, không tự đặt tên bệnh.'], sourceIds: ['niddk-lactose-diagnosis', 'cochrane-interpretation'],
    },
    {
      id: 'ch05-different-mechanisms', title: 'Những tên gọi không được dùng thay nhau', objectiveIds: ['ch05-distinguish'],
      paragraphs: [
        'Lactase là enzyme giúp phân giải lactose. Khi lactose không được tiêu hóa đầy đủ, nó có thể tới ruột già và liên quan sinh hơi cùng triệu chứng ở một số người. Dị ứng sữa lại là đáp ứng miễn dịch với protein sữa. Vì vậy xử lý đường lactose không đồng nghĩa loại bỏ protein gây dị ứng.',
        'Celiac là rối loạn tiêu hóa và miễn dịch liên quan gluten, có thể gây tổn thương ruột non; không đồng nghĩa với dị ứng lúa mì hay mọi khó chịu sau bánh mì. Những cơ chế này giải thích vì sao cùng một từ “không hợp” trong lời kể vẫn cần được làm rõ bằng đánh giá phù hợp.',
        'Luyện phân biệt bằng câu hỏi về đối tượng đang nói tới: đường lactose, protein sữa hay gluten? Nhưng nhận ra tên thành phần chưa đủ kết luận người nào mắc bệnh gì. Một câu trả lời thận trọng có thể nêu cơ chế khác nhau và dừng trước bước chẩn đoán hoặc đề xuất thực phẩm thay thế.',
      ],
      takeaways: ['Không lactose không có nghĩa không protein sữa.', 'Khó chịu sau ăn chưa phân biệt được không dung nạp, dị ứng hoặc celiac.'], sourceIds: ['niddk-lactose-mechanism', 'niddk-celiac-facts'],
    },
    {
      id: 'ch05-safe-next-step', title: 'Biết lúc nào phải dừng bài học', objectiveIds: ['ch05-handoff'],
      paragraphs: [
        'Nếu nghi celiac và đang chờ đánh giá, không tự bắt đầu chế độ không gluten để “làm thử cho chắc”: thay đổi đó có thể ảnh hưởng kết quả xét nghiệm. Nếu đã kiêng, không tự ăn lại gluten để chuẩn bị xét nghiệm; hãy báo tình trạng hiện tại và hỏi bác sĩ cách tiếp tục.',
        'Không tự ăn thử thực phẩm nghi gây dị ứng để kiểm chứng bài học. Biểu hiện như sưng đột ngột ở lưỡi hoặc họng, khó thở, khó nuốt hay mất đáp ứng cần trợ giúp khẩn cấp tại địa phương. Không chờ app hoặc coach trả lời; làm theo hướng dẫn cấp cứu và kế hoạch đã được nhân viên y tế cung cấp nếu có.',
        'Phiếu chuyển câu hỏi nên ghi điều đã xảy ra, điều chưa rõ, điều đang tránh tự thay đổi và người sẽ liên hệ. Không cần đoán bệnh để có một bước tiếp theo đúng. Vai trò của bài này là nâng chất lượng ghi nhận và nhận ra giới hạn, không huấn luyện tự chẩn đoán hoặc xử trí toàn bộ tình huống y tế.',
      ],
      takeaways: ['Không tự thử gây dị ứng hoặc tự chuẩn bị xét nghiệm bằng chế độ ăn.', 'Dấu hiệu khẩn cấp được ưu tiên hơn nhật ký và tiến độ khóa học.'], sourceIds: ['niddk-celiac-diagnosis', 'nhs-food-allergy'],
    },
  ],
  workedExamples: [
    {
      id: 'ch05-map-example', title: 'Sửa sơ đồ đi nhầm qua gan', objectiveIds: ['ch05-pathway'],
      prompt: 'Một sơ đồ giả định ghi: miệng → dạ dày → gan → tụy → ruột già, và nói dạ dày hấp thu mọi dưỡng chất.',
      given: ['Sơ đồ bỏ qua thực quản và ruột non.', 'Gan và tụy bị vẽ thành các đoạn nối tiếp trong đường đi thức ăn.', 'Tiêu hóa và hấp thu đang bị gọi chung là nghiền nhỏ.'],
      steps: ['Khôi phục tuyến ống tiêu hóa gồm thực quản và ruột non.', 'Đặt gan và tụy ở chú thích cơ quan hỗ trợ, không ở tuyến thức ăn.', 'Tách quá trình phân giải khỏi đi qua thành ruột.', 'Ghi ruột non là nơi hấp thu phần lớn dưỡng chất, không phải dạ dày hấp thu tất cả.'],
      answer: 'Sơ đồ đúng phân biệt tuyến thức ăn, nguồn dịch hỗ trợ và hấp thu; không cần một thời gian tiêu hóa cố định.',
      limitation: 'Sơ đồ là mô hình học tập đơn giản, không xác định vị trí bệnh hoặc nguyên nhân triệu chứng.',
    },
    {
      id: 'ch05-association-example', title: 'Một bữa có nhiều thành phần', objectiveIds: ['ch05-causality'],
      prompt: 'Một nhân vật giả định ăn bữa hỗn hợp rồi thấy đầy bụng. Hãy viết lại kết luận “chắc chắn dị ứng sữa”.',
      given: ['Bữa có bánh mì, đồ uống chứa sữa và các món khác.', 'Chỉ biết biểu hiện xuất hiện sau bữa, chưa có giờ cụ thể hay diễn biến.', 'Không có kết quả đánh giá hoặc chẩn đoán.'],
      steps: ['Giữ dữ kiện: nhân vật báo đầy bụng sau bữa hỗn hợp.', 'Đánh dấu chưa biết giờ, diễn biến, thành phần đầy đủ và các tình tiết khác.', 'Không chọn một thành phần làm nguyên nhân chỉ vì có mặt trong bữa.', 'Viết câu hỏi để trao đổi chuyên môn nếu tình trạng tái diễn hoặc đáng lo, không tự thử gây lại.'],
      answer: 'Có liên hệ về thời gian được báo lại; chưa đủ để kết luận dị ứng, không dung nạp hoặc món gây triệu chứng.',
      limitation: 'Ca giả định không hướng dẫn loại trừ thực phẩm và không thể thay khám khi có triệu chứng thật.',
    },
    {
      id: 'ch05-label-example', title: 'Không lactose nhưng vẫn là sữa', objectiveIds: ['ch05-distinguish', 'ch05-handoff'],
      prompt: 'Một nhãn giả định ghi không lactose, đồng thời danh sách thành phần có protein sữa. Có thể gọi là phù hợp cho người dị ứng sữa không?',
      given: ['Thông tin không lactose nói về đường lactose.', 'Danh sách vẫn nêu protein sữa.', 'Đối tượng trong câu hỏi có dị ứng sữa đã được xác định.'],
      steps: ['Tách đường lactose khỏi protein sữa.', 'Đối chiếu chất gây dị ứng đang cần tránh với thành phần thực tế.', 'Không dùng một tuyên bố không lactose để xóa thông tin protein sữa.', 'Giữ kế hoạch dị ứng riêng, hỏi người phụ trách chăm sóc khi chưa rõ; không uống thử.'],
      answer: 'Không thể coi phù hợp chỉ từ chữ không lactose; nhãn giả định vẫn có protein sữa.',
      limitation: 'Không xác nhận độ an toàn của một nhãn hàng thật hoặc thay kế hoạch tránh dị nguyên cá nhân.',
    },
  ],
  cases: [
    { id: 'ch05-case-bloating', title: 'Muốn bỏ cùng lúc nhiều nhóm thực phẩm', context: 'Sau một lần đầy bụng, Phúc định bỏ sữa, lúa mì và nhiều loại khác trong một tháng để tìm thủ phạm.', question: 'Vì sao bài học không yêu cầu làm thử như vậy?', reasoning: ['Một lần triệu chứng chưa xác nhận nguyên nhân.', 'Thay nhiều yếu tố cùng lúc không giúp tách đóng góp của từng yếu tố.', 'Chế độ loại trừ điều trị nằm ngoài bài tập và cần đánh giá phù hợp.'], safeNextStep: 'Ghi dữ kiện sẵn có và câu hỏi cho nhân viên y tế nếu cần; làm bài bằng ca giả định, không tự gây triệu chứng.', commonError: 'Coi loại càng nhiều thực phẩm càng là cách kiểm chứng khoa học.' },
    { id: 'ch05-case-celiac', title: 'Đã tự kiêng trước ngày khám', context: 'Vy nghi celiac và đã bỏ gluten trước khi hẹn bác sĩ. Bạn khuyên tự ăn thật nhiều lại để xét nghiệm cho rõ.', question: 'Cách chuyển thông tin nào an toàn hơn?', reasoning: ['Chế độ trước đánh giá có thể ảnh hưởng kết quả.', 'Không tự chọn cách thử lại hoặc lượng gluten.', 'Bác sĩ cần biết việc đã kiêng và thời điểm thay đổi.'], safeNextStep: 'Báo trung thực việc đã kiêng và hỏi bác sĩ chuẩn bị thế nào; không tự ăn lại để phục vụ bài học hoặc xét nghiệm.', commonError: 'Biến thông tin “có thể ảnh hưởng xét nghiệm” thành chỉ định tự thử lại thực phẩm.' },
    { id: 'ch05-case-urgent', title: 'Sưng họng và khó thở sau ăn', context: 'Trong ca giả định, người tại buổi tập đột ngột sưng họng và khó thở sau ăn.', question: 'Có nên điền nhật ký để coach xác nhận trước không?', reasoning: ['Đây là biểu hiện cần trợ giúp khẩn cấp, không chờ xác định nguyên nhân qua app.', 'Nhật ký và tiến độ khóa học không được làm chậm hỗ trợ.', 'Làm theo hướng dẫn cấp cứu và kế hoạch y tế cá nhân nếu có.'], safeNextStep: 'Dừng hoạt động, gọi trợ giúp khẩn cấp tại địa phương; không chờ coach duyệt hoặc tự cho ăn thử để xác minh.', commonError: 'Cố thu đủ dữ kiện hoặc chờ phản hồi trực tuyến trước khi gọi trợ giúp.' },
  ],
  practice: {
    title: 'Phiếu tiêu hóa: sơ đồ đúng và câu hỏi đúng phạm vi', artifact: 'Một sơ đồ cơ chế và phiếu chuyển câu hỏi từ ca giả định; không phải nhật ký tự thử gây triệu chứng.',
    steps: ['Vẽ tuyến thức ăn, tách cơ quan hỗ trợ và ghi nơi hấp thu chính.', 'Chọn ca bữa hỗn hợp để lập dòng thời gian, không thêm dữ kiện chưa có.', 'So sánh lactose và protein sữa; nêu vì sao chưa thể chẩn đoán.', 'Viết bước hỏi chuyên môn, điều không tự thử và dấu hiệu cần ưu tiên cấp cứu.'],
    fields: [
      { id: 'context', label: 'Dòng thời gian giả định', prompt: 'Nêu bữa ăn, biểu hiện và mốc đã biết; đánh dấu thời gian, thành phần hoặc diễn biến còn thiếu.', required: true },
      { id: 'hypothesis', label: 'Cơ chế và giới hạn', prompt: 'Phân biệt tiêu hóa với hấp thu và lactose với protein sữa; điều gì chưa thể suy ra về bệnh?', required: true },
      { id: 'action', label: 'Câu hỏi chuyển chuyên môn', prompt: 'Viết thông tin cần trao đổi và câu hỏi cho người phụ trách chăm sóc, không kê chế độ loại trừ.', required: true },
      { id: 'minimum', label: 'Phiếu khi thiếu thông tin', prompt: 'Khi chỉ có lời kể ngắn, giữ lại dữ kiện nào và ghi thiếu ra sao mà không thử gây lại triệu chứng?', required: true },
      { id: 'data', label: 'Kiểm tra phiếu', prompt: 'Nêu cách kiểm tra sơ đồ, nguồn tham khảo và ngày rà lại bài viết; không đặt mốc trì hoãn khám thật.', required: true },
      { id: 'stop', label: 'Không tự thử và cấp cứu', prompt: 'Nêu điều không tự làm khi nghi dị ứng hoặc đang đánh giá celiac; khi có khó thở/sưng họng cần ưu tiên gì?', required: true },
    ],
    modelResponse: ['Ca giả định chỉ biết đầy bụng sau bữa hỗn hợp, chưa rõ giờ và diễn biến. Sơ đồ tách tuyến thức ăn với dịch từ cơ quan hỗ trợ; tiêu hóa khác hấp thu.', 'Không đủ dữ kiện chẩn đoán. Lactose là đường, dị ứng sữa liên quan protein; sẽ chuyển mô tả và câu hỏi cho nhân viên y tế nếu tình trạng thật cần đánh giá.', 'Không tự uống thử dị nguyên, không tự bắt đầu hoặc ăn lại gluten để chuẩn bị xét nghiệm. Khó thở/sưng họng cần trợ giúp khẩn cấp; ngày rà bài không phải ngày chờ xử trí.'],
    rubric: [
      { id: 'data', label: 'Dòng thời gian trung thực', levels: ['Thêm dữ kiện hoặc ghi nhãn bệnh như sự thật.', 'Có mô tả nhưng thiếu dấu thông tin chưa biết.', 'Tách dữ kiện, diễn giải và phần thiếu; không suy nguyên nhân từ trình tự.'] },
      { id: 'mechanism', label: 'Cơ chế không đánh tráo', levels: ['Nhầm tiêu hóa/hấp thu hoặc lactose/protein.', 'Phân biệt cơ bản nhưng chưa nối được với tình huống.', 'Sơ đồ đúng, tách cơ chế và giải thích vì sao nhãn không lactose không chứng minh an toàn dị ứng.'] },
      { id: 'feasibility', label: 'Phiếu trao đổi rõ', levels: ['Không có câu hỏi hoặc tự đưa toa.', 'Có câu hỏi nhưng phiếu khó kiểm tra.', 'Phiếu ngắn có nguồn, thông tin thiếu và câu hỏi cho đúng người; có mốc rà bài.'] },
      { id: 'safety', label: 'Không gây thử triệu chứng', levels: ['Tự thử dị nguyên/gluten hoặc trì hoãn cấp cứu.', 'Biết hỏi chuyên môn nhưng chưa nhận diện tình huống khẩn cấp.', 'Không tự thử hay kê loại trừ; giữ ranh giới xét nghiệm, gọi trợ giúp khẩn cấp khi cần.'] },
    ],
  },
  coachExtension: ['Chấm khả năng nhận ra điều chưa biết, không chấm việc đoán trúng tên bệnh.', 'Nếu người học nêu triệu chứng thật, tách hỗ trợ học tập khỏi đánh giá y tế và ưu tiên tình huống khẩn cấp.', 'Không biến câu hỏi cơ chế thành hướng dẫn chế độ loại trừ; bảo vệ riêng tư khi thảo luận ca.'],
  safety: ['Không tự ăn thử thực phẩm nghi gây dị ứng để hoàn thành bài.', 'Không tự bắt đầu hoặc ăn lại gluten để chuẩn bị xét nghiệm; báo bác sĩ tình trạng hiện tại.', 'Dấu hiệu khó thở, sưng họng hoặc mất đáp ứng cần trợ giúp khẩn cấp, không chờ coach hay ứng dụng.', 'Dùng dữ liệu giả định hoặc tối thiểu; bài học không đòi công khai hồ sơ y tế.'],
  referenceIds: ['niddk-digestion', 'niddk-lactose-diagnosis', 'cochrane-interpretation', 'niddk-lactose-mechanism', 'niddk-celiac-facts', 'niddk-celiac-diagnosis', 'nhs-food-allergy'],
}
