# Aura app performance and duplication audit

Reviewed: 2026-09-12
Baseline commit: `d58486d53631030bae57e09e31d7f78e32022632`

## Kết luận điều hành

Aura không có một nhóm dữ liệu lớn nào có thể xóa trực tiếp an toàn chỉ vì nó
được hiển thị ở nhiều trang. Phần lớn trường hợp là nguồn nghiệp vụ và
projection/cache phục vụ mục đích khác nhau. Xóa projection không làm nhẹ
client đáng kể, còn xóa nguồn gốc có thể làm sai hợp đồng, tài chính, timeline
hoặc quyền.

Ba vấn đề tạo tải thật sự là:

1. asset của một surface bị tải ở surface khác;
2. listener legacy tải directory lớn thay vì cursor/projection có giới hạn;
3. cùng một khái niệm được trình bày ở nhiều UI nhưng chưa dùng chung selector
   hoặc chưa có telemetry để đóng surface cũ.

Đợt tối ưu đầu tiên đã tách CSS Tiến độ khỏi shell, tách biểu đồ/ảnh/AI khỏi
critical render, tách warning projection khỏi scheduler fallback và sửa các
entry prefetch không trùng với entry production thực tế.

## Số đo production build

| Chỉ số | Trước | Sau đợt 1 | Thay đổi |
| --- | ---: | ---: | ---: |
| Startup gồm HTML | 130.8 KiB gzip | 130.8 KiB gzip | không đổi |
| Authenticated shell tải thêm | 271.8 KiB gzip | 267.5 KiB gzip | -4.3 KiB |
| `AuraApplication` CSS | 35.83 KiB gzip | 31.31 KiB gzip | -4.52 KiB |
| Progress JS | 30.66 KiB gzip | 17.86 KiB gzip | -12.80 KiB |
| Scheduler fallback wrapper | 26.10 KiB gzip | 23.52 KiB gzip | -2.58 KiB |
| Scheduler engine tách riêng | không tách được | 3.39 KiB gzip | chỉ tải khi fallback |
| Firestore vendor | 146.39 KiB gzip | 146.39 KiB gzip | cần tối ưu theo read path, không copy-split |

Progress CSS 5.62 KiB gzip hiện chỉ tải khi mở Progress hoặc Aura Coach. Các
chunk ảnh, biểu đồ, huy hiệu và AI từ 0.9–6.3 KiB gzip chỉ tải khi mở đúng tab.

## Bản đồ surface và quyết định hợp nhất

### Member

| Nhóm | Trùng/khác nhau | Quyết định |
| --- | --- | --- |
| Home “Hôm nay” và Nutrition “Hôm nay” | Cùng calories/protein/nước nhưng Home là executive summary, Nutrition là nơi ghi/chỉnh dữ liệu | Giữ hai surface, bắt buộc dùng cùng target/journal selector; không tạo listener đồng thời vì route cũ unmount khi đổi trang |
| Nutrition “Hôm nay” và “Nhật ký” | Hôm nay tối ưu hành động hiện tại; Nhật ký phục vụ ngày/tuần/tháng, audit món, nước và vận động | Giữ Nhật ký; không lặp hero và CTA của Hôm nay |
| `classic-diary` và Diary V4 | Hai renderer cho cùng log | `classic-diary` chỉ là compatibility deep link; thu telemetry rồi redirect hoàn toàn về Diary V4 |
| Plan và Menu trong Nutrition | Cùng plan domain; Plan là bản nháp/biên tập, Menu là bản đã xác nhận | Giữ hai trạng thái nhưng dùng cùng plan document/revision, không nhân đôi collection |
| Nutrition Insights và route Progress | Nutrition nhúng lazy toàn bộ Progress; có thể tạo cảm giác hai trang | Tạm giữ entry để không phá route. Release sau đổi thành nutrition-only summary và CTA sang Progress canonical |
| Profile, Nutrition Profile và Progress | Lặp chiều cao/cân nặng/mục tiêu ở root profile, `nutritionProfile` và measurement logs | Root profile là compatibility snapshot; log cân đo là lịch sử canonical. Chỉ tắt mirror sau migration/verify, không xóa bằng UI cleanup |
| `pt-workout` và `workout` | Một trang xem giáo án/lịch sử; một trang thực thi buổi tập | Không phải duplicate. Hợp nhất taxonomy và CTA, giữ runtime tập luyện immersive |
| Courses và Course Detail | Directory và reader | Giữ tách. PDF/runtime/Study Guides phải lazy theo lesson |
| Schedule và Availability | Lịch đã xếp/yêu cầu so với lịch rảnh đầu vào | Không gộp dữ liệu. Dùng một week selector và liên kết chéo có ngữ cảnh |
| Eat Clean và Nutrition Catalog | Món bán thực tế so với cơ sở dữ liệu dinh dưỡng | Không nhập collection. Cho phép liên kết `catalogId` để ghi đơn đã ăn vào diary mà không copy macro thủ công |

### Staff

| Nhóm | Kết luận | Hướng xử lý |
| --- | --- | --- |
| Staff Dashboard và Action Center | Dashboard là tổng quan, Action Center là projection tác vụ | Giữ một Action Center nhúng; không tạo notification thứ hai cho cùng `sourceId` |
| `staff-schedule`, `staff-availability`, `staff-requests` | Cùng một workspace với tab/entry khác nhau | Đây là route entry có chủ đích, không phải ba bundle. Giữ deep link, dùng một module và một cache |
| Student directory và Student 360 | Directory để tìm/lọc, 360 để xử lý một học viên | Giữ tách; directory không tải timeline, ảnh, hợp đồng workspace |
| Staff Performance và Staff Payroll | Điểm hiệu suất khác tiền lương | Không gộp. Chia sẻ kỳ, actor identity và approved evidence selector; Performance không tự đổi lương |
| Trainer Quality và Performance | Quality là compliance/feedback; Performance là score 100 điểm | Giữ hai nghiệp vụ, tránh hiển thị cùng chỉ số hai lần trên dashboard |
| Duyệt món Staff/Admin | Hai wrapper mỏng dùng chung `NutritionReviewWorkspace` | Đúng kiến trúc; tiếp tục dùng server redaction theo scope |

### Admin

| Nhóm | Rủi ro hiện tại | Quyết định |
| --- | --- | --- |
| `admin-report` và `admin-dashboard` | Route cũ | Chỉ giữ redirect, không prefetch/render sản phẩm thứ hai |
| `admin-roles` và `admin-hr` | Route cũ | Chỉ giữ redirect; HR là canonical |
| `admin-students` và `admin-pt-students` | Trùng directory người dùng/học viên nhưng quyền và tác vụ khác | Chưa xóa. Định nghĩa `admin-students` là Academy/account directory, PT Students là contract/operations directory; sau parity dùng chung server directory API |
| Admin Today Sessions và Dashboard | Drill-down có thể ít traffic | Giữ đến khi route telemetry xác nhận có thể biến thành drawer lazy trong Dashboard |
| Finance, Payroll, Performance | Có số liệu liên quan nhưng định nghĩa kế toán khác | Tuyệt đối không hợp nhất nguồn. Dùng `ledgerEntries`, payroll snapshots và performance evidence riêng |
| Contract Renewals và Student 360 Contract | Cùng contract usage, khác workflow queue/detail | Dùng chung `contractUsageViews`; mutations giữ callable và audit chung |
| Schedule V2 và demo scheduler | V2 là production, scheduler client là fallback/demo | Không prefetch cả hai. Production chỉ prefetch V2; engine client tải khi demo/fallback thực sự chạy |
| Package/Quote/Settings | Listener/read adapter legacy còn tồn tại | Thay bằng bounded callable/cursor sau khi production revision coverage đạt yêu cầu |

## Dữ liệu: có thể xóa, chưa thể xóa và không được xóa

### Có thể dọn sau khi có bằng chứng không còn tham chiếu

- Source component orphan và one-off patch script: dùng manifest/hash và Git blob;
  chúng không ảnh hưởng runtime bundle nếu không được import.
- Compatibility renderer `classic-diary`: chỉ sau deprecation window và route
  telemetry; vẫn giữ hash redirect.
- Adapter source `features/eat-clean/pages/EatCleanPage.tsx`: có thể bỏ sau khi
  mọi import trỏ entry canonical và test deep link không phụ thuộc barrel này.
- CSS selector không còn DOM match: chỉ xóa sau coverage ở 320/360/390/430/1440
  và các role; không xóa theo tìm kiếm tên đơn thuần.

### Chưa thể xóa

- `students.accountUid`, `accountIdentityLinks` và `roleAssignments.crmProfileId`
  fallback cho đến khi Identity Link V2 verify an toàn đạt 100%.
- `contracts.usedSessions`/legacy adjustment cho đến khi
  `contractUsageViews` đối soát đủ và mọi consumer chuyển read path.
- `actionSummary` cho đến khi Action Center pilot chứng minh không duplicate,
  đúng redaction và freshness.
- local/session caches cho nutrition, progress photo và auth recovery: đây là
  cache offline, không phải một nguồn nghiệp vụ mới.
- static academy curriculum/study guides khi còn là fallback/demo hoặc nguồn
  nội dung build-time. Chỉ bỏ sau khi Firestore course coverage và offline
  behavior đạt parity.

### Không được xóa trong cleanup giao diện

- `ledgerEntries`, session/attendance nguồn, contract documents, timeline source
  events, audit logs, progress photo metadata/storage và approved performance
  evidence.
- Projection (`studentOperationalViews`, `studentTimelineEvents`,
  `contractUsageViews`, `operationalActions`) không thay thế dữ liệu gốc.
  Projection lỗi phải rebuild, không dùng lý do đó để xóa source.

## Read/listener audit

- Toàn frontend có 39 vị trí `onSnapshot` và các wrapper subscribe.
- Nutrition Today mở 3 listener theo đúng ngày; Progress trước đây mở 3 listener
  nutrition 90 ngày ngay cả khi mặc định xem 7 ngày. Đợt 1 đã đổi query theo kỳ
  7/30/90 ngày.
- `DatabaseContext` đã route-scope phần lớn legacy data, nhưng
  `admin-pt-students` vẫn có thể mở 7 nguồn với giới hạn 1,000–3,000 document.
- HR mặc định còn listener role assignment tối đa 2,500; khi mở tab Staff mới
  mở staff/trainers và active contracts. Đây là đúng hơn trước nhưng vẫn là
  mục tiêu P0 cho cursor API.
- Admin Dashboard/Staff Dashboard đã dùng bounded summary callables; không được
  bổ sung lại directory listener để tính KPI phía client.
- Student 360 overview đúng contract lazy: timeline, photos và contract workspace
  không tải ở initial Overview.

## Kế hoạch xử lý tiếp theo

### P0 — chi phí và độ ổn định

1. Thêm `listIdentityDirectory` cursor API để thay role assignment/users listener
   của HR; trả counts theo projection thay vì tải contracts để đếm trên client.
2. Chuyển Admin PT directory sang `listStudent360Directory`; bỏ listeners
   students/contracts/sessions/availability khi parity test đạt đủ.
3. Thêm route telemetry gồm load duration, chunk error, data-ready duration và
   UI version; không ghi PII.
4. Đặt budget riêng cho Progress, scheduler fallback, Nutrition CSS và Firestore
   reads trên mỗi navigation.

### P1 — hợp nhất UI/data selector

1. Tạo shared member daily summary query/cache cho Home và Nutrition.
2. Thay Nutrition Insights full-page embed bằng nutrition-only summary; CTA mở
   Progress canonical và giữ deep-link compatibility.
3. Làm rõ Admin account/academy directory và PT operations directory bằng tên,
   capability và query riêng, rồi dùng chung row primitive.
4. Tách `NutritionPageController` theo controller/hook; tách CSS theo
   Today/Diary/Plan/Explore để 37.15 KiB CSS không tải đồng loạt.
5. Tách Course Editor catalogue/editor/preview và chỉ tải study guides khi lesson
   cần chúng.

### P2 — visual consolidation

1. Một token source ở `styles-bootstrap.css`/UI V4; đóng các `:root` cũ theo
   surface trước khi xóa.
2. Chuẩn hóa PageHeader, empty/error/loading, Button, Sheet/Dialog và focus ring.
3. Member: full-bleed có gutter 12–20px, một hành động chính, ảnh có chủ đích.
4. Operations: nền trắng/warm-neutral, hàng số liệu và bảng phẳng; pink chỉ cho
   active/CTA, semantic color chỉ cho trạng thái.
5. Loại bỏ card/shadow/gradient trang trí sau screenshot regression, không dùng
   override toàn cục có thể làm sai finance/status.

## Gate trước khi xóa hoặc rollout

- Không collection scan không giới hạn; page size và cursor bắt buộc.
- Contract/calories/finance parity bằng contract test.
- Role matrix và server redaction pass.
- E2E 320, 360, 390, 430 và 1440 px; không horizontal scroll/dock overlap.
- Bundle/read count trước-sau được lưu trong CI artifact.
- Route legacy có ít nhất một deprecation window quan sát được.
- Rollback bằng feature flag/read adapter; không xóa source data và không reset Git.
