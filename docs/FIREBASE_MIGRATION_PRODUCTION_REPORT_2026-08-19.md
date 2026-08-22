# Báo cáo migration Firebase production — 2026-08-19

## Phạm vi

- Nguồn chỉ đọc: project `gen-lang-client-0246058381`, named Firestore database `aura-fitness-db`.
- Đích production: project `gen-lang-client-0815966909`, named Firestore database `ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7`.
- Website production tiếp tục chạy trên Vercel; migration này không đổi URL, DNS hoặc Firebase project của hệ thống cũ.

## Điểm khôi phục

- Snapshot nguồn PITR: `2026-08-19T13:50:00Z`.
- Firestore export nguồn: `gs://aura-migration-607039870489-20260819/source-pitr/2026-08-19T13-55-38-541Z`.
- Firestore backup đích trước merge: `gs://aura-migration-607039870489-20260819/target-backup/2026-08-19T13-55-31-255Z`.
- Database đích đã bật PITR và delete protection sau migration.

## Kết quả Firebase Authentication

- Nguồn: 333 tài khoản Email/Password.
- Đích trước merge: 37 tài khoản.
- 332 tài khoản không xung đột được import với UID, password hash/salt và metadata gốc.
- 1 xung đột email là tài khoản admin chính; giữ nguyên UID và custom claim `admin` của project đích, không import record trùng từ nguồn.
- Đích sau merge: 369 tài khoản; 332/332 tài khoản dự kiến có mặt, 37/37 tài khoản cũ vẫn còn, 0 lỗi import.
- Export nguồn trước/sau migration có cùng SHA-256 và cùng 333 tài khoản, xác nhận nguồn không bị thay đổi.
- Bốn file export Auth chứa email/password hash đã được xóa khỏi máy sau đối soát; chỉ giữ báo cáo đã băm định danh trong `.migration-private/`.

## Kết quả Firestore

- Import thành công 10.966/10.966 documents từ 18 collection groups.
- Đối soát từng document path và toàn bộ fields chuẩn hóa: 10.966 exact, 0 thiếu, 0 khác nội dung.
- Có 34 documents bổ sung trong các collection groups được kiểm tra; đây là dữ liệu đã tồn tại ở app đích, không bị snapshot nguồn ghi đè.
- Inventory cuối: nguồn 10.966 documents, staging 10.966 documents, đích 12.117 documents trong 42 collection groups đã biết.
- 9 composite indexes của app đích vẫn hiện diện sau import.

## Chuẩn hóa an toàn sau import

- Push automation được khóa tạm trong cửa sổ import và đã khôi phục đúng trạng thái ban đầu.
- 307 profile nguồn chưa từng có `notificationSettings` được đặt `enabled=false`, `mealReminders=false` và yêu cầu người dùng tự opt-in; không tự gửi thông báo cho người dùng vừa migrate.
- 25 tài khoản Auth nguồn chưa có profile Firestore; app sẽ tạo profile theo luồng đăng nhập/onboarding hiện hành.
- Profile UID admin cũ được đánh dấu đã hợp nhất và vô hiệu hóa ở project đích; profile admin hiện tại nhận metadata alias nhưng không bị ghi đè role, hồ sơ hoặc custom claim.
- Kiểm tra cuối: role Firestore của admin vẫn là `admin`, tài khoản không bị disabled, custom claim Auth vẫn là `admin`, và dry-run normalization còn 0 write.

## Storage, RTDB và hạ tầng

- Source Storage chỉ có một build artifact của AI Studio, không có ảnh/media người dùng; không copy artifact này.
- Cả nguồn và đích không có Realtime Database instance cần di chuyển.
- Cloud Functions production vẫn được liệt kê đầy đủ ở `asia-southeast1`.
- Vercel production smoke test đạt: HTML, PWA manifest và các bundle React/Firebase chính đều tải thành công.

## Acceptance còn cần thao tác người dùng

- Đăng nhập thử một tài khoản nguồn bằng mật khẩu cũ để xác nhận trải nghiệm end-to-end. Password hash đã được import đúng cấu hình SCRYPT nguồn, nhưng hệ thống migration không biết mật khẩu dạng rõ để tự chạy canary này.
- Đăng nhập tài khoản `nhattank16.1@gmail.com`, kiểm tra trang admin và refresh token để xác nhận UI nhận claim hiện tại.
- Khi một người dùng migrate muốn nhận Push, họ cần bật thông báo trong app để đăng ký FCM token thuộc project mới.

## Rollback

- Firestore: dùng target backup ở trên để dựng database khôi phục/canary; không xóa database production đang được bảo vệ.
- Website: rollback Vercel release không đụng project nguồn.
- Auth không có rollback nguyên tử. Nếu cần đảo migration, dựng danh sách từ source export mới và manifest UID hash; tuyệt đối không bulk-delete 37 tài khoản đích hiện hữu.
- Project nguồn vẫn hoạt động độc lập và không bị sửa/xóa trong toàn bộ quy trình.
