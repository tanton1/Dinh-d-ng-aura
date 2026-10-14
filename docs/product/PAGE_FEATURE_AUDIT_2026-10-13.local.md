# Aura Dinh Dưỡng — audit trang và tính năng (13/10/2026)

> Tài liệu nội bộ, lưu local và **không đưa lên production/Git**. Các số liệu vận hành bên dưới là snapshot trong đợt kiểm tra trực tiếp ngày 12–13/10/2026, không phải cam kết số liệu hiện tại.

## 1. Kết luận nhanh

- Bản release gần nhất đã triển khai thành công lên production: frontend Vercel, Firestore/Storage Rules và 4 callable Functions đều healthy.
- Smoke production độc lập đạt **14/14**; CI, CodeQL, E2E browser, schedule UI và emulator rules đều đạt.
- Điểm phần mềm trung bình theo nhóm route đạt khoảng **7,2/10**. Các luồng có nền tảng tốt nhất là Academy, payroll, nutrition và Student360; điểm vận hành thấp chủ yếu do dữ liệu chưa được đối soát, tài khoản chưa liên kết học viên và các hàng đợi quá SLA.
- Ba ưu tiên cần xử lý trước khi mở rộng vận hành: (1) thay mật khẩu khởi tạo bằng lời mời/đặt mật khẩu riêng và bắt buộc đổi lần đầu; (2) xử lý backlog meal review, revenue reconciliation và renewals; (3) chuyển Student directory khỏi listener legacy sang cursor-first và chuẩn hóa trạng thái lỗi liên kết lịch.

## 2. Release đã triển khai

| Hạng mục | Kết quả |
|---|---|
| Release SHA | `da1270ff0d086a1259b077c5c18c925ced7fbae6` |
| Production | https://dinh-duong-aura.vercel.app |
| Release workflow | https://github.com/tanton1/Dinh-d-ng-aura/actions/runs/38346644671 |
| CI / CodeQL | https://github.com/tanton1/Dinh-d-ng-aura/actions/runs/38216634185 · https://github.com/tanton1/Dinh-d-ng-aura/actions/runs/38216634191 |
| Thay đổi chính | Payroll lazy tab/cache/dedup/stale guard; mã nhân viên; cảnh báo dữ liệu tạm tính; bounded AI meal review; owner cache 7 ngày; quota transactional; single-flight; reminder/content-AI cleanup; Firestore cache TTL declaration |
| Functions | `generateMealReview`, `dispatchScheduledReminders`, `listStaffPayrollAttendance`, `listStaffPayrollAttendanceV2` |
| Rules | Firestore và Storage đã deploy; App Check enforcement giữ nguyên (`ENFORCE_AI_APP_CHECK=true`, compatibility override false) |
| Smoke | 14/14, đúng release SHA, đúng Firebase project/database, production không chạy demo |
| Kiểm thử | `npm run ci`; Functions suite 732 pass; focused finance/history/staff Playwright 7 pass; CI + CodeQL + full production workflow pass |
| Bảo mật | Secret scan 766 file không phát hiện mẫu credential; production audit 0 vulnerability mức high |

Không thay đổi công thức lương, hồ sơ kinh doanh, lịch, phê duyệt bữa ăn hay giao dịch tài chính trong quá trình audit. Các thao tác production chỉ đọc, ngoại trừ kích hoạt cấu hình TTL dọn cache AI đã có trong release contract.

### TTL cache

`aiMealReviewCache.expiresAt` đã được kiểm tra trực tiếp trên database production và trả về `ttlConfig.state = ACTIVE`. Đây chỉ là dọn document cache hết hạn; ứng dụng vẫn tự từ chối cache hết hạn trước khi dùng. `firestore.indexes.json` khai báo `indexes: []`, nhưng API field GET sau operation vẫn trả `usesAncestorConfig: true`; vì vậy không ghi nhận quá mức rằng exemption single-field đã được xác nhận. Không chạm vào collection nghiệp vụ.

## 3. Cách chấm điểm

Điểm là đánh giá chuyên gia **0–10**, không phải Lighthouse hay benchmark chuyển đổi. Mỗi nhóm được chấm:

- **Đủ luồng (C)** — dữ liệu, thao tác chính, empty/error state và khả năng hoàn tất quy trình: 30%.
- **UX/mobile/a11y (U)** — phân cấp thông tin, responsive, nhãn thao tác, keyboard/screen-reader affordance: 20%.
- **Hiệu năng (P)** — lazy loading, số lần gọi, kích thước route chunk, cache/dedup, khả năng chịu dữ liệu: 20%.
- **Đúng/an toàn/tin cậy (R)** — scope/permission, validation, idempotency, stale guard, đối soát và tính giải thích được: 30%.

`Điểm tổng = 0,30C + 0,20U + 0,20P + 0,30R`. Điểm thấp do **thiếu dữ liệu vận hành** không đồng nghĩa giao diện hỏng; cột “trạng thái” tách hai việc này.

## 4. Bảng điểm route và tính năng

| Nhóm canonical | Kiểm tra | C | U | P | R | Tổng | Trạng thái |
|---|---|---:|---:|---:|---:|---:|---|
| Hôm nay / Home | Live mobile | 7,2 | 8,0 | 7,4 | 6,0 | **7,0** | Tốt có điều kiện; lỗi đồng bộ lịch cần copy rõ hơn |
| Dinh dưỡng | Live mobile + source | 8,2 | 8,2 | 7,7 | 7,0 | **7,8** | Sẵn sàng pilot; Health Connect còn placeholder |
| Tiến độ | Live mobile + source | 7,4 | 8,0 | 8,2 | 6,0 | **7,3** | Tốt; cần rubric cho “điểm sức khỏe” và dữ liệu thiếu |
| Lịch học viên | Live mobile + service/test | 7,2 | 7,3 | 7,2 | 4,9 | **6,6** | Cần liên kết hồ sơ; không kết luận thuật toán lỗi từ empty draft |
| Lịch rảnh | Source/test | 7,5 | 7,2 | 7,0 | 6,3 | **7,1** | Sẵn sàng có điều kiện, cần đủ availability |
| Tập luyện / PT workout | Live mobile + source | 6,8 | 7,2 | 7,4 | 4,7 | **6,5** | Guard đúng khi chưa có PT, nhưng trải nghiệm phụ thuộc phân công |
| Aura Academy / đọc bài | Live mobile | 8,7 | 8,0 | 7,8 | 8,2 | **8,3** | Mạnh nhất; 20 chương/60 bài, PDF + active recall/flashcard |
| Eat Clean học viên | Source + admin live | 7,8 | 7,2 | 6,8 | 7,0 | **7,3** | Có luồng tốt; cần E2E giao hàng/OTP/GPS thật |
| Aura Club học viên/chi nhánh | Live role gate + source | 6,6 | 7,0 | 7,4 | 6,2 | **6,7** | Scope đúng; cần bật/đo adoption trước khi mở rộng |
| Hồ sơ & bảo mật | Live mobile + source | 8,0 | 7,9 | 7,5 | 6,0 | **7,3** | Đủ tính năng; rủi ro mật khẩu khởi tạo P0/P1 |
| Push notifications | Live admin + source | 7,2 | 7,1 | 7,5 | 5,5 | **6,8** | Backend/automation có; snapshot có 347 account nhưng 0 device bật Push |
| Staff dashboard | Source/test | 7,8 | 7,6 | 7,4 | 7,0 | **7,5** | Có requestId/stale guard và scope |
| Staff students / Student360 | Live admin + source | 8,2 | 7,8 | 7,0 | 7,4 | **7,7** | Tốt; directory chính vẫn là legacy load |
| Staff schedule / availability / requests | Source/test | 7,8 | 7,4 | 7,2 | 7,0 | **7,5** | Sẵn sàng có điều kiện |
| Staff payroll | Source + release smoke | 8,3 | 8,0 | 8,3 | 7,2 | **7,9** | Release tốt; pending calendar/policy còn nhiều |
| Staff performance | Source | 7,5 | 7,4 | 7,4 | 6,2 | **7,1** | Cần chuẩn hóa SLA review |
| Staff nutrition reviews | Source + feature contract | 7,2 | 7,1 | 7,2 | 6,0 | **6,8** | Queue có bounded page; backlog vận hành cao |
| Staff quotes / sales | Source | 7,7 | 7,5 | 7,3 | 7,2 | **7,5** | Cursor 30 dòng, scope capability rõ |
| Staff renewals | Live admin + source | 7,6 | 7,4 | 7,2 | 6,4 | **7,1** | Workflow đầy đủ; dữ liệu adoption lệch cần reconcile |
| Admin dashboard | Live admin + source | 8,0 | 8,0 | 7,0 | 7,0 | **7,5** | Tốt; định nghĩa doanh thu/cash/attendance cần luôn hiển thị |
| Admin today sessions | Source + live navigation | 7,8 | 7,4 | 7,2 | 7,1 | **7,4** | Có filter/refresh và phân biệt upcoming/pending |
| Admin student directory | Live mobile + source | 6,8 | 6,4 | 5,8 | 6,4 | **6,4** | Nợ migration cursor-first; nhiều nút thiếu accessible name |
| Xếp lịch PT / optimizer | Live empty draft + source/test | 7,8 | 7,2 | 7,0 | 6,8 | **7,2** | Engine có objective/rescue/blocker; chưa chứng minh global optimum |
| Training history | Source | 7,6 | 7,1 | 6,6 | 7,0 | **7,1** | Đủ tab lịch sử/đổi-hủy/OFF |
| Trainer quality | Source/test | 8,0 | 7,4 | 7,2 | 7,5 | **7,6** | Có review state và resolution |
| Admin performance | Live admin + source | 7,6 | 7,3 | 7,1 | 6,3 | **7,1** | N/A tách zero; SLA copy đang lệch |
| Renewals admin | Live admin + source | 7,8 | 7,5 | 7,1 | 6,5 | **7,2** | Queue/pipeline/care/report tốt; số legacy vượt tổng |
| Finance | Live admin + source | 7,4 | 7,3 | 7,0 | 5,8 | **6,8** | Giao diện ổn, reconciliation adoption thấp |
| HR / roles | Live admin + source | 7,2 | 7,2 | 7,0 | 6,5 | **7,0** | Permission model tốt; scope HR/payroll lệch 14/15 cần mapping |
| Admin payroll | Live admin + source | 8,3 | 8,0 | 8,2 | 7,3 | **7,9** | Cải thiện rõ sau release; chưa có official run |
| Packages / quotes / schedule settings | Source | 8,0 | 7,5 | 7,2 | 7,5 | **7,6** | Validation, capability và pending guard tốt |
| Admin nutrition reviews | Live admin + source | 7,7 | 7,4 | 7,4 | 6,2 | **7,1** | Bounded page/summary; 103 pending vượt SLA |
| Eat Clean admin / delivery | Live admin + source | 7,4 | 7,2 | 6,8 | 6,0 | **6,8** | Có state machine OTP; chưa E2E shipper thật |
| Loyalty admin | Live admin + source | 8,0 | 7,4 | 7,3 | 7,2 | **7,5** | Ledger/policy/redeem có guard; cần adoption |
| Admin notifications | Live admin + source | 7,8 | 7,4 | 7,2 | 7,0 | **7,5** | Tab overview/send/automation/history/UI rollout rõ |
| Admin Academy/programs | Source-only, navigation hidden | 6,8 | 6,5 | 6,8 | 6,7 | **6,7** | Tồn tại và permission đúng nhưng chưa nên quảng bá |

### Redirect và route hygiene

Các bookmark cũ vẫn được canonicalize về một màn hình: `trainer-portal → staff-students`, `sales-portal → staff-quotes`, `schedule-pt → schedule`, `food-database/dish-collection → nutrition`, `meal-plan → nutrition?section=plan`, `admin-workout-plans → admin-programs`, `admin-meal-plans → admin-eat-clean`, `admin-report → admin-dashboard`, `admin-roles → admin-hr`. Đây là điểm tốt cho tương thích, nhưng tài liệu vận hành nên dùng route canonical để tránh tạo thêm bề mặt trùng.

## 5. Bằng chứng vận hành quan trọng

### Scheduling

- Snapshot CS1, tuần 12–18/10: **0/78** học viên đủ cả tuần, **0/247** ca đã xếp, **84** cảnh báo; draft đang rỗng.
- Engine có `completionFirst`, ưu tiên số học viên hoàn tất khi thiếu capacity, rescue search có budget/blocker và `optimalityGap` heuristic.
- `optimalityGap = 0` không phải bằng chứng toán học cho global optimum. Vì audit không bấm optimize/publish, snapshot rỗng không chứng minh engine thất bại.
- Việc cần làm: liên kết đủ student/PT/availability, chạy dry-run theo branch, lưu objective summary và đo tỷ lệ đủ ca trước/sau.

### Payroll

- Snapshot có 15 staff và 237 unique payable teaching slots; projected total 23,410,000đ; chưa có official payroll run.
- Chỉ 19/405 ngày công đủ điều kiện đã được ghi nhận ở snapshot; hai entry full-time còn pending calendar/approval.
- Release đã giảm tải tab bằng lazy loading, cache attendance dùng chung 20 giây, request dedup/stale guard, employee code và cảnh báo “tạm tính/đã ghi nhận”. Không suy diễn thành phần trăm attendance và không tuyên bố giảm latency theo phần trăm khi chưa có p95 đo thật.

### Finance / renewals / meal review

- Finance: 387 attended sessions chờ revenue reconciliation, 0 recognized; 56 contracts còn debt 478.3mđ, trong đó 34 overdue 262.3mđ và 28 due-month 176.2mđ.
- Renewals: 42 sắp hết hạn trong 30 ngày, 42 đã hết hạn trong 30 ngày, 0 case đang actively followed. Một số usage legacy lớn hơn tổng case; phải reconcile, không clamp âm thầm.
- Meal review: 103 pending và đều vượt SLA 2 giờ trong snapshot; có entry cũ khoảng 68 ngày, nhiều entry chưa assign nutrition coach.
- Performance settings đang có lệch thật: `nutrition-reviews.js` mặc định 120 phút, còn `performance-automatic.js` khi settings thiếu lại clamp giá trị 0 thành 30 phút. Nên dùng một hàm normalize SLA dùng chung.

### Data quality / access

- Admin dashboard: 248 renewal overdue, 103 meal-review overdue, 34 overdue contract (262.3mđ), 347 active students, 152 effective contracts và 6 frozen ở snapshot.
- Student directory live vẫn nạp legacy context rồi paging client-side: 348 profile, 150 week-eligible, 84 chưa gán PT, 8 warning. Cursor V2 đã có trong source nhưng rollout chưa active trên route quan sát.
- HR có 14 staff, payroll có 15; chưa đủ mapping để gọi là duplicate. Cần identity/scope reconciliation.
- Home khi dùng tài khoản staff chưa link student hiển thị “Tạm lỗi đồng bộ lịch PT”; trang Schedule lại giải thích đúng “chưa có lịch cá nhân”. Nên đồng nhất copy theo `issueCode` để không tạo ticket giả.

## 6. Hiệu năng và kiến trúc

Kết quả `npm run performance:check` sau release (gzip, static budget; không phải LCP/INP/p95 live):

| Asset/route | Đo được | Budget | Nhận xét |
|---|---:|---:|---|
| Startup gồm HTML | 108.0 KiB | 195.3 KiB | Dư địa tốt |
| Shell sau đăng nhập | 220.6 KiB | 351.6 KiB | Đạt |
| Firestore vendor | 381.5 KiB | 512.7 KiB | Còn lớn nhất nhưng trong budget |
| Nutrition chunk | 67.6 KiB | 82.0 KiB | Đạt |
| PT directory chunk | 67.5 KiB | 73.2 KiB | Gần ngưỡng |
| Admin Dashboard | 33.0 KiB | 33.2 KiB | **99,4% budget — cần theo dõi** |
| Schedule workspace | 26.5 KiB | 28.3 KiB | Gần ngưỡng |
| Progress | 7.8 KiB | 19.5 KiB | Tốt; card phụ lazy |

> Đây là kích thước bundle, không thay thế đo field data, TTFB, LCP, INP, query read count hay p95 ở thiết bị thật.

**Điểm mạnh đã có**

- Lazy route/chunk và secondary progress cards; payroll tab không nạp mọi panel ngay.
- Attendance callable dùng cache/dedup/stale guard; readonly callable retries tách khỏi mutation.
- AI meal review có input bound, cache theo owner, TTL, quota transaction và in-flight dedup.
- Nhiều màn hình có cursor/page size 30 và `Promise.allSettled` để phần lỗi không làm trắng toàn bộ workspace.

**Tồn dư cần xử lý**

- `DatabaseContext` vẫn có collection listeners route-scoped cho payments, leaveRequests, workoutLogs, sessionRequests, trainers, branches, packages, staff, dailyCheckins, schedules; cần chuyển các route danh sách lớn sang callable/cursor/query scope.
- PT directory observed chưa dùng cursor-first V2.
- Admin dashboard và schedule chunk sát budget; cần bundle guard trong PR.
- Cache client attendance chưa có size bound/sign-out cleanup (dù đã scope theo UID và TTL ngắn).
- `accountsLoaded` của payroll có thể giữ balance cũ sau payout; policy/run list còn refetch khi quay lại tab. Đây là backlog, không phải lỗi release smoke.

## 7. Ưu tiên hành động

### P0/P1 — 0–14 ngày

1. **Đổi credential provisioning**: không dùng số điện thoại làm password. Dùng email/phone invite hoặc random one-time secret, `mustChangePassword=true`, bắt buộc đổi lần đầu và không hiển thị mật khẩu trong UI/log. Mã hiện tại xác nhận `initialPasswordFromPhone()` và ghi `mustChangePassword: false` cho student/staff.
2. **Triage backlog meal review**: phân công coach, bulk triage có audit log, SLA chung 120 phút, dashboard hiển thị age buckets (2h/24h/7d).
3. **Revenue reconciliation**: tạo queue 387 session, owner, reason code và đối soát idempotent trước khi dùng số 0 trên Finance làm kết luận kinh doanh.
4. **Scheduling readiness**: hoàn thiện identity/branch/PT availability; chạy dry-run theo từng branch, lưu before/after `fully_scheduled_learners`, `warnings`, `blockers`, `searchBudgetUsed`.

### P1 — 14–30 ngày

5. Chuẩn hóa `reviewSlaMinutes` bằng một helper dùng chung giữa nutrition review và automatic performance.
6. Đưa directory học viên sang cursor-first V2, giới hạn listener legacy và bổ sung accessible name cho icon-only buttons.
7. Đồng nhất error copy Home/Schedule theo issue code; phân biệt `PROFILE_NOT_LINKED`, `SYNC_UNAVAILABLE`, `ACCESS_SYNC_REQUIRED`.
8. Reconcile HR/payroll identity và branch scope; xác định một canonical staff directory.

### P2 — 30–60 ngày

9. Đo RUM (TTFB/LCP/INP/error rate), callable latency p50/p95 và Firestore reads/session; không dùng bundle budget làm proxy cho user-perceived speed.
10. Hoàn thiện E2E shipper: accept → pickup → OTP → delivered, consent GPS, offline/retry và missing-delivery reconciliation.
11. Công bố rõ định nghĩa attendance, revenue signed/earned/cash, “estimated vs earned” trên mọi màn hình tài chính.
12. Với optimizer, thêm benchmark cohort cố định và solver/oracle nhỏ để kiểm tra gap; không gọi heuristic `optimalityGap` là proof.

## 8. Giới hạn audit

- Không approve/pay payroll, không publish lịch, không approve meal review, không record payment, không đổi quyền, không gửi push thật, không thay đổi nhân sự hoặc giao hàng.
- Các trang staff/admin như course editor, admin programs, hidden Academy pages và một phần delivery được chấm từ source/test, không giả vờ là đã test mọi write path.
- Số liệu trên là snapshot có timestamp; cần dashboard freshness và owner để biến audit thành vận hành thường nhật.
