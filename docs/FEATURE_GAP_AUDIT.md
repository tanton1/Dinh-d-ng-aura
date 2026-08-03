# Audit khoảng trống tính năng Aura Fitness E-learning

Ngày chụp trạng thái: 01/08/2026
Phạm vi: PWA học viên, quản trị, Firebase, điều hướng và các luồng dữ liệu chính.

## 1. Cách đọc tài liệu

Tài liệu này phân biệt rõ giao diện đã có với tính năng vận hành thật. Một màn hình đẹp hoặc một nút có hiệu ứng chưa được xem là hoàn tất nếu chưa đọc/ghi đúng dữ liệu, xử lý lỗi và vượt qua kiểm thử luồng.

| Trạng thái | Ý nghĩa |
| --- | --- |
| **Hoạt động** | Luồng chính đã nối backend và có thể sử dụng; vẫn có thể còn gap phụ ở P2. |
| **Đang một phần** | Một số dữ liệu hoặc hành động là thật, nhưng luồng chưa khép kín hoặc vẫn trộn dữ liệu mô phỏng. |
| **Mô phỏng** | Phần lớn dữ liệu hard-code, control không có handler hoặc chưa có service/backend tương ứng. |

Mức ưu tiên:

- **P0 – Release blocker:** sai dữ liệu, sai quyền, không thể hoàn thành luồng cốt lõi hoặc build/integration chưa xanh.
- **P1 – Core product:** cần có để sản phẩm dùng được hằng ngày, nhưng chưa nhất thiết chặn bản thử nghiệm nội bộ.
- **P2 – Hoàn thiện trải nghiệm:** tiện ích, điều khiển phụ, khả năng tiếp cận và độ bóng sản phẩm.

## 2. Kết luận nhanh

Aura hiện đã khép kín vertical slice kỹ thuật **chọn khóa → deep-link đúng course/lesson → ghi danh → hoàn thành → cập nhật tiến độ**. Luồng demo đã được kiểm tra bằng trình duyệt; hai callable server-side, Firestore/Storage Rules và Hosting đã triển khai production. Smoke test HTTP ẩn danh đã xác nhận callable từ chối truy cập sai; smoke test có đăng nhập vẫn cần chạy bằng tài khoản kiểm thử riêng.

Ứng dụng không còn trình bày KPI admin, số đo cơ thể, lịch production hoặc thành tích mẫu như dữ liệu thật. Các khu vực chưa có backend được chuyển sang empty state/“Sắp ra mắt”; dữ liệu trình diễn chỉ còn trong chế độ Demo và được dán nhãn. Schedule nâng cao, workout assignment, media player, Admin Students và analytics vẫn là các phần lớn chưa hoàn tất.

## 3. Ma trận trạng thái từng trang

### 3.1. Xác thực và khung ứng dụng

| Trang/khu vực | Trạng thái | Đã hoạt động | Đang một phần hoặc mô phỏng | Ưu tiên tiếp theo |
| --- | --- | --- | --- | --- |
| Đăng nhập/đăng ký | **Hoạt động** | Email/password, Google, tạo profile, quên mật khẩu và đăng xuất đã nối Firebase Auth. | Điều khoản và chính sách chưa mở nội dung; chưa có xác minh email, MFA, quản lý phiên hoặc đổi mật khẩu trong app. | P2 |
| App Shell/navigation | **Đang một phần** | Hash route mang `courseId/lessonId`, deep-link/reload, mobile menu, Student/Admin guard, tìm khóa học toàn cục, offline banner và trạng thái thông báo trung thực hoạt động. | Notification center, help center và command palette nâng cao chưa có backend; program/workout route mới ở mức liên kết lesson. | P1/P2 |
| PWA/offline | **Đang một phần** | Manifest có icon PNG 192/512, service worker chỉ cache GET same-origin thành công, navigation network-first, static stale-while-revalidate và cache header production rõ ràng. | Cần acceptance test offline/update trên bản deploy, update prompt/background sync và audit cache/draft khi đổi tài khoản. | P1 |

### 3.2. Khu vực học viên

| Trang | Trạng thái | Đã hoạt động | Đang một phần hoặc mô phỏng | Ưu tiên tiếp theo |
| --- | --- | --- | --- | --- |
| Trang chủ | **Đang một phần** | Ngày/lời chào/profile, khóa đang học và tiến độ lấy từ nguồn hiện tại; mở đúng course ID. Production dùng số liệu khóa thật và empty state thay cho activity/lịch giả. | Workout tự do vẫn dùng chương trình nền tảng tĩnh; activity, schedule assignment và achievement nâng cao chưa có aggregation. Demo vẫn có số mẫu nhưng được dán nhãn. | P1 |
| Khóa học | **Hoạt động** | Catalog published, enrollment/progress merge, tab “Đang học”, tìm kiếm toàn cục/cục bộ, category/level filter, loading/error/empty và keyboard access đã nối App. | Hủy ghi danh, mua/nâng gói và catalog riêng cho private assignment chưa có UI hoàn chỉnh. | P1 |
| Chi tiết khóa học | **Đang một phần** | Render đúng metadata/module/lesson; deep-link course/lesson; sidebar, tab, ghi chú tách theo tài khoản, CTA ghi danh/Pro, completion server-side, progress real-time và lịch mở module theo tuần hoạt động. | Media/article/quiz thật, tài liệu upload/download, discussion/chat và lịch mở theo từng lesson tùy biến chưa có. | P0/P1 |
| Lịch học & tập | **Đang một phần** | Production hiển thị empty state trung thực và cho bắt đầu workout tự do; Demo có lịch mẫu được tách riêng. | CRUD calendar, recurrence, timezone, assignment, reminder và liên kết event thật chưa có. | P1 |
| Tiến độ & thành tích | **Đang một phần** | KPI và danh sách tiến độ khóa học tính từ enrollment/course progress thật; huy hiệu chỉ sinh từ khóa hoàn thành. | Workout analytics, body metrics history, PB, date filter và aggregation server chưa có. | P1 |
| Hồ sơ cá nhân | **Đang một phần** | Tên, email, membership, goals, chiều cao, cân nặng và notification setting đọc/ghi Firestore với validation, trạng thái lưu/lỗi; đăng xuất hoạt động. | Avatar upload, theme, thiết bị, billing, MFA, quyền riêng tư, export dữ liệu, help và feedback được disable/dán nhãn sắp ra mắt. | P1/P2 |
| Workout Player | **Đang một phần** | Timer, pause, chọn bài, complete set, rest timer và lưu workout log đã có. Sprint này đã sửa dữ liệu per-set, tổng tải, RPE, completion guard, draft/resume và dùng `clientLogId` ổn định để retry không tạo log trùng. | Program/session/exercises vẫn lấy dữ liệu tĩnh; video/sound/fullscreen/kỹ thuật chưa hoạt động; chưa tải lịch sử set trước, chưa có workout assignment thật và chưa có rules validation đầy đủ cho log. | P1 |

### 3.3. Khu vực quản trị

| Trang | Trạng thái | Đã hoạt động | Đang một phần hoặc mô phỏng | Ưu tiên tiếp theo |
| --- | --- | --- | --- | --- |
| Admin Dashboard | **Đang một phần** | Điều hướng tạo nội dung/danh sách khóa học hoạt động theo quyền; seed template chỉ còn trong development. | KPI/chart/queue/feed chưa có nguồn thật nên hiển thị `—`/empty state, không còn số giả. | P1 |
| Quản lý khóa học | **Đang một phần** | Đọc course Firestore, lọc theo trạng thái/tên, tạo và mở editor theo quyền. | Learners, completion trung bình, rating và updated label chưa có aggregation thật. View, filter nâng cao và menu thêm chưa hoạt động. | P1/P2 |
| Trình tạo khóa học | **Đang một phần** | Tạo/sửa metadata, module/lesson, settings, draft/review/publish và lưu Firestore. Sprint này bổ sung dirty state trên reload/sidebar/hash-back, URL course ID sau lần lưu đầu, giữ nguyên trạng thái scheduled/archived, lỗi tải rõ ràng và khóa thao tác sai quyền với course published. | Chưa có upload/processing video, rich lesson content, quiz builder, attachment, autosave/version history, revision staging hoặc preview giống học viên. | P1 |
| Trình tạo giáo án | **Đang một phần** | Chọn bài từ thư viện mẫu, thêm/xóa bài, chuyển tuần/ngày và lưu plan lên Firestore. | Chưa đọc ngược program đã lưu; thông số row đang read-only; kéo thả, filter nhóm cơ, tạo bài mới, copy tuần, progressive overload, settings và preview chưa hoạt động. | P1 |
| Học viên | **Mô phỏng** | Tìm kiếm cục bộ trên danh sách mẫu. | Danh sách, KPI, progress, streak và trạng thái đều từ `data.ts`. Export, thêm học viên, filter, email và menu hành động chưa hoạt động. | P1 |
| Vai trò & quyền | **Đang một phần** | Đọc user Firestore, lọc, permission guard và đổi role qua callable Function; có xác nhận và trạng thái lỗi/thành công. | Mời user, khóa/mở tài khoản, phân công coach, lịch sử thay đổi và last-active thật chưa có. Người nhận role mới vẫn cần refresh token/đăng nhập lại. | P1/P2 |

## 4. Khoảng trống P0–P2

### P0 – Release blocker còn lại

1. **Entitlement nội dung Pro chưa được bảo vệ đầy đủ ở cấp document**
   - Course `published` và `course-media` hiện không nên dựa duy nhất vào trạng thái signed-in.
   - Callable đã bảo vệ ghi danh/tiến độ và Storage media hiện khóa staff-only, nhưng modules vẫn embed trong course document đọc được bởi user signed-in.
   - Cần tách catalog metadata khỏi lesson content trả phí; media phải cấp signed URL ngắn hạn sau entitlement check.

2. **Smoke test production có xác thực**
   - Functions, Rules và Hosting đã triển khai; endpoint callable tồn tại và từ chối request ẩn danh bằng HTTP 401.
   - Còn xác minh bằng tài khoản test riêng: Free bị chặn khóa Pro, admin/pro ghi danh được, completion lặp không tăng phần trăm và reload giữ state.

3. **Automated security/E2E gate chưa có**
   - Typecheck, production build, Functions syntax và Rules dry-run đã xanh; vẫn cần emulator test role/attacker và E2E Firebase có xác thực trong CI.

4. **Course revision/content integrity**
   - Callable từ chối lesson ID trùng và tự đối soát ID cũ đã bị xóa, nhưng sửa trực tiếp module của khóa published vẫn có thể thay đổi ý nghĩa tiến độ hiện tại.
   - Cần immutable revision và migration enrollment/progress khi xuất bản bản mới.

### P1 – Chức năng cốt lõi còn thiếu

1. Home phải tổng hợp progress, workout logs, schedule và achievement thật.
2. Course player cần video/article/quiz/workout lesson, attachment và next-lesson flow.
3. Enrollment cần vòng đời active/completed/cancelled và access tier free/pro.
4. Schedule cần CRUD, timezone, recurring event, assignment từ coach và reminder.
5. Progress cần aggregation từ logs/progress/body metrics, bộ lọc khoảng thời gian và empty state trung thực.
6. Profile cần form edit các field được rules cho phép, avatar upload và preferences thực.
7. Workout phải đọc program/session thật, có set history, resume đồng bộ và server/rules validation cho payload.
8. Admin Dashboard/Students/Course analytics phải thay dữ liệu mẫu bằng query hoặc aggregation backend.
9. Program Builder cần load/update program, sửa sets/reps/rest/RPE và lưu riêng theo week/day.
10. PWA cần cache policy rõ ràng, offline shell ổn định, update prompt và không để draft/cache của user A xuất hiện cho user B.

### P2 – Hoàn thiện trải nghiệm

1. Global search, notification center, help center, settings và command palette.
2. Notes/discussion/chat coach/download resources.
3. Calendar month/week interaction nâng cao và export calendar.
4. Admin bulk actions, export, email, filters, audit history và activity feed.
5. Accessibility: focus states, keyboard navigation, aria-label, reduced motion và screen-reader announcements.
6. Toast thống nhất, retry, optimistic state và thông báo offline/sync.
7. Terms/privacy pages, account security, data export/delete request.

## 5. Những thay đổi đã triển khai trong sprint này

Phần này ghi nhận code đã được thêm vào working tree; không đồng nghĩa production hoàn tất nếu cột “Còn phải xác nhận” chưa đóng.

| Hạng mục | Đã triển khai | Còn phải xác nhận |
| --- | --- | --- |
| Workout data integrity | Timer bắt đầu 0; weight/reps lưu riêng từng completed set; tổng set/tải tính thật; RPE có state/payload; không thể finish khi thiếu set; retry dùng cùng `clientLogId` nên không tạo log trùng. | Test tích hợp payload với Firestore và rules validation. |
| Workout draft/resume | Draft localStorage được validate, giới hạn giá trị, tách theo user/program/session; có resume, confirm exit/reload và chỉ xóa sau discard/save thành công. | E2E refresh/tab close, quota/private mode và đổi tài khoản. |
| Course catalog states | Bỏ silent fallback demo; loading/error/empty/filter động; App merge enrollment/progress và tìm kiếm toàn cục. | E2E trên production Firebase và retry chủ động. |
| Course routing/player | URL chứa course/lesson ID; reload/deep-link; render module/lesson thật; tab/notes/CTA/access/completion hoạt động; workout chưa map bị chặn thay vì ghi nhầm; ghi chú có dirty guard toàn app. | Media/article/quiz/resources/discussion và next-lesson automation. |
| Progress/enrollment backend | Hai callable dùng named DB, transaction idempotent, kiểm tra user/course/enrollment/tier/private/lesson, lịch mở tuần và ngưỡng hoàn thành bằng phân số chính xác; App cập nhật real-time; Functions/Rules/Hosting đã deploy production. | Authenticated production smoke, emulator security test và course revision. |
| Firestore/Storage hardening | Chặn client ghi progress/enrollment, giới hạn notification update, media staff-only, avatar MIME chặt và bỏ vùng Storage progress không dùng. | Tách protected content, signed media delivery, App Check và security tests. |
| Course Editor safeguards | Dirty state, reload/sidebar/hash-back confirmation, save locking, URL ổn định sau lần lưu đầu, admin-route boundary, giữ trạng thái review/scheduled/archived, kiểm tra ngưỡng 50–100% ở UI + Rules và bảo vệ published course theo quyền. | Rich lesson validation và revision workflow vẫn là backlog. |

## 6. Roadmap ưu tiên

### Giai đoạn A — Khép kín vertical slice học tập (đã triển khai production, chờ authenticated smoke)

1. Đã chuẩn hóa route `courseId/lessonId` và nối `useLearningProgress`/enrollment vào App.
2. Đã merge catalog + enrollment + progress và render Course Detail từ module/lesson thật.
3. Đã chuyển enroll/complete sang callable transaction, cập nhật real-time và có loading/error/empty state.
4. Còn authenticated production smoke, emulator security test, nội dung media thật và next-lesson automation.

Kết quả mong đợi: một tài khoản mới có thể ghi danh, mở đúng khóa, hoàn thành bài, reload và vẫn thấy đúng tiến độ.

### Giai đoạn B — Workout và lịch tập dùng dữ liệu thật

1. Đọc program/session/exercises từ Firestore.
2. Gán workout từ schedule hoặc coach assignment.
3. Lưu set history, workout draft và completed log với schema/rules chặt.
4. Xây Schedule CRUD và liên kết event → workout/lesson.
5. Tổng hợp Home và Progress từ workout logs thật.

### Giai đoạn C — Hồ sơ, sức khỏe và vận hành admin

1. Profile edit, avatar, goals, preferences và body metrics.
2. Admin Students từ users/enrollments/progress; thêm filter, export và coach assignment.
3. Dashboard analytics/attention queue từ aggregation backend.
4. Program Builder đọc/sửa/xuất bản program có version.

### Giai đoạn D — Nội dung, thương mại và trải nghiệm nâng cao

1. Media upload/transcode, article editor, quiz builder, resource manager.
2. Entitlement Pro, thanh toán/subscription và signed content delivery.
3. Notifications, discussion, notes, coach chat và certificate.
4. Offline-first lesson/workout, background sync, update prompt và observability.

## 7. Tiêu chí nghiệm thu

### 7.1. Course và progress

- Mở hai course khác nhau phải hiển thị đúng title/module/lesson tương ứng.
- URL trực tiếp và reload không làm mất course/lesson đang học.
- “Khóa của tôi” chỉ chứa enrollment active/completed của user hiện tại.
- Hoàn thành một lesson ghi đúng `userId`, `courseId`, `lessonId`; phần trăm bằng số lesson duy nhất đã hoàn thành chia tổng lesson.
- Click hoàn thành lặp lại cùng lesson không tăng phần trăm.
- Home, Courses và Detail hiển thị cùng một progress trong thời gian thực.
- User free không đọc được lesson/media Pro; admin/editor vẫn làm việc đúng phạm vi.
- Firebase lỗi phải hiển thị error/retry, không tự thay bằng dữ liệu demo trong production.

### 7.2. Workout

- Workout mới bắt đầu ở `00:00`.
- Mỗi set lưu đúng exercise, set number, weight và reps tại thời điểm hoàn thành.
- Không có đường UI hoặc reload draft nào mở completion khi thiếu set.
- Tổng set và tổng tải trên màn hình bằng payload gửi backend.
- RPE được chọn và lưu đúng.
- Refresh khôi phục đúng exercise, completed sets, input, timer, rest và RPE của cùng user/session.
- User khác trên cùng thiết bị không nhận draft của user trước.
- Save lỗi giữ draft và cho retry; save thành công xóa draft đúng session.

### 7.3. Schedule, Progress và Profile

- CRUD schedule tồn tại qua reload, đúng timezone Asia/Ho_Chi_Minh và mở đúng lesson/workout.
- Progress thay đổi khi có workout log/course completion mới; date filter thực sự đổi query/aggregation.
- Không hiển thị body metric mẫu dưới tài khoản thật; khi chưa có dữ liệu phải dùng empty state.
- Profile chỉ cập nhật field được phép; avatar đúng owner/type/size; preferences tồn tại qua phiên đăng nhập.

### 7.4. Admin

- Dashboard và Students không còn KPI/danh sách từ `data.ts` trong production.
- Role change bị chặn đúng với self-change, super admin và user không đủ quyền; audit log được ghi.
- Course draft có thể lưu khi chưa hoàn thiện; review/publish phải vượt checklist.
- Editor không làm published course tụt về draft ngoài ý muốn.
- Program đã lưu có thể đọc lại, sửa từng week/day/set và không ghi đè dữ liệu ngoài phạm vi.

### 7.5. PWA và chất lượng phát hành

- `npm run typecheck` và `npm run build` pass trên working tree hợp nhất.
- Firebase emulator tests pass cho Auth/Firestore/Storage rules ở vai trò student, coach, editor, admin và attacker.
- E2E tối thiểu pass: đăng nhập → ghi danh → học/complete → reload; workout → save; admin → tạo/publish course → student nhìn thấy.
- App shell mở offline sau lần tải online đầu; không cache private API response ngoài allowlist.
- Có cơ chế nhận biết bản service worker mới và không giữ cache/draft chéo tài khoản.
- Không có console error chưa xử lý ở các luồng nghiệm thu.

## 8. Nguyên tắc cập nhật trạng thái

Chỉ đổi một trang từ **Mô phỏng** sang **Đang một phần** khi đã có ít nhất một nguồn dữ liệu hoặc mutation thật. Chỉ đổi sang **Hoạt động** khi luồng chính đã khép kín, có xử lý loading/error/permission và đạt tiêu chí nghiệm thu tương ứng. Không dùng việc “đã có UI” hoặc “đã có service nhưng chưa được gọi” làm bằng chứng hoàn tất.
