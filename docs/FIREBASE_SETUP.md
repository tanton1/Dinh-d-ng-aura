# Thiết lập Firebase cho Aura Fitness

## 1. Tạo dự án

1. Mở Firebase Console và tạo một project mới.
2. Thêm một Web App trong **Project settings > Your apps**.
3. Bật **Authentication > Sign-in method**:
   - Email/Password.
   - Google.
4. Tạo Cloud Firestore ở chế độ Production.
5. Bật Cloud Storage.

## 2. Cấu hình ứng dụng

Sao chép `.env.example` thành `.env.local`, sau đó điền cấu hình Web App do Firebase cung cấp. Nếu project dùng named database, điền thêm `VITE_FIREBASE_DATABASE_ID`:

```powershell
Copy-Item .env.example .env.local
```

Không commit `.env.local`. Các Firebase Web API key không phải server secret, nhưng việc tách theo môi trường giúp tránh trỏ nhầm dev/production.

## 3. Chạy local

```powershell
npm.cmd install
npm.cmd run dev
```

Khi đủ biến môi trường, ứng dụng tự chuyển từ Demo sang Firebase, yêu cầu đăng nhập và đồng bộ Firestore.

## 4. Tạo tài khoản admin đầu tiên

1. Đăng ký một tài khoản trong app.
2. Mở Firestore Console, tìm `users/{uid}` của tài khoản đó.
3. Đổi trường `role` từ `student` thành `admin`.
4. Tải lại app và mở **Trang quản trị**.
5. Nhấn **Khởi tạo dữ liệu** trên Dashboard để đưa khóa học/bài tập mẫu lên Firestore.

Chỉ bootstrap admin qua Firebase Console. Client không được tự nâng quyền theo Security Rules.

Cloud Storage Rules kiểm tra role bằng custom Auth claim vì Storage chỉ đọc được database `(default)` khi một project có nhiều Firestore database. Trước khi bật upload course media, đồng bộ claim `role` cho tài khoản staff bằng môi trường Admin SDK tin cậy.

## 5. Firebase CLI và deploy

Trên PowerShell dùng `firebase.cmd` để tránh Execution Policy chặn file `.ps1`:

```powershell
firebase.cmd login
firebase.cmd use --add
npm.cmd run build
firebase.cmd deploy --only firestore:rules,firestore:indexes,storage,hosting
```

Lệnh `firebase.cmd use --add` tạo `.firebaserc` với project ID thật. File `.firebaserc.example` chỉ là mẫu.

## 6. Emulator Suite

Đổi `VITE_USE_FIREBASE_EMULATORS=true` trong `.env.local`, rồi chạy:

```powershell
firebase.cmd emulators:start
npm.cmd run dev
```

Các cổng được cấu hình trong `firebase.json`: Auth `9099`, Firestore `8080`, Storage `9199`, Emulator UI `4000`.

## Dữ liệu chính

- `users/{uid}`: hồ sơ và vai trò.
- `users/{uid}/progress/{courseId}`: tiến độ khóa học.
- `users/{uid}/workoutLogs/{logId}`: nhật ký tập.
- `courses/{courseId}`: khóa học và module.
- `programs/{programId}`: giáo án.
- `exercises/{exerciseId}`: thư viện bài tập.

Security Rules mặc định từ chối mọi đường dẫn không được khai báo.
