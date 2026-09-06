# Nội Dung và Học cùng Aura — phân tích và nâng cấp module

Phạm vi: đọc source từ HEAD `2a70078`, kiểm thử trình đọc và lớp học tương tác bằng fixture riêng. Không thay đổi Functions, Firestore Rules, nội dung PDF, revision khóa học hoặc dữ liệu production. Không gọi AI để tạo nội dung/chấm bài trong lần nâng cấp này.

## 1. Vai trò của hai khu vực

| Khu vực | Mục đích | Không nên đảm nhiệm |
| --- | --- | --- |
| Nội Dung | Đọc giáo trình gốc; hiểu đầy đủ sơ đồ, ví dụ, tài liệu tham khảo; tìm và quay lại vị trí quan trọng | Tự coi đã đọc là đã hiểu; ghi nhận hoàn thành chỉ bằng việc lật trang |
| Học cùng Aura | Chuyển bài đọc thành nhớ lại, thực hành, tự đánh giá và checkpoint có chấm điểm | Tạo thêm tab toàn văn trùng PDF; thay thế toàn bộ nội dung chuyên sâu của giáo trình |

Giữ thứ tự `Nội Dung → Học cùng Aura`. PDF vẫn là điểm mở mặc định cho mỗi chương có tài nguyên. Bên trong lớp học giữ bốn bước `Nắm lõi → Ghi nhớ → Thực hành → Kiểm tra`. Không thêm menu chân trang thứ hai.

## 2. Phát hiện chi tiết

### Trình đọc Nội Dung

- Đã có PDF.js vẽ một trang/lần, phóng to, chuyển trang, vuốt, mở/tải bằng liên kết media có kiểm tra quyền. Phù hợp giới hạn bộ nhớ mobile hơn tải đồng thời toàn bộ trang.
- Chưa có vị trí đọc hay dấu trang: chuyển sang lớp học rồi quay lại bị trở về trang 1.
- Mục lục khóa học chỉ tìm tên chương, chưa đọc mục lục nằm bên trong tệp PDF.
- Vuốt chỉ kiểm khoảng cách ngang; thao tác cuộn chéo có thể bị hiểu nhầm là lật trang.
- Chữ/nút toolbar khá nhỏ; tên tab PDF bị định dạng như badge do selector áp dụng lên mọi span.
- Chương được đánh số theo chỉ mục bài nội bộ (01,04,07…) thay vì 01–20.
- Effect thay đổi trạng thái hoàn thành cũng đặt lại tab đọc, gây chuyển tab ngoài ý muốn.

### Nắm lõi

- Có 12 thẻ/chương, bốn micro-check, ví dụ và điều kiện an toàn; không cần thêm số lượng thẻ để giải quyết vấn đề điều hướng.
- Các mức `Hiểu/Nhớ/Làm/Dùng` chưa giải thích cách tính tại chỗ; phần Thực hành chỉ có 0/100 dù đã điền gần hết.
- “Bước tiếp theo” chỉ là chữ, chưa đưa người học đến module tương ứng.

### Ghi nhớ

- Đã có flashcard lật mặt, tự đánh giá, lịch ôn cách quãng, câu tự nhớ và hàng đợi liên chương.
- Chưa có nút xem thẻ kế tiếp/trước: người xem chưa ghi danh gần như chỉ xem được thẻ đầu; người đã học phải tự chấm thẻ mới chuyển được.
- Số thẻ đã từng ôn được dùng làm số thẻ đã nhớ. Chọn “Quên” cho mọi thẻ vẫn làm thanh Nhớ tăng; chỉ số này dễ gây hiểu nhầm.
- Không có thẻ đến hạn lại ghi “Đã ôn xong” ngay cả khi chưa học thẻ nào.
- Bản nháp câu tự nhớ lưu cục bộ; không nên mô tả là đã đồng bộ Cloud. Cỡ chữ đoạn giải thích còn 8–11px ở nhiều chỗ.

### Thực hành và portfolio

- Workbook đã có revision/conflict, chia sẻ rõ ràng với coach, rubric, điều kiện an toàn; portfolio dùng tại các mốc 5/10/15/20.
- Dữ liệu đã có `challengeDone` và `confidenceAfter`, nhưng Learning Studio chưa hiển thị để học viên sử dụng.
- Chưa có phần trăm điền bài để người học biết còn thiếu bao nhiêu.
- Cần phân biệt “đã điền”, “đã lưu”, “đạt checkpoint” và “năng lực chuyên môn”; chúng không tương đương.

### Kiểm tra

- Ngân hàng hiện tại 16 câu/chương; mỗi lượt chọn 8 câu, có câu an toàn; production chấm tại server. Đã có điểm, giải thích và lượt còn lại.
- Tám câu hiển thị trên trang dài; khó tìm câu còn bỏ trống trên điện thoại.
- Gợi ý ôn lại hiển thị raw ID, chưa đưa về nội dung có tên dễ hiểu.
- Số thứ tự giải thích lấy theo vị trí response, có thể không khớp thứ tự đề nếu server trả thứ tự khác.
- Chấm demo chỉ kiểm điểm tổng, chưa chặn trường hợp sai câu an toàn. Production vẫn do server quyết định.

## 3. Đã triển khai trong lần này

1. PDF: tự phục hồi trang, tối đa 50 dấu trang, tách theo owner/course/lesson/resource; không lưu signed URL. Mục lục điện tử, lọc tên mục và điều hướng theo destination thật của PDF; tối đa 100 mục/6 cấp; không quét toàn văn. Có thông báo nếu tệp không chứa mục lục.
2. Chỉ coi vuốt ngang rõ rệt là lật trang; hỗ trợ phím trái/phải khi focus vùng đọc, không chiếm phím trong input.
3. Sửa số thứ tự chương và effect chuyển tab; giữ tab đang học khi ghi hoàn thành. Component được tách scope theo tài khoản/chương để tránh nhầm state khi chuyển chương.
4. Giải thích tiến độ; tính Nhớ từ tự đánh giá `good/easy`, không tính `again/hard`; hiển thị tỷ lệ điền bài thực hành.
5. CTA bước tiếp theo; phần mô tả mục tiêu và số liệu ngay đầu module. Khi ôn từ checkpoint, lọc/mở đúng thẻ và có nút xem tất cả.
6. Flashcard trước/sau/chọn thẻ; xem thẻ không ghi điểm hay thay lịch ôn. Đổi thông điệp hàng đợi trống; nhãn truy cập và giới hạn 2.000 ký tự cho bản nháp tự nhớ.
7. Checklist thử nghiệm 7 ngày và tự đánh giá sau khi đạt checkpoint, tái sử dụng workbook hiện hành; không thêm collection hay API.
8. Quiz hiển thị một câu/lần, lưới câu đã/chưa trả lời, nhảy tới câu bỏ trống khi nộp; giữ nguyên bộ câu, options, payload và chấm server. Gợi ý ôn lại thành nút có tên thẻ; ánh xạ số câu theo ID. Demo tôn trọng câu bắt buộc.
9. CSS bổ sung có phạm vi: Aura Pink cho hành động, nền sáng cho đọc, semantic green cho trạng thái; touch target 44px; mobile input 16px; không có dock mới; tôn trọng reduced motion.

## 4. Giới hạn minh bạch và hướng tiếp theo

- Vị trí/dấu trang PDF chỉ lưu trên thiết bị hiện tại. Chưa đồng bộ đa thiết bị; muốn thêm cần schema/rules và conflict policy riêng.
- Mục lục PDF chỉ có nếu tệp thực sự nhúng outline. Tìm kiếm hiện tại tìm tên mục, **không phải** tìm toàn văn. Các file thiếu outline có thể biên tập metadata mục–trang đã đối chiếu, không đoán số trang.
- PDF canvas giữ bố cục gốc nhưng chưa có text layer đầy đủ cho tìm/đọc bằng screen reader. Đây là hạng mục accessibility tiếp theo; không giải quyết bằng cách thêm tab đọc trùng trong Học cùng Aura.
- Lưu bản nháp, review sync/retry trên mạng yếu cần một đợt hardening riêng; không tuyên bố đã hoàn thiện đồng bộ offline/đa thiết bị chỉ từ test UI.
- Thuật toán chọn câu hiện giữ nguyên hợp đồng backend. Không tự xáo lượt mới hoặc mở lại lượt đã hết vì frontend không có quyền quyết định số lần thi.
- Ngân hàng hiện dùng một số phương án nhiễu theo mẫu. Đợt biên tập sau nên viết distractor đặc thù cho từng chương, map competency và nguồn trang PDF; review chuyên môn trước khi publish. Không thêm lời khuyên điều trị mới trong đợt UI này.
- Portfolio đã có rubric và tự chia sẻ; màn hình coach phản hồi/chấm sản phẩm, xuất portfolio, dashboard lớp học là các module nghiệp vụ riêng, chưa triển khai ở đây.

## 5. Kiểm thử tái chạy

```text
npx tsx --test tests/aura-nutrition-curriculum.test.ts
npx playwright test --config playwright.academy.config.ts
npx playwright test tests/e2e/aura-ui-v4.spec.ts -g "Aura Academy" --project=chromium --project=mobile-chromium
npm run typecheck
npm run build
```

Suite Academy riêng dùng PDF 3 trang thật qua PDF.js và course fixture 20 chương, không dùng credentials hay ghi production. Kiểm tra 320/390/1440px, restore trang/dấu trang, chuyển chương, flashcard không ghi lịch khi chỉ duyệt, checklist, nộp thiếu câu, phân trang quiz, remediation có thể bấm. Unit test kiểm khóa lưu theo tài khoản/tài nguyên, giới hạn dấu trang, outline và phép tính Nhớ/Thực hành. Fixture nằm trong tests, không import từ entry production.

### Kết quả xác minh

- Unit curriculum + reader/mastery: 11/11 đạt; toàn bộ `test:profile-sync`: 70/70 đạt.
- Suite module riêng: 5/5 đạt, gồm PDF có/không có outline và quay lại kết quả quiz sau khi ôn thẻ.
- Luồng app mở Academy: 2/2 đạt trên Chromium desktop/mobile.
- Typecheck và build đạt trên worktree kiểm tra riêng dựa trên `2a70078` + đúng các file Academy của đợt này. Các thay đổi dinh dưỡng/xếp lịch đang diễn ra song song không được đưa vào bản kiểm tra này.
- Đã xem ảnh chụp 320px của PDF và flashcard, sửa specificity khiến chữ nút PDF bị thu nhỏ và sửa sticky tabs (`overflow: clip`).
- Budget Academy đạt: trang đọc 5,7 KiB gzip / 14,6 KiB; runtime media 48,5 KiB / 54,7 KiB. Gate toàn app còn lỗi tải thêm Dinh dưỡng 84,8 KiB / 82 KiB; chưa tuyên bố toàn bộ performance gate đạt.
- Chưa commit/push/deploy các thay đổi này trong lượt yêu cầu phân tích và phát triển module. Chưa sửa dữ liệu khóa học hay chạy migration production.

## Khắc phục sự cố production được người dùng cho phép

- Log Cloud Run xác nhận listAcademyCourses trả 503 (cpu_allocation), tiếp theo 429 (không có instance). Khóa học vẫn published revision 10; không khôi phục/ghi đè course document.
- Cấu hình riêng năm learner endpoints (listAcademyCourses, enrollInCourse, completeCourseLesson, gradeCourseQuiz, getCourseMediaUrl): gcf_gen1 CPU, 256MiB RAM, concurrency 1, minInstances 0, maxInstances 2. Giữ nguyên handlers, auth, entitlement, chấm quiz và transaction.
- Đã deploy năm endpoints và chuyển traffic sang revision mới, health audit 5/5. Đã mở lại thư viện và PDF chương 1 qua tài khoản thật.
- Danh sách và media reads thử tối đa 2 lần/20 giây mỗi lần; không retry tự động thao tác ghi hoặc nộp quiz. Unsubscribe ngăn áp dụng kết quả cũ.
- UI có lỗi rõ ràng và nút Thử lại, không kết luận không tìm thấy khi API thất bại; admin preview dùng đúng loading/error nguồn admin.
- Chặn lazy loader trả module undefined khi bộ tài nguyên cũ hết hiệu lực giữa các lần deploy.
- Tests bổ sung: thông báo lỗi catalog/detail + retry giữ route. 74/74 test frontend, 33/33 contract tests, 7/7 module E2E, 2/2 Academy entry E2E. Build và toàn bộ performance budget đạt trên base mới.
