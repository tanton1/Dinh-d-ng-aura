# Lộ trình sản phẩm Dinh dưỡng Aura

## Mục tiêu

Biến trang Dinh dưỡng thành một trợ lý ghi nhận và lập kế hoạch ăn uống cho người Việt: nhập hồ sơ một lần, tra cứu nhanh dữ liệu chuẩn, quét món bằng AI, xác nhận khẩu phần rồi theo dõi tiến độ theo ngày/tuần.

Nền dữ liệu hiện tại có 2.103 bản ghi từ Viện Dinh dưỡng Quốc gia:

- 1.250 món ăn, đều có URL ảnh nguồn.
- 853 thực phẩm theo cơ sở 100 g phần ăn được; nguồn không cung cấp ảnh.
- 34 nhóm dữ liệu, năng lượng, macro và các vi chất khả dụng.

## Cấu trúc sản phẩm đề xuất

Trang Dinh dưỡng nên phát triển thành năm khu vực thống nhất:

1. **Tổng quan**: kcal, macro, nước, bữa hôm nay và một gợi ý ưu tiên.
2. **Nhật ký**: bữa ăn theo ngày, chỉnh sửa, sao chép và thêm lại nhanh.
3. **Kho món**: tìm kiếm, lọc và xem chi tiết toàn bộ 2.103 bản ghi.
4. **Kế hoạch**: thực đơn ngày/tuần, đổi món tương đương và danh sách mua sắm.
5. **Tiến độ**: xu hướng 7/30/90 ngày, cân nặng và mức bám mục tiêu.

Deep-link chi tiết hiện dùng ID duy nhất, ví dụ `#/nutrition?foodId=nin%3Adish%3A...`. Không dùng slug tên vì có nhiều món trùng tên.

## P0 — Dữ liệu và nhật ký bền vững

- Kiểm tra schema và đơn vị trước mỗi lần cập nhật dữ liệu; giữ giá trị thiếu là `null`, không đổi thành `0`.
- Lưu snapshot kcal/macro/vi chất tại thời điểm người dùng ghi món để lịch sử không thay đổi khi nguồn được cập nhật.
- Lưu nhật ký, nước và món yêu thích theo tài khoản thay vì state trình duyệt.
- Tách dữ liệu đề xuất:

```text
nutritionCatalog/{catalogId}
users/{uid}/nutritionDays/{yyyy-mm-dd}
users/{uid}/nutritionDays/{yyyy-mm-dd}/meals/{mealId}
users/{uid}/savedMeals/{mealId}
users/{uid}/mealPlans/{weekId}
users/{uid}/foodScanFeedback/{scanId}
```

- Mỗi log nên có ngày theo múi giờ, loại bữa, nguồn (`catalog`, `ai-scan`, `manual`), khẩu phần, snapshot dinh dưỡng, độ tin cậy AI và thời điểm tạo/sửa.
- Thêm migration/version cho catalog để có thể cập nhật dữ liệu mà không làm hỏng nhật ký cũ.

## P1 — Hoàn thiện Kho món

### Đã triển khai

- Tìm theo tên có/không dấu, tên tiếng Anh, mã, nhóm và vùng miền.
- Lọc món ăn/thực phẩm và nhóm dữ liệu; tải thêm kết quả thay vì giới hạn 24 món.
- Thumbnail ảnh nguồn với lazy-load và fallback.
- Trang chi tiết có ảnh, metadata, khẩu phần, kcal/macro, bảng vi chất, nguồn và món liên quan.
- Thực phẩm được quy đổi từ cơ sở 100 g; món ăn chỉ nhân theo suất tham chiếu vì nguồn không nêu khối lượng chuẩn.
- Deep-link theo ID, lưu món trong trình duyệt và thêm khẩu phần đã chọn vào nhật ký hiện tại.

### Bước tiếp theo

- Chuyển Kho món thành trang toàn màn hình với phân trang hoặc virtualized list.
- Thêm sắp xếp: phù hợp nhất, kcal thấp/cao, đạm cao và mới cập nhật.
- Có “Đã xem gần đây”, “Đã lưu”, “Thường dùng” và so sánh hai món.
- Đề xuất món gần macro nhưng ít natri/đường hơn; giải thích rõ tiêu chí thay vì gắn nhãn tốt/xấu.
- Cho phép chọn ngày, bữa, giờ và ghi chú trước khi thêm món.

## P2 — AI nhận diện món ăn có bước xác nhận

Luồng chuẩn nên là:

```text
Chụp ảnh → Nhận diện thành phần → Đối chiếu catalog → Hỏi điểm chưa rõ
→ Người dùng sửa/xác nhận → Tính khoảng kcal → Lưu snapshot
```

- Tự xoay và nén ảnh trước khi tải lên; hướng dẫn chụp đủ sáng, từ trên xuống và có vật tham chiếu kích thước.
- Hiển thị khoảng kcal thay vì một số tuyệt đối.
- Mỗi thành phần cần tên, gram ước tính, cách chế biến, macro, độ tin cậy và ứng viên catalog.
- Dùng câu hỏi làm rõ cho dầu/sốt, loại thịt, kích thước tô hoặc món vùng miền trùng tên.
- Thành phần độ tin cậy thấp phải được xác nhận trước khi lưu.
- Cho phép thêm/xóa thành phần, sửa gram và chọn lại bản ghi nguồn.
- Lưu phần người dùng chỉnh sửa vào `foodScanFeedback` để đo chất lượng matching; không dùng dữ liệu cá nhân để huấn luyện khi chưa có đồng ý.
- Bộ kiểm thử nên gồm món nước, cơm phần, đồ chiên, lẩu, món nhiều sốt và nhiều đĩa.

KPI: tỷ lệ scan thành công, thời gian phân tích, tỷ lệ sửa thành phần, sai lệch khẩu phần và tỷ lệ lưu sau scan.

## P3 — Kế hoạch dinh dưỡng cá nhân hóa

Mở rộng hồ sơ với cân nặng mục tiêu, tốc độ mong muốn, số bữa, giờ ăn, lịch tập, dị ứng, món không thích, ngân sách, thời gian nấu và vùng miền yêu thích.

Kế hoạch 7 ngày cần:

- Bám khoảng kcal/protein linh hoạt, không ép đúng một con số.
- Loại trừ tuyệt đối dị ứng và món người dùng chặn.
- Phân bổ protein đều; điều chỉnh carb quanh lịch tập.
- “Đổi món tương đương” nhưng giữ gần mục tiêu kcal/macro.
- Sao chép bữa/ngày và lặp lại món quen thuộc.
- Tạo danh sách mua sắm, gom nguyên liệu trùng và ước tính số lượng.
- Cho phép duyệt toàn bộ kế hoạch trước khi ghi vào lịch; AI đề xuất, người dùng quyết định.

## P4 — Tiến độ, coach và giữ chân

- Biểu đồ 7/30/90 ngày cho kcal, protein, nước, chất xơ và natri.
- Cân nặng dùng đường xu hướng, tránh nhấn mạnh dao động từng ngày.
- Insight phải có nguyên nhân và hành động cụ thể, ví dụ thiếu protein ở bữa sáng ba ngày liên tiếp.
- So sánh ngày tập/ngày nghỉ; cho phép coach xem và phản hồi khi học viên đồng ý.
- Weekly review ngắn: điều làm tốt, một ưu tiên điều chỉnh và kế hoạch tuần tới.
- Streak dựa trên hành vi check-in, không thưởng cho việc ăn thiếu năng lượng.
- Nhắc ghi bữa/nước theo khung giờ do người dùng tự bật.

## Phong cách giao diện

- Dùng tím Aura cho CTA, tab active và focus; xanh dành cho trạng thái dinh dưỡng tích cực.
- Nền trắng/xám dịu, viền mảnh, bán kính 14–18 px và bóng rất nhẹ.
- Ảnh món là điểm nhấn; hạn chế gradient trang trí.
- Body 13–14 px, metadata tối thiểu 10–11 px, control tối thiểu 42 px.
- Desktop dùng lưới rõ ràng; mobile một cột với CTA ghi món cố định phía dưới.
- Luôn có skeleton/loading, empty state, image fallback, offline state và reduced-motion.

## An toàn và quyền dữ liệu

- Kết quả AI và số liệu khẩu phần là ước tính, không thay thế tư vấn y khoa.
- Không khẳng định món an toàn với dị ứng chỉ từ hình ảnh.
- Thai kỳ, dưới 18 tuổi, bệnh nền hoặc dấu hiệu rối loạn ăn uống cần luồng chuyên gia.
- Ảnh quét mặc định xóa sau phân tích; chỉ lưu khi người dùng đồng ý.
- Ảnh món của Viện hiện được hiển thị bằng URL nguồn kèm attribution. Chưa sao chép sang Firebase vì trang nguồn không công bố giấy phép tái sử dụng; cần xin phép bằng văn bản trước khi dùng thương mại hoặc lưu bản sao.

Nguồn dữ liệu:

- https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-mon-an
- https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-thuc-pham

## Definition of Done cho bản tiếp theo

- Tìm và mở đúng chi tiết đủ 2.103 bản ghi trên desktop/mobile.
- 1.250 món hiển thị ảnh nguồn; 853 thực phẩm có fallback nhất quán.
- Không quy đổi gram giả cho món ăn thiếu cơ sở khẩu phần.
- Nhật ký, nước và món lưu vẫn còn sau khi đăng nhập lại.
- AI hiển thị khoảng ước tính, câu hỏi và mức tin cậy trước khi lưu.
- Build, kiểm tra schema, kiểm tra quyền và smoke test được chạy tự động trước deploy.
