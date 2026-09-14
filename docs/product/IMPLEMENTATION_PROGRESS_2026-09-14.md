# Aura Operating System — triển khai 2026-09-14

Tài liệu này ghi nhận các lát cắt đã triển khai từ kế hoạch hợp nhất dữ liệu và
nâng cấp vận hành. Đây không phải là bằng chứng đã deploy production; rollout
backend vẫn phải qua CI, staging và feature flag theo quy trình phát hành.

## Đã hoàn thành trong lát cắt này

- Admin HR dùng callable `listIdentityDirectory` với cursor và page size bị
  giới hạn 20–100, thay cho listener `roleAssignments` 2.500 dòng.
- Trang HR chỉ tải directory Nhân viên khi người quản trị mở tab tương ứng.
- Hồ sơ tài khoản, Identity v2 assignment, hồ sơ vận hành Staff/PT và phạm vi
  chi nhánh được ghép ở server; client không còn tải các collection này để join.
- Số học viên PT chính/phối hợp/dinh dưỡng được lưu ở
  `staffOperationalSummaries/{uid}`. Callable làm mới summary cũ theo yêu cầu
  trong phạm vi giới hạn; trigger hợp đồng cập nhật các PT bị ảnh hưởng.
- Thêm telemetry `route_loaded` không chứa PII để đo thời gian route sau khi
  React commit; lỗi chunk vẫn đi qua `reportClientIssue`.
- Home và Nutrition dùng cache nhật ký dinh dưỡng theo `accountUid + ngày` để
  chuyển trang không tạo lại dữ liệu cục bộ ngay lập tức. Firebase listener
  vẫn bị giới hạn theo đúng học viên và ngày.
- Thêm token bridge Aura UI 4.0: brand/semantic color, radius, Be Vietnam Pro,
   minimum text size và `prefers-reduced-motion`. Operations frame dùng canvas
   trung tính, không còn orb trang trí ở lớp shell chung.
- State cục bộ của Nutrition (profile, meal/water/activity restore và scan
  review cleanup) được chuyển sang module dùng chung, không đổi storage key hay
  công thức dữ liệu.
- `NutritionPageController.tsx` đã bỏ các bản sao demo/profile/plan và dùng
  module state canonical; file giảm hơn 600 dòng so với đầu lát cắt, trong khi
  scan, catalog, editor và plan vẫn giữ boundary lazy hiện tại.

## Chưa được coi là hoàn thành rollout

- Admin PT Students đã có surface V2 theo feature flag `admin-student-directory`:
  roster dùng `listStudent360Directory` cursor-first, deep link vẫn mở Student
  360, và khi flag bật DatabaseContext không mở các listener
  students/contracts/sessions/availability legacy. Tìm kiếm tên đã chuẩn hóa
  dấu tiếng Việt và số điện thoại không khoảng trắng; mobile chuyển sang card
  không cuộn ngang. Legacy surface vẫn giữ để rollback cho đến khi parity
  production được xác nhận.
- Nutrition onboarding được tách thành chunk lazy; model/cache/diagnostic của
  Schedule workspace đã tách ra `features/schedule/workspaceModel.ts` mà không
  thay đổi optimizer hay chính sách nghiệp vụ. Các entry scan/catalog/plan
   tiếp tục lazy-load để giữ budget hiện tại.
- Directory callable đọc cửa sổ tài khoản có giới hạn lớn hơn để bù các bản ghi
  staff/admin bị loại sau join; cursor vẫn tiến theo UID và không tải quá 300
  user source records cho mỗi request.
- Đã bổ sung tìm kiếm không phân biệt dấu cho directory HR và kiểm thử hành vi
  UI 4.0 trên Chromium desktop/mobile.
- Các route compatibility, schema legacy và source data chưa bị xóa.
- E2E các shell, Nutrition, Student 360, Admin Dashboard và Schedule đã chạy
  trên Chromium và mobile Chromium (64 ca đạt); audit screenshot thủ công vẫn
  là việc rollout tiếp theo.

## Verification

- `npm run typecheck` phải đạt trước khi commit.
- `npm run performance:check` đo lại sau clean build; bundle baseline hiện vẫn
  nằm trong budget repo, nhưng Firestore vendor và các route Admin/Schedule
  vẫn gần ngưỡng nên không tăng dependency mới.
- Contract test phải xác nhận callable directory, server redaction và trigger
  summary; không kiểm tra bằng cách chỉ ẩn UI.

## Verification đã chạy trong phiên

- `npm run typecheck` đạt.
- `npm run test:profile-sync`: 130/130 test đạt.
- `npm --prefix functions test`: đạt toàn bộ Functions suite.
- `node --check functions/identity-access.js` và `node --check functions/index.js` đạt.
- `npm run build` đạt; production chunk được tạo riêng cho
  `AdminStudentDirectoryV2` và `NutritionOnboarding`.
- `npm run performance:check` đạt: startup 130.8 KiB gzip, Nutrition 68.1 KiB,
  Admin PT 67.5 KiB, Schedule 26.4 KiB; tất cả dưới budget hiện hành.
- E2E mục tiêu `aura-ui-v4`, `mobile-shell-behavior`, `nutrition-scan`,
  `pt-schedule-layout`, `student-360`: 64/64 đạt trên Chromium và mobile
  Chromium.
- Functions đã nâng `firebase-admin` lên 14.4.0; audit còn 3 cảnh báo
  moderate transitive (`qs`/`uuid`) không có bản vá trực tiếp từ dependency
  hiện tại, không có cảnh báo high/critical.
- Secret scan đã kiểm tra 788 file được track và không phát hiện mẫu credential.
- Firestore rules emulator đã được chạy lại bằng JDK 21: Firestore 32/32,
  Storage 9/9 và Realtime Database 1/1 đạt.
- Production gate đã đạt enforcement thật khi cung cấp site key và
  `ENFORCE_AI_APP_CHECK=true`; `ENFORCE_APP_CHECK` vẫn tắt để giữ rollout AI-only.

## Prerequisite production đã xử lý trong phiên tiếp theo

- Đã cài Temurin OpenJDK 21 LTS theo user scope tại
  `C:\Users\TAN TON\AppData\Local\Programs\AuraJdk21`; Java 8 hệ thống vẫn
  được giữ nguyên. Firebase Firestore, Storage và Realtime Database Rules đã
  chạy lần lượt đạt 32/32, 9/9 và 1/1.
- Firestore emulator trên Windows không xử lý được đường dẫn workspace có ký tự
  Unicode `Dưỡng`; test được chạy qua junction ASCII tạm thời, không sao chép,
  xóa hoặc thay đổi dữ liệu/repository.
- Firebase App Check đã xác minh Web App dùng provider reCAPTCHA Enterprise
  với key `aura-web-production`, domain production duy nhất
  `dinh-duong-aura.vercel.app`, TTL 3600 giây. Biến
  `VITE_FIREBASE_APP_CHECK_SITE_KEY` trên Vercel Production đã được thay bằng
  site key hiện hành (site key là public client config, không phải secret).
- Khi cung cấp site key cùng `ENFORCE_AI_APP_CHECK=true`, production gate đạt
  chế độ enforcement thật; `ENFORCE_APP_CHECK` vẫn giữ `false` để không mở rộng
  enforcement cho các sản phẩm ngoài AI.
- GitHub Actions repository variables đã được đồng bộ bằng quyền quản trị của
  Git credential hiện tại: `VITE_FIREBASE_APP_CHECK_SITE_KEY`,
  `ENFORCE_AI_APP_CHECK=true` và `ENFORCE_APP_CHECK=false`. Release production
  tiếp theo phải chạy gate enforcement thật, không dùng
  `--allow-pending-app-check`.
