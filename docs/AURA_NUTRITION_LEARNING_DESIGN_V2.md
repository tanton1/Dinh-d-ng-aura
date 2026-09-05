# AURA Nutrition Academy - Kế hoạch thiết kế học tập 20 chương

## 1. Mục tiêu

Biến bộ giáo trình 20 chương thành trải nghiệm giúp học viên **hiểu nhanh, nhớ lâu, làm được và biết tự ra quyết định an toàn**. PDF đầy đủ vẫn là nguồn chuẩn; app chuyển hóa nội dung thành các lớp học ngắn, sau đó cho phép mở PDF để đọc sâu hoặc đối chiếu.

Kết quả cuối khóa không chỉ là “đã đọc 20 chương”, mà là một **Hệ điều hành dinh dưỡng cá nhân 1.0** được ghép từ các sản phẩm thực hành của từng chương.

## 2. Hiện trạng và khoảng trống

### Nền tảng đã có

- 20 chương, 60 bài, 4 chặng, khoảng 21 giờ học trên app.
- 1.823 trang PDF, khoảng 405.969 từ; có infographic, case study, workbook, thử thách và tài liệu tham khảo.
- Mỗi chương đã có bài nắm lõi, bài thực hành và checkpoint.
- Mỗi chương đang có 3 flashcard thuật ngữ, 2 câu active recall, 3 câu trắc nghiệm, workbook lưu tự động và thử thách 7 ngày.
- Đã có ôn cách quãng, chấm quiz trên server và cổng an toàn.

### Khoảng trống cần xử lý

- Flashcard chủ yếu kiểm tra định nghĩa, chưa kiểm tra so sánh, cơ chế, quyết định và sai lầm thường gặp.
- Quiz 3 câu thiên về nhận biết; đạt 2/3 là qua nên chưa chứng minh khả năng áp dụng.
- Đáp án sai chưa có phản hồi riêng và liên kết về đúng phần cần học lại.
- Workbook mới kiểm tra đã điền/chưa điền, chưa có rubric về chất lượng đầu ra.
- Thử thách 7 ngày mới là checkbox, chưa có dữ liệu, phản ánh và quyết định giữ/chỉnh/dừng.
- Tiến độ đang đếm bài hoàn thành, chưa cho biết năng lực nào đã thật sự được nắm vững.
- 20 chương dùng gần cùng một mẫu tương tác dù chương tính toán, chương hành vi và chương an toàn cần cách học khác nhau.

## 3. Luồng học chuẩn cho mỗi chương

Mỗi chương dùng một nhịp 5 bước, tổng 35-55 phút trên app và một bài ứng dụng ngoài đời sống:

1. **Khởi động - 2 phút:** câu hỏi lớn, tình huống Aura, học viên dự đoán và tự chấm mức tự tin 1-5.
2. **Nắm lõi - 12-20 phút:** 6-10 thẻ thông tin, một mô hình trực quan, một hiểu lầm và một cổng an toàn; có micro-check sau mỗi 2-3 thẻ.
3. **Ghi nhớ - 5-8 phút:** 6-10 flashcard đa dạng, 3 câu active recall và lịch ôn cách quãng.
4. **Luyện tập - 8-12 phút:** 8 câu được lấy từ ngân hàng 12-15 câu; trộn nhận biết, phân loại, sắp xếp, tính nhanh, đọc biểu đồ và tình huống.
5. **Ứng dụng:** workbook có hướng dẫn, dữ liệu tối thiểu, ngày rà và điều kiện giữ/chỉnh/dừng/chuyển tuyến.

## 4. Hệ thống thẻ thông tin

Mỗi chương phối hợp tám loại thẻ:

1. **Nắm lõi:** một cơ chế hoặc nguyên tắc trong tối đa 80 từ.
2. **So sánh:** đặt hai khái niệm dễ nhầm cạnh nhau.
3. **Mô hình:** sơ đồ dòng chảy, timeline, vòng lặp hoặc cây quyết định.
4. **Ví dụ Việt Nam:** món quen, bữa cơm, lịch làm việc và lịch tập thực tế.
5. **Hiểu lầm:** mặt trước là nhận định; mở ra để xem sự thật và lý do.
6. **Quyết định:** cho dữ liệu ngắn và yêu cầu chọn giữ, chỉnh, dừng hoặc chuyển tuyến.
7. **Cổng an toàn:** dùng màu semantic Danger/Warning, không gamification và không được bỏ qua.
8. **Tự soi:** một câu hỏi nối kiến thức với dữ liệu của chính học viên.

### Chuẩn giao diện Aura

- Nền trắng/warm-neutral; Aura Pink chỉ dùng cho active state và CTA.
- Desktop tối đa hai cột; mobile một cột full-width, chỉ bộ flashcard được vuốt ngang.
- Body tối thiểu 14px, nhãn phụ tối thiểu 12px, vùng chạm tối thiểu 44px.
- Một thẻ chỉ có một ý; không đặt nguyên đoạn bài đọc dài vào card.
- Mọi infographic có alt text và phiên bản văn bản; không dùng màu làm tín hiệu duy nhất.
- Mỗi màn hình chỉ có một CTA chính: Học tiếp, Kiểm tra, Bắt đầu thực hành hoặc Ra quyết định.

## 5. Thiết kế chi tiết từng chương

### Chặng 1 - Hiểu nền tảng

| Chương | Thẻ trọng tâm | Bài kiểm tra | Thực hành và đầu ra |
| --- | --- | --- | --- |
| **1. Khởi đầu đúng** | Dinh dưỡng khác ăn kiêng; La bàn AURA; vòng lặp thất bại; lượng-tần suất-bối cảnh; ngôn ngữ trung tính; cổng an toàn rối loạn ăn uống. | Phân loại món/bữa/mẫu hình; case Mai tìm điểm gãy trước bữa tối; chọn cách phản hồi sau một lần lệch; câu bắt buộc về chuyển tuyến. | Bản chụp dinh dưỡng 10 phút: timeline một ngày, mức đói, giấc ngủ, bối cảnh. Đầu ra: 1 điểm gãy + 1 bước tối thiểu + 1 dữ liệu + 1 ngày rà. |
| **2. Cơ thể sử dụng năng lượng** | Calorie và ATP; bốn ngăn TDEE; BMR/RMR; TEF; NEAT; tập luyện; glycogen/nước; sai số thiết bị đeo. | Kéo hoạt động vào TEF/NEAT/tập/nghỉ; đọc hai ngày cùng buổi tập nhưng NEAT khác; giải thích vì sao không ăn bù chính xác calories đồng hồ. | Bản đồ năng lượng 24 giờ. Đầu ra: một khoảng ít vận động, một thay đổi 10 phút và ba ngày thử, không gán calories giả. |
| **3. Protein, carbohydrate và chất béo** | Quy tắc 4-4-9; vai trò protein; amino acid; glucose/glycogen; đường-tinh bột-chất xơ; chất béo thiết yếu/trans; “gói thực phẩm”. | Ghép chất với vai trò; đọc bữa trước/sau tập; phản biện “carb tự động thành mỡ”; chọn điều chỉnh nhỏ nhất cho một bữa. | Chụp/mô tả một bữa, gắn bốn nhãn chức năng. Đầu ra: một khoảng trống và một điều chỉnh cho lần ăn tiếp theo. |
| **4. Vitamin, khoáng chất và nước** | RDA/AI/UL; thực phẩm trước viên bổ sung; sắt, canxi, vitamin D, folate; cân bằng dịch; điện giải; màu nước tiểu; red flag supplement. | Phân biệt mức tham chiếu; chọn tình huống cần bác sĩ/dược sĩ; phản biện “tự nhiên luôn an toàn”; so sánh ngày nóng/tập dài với ngày thường. | Rà 7 ngày về đa dạng thực phẩm, nhịp uống và sản phẩm bổ sung. Đầu ra: một khoảng trống từ thực phẩm hoặc một câu hỏi cho chuyên môn; không tự tăng liều. |
| **5. Tiêu hóa và hấp thu** | Hành trình bữa ăn; nhu động; khả dụng sinh học; hấp thu khác sử dụng; triệu chứng không phải chẩn đoán; không dung nạp khác dị ứng; hiểu lầm detox/probiotic; cờ đỏ. | Sắp xếp hành trình; phân biệt mô tả và tự chẩn đoán; case đầy hơi yêu cầu hỏi thêm dữ liệu; câu bắt buộc về dừng thử nghiệm. | Nhật ký ba lần triệu chứng gồm món, lượng, giờ, tốc độ, độ trễ và mức 1-10. Đầu ra: mô tả có cấu trúc để trao đổi với chuyên môn. |

### Chặng 2 - Cá nhân hóa

| Chương | Thẻ trọng tâm | Bài kiểm tra | Thực hành và đầu ra |
| --- | --- | --- | --- |
| **6. Hormone, insulin và đường huyết** | Nguồn-dòng chảy-tín hiệu-đích đến-phản hồi; insulin/glucagon; đường cong khác đỉnh; HbA1c; CGM; ngủ/stress/vận động; ranh giới điều trị. | Đọc đường cong có bối cảnh; chọn yếu tố gây nhiễu; phân biệt quan sát và chẩn đoán; tình huống dùng thuốc bắt buộc hỏi đội điều trị. | Thử một bữa thường gây đói sớm trong 7 ngày. Đầu ra: so sánh cảm giác và bối cảnh trước-sau, không đặt mục tiêu “làm phẳng glucose”. |
| **7. Vì sao mỗi người giảm cân khác nhau** | Bốn lớp điểm xuất phát-thực hiện-phản ứng-sai số; tuân thủ thực tế; thích nghi chuyển hóa; NEAT; nước/chu kỳ; chững giả; không so tốc độ. | Xác định lớp thiếu dữ liệu; tách plateau thật/giả; chọn điều chỉnh nhỏ; phản biện “giảm chậm là thiếu kỷ luật”. | Bảng điều khiển bốn lớp. Đầu ra: chọn lớp có bằng chứng yếu nhất, thu thêm đúng một dữ liệu và hẹn ngày rà. |
| **8. Tôi cần ăn bao nhiêu** | RMR đến TDEE; Mifflin-St Jeor; hệ số hoạt động; EER; duy trì/giảm/tăng; khoảng thay vì điểm; AMDR; sai số; hiệu chỉnh 14 ngày. | Bài tính có máy tính; phát hiện đầu vào yếu; so hai ước tính; chọn giữ/chỉnh 5-10%; câu an toàn về mức cắt quá mạnh. | Thử nghiệm nhu cầu 14 ngày. Đầu ra: khoảng khởi đầu, độ tin cậy và quy tắc chỉ đổi một biến sau ngày rà. |
| **9. Xây thực đơn thực tế** | Điểm neo; khung bữa; thay thế theo chức năng; phương án A nấu/B lắp ráp/C mua ngoài; bữa cứu hộ; meal prep theo nút thắt; ăn ngoài. | Kéo món vào khung bữa; thay món nhưng giữ vai trò; case lịch làm ca; chọn meal prep xử lý đúng ma sát. | Xây một tuần có ba phương án cho bữa khó nhất. Đầu ra: thực đơn dùng được khi nấu, bận và ăn ngoài. |
| **10. Theo dõi tiến độ và điều chỉnh** | Bốn lớp kết quả-hành vi-trải nghiệm-an toàn; chuẩn hóa đo; cân trung bình; sai số BIA; RPE/RIR; xu hướng và nhiễu; cổng quyết định. | Đọc dashboard bốn tuần; phát hiện chỉ số trùng lặp; xử lý kết quả tốt nhưng trải nghiệm xấu; câu an toàn về theo dõi ám ảnh. | Dashboard tối giản, tối đa bốn chỉ số. Đầu ra: một quyết định có lý do, không đổi kế hoạch theo một lần cân. |

### Chặng 3 - Ăn cho mục tiêu

| Chương | Thẻ trọng tâm | Bài kiểm tra | Thực hành và đầu ra |
| --- | --- | --- | --- |
| **11. Ăn trước, trong và sau tập** | Hồ sơ buổi tập; ba chiếc đồng hồ; bữa trước; phương án cứu hộ; khi nào cần ăn/uống trong buổi; tốc độ ra mồ hôi; bữa sau; “cửa sổ 30 phút”. | Xây timeline cho buổi 45/90/150 phút; chọn bữa dễ tiêu; tính tốc độ ra mồ hôi; case tập sáng và tập tối. | Giao thức cho một buổi thật gồm mục tiêu, tải, môi trường và bữa trước/trong/sau. Đầu ra: đánh giá năng lượng, tiêu hóa và hiệu suất sau 2-3 lần thử. |
| **12. Dinh dưỡng để phục hồi** | Tải tập và tải đời sống; bốn trụ phục hồi; khung 24-48 giờ; DOMS; năng lượng sẵn có; REDs; thực phẩm trước supplement; dấu hiệu quá tải. | Phân tích tải tổng; chọn trụ yếu nhất; tách đau cơ và tiến bộ; case mệt/rối loạn chu kỳ/chấn thương lặp lại bắt buộc chuyển tuyến. | Chấm bốn trụ trong 7 ngày. Đầu ra: kế hoạch phục hồi 24-48 giờ có điều kiện tăng/giảm tải và dấu hiệu dừng. |
| **13. Dinh dưỡng giảm mỡ** | Thâm hụt; tốc độ phù hợp; bảo vệ khối không mỡ; protein/tập kháng lực; đói và môi trường; chững giả; giai đoạn duy trì; red flag thiếu năng lượng/rối loạn ăn. | Chọn mức thâm hụt theo bối cảnh; đọc bốn tuần xu hướng; case cần dừng giảm; phản biện cheat day và “ra mồ hôi là đốt mỡ”. | Cổng giảm mỡ 7 bước. Đầu ra: tốc độ, ba tín hiệu bảo vệ, hai bữa neo, phương án xã hội và điều kiện tạm dừng. |
| **14. Dinh dưỡng tăng cơ, tăng cân** | Thặng dư vừa đủ; tốc độ tăng; kích thích tập; phân bố protein; carbohydrate; mật độ năng lượng; khó ăn nhiều; tăng cân khác tăng cơ. | Chọn cách thêm 200-300 kcal; đọc cân-vòng eo-thành tích; xử lý tiêu hóa xấu; phản biện dirty bulk và “chỉ cần protein”. | Thiết kế một bữa phụ và một điều chỉnh bữa chính. Đầu ra: bản đồ tăng có tốc độ, hiệu suất, tiêu hóa và ngày rà. |
| **15. Tái cấu trúc cơ thể** | Recomp; ai có cửa sổ thuận lợi; kích thích tập; năng lượng/protein; phục hồi; hai xu hướng mô; normal-weight obesity; sai số BIA; block 4-8 tuần. | Chọn ứng viên phù hợp; đọc dashboard cân-vòng-hình-kỷ lục; đánh giá kết quả BIA; chọn tiếp tục hay tách giai đoạn. | Block recomp 4-8 tuần với bốn kênh đo. Đầu ra: giả thuyết, mốc rà và quy tắc đổi hướng. |

### Chặng 4 - Tự chủ bền vững

| Chương | Thẻ trọng tâm | Bài kiểm tra | Thực hành và đầu ra |
| --- | --- | --- | --- |
| **16. Dinh dưỡng qua các giai đoạn sống phụ nữ** | Chu kỳ và triệu chứng; không áp một mẫu theo pha; thai kỳ; folate; sau sinh/cho con bú; tiền mãn kinh/mãn kinh; xương-cơ-tim; riêng tư; chuyển tuyến. | Case ba người cùng 45 tuổi nhưng khác nhiệm vụ; chọn câu hỏi thay vì giả định; phản biện “mãn kinh không thể giảm mỡ”; câu an toàn thai kỳ/sau sinh. | Hộ chiếu giai đoạn sống và timeline 4-8 tuần. Đầu ra: ưu tiên hiện tại, điều tự chỉnh được và điều cần hỏi chuyên môn. |
| **17. Dinh dưỡng khi có bệnh lý và tình trạng đặc biệt** | Giáo dục khác điều trị; hồ sơ an toàn; chủ sở hữu quyết định; thuốc/supplement/dị ứng; tương tác; cờ đỏ; phân vai; bàn giao. | Mỗi case yêu cầu chọn “coach được làm gì”; nhận diện cờ đỏ; câu bắt buộc về không đổi thuốc và không tự điều trị. | Sáu quyết định trước khi thay bữa ăn và hộ chiếu an toàn. Đầu ra: hướng dẫn hiện có, người phụ trách, phần coach được hỗ trợ và kênh liên hệ. |
| **18. Đọc bằng chứng và tự bảo vệ** | Biến lời hứa thành câu hỏi; PICO-T; thiết kế nghiên cứu; tương quan/nhân quả; sai lệch; relative/absolute risk; khoảng tin cậy; GRADE; xung đột lợi ích. | Nhận diện loại nghiên cứu; đổi nguy cơ tương đối sang chênh lệch tuyệt đối; chọn kết luận vừa mức; kiểm tra bài có DOI nhưng không khớp PICO-T. | Kiểm toán một bài đăng bằng AURA 6C. Đầu ra: tuyên bố, nguồn, độ khớp, hiệu ứng, giới hạn, mức tin và hành động tương xứng. |
| **19. Biến quyết định thành thói quen** | COM-B; hành vi quan sát được; tín hiệu; ma sát; nếu-thì; ba chế độ; nối lại; tự bỏ qua; hiểu lầm 21 ngày. | Tìm nút thắt năng lực/cơ hội/động lực; thiết kế lại môi trường; viết nếu-thì đạt chuẩn; chọn cách nối lại sau một lần bỏ. | Bản thiết kế thói quen AURA 6N. Đầu ra: tín hiệu, hành vi, phiên bản tối thiểu, ma sát cần giảm và quy tắc nối lại trong 24 giờ. |
| **20. Trở thành chuyên gia của chính mình** | AURA 6Đ; Sao Bắc Đẩu; mùa hiện tại; hệ điều hành cá nhân; thử nghiệm rủi ro thấp; bốn dữ liệu; mạng lưới đúng người; điều kiện tốt nghiệp. | Bài tổng hợp 20 chương: mô tả vấn đề, chọn dữ liệu, phân loại rủi ro, thiết kế thử nghiệm và quyết định khi nào gọi hỗ trợ. | Ghép portfolio thành Hệ điều hành dinh dưỡng 1.0. Đầu ra: Sao Bắc Đẩu, ba bữa mặc định, hộ chiếu an toàn, dashboard, một thử nghiệm và mạng lưới hỗ trợ. |

## 6. Thiết kế bài kiểm tra

### Ba tầng đánh giá

| Tầng | Thời điểm | Mục đích | Cách chấm |
| --- | --- | --- | --- |
| Micro-check | Sau 2-3 thẻ | Sửa hiểu sai ngay | Phản hồi theo từng lựa chọn, không tính lượt |
| Checkpoint chương | Cuối chương | Kiểm tra hiểu và áp dụng | 8 câu từ ngân hàng 12-15 câu, đạt 80% |
| Challenge/Capstone | Sau mỗi chặng và Chương 20 | Kiểm tra chuyển giao vào đời thật | Rubric + tự phản ánh; coach review tùy chọn |

Mỗi ngân hàng câu hỏi gồm khoảng 3 câu khái niệm, 3 câu so sánh/phân loại, 3 câu tình huống, 2 câu đọc biểu đồ/timeline, 1-2 câu tính nhanh khi phù hợp và 1-2 câu an toàn.

Mỗi câu cần có `competencyId`, độ khó, giải thích đáp án đúng, phản hồi cho từng lựa chọn sai và liên kết đến thẻ cần ôn. Khoá đáp án chỉ nằm trên server. Câu an toàn dùng `mustPass`: tổng điểm cao không bù được một quyết định nguy hiểm.

## 7. Thực hành và portfolio

Mỗi chương tạo một `practice artifact` gồm:

- Dữ kiện và bối cảnh do học viên tự điền hoặc chủ động liên kết từ Nhật ký.
- Một giả thuyết, không đổi nhiều biến cùng lúc.
- Hành động cụ thể: khi nào, ở đâu, làm gì, phiên bản ngày bận.
- 1-4 dữ liệu tối thiểu.
- Điều kiện dừng/chuyển tuyến.
- Ngày rà và quyết định `giữ | chỉnh | dừng | hỏi chuyên môn`.

Rubric có bốn tiêu chí, mỗi tiêu chí 0-2 điểm:

1. **Đủ dữ liệu:** có bối cảnh, thời gian và dữ kiện cần thiết.
2. **Đúng cơ chế:** giải thích khớp chương, không nhảy sang chẩn đoán.
3. **Có thể làm:** hành vi cụ thể, có phiên bản tối thiểu.
4. **An toàn:** có giới hạn, điều kiện dừng và đúng người cần hỏi.

Hệ thống chỉ tự chấm tính đầy đủ và logic hình thức. Không dùng AI để chẩn đoán, kê chế độ ăn điều trị hoặc đánh giá tính đúng y khoa của câu trả lời cá nhân.

Portfolio tích lũy:

- Sau Chương 5: Bản đồ nền tảng.
- Sau Chương 10: Dashboard cá nhân hóa.
- Sau Chương 15: Kế hoạch theo mục tiêu.
- Sau Chương 20: Hệ điều hành dinh dưỡng 1.0.

## 8. Mô hình dữ liệu đề xuất

Mở rộng tương thích, không phá dữ liệu V2 hiện tại:

```ts
interface AcademyLearningDesignV1 {
  version: 1
  chapterId: string
  competencyIds: string[]
  cards: AcademyLearningCard[]
  microChecks: AcademyKnowledgeCheck[]
  practice: AcademyPracticeDefinition
  safetyGate?: AcademySafetyGate
}

type AcademyLearningCard = {
  id: string
  kind: 'core' | 'compare' | 'model' | 'vietnam-example' | 'myth' | 'decision' | 'safety' | 'reflection'
  title: string
  body: string
  visualRef?: string
  competencyIds: string[]
}

type AcademyQuizQuestionV2 = {
  id: string
  kind: 'single' | 'multi' | 'order' | 'match' | 'numeric' | 'scenario'
  competencyId: string
  difficulty: 1 | 2 | 3
  prompt: string
  explanation: string
  remediationCardIds: string[]
  mustPass?: boolean
}

interface AcademyPracticeSubmissionV1 {
  schemaVersion: 1
  courseId: string
  chapterId: string
  definitionVersion: number
  answers: Record<string, string | number | boolean>
  evidenceRefs: Array<{ kind: 'meal-log' | 'progress' | 'note'; refId: string }>
  rubric: Record<'data' | 'mechanism' | 'feasibility' | 'safety', 0 | 1 | 2>
  decision: 'keep' | 'adjust' | 'stop' | 'refer' | null
  reviewAt: string | null
  updatedAt: string
}
```

Dữ liệu riêng của học viên tiếp tục nằm dưới `users/{uid}`. Đính kèm chỉ lưu reference đến dữ liệu đã có, không sao chép ảnh hoặc base64 vào workbook. Coach chỉ xem nội dung học viên chủ động chia sẻ.

## 9. Tiến độ và mastery

Mỗi chương có bốn thành phần:

- **Hiểu:** micro-check >= 80%.
- **Nhớ:** đã ôn ít nhất 70% thẻ đến hạn.
- **Làm:** checkpoint >= 80% và qua mọi câu `mustPass`.
- **Dùng:** practice đủ trường bắt buộc và có ngày rà.

Trạng thái hiển thị: `Đang học`, `Cần ôn`, `Sẵn sàng thực hành`, `Đã nắm vững`. CTA luôn giải thích bước tiếp theo. Dùng hàng đợi “Hôm nay cần ôn” thay cho streak gây áp lực.

## 10. Trình tự phát hành

1. **Release 0 - Nền tảng:** schema, CardDeck, MicroCheck, ScenarioQuestion, PracticeStudio, RubricPanel, MasteryStrip; dual-read với V2.
2. **Release 1 - Chương 1-5:** thẻ nền tảng, symptom diary và cổng an toàn; pilot 10-20 học viên.
3. **Release 2 - Chương 6-10:** biểu đồ, bộ tính có chú thích, dashboard và logic giữ/chỉnh/dừng; review chuyên môn insulin, CGM và năng lượng.
4. **Release 3 - Chương 11-15:** timeline buổi tập, tốc độ ra mồ hôi, progress trend và decision gate; liên kết read-only với lịch/nhật ký khi học viên đồng ý.
5. **Release 4 - Chương 16-20:** scenario phân vai, safety gate, AURA 6C và capstone; review riêng thai kỳ, sau sinh, bệnh lý, thuốc và rối loạn ăn uống.

Mỗi release dùng feature flag theo chương và UID, pilot tối thiểu 7 ngày. PDF và bài V1 vẫn là fallback đến khi cohort ổn định.

## 11. Tiêu chí hoàn thành

### Nội dung

- Mỗi chương có 6-10 thẻ; ít nhất một myth, một case Việt Nam, một decision card và safety card khi phù hợp.
- Mỗi checkpoint có ngân hàng tối thiểu 12 câu, ít nhất ba câu tình huống.
- Không trùng ID; mọi competency đều được dạy, luyện và đánh giá.
- Số liệu, công thức, ranh giới và nguồn được đối chiếu lại PDF canonical.

### Nghiệp vụ và bảo mật

- Answer key không xuất hiện trong learner payload.
- Học viên chỉ đọc/ghi practice, review và recall của chính mình.
- Coach chỉ xem submission được chia sẻ rõ ràng.
- Sửa nội dung đã xuất bản tạo revision; bài nộp cũ giữ `definitionVersion`.
- Câu `mustPass` và proof checkpoint do server sở hữu.

### UX và kỹ thuật

- Kiểm thử tại 320, 360, 390, 430 và 1440px; không cuộn ngang.
- Tất cả nút >= 44x44px; WCAG AA; hỗ trợ keyboard, screen reader và reduced motion.
- Refresh/offline tạm thời không mất câu trả lời; xung đột hai thiết bị được báo rõ.
- Mở chương không tải PDF, toàn bộ ngân hàng câu hỏi hoặc lịch sử review trước khi cần.

### Chỉ số học tập

- >= 70% người bắt đầu hoàn thành Nắm lõi.
- >= 60% đạt checkpoint sau tối đa ba lần.
- >= 40% bắt đầu practice và >= 25% hoàn thành ngày rà.
- Điểm kiểm tra lại sau 7 ngày >= 70% ở competency lõi.
- Theo dõi câu sai nhiều, thẻ bị đánh dấu “Khó” và điểm rơi theo chương để cải thiện nội dung, không dùng để phán xét học viên.

## 12. Thứ tự ưu tiên nếu triển khai ngay

1. Nâng quiz từ 3 câu nhận biết lên ngân hàng V2 và thêm phản hồi theo lựa chọn.
2. Chuyển infographic/case có sẵn thành 6-10 card cho từng chương.
3. Biến workbook hiện tại thành PracticeStudio có rubric và ngày rà.
4. Thêm mastery theo competency và hàng đợi ôn tập.
5. Làm lần lượt 5 chương/release, review chuyên môn trước khi mở rộng.

Phương án này giữ nguyên giá trị của bộ PDF, nhưng biến khóa học thành hệ thống **học - nhớ - làm - ra quyết định**, thay vì chỉ là thư viện tài liệu để đọc.
