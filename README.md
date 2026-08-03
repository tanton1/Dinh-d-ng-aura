# Aura Fitness Learning PWA

PWA học và tập luyện Aura Fitness, gồm trải nghiệm học viên, giao diện quản trị và backend Firebase.

## Chạy dự án

```powershell
npm.cmd install
npm.cmd run dev
```

Mở `http://localhost:5173`.

## Luồng có sẵn

- Trang chủ học viên và điều hướng mobile-first.
- Thư viện khóa học, trang học video và danh sách bài học.
- Lịch tập, báo cáo tiến độ, hồ sơ cá nhân.
- Trình tập có log mức tạ/số lần, rest timer và màn hình hoàn thành.
- Dashboard admin, quản lý khóa học và học viên.
- Course Builder và Workout Program Builder có tương tác.
- Web manifest, service worker và app icon cho PWA.
- Firebase Authentication: Email/Password, Google và reset mật khẩu.
- Firestore realtime + offline persistence cho khóa học, tiến độ, workout log và giáo án.
- Firebase Storage Rules, Firestore Rules, indexes và Hosting config.
- Phân quyền 5 vai trò, quản lý đội ngũ và Course Builder 4 bước.

## Kết nối Firebase

Sao chép `.env.example` thành `.env.local`, điền cấu hình Web App từ Firebase Console rồi khởi động lại dev server. Xem hướng dẫn đầy đủ tại [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md).

Xem blueprint chi tiết khu vực quản trị và quy trình tạo khóa học tại [`docs/ADMIN_COURSE_BLUEPRINT.md`](docs/ADMIN_COURSE_BLUEPRINT.md).

## Giai đoạn tiếp theo

Nếu chưa có `.env.local`, app tự chạy Demo Mode với dữ liệu mẫu. Khi đủ cấu hình Firebase, app chuyển sang đăng nhập và đồng bộ dữ liệu thật. Các phần tiếp theo gồm upload media UI, thanh toán và push notification production.
