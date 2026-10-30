# Kế hoạch audience và giao nhận thông báo Push

Ngày 30/10/2026. **Trạng thái: đề xuất, chưa triển khai.** Phân tích dựa trên main `3cee3b97ad4aa3c168fd532f664e1481531d62cb`. Tài liệu này không thay đổi runtime, không gửi thông báo thật và không chứng minh mức giảm hóa đơn.

Đây là đợt tiếp theo của [kế hoạch tối ưu Graphify](GRAPHIFY_OPTIMIZATION_PLAN_2026-10-30.md), nối Đợt 0 đo luồng thao tác với Đợt 1 giảm tải đọc và nguyên tắc idempotency của các luồng ghi. Đợt 4 của kế hoạch gốc vẫn là queue AI; không thay queue AI, giới hạn provider hoặc API key trong đề xuất Push này.

[Đợt tải thông báo theo tab](NOTIFICATION_READ_SCOPE_2026-10-30.md) đã tách nguồn đọc theo nhu cầu nhưng giữ nguyên audience và backend gửi. Tối ưu cache `getPushAdminOverview` đang được làm riêng. Kế hoạch dưới đây là increment sau cache tổng quan, không gộp thay đổi queue/gửi vào bản backend cache đó. Bước xác nhận gửi trong giao diện hiện có được giữ và ràng buộc dữ liệu rõ hơn; tài liệu không đặt thêm yêu cầu xin phép ngoài phạm vi công việc đã giao.

## Hiện trạng và đường lỗi

| Điểm đọc/gửi hiện tại | Hành vi đã xác minh | Hệ quả |
| --- | --- | --- |
| [`subscribeToAdminUsers`](../../src/services/firebaseService.ts) | Listener `users` có `limit(2_500)`, không trả `hasMore` hoặc độ đầy đủ | Người ngoài 2.500 bản ghi đầu không xuất hiện ở bộ chọn; số đếm không phải tổng hệ thống |
| [`AdminNotificationsPage`](../../src/pages/admin/AdminNotificationsPage.tsx) | Mở Gửi/UI 4.0 mới nghe danh bạ; rời hai tab thì ngừng nghe | Vòng đời đọc đã được giới hạn, nhưng mỗi lần cần danh bạ vẫn lấy tập rộng |
| [`PushComposerPanel`](../../src/pages/admin/push/PushComposerPanel.tsx) và [`pushTypes`](../../src/pages/admin/push/pushTypes.ts) | Lọc mục tiêu, preference, Academy và cá nhân ở client; xem trước đếm tập local | Nhóm là một phần danh bạ có thể bị hiểu là toàn bộ nhóm. Danh bạ thay đổi khi dialog mở có thể làm thay đổi đối tượng đã xem |
| `dispatchPushBroadcast` trong [`functions/index.js`](../../functions/index.js) | Danh sách chọn được chuẩn hóa rồi `.slice(0, 1000)` | Trên 1.000 ID bị cắt âm thầm, không báo phần bị bỏ |
| Cùng callable, `targetType: all` | Đọc `users.limit(2000)`, sau đó mới lọc vai trò/disabled/preferences; bỏ qua danh sách ID từ client | Không xử lý đầy đủ toàn hệ thống. Staff nằm trong 2.000 hồ sơ đầu còn làm giảm số học viên được xét |
| Cùng callable, giao nhận | Tạo ID inbox/log ngẫu nhiên; commit inbox từng 400; tìm devices từng nhóm 30 UID; gửi FCM từng 500; ghi log cuối cùng | Lỗi ở batch sau, đọc devices, xóa token lỗi hoặc ghi log có thể xảy ra sau khi đã tạo/gửi một phần. Gửi lại tạo ID mới và có thể gửi trùng |
| Cùng callable, đọc devices | Giới hạn số UID trong mỗi query nhưng không giới hạn số document thiết bị trả về | Một nhóm người có nhiều thiết bị vẫn có thể làm một lượt đọc lớn |
| [`UiRolloutPanel`](../../src/pages/admin/push/UiRolloutPanel.tsx) | Sắp xếp toàn bộ danh bạ local để chọn một UID pilot | Không cần listener rộng chỉ để chọn một tài khoản; vẫn thiếu người ngoài giới hạn |

`all` ở backend cho phép vai trò thiếu/null/rỗng như học viên legacy, loại staff; explicit targets hiện hỗ trợ staff, gồm tự gửi thử của admin. Backend loại cả `disabled: true` và `status: disabled`, còn adapter danh bạ hiện chuẩn hóa `status` chủ yếu theo `disabled`. Vì vậy cần một chính sách thuần được kiểm thử chung, không lấy số đếm frontend làm chuẩn giao nhận. Nhóm `academy` hiện chỉ mang nghĩa tài khoản học viên, chưa kiểm tra enrollment; không tự đổi nghĩa thành người đã mua khóa học.

Khi tải danh bạ lỗi, client xóa danh sách; nhánh `all` với danh sách rỗng vẫn cho máy chủ tự xác định audience. Giao diện chưa có preview server xác nhận được phạm vi trong trường hợp này. Luồng mới phải phân biệt rõ chưa biết, rỗng và đầy đủ.

Backend hiện kiểm tra Auth claim cùng vai trò hồ sơ quản trị. Bypass preference chỉ dành cho một explicit target là chính admin gửi thử; disabled vẫn bị loại. Inbox được tạo ngay cả khi người nhận không có thiết bị. FCM chấp nhận không đồng nghĩa thiết bị đã hiển thị hoặc người dùng đã mở. Những nghĩa này phải giữ nguyên.

## Thứ tự triển khai đề xuất

### 1. Chặn cắt âm thầm và lỗi admission trước khi mở rộng

- Thay `.slice(0, 1000)` bằng kiểm tra đầu vào rõ ràng: danh sách hợp lệ sau dedupe vượt mức đang hỗ trợ thì trả lỗi trước mọi inbox/FCM write. Không chia thành nhiều lệnh gửi client để lách giới hạn.
- Với đường `all` cũ, dùng một lookahead để phát hiện chưa đọc hết; khi còn trang thì từ chối gửi trước mọi side effect. Đây là biện pháp chuyển tiếp, không phải giải pháp hoàn thiện audience.
- Trả loại lỗi cụ thể cho audience chưa đầy đủ, đầu vào sai, quyền thay đổi, hệ thống chưa sẵn sàng và hết ngân sách admission. UI giữ draft và nêu hành động phù hợp; không báo thành công cho phần đã bị loại bởi giới hạn kỹ thuật.
- Production thiếu Functions phải báo lỗi; không rơi sang đường ghi Firestore/demo trong [`dispatchAdminPushBroadcast`](../../src/services/notificationService.ts). Demo chỉ chạy khi được chọn rõ ràng.
- Giữ endpoint cũ cho client tương thích trong giai đoạn chuyển tiếp. Chỉ bỏ đường cũ sau khi consumer đã chuyển và quan sát không còn dùng; giới hạn tạm không được quảng bá là hỗ trợ toàn bộ audience.

### 2. Chuẩn bị audience ở server và xác nhận một tập cố định

Đề xuất contract mới gồm audience có schema/version (`all`, goal, preference, academy, individual hoặc explicit targets có kiểm soát), nội dung chuẩn hóa, actor dự kiến và `clientRequestId` ổn định. Client gửi định nghĩa nhóm thay cho hàng nghìn UID được suy ra từ trang đang hiển thị.

1. Nút kiểm tra tạo hoặc đọc lại một chiến dịch chuẩn bị. Server xác minh quyền, owner, đầu vào, quota admission và fingerprint trước khi tạo job. Chưa có inbox hay FCM ở giai đoạn này.
2. Worker duyệt nguồn theo document-ID cursor, từng trang có giới hạn. Lưu các chunk ID ứng viên/đủ điều kiện cùng tiến độ bền vững. Replay chỉ tiếp tục từ phần đã commit, không khởi động lại toàn bộ scan.
3. Chỉ đánh dấu `ready` khi đã duyệt hết nguồn. Budget hết giữa chừng phải trả trạng thái chưa hoàn tất/có thể tiếp tục; không gọi tập bị giới hạn là đầy đủ.
4. Trả tổng đã xét, đủ điều kiện, bị loại theo nhóm lý do, thời gian bắt đầu/kết thúc duyệt và manifest version/hash. Không tải toàn bộ hồ sơ hoặc danh sách recipient lên browser để chỉ hiển thị số đếm.
5. Dialog đóng băng nội dung và manifest đang xem. Xác nhận, gồm checkbox toàn bộ học viên hiện có, ràng buộc đúng actor, request ID, content hash và manifest version. Sửa nội dung/audience tạo bản chuẩn bị mới; phản hồi cũ không thay bản mới.

Manifest là tập đã duyệt trong một khoảng thời gian rồi được đóng băng, không tự nhận là snapshot toàn hệ thống tại một thời điểm. Nếu nghiệp vụ sau này yêu cầu snapshot cùng `readTime`, phải triển khai và kiểm thử riêng. Tài khoản xuất hiện sau khi manifest hoàn tất không được tự thêm vào lượt gửi đã xác nhận.

Tập đủ điều kiện trong manifest là trần giao nhận. Trước mỗi chunk giao nhận, kiểm tra lại hồ sơ và preferences hiện tại; opt-out/disabled/quyền không còn hợp lệ chỉ được làm giảm tập đã xác nhận. Người trước đó bị loại nhưng vừa bật lại không được tự thêm. Mục tiêu/preference dùng để chọn nhóm và danh mục thông báo dùng để kiểm tra opt-out phải được biểu diễn riêng.

### 3. Giao nhận qua queue với receipt và trạng thái thực

Trạng thái đề xuất: `preparing → ready → queued → processing → completed`, có `failed`, `partial` và `outcome_unknown` khi phù hợp. `completed` nghĩa mọi phần việc đã có kết luận, không đồng nghĩa mọi thiết bị đã nhận.

- Một campaign ID được giữ qua double-click, timeout, reload và thao tác tiếp tục. Khóa receipt theo actor/request ID; cùng ID khác fingerprint bị từ chối. Nội dung đã admission không được sửa trong một retry.
- Admission tạo job/outbox trong transaction; dispatcher dùng deterministic task ID. Ghi job thành công nhưng enqueue lỗi vẫn phục hồi từ outbox. Retry task không đồng nghĩa tạo chiến dịch mới.
- Bắt đầu với trang khoảng 200 người như giá trị kỹ thuật cần đo, không phải cam kết thông lượng. Mỗi task có deadline, giới hạn trang, giới hạn retry và concurrency được cấu hình riêng cho Push. Không dùng queue/slot AI cho FCM.
- Inbox dùng deterministic ID từ campaign và UID. Commit inbox cùng progress/receipt của chunk theo transaction hoặc cơ chế tương đương có fence; replay không tăng lại counters hay tạo inbox thứ hai. Không đặt FCM trong callback transaction.
- Device query phải có cursor và page size, tiếp tục đến hết. Giữ batch FCM tối đa 500 token và cleanup token lỗi có giới hạn; không dùng cap tổng thiết bị để âm thầm bỏ phần còn lại.
- Worker kiểm tra trạng thái campaign, lease/generation, quyền actor hiện tại và phiên bản quyền đã admission. Không giữ ID token trong job. Mất quyền hoặc bị hủy phải ngăn phần chưa giao nhận; không tuyên bố có thể thu hồi thông báo đã gửi.
- Public status chỉ trả số tổng hợp, giai đoạn và lỗi đã làm sạch. Manifest/chunk và token chỉ dành backend hoặc quyền admin phù hợp; client không được tự ghi counters hoặc tạo task.

**Tradeoff FCM không xác định:** deterministic inbox không làm side effect FCM exactly-once. Cần ghi stage trước lúc submit và kết quả theo batch/token khi biết được. Timeout/crash sau admission FCM có thể đã gửi; đánh dấu phần đó `outcome_unknown`, không tự gửi lại toàn chiến dịch. Lỗi chắc chắn chưa submit có thể retry cùng receipt. Retry các token được FCM xác nhận lỗi tạm thời phải chỉ áp dụng phần thất bại đã biết, có budget. Khi mất phản hồi không được giả định toàn bộ thất bại hoặc toàn bộ thành công. Nếu cho thao tác gửi lại phần chưa rõ, giao diện phải giải thích nguy cơ trùng và tạo một hành động có truy vết riêng.

Service worker hiện dùng tag chung `aura-notification` trong [`public/sw.js`](../../public/sw.js); đây không phải cơ chế dedupe theo campaign. Nếu bổ sung tag/dedupe theo campaign, phải giữ deep-link/foreground behavior và vẫn không gọi đó là đảm bảo FCM exactly-once.

History và overview cần phân biệt chiến dịch đang chuẩn bị/đang chạy với đã hoàn tất. Tách thời điểm tạo, admission và hoàn tất; không tính job pending thành giao nhận thành công. Giữ khả năng đọc log legacy và phân biệt `inboxCreated`, `fcmAccepted`, `fcmFailed`, `fcmUnknown`, `filteredOut`.

### 4. Bộ chọn người dùng có giới hạn đọc

- Compose nhóm không cần tải danh bạ. Cá nhân dùng endpoint tìm account có quyền quản trị, trả UID, display label và role/status cần thiết; khoảng 25 kết quả/trang, có cursor/`hasMore` rõ ràng.
- UI rollout dùng cùng thành phần chọn account nhưng giữ quyền `canManage`/Super Administrator và command kiểm tra quyền server hiện có. Không cần lấy users khi chỉ mở phần cấu hình rollout theo vai trò.
- Tìm kiếm theo thao tác submit hoặc debounce ngắn, hủy/bỏ qua phản hồi cũ. Cache có giới hạn theo actor, authzVersion, mục đích tìm, bộ lọc và cursor; đổi tài khoản/quyền xóa dữ liệu.
- Có thể bổ sung trường tìm kiếm chuẩn hóa ở nguồn user để prefix query. Cần kiểm kê và backfill có cursor trước khi bỏ compatibility path; bản ghi legacy không được mất khả năng tìm mà không báo.
- Không gọi trực tiếp directory PT/Student360 làm danh bạ Auth: chúng dùng population, quyền và student ID khác UID. Không tái sử dụng các giới hạn fallback cũ rồi gọi là tìm kiếm đầy đủ.
- UI chỉ theo dõi document/trạng thái của campaign đang mở; rời trang, đổi owner hoặc terminal thì ngừng. Không thêm polling 5 giây hoặc đọc định kỳ lúc không có việc. Giữ draft, tìm kiếm và trang lịch sử như đợt read-scope đã làm.

## Hạ tầng có thể tái sử dụng

| Nguồn | Cơ chế phù hợp | Giới hạn khi tái sử dụng |
| --- | --- | --- |
| [`nutrition-scan-queue.js`](../../functions/nutrition-scan-queue.js) | Durable outbox, deterministic task IDs, admission replay, terminal state, private worker | Chỉ dùng mẫu cơ chế; không nhập quota, paid provider, secret hoặc queue AI |
| [`nutrition-ai-requests.js`](../../functions/nutrition-ai-requests.js) | Canonical fingerprint, lease token, stale-worker fence, receipt và unknown outcome | Cần module Push với state/retention riêng; FCM có partial result theo token |
| [`nutrition-reminder-schedule.js`](../../functions/nutrition-reminder-schedule.js) | Seed bằng document-ID cursor có thể tiếp tục, không cutoff tổng population | Không dùng vòng cron nhắc món ăn để chạy broadcast |
| `createScheduledNotification` trong [`index.js`](../../functions/index.js) | Deterministic inbox ID và transaction-create chống trùng | Không tự giải quyết unknown FCM hoặc campaign progress |
| [`student-360.js`](../../functions/student-360.js) | Page cursor, scan budget, `hasMore`/`truncated` và tổng chưa biết | Học viên PT không phải toàn bộ tài khoản `users` |
| [`pt-schedule-v2.js`](../../functions/pt-schedule-v2.js) | Prefix search chuẩn hóa và cache có thời hạn | Không sao chép fallback scan có cap làm kết quả đầy đủ |
| [`readOnlyCallableService.ts`](../../src/services/readOnlyCallableService.ts) | Retry có giới hạn cho search/status thuần đọc, fence đổi tài khoản | Không bọc admission/confirm/send bằng retry dành cho read |
| [`useAdminPushReads.ts`](../../src/pages/admin/push/useAdminPushReads.ts) | Cache theo phiên màn hình, invalidation đúng nguồn và phản hồi trễ | Queue status mới chỉ hoạt động khi cần; không mở lại mọi listener |

## Chi phí và đo lường

Mục tiêu là giới hạn công việc từng request và loại bỏ đọc lặp, không hứa xử lý toàn bộ audience với chi phí hằng số. Một chiến dịch hoàn chỉnh vẫn cần duyệt nguồn phù hợp, đọc lại người nhận trước gửi, tạo inbox và xử lý thiết bị: quy mô xấp xỉ O(U + R + D), với U là hồ sơ phải xét, R là người đã chọn và D là thiết bị. Lưu manifest, receipt và kiểm tra lại tạo thêm reads/writes có chủ đích để chống bỏ sót/gửi trùng.

- Một lần chuẩn bị cho một phiên bản campaign, không scan lại trên từng phím gõ hoặc mỗi lần mở dialog.
- Ghi metric ở admission/chunk/terminal sau commit: số hồ sơ xét, eligible, devices, trang, reads/writes ước lượng từ thao tác, queue wait, processing, retry và trạng thái kết thúc. Không ghi UID, token, email, nội dung, goal sức khỏe hoặc raw payload vào telemetry.
- Tách revision, outcome và mẫu đã đăng nhập như collector hiện có. Chưa có mẫu phải giữ unknown; không lấy smoke unauthenticated làm baseline gửi.
- Admission limit theo actor và tổng job đang mở để ngăn bấm lặp tạo nhiều scan/queue. Giá trị quota/concurrency phải chốt qua đo và kiểm thử giả; khi bị từ chối không tạo inbox/FCM và UI giữ bản nháp.
- Retention/TTL riêng cho draft manifest, terminal receipt và audit. Receipt phải sống lâu hơn cửa sổ retry/recovery được hỗ trợ; expired campaign không âm thầm phát sinh lượt gửi mới cùng ID. Cleanup theo batch có giới hạn, không xóa queue còn chạy.

## Nghiệm thu trước khi phát hành increment này

Các trường hợp dưới đây là **kiểm thử cần bổ sung**, chưa phải kết quả đã chạy của kế hoạch.

| Nhóm | Trường hợp bắt buộc | Bất biến cần chứng minh |
| --- | --- | --- |
| Đầy đủ audience | 1.001 selected; 2.001 và 2.501+ users; staff ở đầu thứ tự; nhiều trang hơn budget một worker | Không silent slice; mọi trang được xét hoặc báo chưa hoàn tất; chưa complete thì không gửi |
| Chính sách | Vai trò legacy thiếu/null/rỗng, student/staff, disabled qua hai trường, opt-out tổng/danh mục; goal aliases; Academy | Cùng quy tắc preview/delivery; giữ self-test riêng; không mở rộng audience ngoài xác nhận |
| Drift | Opt-out/disable/đổi role sau preview; người mới; sửa draft khi phản hồi cũ đang về | Chỉ giảm manifest đã xác nhận; hash/version sai không admission |
| Admission | Sai quyền, đổi owner/authz, input quá lớn, service chưa sẵn sàng, quota hết, cùng ID khác nội dung | Không inbox/FCM; không fallback demo production; lỗi rõ, draft còn nguyên |
| Idempotency | Double-click, nhiều worker cùng job, mất response rồi reload, cùng ID replay sau thành công | Một campaign; một inbox/người; counters không tăng hai lần; không tự tạo ID mới |
| Partial failure | Commit được chunk đầu rồi lỗi; enqueue một phần; crash sau progress; stale lease hoàn tất muộn | Tiếp tục đúng phần còn lại; progress và receipt không bị worker cũ ghi đè |
| FCM | Một số token thành công, token invalid, lỗi tạm thời được xác nhận, timeout mất phản hồi, log completion lỗi | Không gửi lại phần đã xác nhận thành công; unknown được hiển thị đúng; không tuyên bố delivered |
| Device pagination | Một người/nhóm có nhiều thiết bị hơn page size | Trang sau vẫn được xử lý; không cap âm thầm; query/task có budget |
| Picker/UI | Tìm được account ngoài trang đầu; đổi query/account/authz; chọn pilot; Chrome/WebKit ở 320–430 px | Không leak phản hồi cũ, không overflow, giữ confirm hiện có, không gửi khi đọc |
| Read budget | Mở compose/rollout không tìm; chuyển tab; idle; status terminal; sửa mẫu/cấu hình | Không quét danh bạ rộng, không polling, mutation chỉ refresh nguồn liên quan |
| Tương thích | Log legacy, client cũ, self-device test, deep link và cache tổng quan | Nghĩa counters/quyền giữ nguyên; pending campaign không làm sai số tổng quan |
| Quy mô/riêng tư | Tập giả lớn và retry burst; kiểm tra log/task payload/Rules | Tổng được duyệt hết qua nhiều task; không raw PII/token/content trong telemetry; client không ghi campaign state |

Mở rộng [`tests/notification-read-ui`](../../tests/notification-read-ui), [`tests/e2e/admin-push-notifications.spec.ts`](../../tests/e2e/admin-push-notifications.spec.ts), mẫu queue tests/emulator trong [`nutrition-scan-queue.test.js`](../../functions/nutrition-scan-queue.test.js) và [`nutrition-scan-queue.integration.cjs`](../../functions/nutrition-scan-queue.integration.cjs). Dùng messaging/task adapters giả và Firestore emulator; không gửi FCM thật để kiểm thử audience lớn. Các assertion hiện tại về dispatch trong [`security-contract.test.js`](../../functions/security-contract.test.js) chủ yếu kiểm tra source, chưa chứng minh xử lý toàn bộ population hay retry an toàn.

Phát hành theo từng phần tương thích: guard trước; server admission/preparation/worker và Rules cần thiết; client picker/preview/status; sau đó quan sát metric cùng scope. Dừng admission mới là cách rollback ưu tiên khi có lỗi; giữ khả năng reconcile campaign đã nhận, không xóa task/job đang chạy hoặc gọi gửi lại toàn bộ để chữa trạng thái chưa rõ.
