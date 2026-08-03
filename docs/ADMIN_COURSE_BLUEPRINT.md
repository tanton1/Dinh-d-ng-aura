# Blueprint quản trị và khóa học Aura Fitness

## 1. Mục tiêu trải nghiệm

Khu vực quản trị giúp đội Aura đi từ ý tưởng đến một khóa học đã xuất bản mà không cần thao tác trực tiếp trong Firebase. Giao diện ưu tiên rõ ràng, ít thuật ngữ kỹ thuật, dùng tốt trên laptop và vẫn đọc được trên tablet.

Luồng chính:

1. Xem tình hình vận hành trên Dashboard.
2. Tạo khóa học theo trình hướng dẫn 4 bước.
3. Gửi nội dung sang trạng thái chờ duyệt.
4. Admin kiểm tra và xuất bản.
5. Theo dõi học viên, đăng ký và tiến độ.
6. Quản lý thành viên nội bộ theo vai trò.

## 2. Kiến trúc khu vực Admin

### Dashboard

- KPI: học viên hoạt động, lượt đăng ký, tỷ lệ hoàn thành, khóa học cần duyệt.
- Việc cần làm: nội dung nháp lâu ngày, học viên có nguy cơ bỏ học, giáo án cần cập nhật.
- Hoạt động gần đây và lối tắt tạo khóa học/giáo án.

### Khóa học

- Danh sách theo trạng thái: tất cả, đã xuất bản, chờ duyệt, bản nháp.
- Tìm kiếm, lọc huấn luyện viên/chủ đề/cấp độ và sắp xếp theo lần cập nhật.
- Hành động: xem trước, nhân bản, chỉnh sửa, gửi duyệt, xuất bản, lưu trữ.
- Chỉ Admin hoặc Super Admin có quyền xuất bản và xóa.

### Giáo án tập luyện

- Tạo lịch theo tuần/ngày, bài tập, hiệp, số lần, mức tạ, tempo và thời gian nghỉ.
- Kho bài tập dùng lại, biến thể theo thiết bị và mức thể lực.
- Gán giáo án cho cá nhân hoặc nhóm học viên.
- Huấn luyện viên được tạo/chỉnh sửa và gửi duyệt; Admin xuất bản.

### Học viên

- Hồ sơ, gói thành viên, khóa đã đăng ký, tiến độ và lịch sử tập.
- Bộ lọc học viên mới, hoạt động, sắp hết hạn và có nguy cơ bỏ học.
- Gán khóa học/giáo án, ghi chú nội bộ và trạng thái chăm sóc.

### Đội ngũ và phân quyền

- Tìm kiếm tài khoản, lọc theo vai trò và xem trạng thái hoạt động.
- Đổi vai trò qua backend tin cậy; đồng bộ cả Firestore profile và Firebase Auth custom claim.
- Ghi audit log cho mọi thay đổi quyền.
- Người nhận quyền mới cần đăng xuất rồi đăng nhập lại để làm mới token.

### Phân tích và cấu hình (giai đoạn tiếp theo)

- Funnel đăng ký → bắt đầu → hoàn thành, retention theo tuần, bài học gây rớt nhiều nhất.
- Quản lý danh mục, chứng chỉ, email, notification, branding và tích hợp thanh toán.
- Audit log, lịch sử xuất bản và khả năng quay lại phiên bản cũ.

## 3. Ma trận vai trò

| Vai trò | Phạm vi chính |
| --- | --- |
| Học viên | Học khóa đã được cấp, tập theo giáo án và theo dõi tiến độ cá nhân |
| Huấn luyện viên | Tạo giáo án, quản lý kho bài tập và học viên được giao |
| Biên tập viên | Tạo/chỉnh sửa khóa học, tải media và gửi duyệt |
| Admin | Quản trị vận hành, duyệt/xuất bản nội dung, quản lý học viên và vai trò thông thường |
| Super Admin | Toàn quyền, gồm cấp Super Admin và cấu hình hệ thống |

Quyền được kiểm tra ở ba lớp: menu giao diện, Firestore/Storage Rules và Cloud Function cho thao tác nhạy cảm. Ẩn nút trên giao diện không được xem là một cơ chế bảo mật.

## 4. Course Builder 4 bước

### Bước 1 — Thông tin cơ bản

- Tên, slug, mô tả, danh mục, cấp độ, huấn luyện viên và thời lượng.
- Kết quả đầu ra và yêu cầu đầu vào của học viên.
- Validation bắt buộc trước khi chuyển bước.

### Bước 2 — Chương và bài học

- Thêm/xóa/sắp xếp chương và bài.
- Loại bài: video, bài đọc, quiz hoặc buổi tập.
- Thời lượng, cho phép xem thử và ID ổn định cho từng bài.
- Giai đoạn sau bổ sung upload media, editor nội dung và quiz builder.

### Bước 3 — Thiết lập

- Gói truy cập Free/Pro, tỷ lệ hoàn thành và chứng chỉ.
- Hiển thị công khai/thành viên/nội bộ.
- Mở toàn bộ nội dung hoặc drip theo tuần.

### Bước 4 — Kiểm tra và xuất bản

- Tóm tắt số chương/bài và checklist hoàn thiện.
- Biên tập viên lưu nháp hoặc gửi duyệt.
- Admin có thêm quyền xuất bản trực tiếp.
- `createdAt` được giữ nguyên; mỗi lần lưu chỉ cập nhật `updatedAt`.

## 5. Khóa học mẫu

`Nền tảng sức mạnh · Aura 8 tuần` gồm 6 chương và 24 bài:

1. Khởi động hành trình.
2. Kỹ thuật nền tảng.
3. Nền tảng tăng tiến.
4. Xây dựng sức mạnh.
5. Làm chủ cường độ.
6. Hoàn thiện hành trình.

Khóa học bao phủ video kỹ thuật, bài đọc, quiz và buổi tập; cấu hình gói Pro, hoàn thành ở 80%, chứng chỉ và mở nội dung theo tuần.

## 6. Các bước phát triển kế tiếp

1. Kết nối trang chi tiết học viên với `courseId` và dữ liệu module thật.
2. Tách tiến độ theo `users/{uid}/progress/{courseId}` thay vì lưu trên course.
3. Thêm upload video/thumbnail, xử lý media và phụ đề.
4. Xây quiz builder, chấm điểm và điều kiện hoàn thành.
5. Thêm versioning, lịch xuất bản và rollback.
6. Hoàn thiện analytics, notification và thanh toán.
