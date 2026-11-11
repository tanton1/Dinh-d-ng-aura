# Phân tích chi phí Firestore và Cloud Functions

Ngày đo: 11/11/2026. Cửa sổ đo: 7 ngày, 04/11 09:00 → 11/11 09:00 (giờ Việt Nam). Mốc source: `23e04c9` cộng thay đổi của đợt này.

Số liệu lấy từ Cloud Monitoring của dự án production (chỉ đọc số đo: không đọc dữ liệu nghiệp vụ, không ghi gì). Chạy lại bằng `node scripts/cloud-usage-snapshot.cjs --project=<project id> --days=7 --hourly=48`.

Tài liệu này nối tiếp [kế hoạch tối ưu luồng dữ liệu 25/10](../product/DATA_FLOW_COST_OPTIMIZATION_PLAN_2026-10-25.md) và [ma trận luồng đọc 30/10](READ_FLOW_MATRIX_2026-10-30.md). Khác biệt: lần này xếp hạng theo số đo thật của production chứ không theo đọc code.

## 1. Kết luận

1. **Trang không phải nơi tốn tiền.** Client đọc trực tiếp Firestore (listener) chỉ chiếm 0,6% đơn vị đọc. Việc nền chiếm 72% số lượt gọi Functions và 93% thời gian tính tiền; toàn bộ callable của mọi trang cộng lại chỉ khoảng 3.300 lượt/ngày.
2. **Khoảng một nửa lượt đọc Firestore đến từ một việc nền:** mỗi lần trừ buổi của hợp đồng làm mọi bảng lịch tuần của cơ sở bị dựng lại, kể cả 41/47 bảng là tuần đã qua. Đã sửa và deploy ngày 11/11 (mục 4). **Nhưng hóa đơn tính theo đơn vị đọc, không theo lượt đọc:** phép đo sau deploy (mục 9) cho thấy gần như toàn bộ đơn vị đọc đến từ việc trigger tìm bảng lịch tuần cần đánh dấu, và phần này chưa được sửa.
3. **Khoản lớn nhất của Cloud Functions là một bất thường về thời gian tính tiền** bắt đầu 16:20 ngày 07/11: bảy trigger được ghi nhận thời gian tính tiền gấp hàng trăm lần thời gian xử lý thật, chiếm 94% tổng thời gian tính tiền. Chưa xác định được nguyên nhân phía nền tảng; cần thử deploy lại và đối chiếu Billing (mục 3).

## 2. Số đo 7 ngày

| Hạng mục | Tổng 7 ngày | Mỗi ngày |
| --- | ---: | ---: |
| Firestore: lượt đọc qua query | 10.648.365 | 1.521.195 |
| Firestore: lượt đọc theo id | 2.832.737 | 404.677 |
| Firestore: đọc tài liệu không tồn tại | 791.154 | 113.022 |
| Firestore: đơn vị đọc tính tiền, query | 73.311.835 | 10.473.119 |
| Firestore: đơn vị đọc tính tiền, đọc theo lô | 6.679.353 | 954.193 |
| Firestore: đơn vị đọc tính tiền, listener của client | 512.303 | 73.186 |
| Firestore: lượt ghi (cập nhật + tạo) | 404.259 | 57.752 |
| Functions: số dịch vụ có lưu lượng | 227 | |
| Functions: lượt gọi | 82.289 | 11.756 |
| Functions: giây instance tính tiền | 1.578.638 | 225.520 |

Việc nền (trigger, hàng đợi, lịch chạy): 59.002 lượt, 1.471.655 giây. Callable của các trang: 23.287 lượt, 106.984 giây (trong đó 68.879 giây thuộc bất thường ở mục 3).

## 3. Bất thường thời gian tính tiền của Cloud Run

| Dịch vụ | Lượt gọi | Giây tính tiền | Giây / lượt |
| --- | ---: | ---: | ---: |
| syncPtScheduleWeeklyViewFromContractUsage | 1.389 | 352.440 | 254 |
| syncStudent360ContractUsage | 1.389 | 334.299 | 241 |
| syncContractUsageOperationalActions | 1.392 | 258.425 | 186 |
| syncContractOperationalActions | 529 | 199.759 | 378 |
| syncPtScheduleWeeklyViewFromContract | 530 | 116.540 | 220 |
| syncLoyaltyContractSpend | 437 | 98.900 | 226 |
| syncStudent360Contract | 504 | 62.048 | 123 |
| getMyPendingSessionFeedbackRegional (04–05/11) | 1.002 | 68.879 | 69 |

Các trigger cùng loại không bị ảnh hưởng chỉ tốn 0,5–1 giây mỗi lượt (ví dụ `syncStudent360Session`: 1.582 lượt, 1.702 giây).

Điều đã kiểm chứng:

- Bắt đầu ở đợt trừ buổi hằng giờ đầu tiên sau bản phát hành trả góp ngày 07/11 (16:20). CPU cấp phát của cả dự án tăng từ khoảng 31–40 nghìn lên 117–148 nghìn vCPU-giây mỗi ngày.
- Bảy trigger này **không** được deploy lại trong bản phát hành đó; revision vẫn từ 29/10 và 01/11, cấu hình giống hệt các trigger bình thường (CPU chỉ cấp khi có request, tối thiểu 0 instance, concurrency 1).
- Request bình thường: khoảng 10 lượt mỗi đợt, 0,07–7 giây, tất cả trả 200, không lỗi, không retry, hàng đợi Pub/Sub sạch.
- Sau mỗi đợt, số đo ghi đúng 120 hoặc 360 giây tính tiền mỗi phút trong 16–21 phút, trong khi chỉ có một instance, không dùng CPU, không có lưu lượng mạng.
- `getMyPendingSessionFeedbackRegional` có cùng kiểu từ 04/11 17:00 đến 06/11 02:00 rồi tự hết, không ai deploy.

Điều chưa biết: cơ chế gây ra, và hóa đơn có tính đúng theo số đo này không. Theo giá niêm yết của Cloud Run, phần tăng thêm tương đương khoảng 60–120 USD mỗi tháng; con số này là ước tính từ số đo CPU cấp phát, chỉ báo cáo Billing mới xác nhận được.

Việc nên làm, theo thứ tự:

1. Mở Billing → Reports, lọc dịch vụ Cloud Run, nhóm theo SKU, so 01–07/11 với 08–11/11.
2. Deploy bản sửa ở mục 4. Bản này deploy lại 2 trong 7 trigger (`syncPtScheduleWeeklyViewFromContract`, `…FromContractUsage`). Nếu sau deploy hai trigger này về bình thường còn năm trigger kia thì không, deploy lại năm trigger còn lại.
3. Nếu deploy lại không hết, mở yêu cầu hỗ trợ Google Cloud kèm số đo trên.

## 4. Lịch tuần bị dựng lại hàng loạt (đã sửa)

**Cơ chế cũ.** Mỗi lần trừ buổi ghi vào `contracts` và `contractUsageViews`. Hai trigger tương ứng đánh dấu "cần dựng lại" cho mọi bảng lịch tuần của cơ sở (24–29 bảng mỗi sự kiện). Việc nền chạy 5 phút một lần dựng lại tối đa 20 bảng mỗi lượt, mỗi bảng đọc lại toàn bộ học viên, PT, hợp đồng, buổi tập và lịch rảnh của cơ sở.

**Số đo.** Production có 47 bảng lịch tuần cho 2 cơ sở: 41 bảng cũ hơn tuần trước, 6 bảng là tuần trước, tuần này và tuần sau. Giờ có đợt trừ buổi tốn khoảng 50.000–190.000 lượt đọc; giờ không có đợt chỉ 1.500–9.000. Ví dụ ngày 10/11, 14:00–15:00: 82.116 lượt đọc, không ai mở lịch, việc nền chạy 97 giây; giờ liền trước chỉ 6.893 lượt.

**Thay đổi.** Tuần cũ hơn tuần trước vẫn được đánh dấu là đã cũ, nhưng không đưa vào hàng đợi của việc nền; bảng được dựng lại khi có người mở đúng tuần đó. Tuần trước, tuần này và các tuần sau vẫn được dựng lại ngay như cũ. Không tuần nào bị bỏ qua hay trả dữ liệu cũ: trang lịch quản trị luôn gọi với `initialPaint`, nên bảng đã cũ được dựng lại trước khi hiển thị.

- `functions/pt-schedule-weekly-view.js`: `eagerRebuildFloorWeek`, tham số `deferred` của `markPtScheduleWeeklyViewDirty`, `syncPtScheduleWeeklyViewSource` ghi thêm số bảng hoãn vào log `pt_schedule_weekly_view_marked_dirty`.
- `functions/pt-schedule-weekly-view.test.js`: hai test mới (trừ buổi chỉ đưa tuần gần vào hàng đợi, việc nền bỏ qua tuần cũ, mở tuần cũ thì dựng lại đúng tuần đó; sửa buổi tập của tuần cũ cũng được hoãn chứ không mất).

**Kỳ vọng.** Việc nền dựng lại ít hơn khoảng 87% (6 thay vì 47 bảng mỗi đợt), tương ứng giảm khoảng 45–50% tổng lượt đọc Firestore. Đây là ước tính; đo lại bằng `--hourly=48` sau khi deploy một ngày.

**Đánh đổi.** Mở một tuần cũ hơn tuần trước sẽ chậm thêm vài giây ở lần mở đầu sau mỗi thay đổi hợp đồng, vì bảng được dựng lúc mở thay vì dựng sẵn.

**Thay đổi nhỏ đi kèm.** `listSopKnowledge` trước đây đọc tới 500 tài liệu đầy đủ cho mỗi trang 100 dòng (khoảng 756 lượt đọc để mở Trung tâm SOP với 339 tài liệu). Nay chỉ đọc một trang cộng một dòng, chỉ lấy các trường tóm tắt, và chỉ lấy `searchText` khi có từ khóa (`functions/sop-center.js`, hai test mới).

## 5. Theo màn hình

Chỉ liệt kê callable có từ 120 lượt trong 7 ngày; mọi callable khác của các trang Tài chính, Hợp đồng, Student 360, Academy, Dinh dưỡng, CRM, SOP, Thông báo đều thấp hơn mức này.

| Màn hình | Callable | Lượt / 7 ngày | Giây / lượt | Nhận xét |
| --- | --- | ---: | ---: | --- |
| Lịch tập của học viên | listMyStudentPtSchedule | 3.088 | 1,0 | Ổn |
| Khởi động ứng dụng | getMyAccessContext | 1.939 | 0,7 | Ổn |
| Lịch quản trị, bảng tuần | getPtScheduleWeeklyView | 1.822 | 5,4 | Gần như lần mở nào cũng dựng lại bảng. Điểm nóng còn lại lớn nhất của trang |
| Lịch quản trị, sửa nháp | applyPtScheduleDraftCommand | 934 | 0,8 | Mỗi lệnh làm bảng tuần cũ đi, kéo theo dòng trên |
| Lịch quản trị, gợi ý ô | getPtScheduleSlotCandidates | 641 | 1,0 | Ổn |
| Lịch quản trị, sửa trực tiếp | adminEditPtSchedule | 342 | 1,6 | Ổn |
| Không gian làm việc của PT | getMyTrainerWorkspace | 1.597 | 3,6 | Nặng; nên có bản tóm tắt dựng sẵn |
| Điểm hiệu suất của PT | getMyPerformanceScoreV2 | 280 | 5,0 | Nặng nhưng ít lượt |
| Loyalty của học viên | getMyLoyaltyDashboard | 1.356 | 0,8 | Ổn |
| Phản hồi sau buổi tập | getMyPendingSessionFeedback | 1.002 | — | Bình thường nhanh; số giây bị bất thường ở mục 3 |
| Điểm danh | recordMySessionAttendance | 258 | 1,5 | Ổn |
| Dashboard vận hành | getOperationsDashboard | 181 | 3,8 | Ít lượt |
| Đăng ký lịch rảnh | saveMyStudentAvailability | 175 | 2,2 | Ổn |
| Sổ quỹ | listCashAccounts | 129 | 1,5 | Ổn |

## 6. Việc nền

| Việc | Lượt / 7 ngày | Giây | Nhận xét |
| --- | ---: | ---: | --- |
| processStudent360SourceQueue | 14.236 | 7.168 | Nhiều lượt nhất; mỗi lượt nhẹ |
| dispatchScheduledReminders (mỗi phút) | 10.079 | 1.882 | Mỗi lượt đọc một cờ; rẻ |
| trackProductEvent | 5.164 | 1.837 | Sự kiện sản phẩm từ client |
| syncStudent360OperationalActions | 3.253 | 1.901 | |
| syncPtScheduleWeeklyViewFromSession | 2.550 | 1.295 | Chỉ đánh dấu đúng tuần của buổi tập |
| rebuildDirtyPtScheduleWeeklyViewsScheduled | 2.017 | 15.277 | Việc theo lịch nặng nhất; mục 4 xử lý |
| recoverStudent360SourceQueueScheduled | 2.016 | 482 | |

## 7. Việc còn lại, xếp theo lợi ích

1. Xử lý bất thường ở mục 3 (đối chiếu Billing, deploy lại, yêu cầu hỗ trợ nếu cần).
2. Deploy bản sửa mục 4 rồi đo lại sau một ngày.
3. Bảng lịch tuần khi đang sửa nháp: mỗi lệnh sửa làm bảng cũ đi và lần đọc kế tiếp dựng lại từ toàn bộ nguồn (5,4 giây, khoảng 1.500 lượt đọc). Hướng xử lý là cập nhật thẳng phần ma trận của bảng từ kết quả lệnh, để phần kiểm tra chính xác cho việc nền (phần còn lại của D4.2).
4. Một lần trừ buổi kích hoạt hai trigger lịch tuần (`contracts` và `contractUsageViews`), mỗi trigger tự tìm lại danh sách bảng và ghi 24–29 dấu. Gộp thành một dấu cho mỗi cơ sở sẽ giảm cả đọc lẫn ghi.
5. `getMyTrainerWorkspace` (3,6 giây) và `getMyPerformanceScoreV2` (5,0 giây): dựng bản tóm tắt sẵn thay vì tính lúc mở.
6. Student 360: tách cập nhật theo miền dữ liệu (D4.1) để giảm 14 nghìn lượt xử lý hàng đợi mỗi tuần.
7. Nhắc lịch hằng giờ (`sendSessionRemindersScheduled`) quét `sessions` theo khoảng ngày, giới hạn 5.000; nên truy vấn theo khung giờ sắp tới.
8. Khoảng 375 trong 602 dịch vụ Functions không có lượt gọi nào trong 7 ngày. Chúng không tốn tiền khi nghỉ nhưng làm deploy chậm và chiếm hạn mức; rà theo [SAFE_CLEANUP](SAFE_CLEANUP.md).

## 8. Kiểm thử của đợt này

- `npm --prefix functions run check`: qua.
- `node --test functions/pt-schedule-weekly-view.test.js`: 47/47. `node --test functions/sop-center.test.js`: 7/7.
- `npm --prefix functions run check:weekly-view`: 57/58. Test không qua là `pt-schedule-weekly-runtime.test.js:263`, ghim 598 export trong khi `functions/index.js` có 605 từ đợt trung tâm thông báo (`8ab4620`, `b757019`); lỗi có từ trước, không liên quan thay đổi này.
- Chưa chạy bộ test tích hợp cần emulator (`npm run test:projection-transaction`).
- Số liệu kỳ vọng ở mục 4 được viết trước khi deploy; kết quả đo thật ở mục 9.

## 9. Kết quả sau deploy và phát hiện mới (11/11, 10:00–10:50)

**Deploy.** 11 trigger `syncPtScheduleWeeklyViewFrom*` và `listSopKnowledge` đã lên production từ commit `4a1a9e9`, tất cả qua kiểm tra sức khỏe. `syncPtScheduleWeeklyViewFromTrainerAvailability` có tên dịch vụ 47 ký tự nên phải đi đường `--platform-readiness-gate` (lần đầu bị từ chối ở bước chuyển lưu lượng và tự quay về bản cũ).

**Bản sửa mục 4 chạy đúng.** Đợt trừ buổi 10:20: trigger hợp đồng đánh dấu 100 bảng, hoãn 88; trigger usage đánh dấu 182, hoãn 161. Sau lượt quét của việc nền: 41 bảng tuần cũ ở trạng thái hoãn, 0 bảng trong hàng đợi, 6 bảng tuần gần đã dựng lại.

| | Đợt 09:20 (trước) | Đợt 10:20 (sau) |
| --- | ---: | ---: |
| Lượt đọc trong 15 phút quanh đợt | 73.208 | 17.664 |
| Giây chạy của việc nền dựng lịch | 97 | 12 |
| Đơn vị đọc tính tiền ở hai phút trừ buổi | 407.472 | 259.171 |

Hai đợt có số buổi bị trừ khác nhau, nên dòng cuối không so trực tiếp được; tính theo từng sự kiện thì đơn vị đọc **không giảm**.

**Deploy lại làm hết bất thường ở mục 3.** Giây instance tính tiền của mỗi đợt trừ buổi:

| Trigger | Đợt 09:20 | Đợt 10:20 |
| --- | ---: | ---: |
| syncPtScheduleWeeklyViewFromContractUsage (deploy lại 09:40) | 2.267 | 28 |
| syncPtScheduleWeeklyViewFromContract (deploy lại 09:42) | 2.786 | 12 |
| syncStudent360ContractUsage (không deploy lại) | 2.298 | 2.558 |

Mới có một đợt sau deploy, nhưng chênh lệch với trigger đối chứng rất rõ. Năm trigger còn bất thường (`syncStudent360ContractUsage`, `syncContractUsageOperationalActions`, `syncContractOperationalActions`, `syncLoyaltyContractSpend`, `syncStudent360Contract`) chưa được deploy lại; deploy lại sẽ đưa code hiện tại của `main` lên các trigger đó, vốn đang chạy revision ngày 29/10 và 01/11.

**Phát hiện mới: việc tìm bảng cần đánh dấu mới là thứ bị tính tiền.**

- Mỗi tài liệu `ptScheduleWeeklyViews` nặng 430–650 KB (47 tài liệu, 25 MB; riêng trường `students` trung bình 253 KB). Tài liệu trạng thái `ptScheduleWeeklyViewStates` chỉ 211 byte.
- Firestore Enterprise tính đơn vị đọc theo kích thước cả tài liệu, kể cả khi query chỉ lấy hai trường. Phép thử có kiểm soát: 20 query chỉ lấy `branchId`, `weekId` trên 47 tài liệu bị tính khoảng 138 nghìn đơn vị, tức khoảng 6.800 đơn vị mỗi query, 144 đơn vị mỗi tài liệu.
- `sourceEventTargets` chạy 4–5 query như vậy cho mỗi sự kiện hợp đồng hoặc usage (khoảng 27–34 nghìn đơn vị) và 1 query cho mỗi sự kiện buổi tập (khoảng 6.800). Mô hình này khớp số đo nếu mỗi query quét cả 47 tài liệu: 10:18–10:19 có 4 sự kiện buổi tập, 2 hợp đồng, 2 usage, dự tính 136–163 nghìn, đo được 162 nghìn; đợt 10:20 dự tính 224–272 nghìn, đo được 259 nghìn.
- Với khoảng 274 sự kiện hợp đồng/usage và 364 sự kiện buổi tập mỗi ngày, phần này ước chừng 9–12 triệu đơn vị mỗi ngày, tức gần như toàn bộ 10,5 triệu đơn vị đọc qua query. Việc nền dựng lại lịch chỉ chiếm khoảng 12% đơn vị của một đợt.

## 10. Đợt hai trong ngày 11/11 (11:15–12:30)

**Deploy lại 5 trigger còn bất thường.** `syncStudent360ContractUsage`, `syncContractUsageOperationalActions`, `syncContractOperationalActions`, `syncLoyaltyContractSpend`, `syncStudent360Contract` đã deploy lại từ `8da079b`, tất cả qua kiểm tra sức khỏe. Ba trigger đầu lên trước đợt trừ buổi 11:20 và chỉ còn 22, 13 và 6 giây tính tiền ở đợt đó (trước là khoảng 2.300–2.800). Hai trigger sau lên ngay sau đợt 11:20; thời gian tính tiền treo của revision cũ dừng lúc 11:30, nhưng chưa có đợt trừ buổi nào sau đó để xác nhận.

**Tìm bảng cần đánh dấu mà không đọc tài liệu lịch (`35d39f4`).** Mỗi bảng lịch tuần có thêm một tài liệu phụ thuộc nhỏ trong `ptScheduleWeeklyViewDependencies` (chỉ chứa mã học viên, PT, hợp đồng), ghi cùng transaction với tài liệu lịch. `sourceEventTargets` đọc tập này và tập trạng thái, không còn query `ptScheduleWeeklyViews`. Bảng chưa biết phụ thuộc (dựng trước khi có mảng phụ thuộc, hoặc mới chỉ có tài liệu trạng thái) được coi là khớp, nên không bảng nào bị bỏ sót. Tài liệu lịch hiện có được lập chỉ mục một lần cho mỗi database, ghi dấu ở `systemJobs/ptScheduleWeeklyViewDependencyIndex`. Client không có quyền đọc tập mới.

- Deploy 16 function: việc nền dựng lịch, hai hàm đọc và hai hàm dựng lại lịch tuần (để mọi lần ghi tài liệu lịch đều ghi tài liệu phụ thuộc), rồi 11 trigger.
- Production lúc 12:05: chỉ mục được lập ở sự kiện đầu tiên, 47/47 bảng có tài liệu phụ thuộc đầy đủ.
- Số đo đầu tiên (12:05, 2 sự kiện buổi tập và 2 sự kiện usage): khoảng 32 nghìn đơn vị đọc trong bốn phút, trong đó khoảng 14 nghìn là lần lập chỉ mục một lần. Theo đường cũ, cùng số sự kiện này tốn khoảng 68–82 nghìn. Đợt trừ buổi 12:20 không có buổi nào để trừ, nên **chưa có số đo cho một đợt trừ buổi đầy đủ**.

## 11. Đo lại buổi tối 11/11 (21:00)

So cùng khung giờ với hôm trước, 15:00–21:00 giờ Việt Nam, sáu đợt trừ buổi mỗi ngày:

| | 10/11 | 11/11 | Thay đổi |
| --- | ---: | ---: | ---: |
| Đơn vị đọc tính tiền | 8.320.519 | 2.457.239 | −70% |
| Lượt đọc | 481.636 | 194.494 | −60% |
| Giây chạy của việc nền dựng lịch | 553 | 158 | −71% |
| Lượt gọi Functions (mức hoạt động) | 3.140 | 3.420 | +9% |

Diễn biến trong ngày 11/11 khớp với từng bản sửa: trước khi sửa mỗi giờ có đợt tốn 1,1–1,6 triệu đơn vị; sau bản hoãn dựng tuần cũ lượt đọc giảm nhưng đơn vị vẫn 1,1–1,2 triệu; sau bản chỉ mục phụ thuộc còn 0,2–0,5 triệu ở các giờ bận nhất. Tính theo sự kiện usage, mỗi lần trừ buổi giảm từ khoảng 54–84 nghìn xuống khoảng 13 nghìn đơn vị. Phần còn lại chưa được phân tích nguồn.

**Bảy trigger từng bị tính thừa đều đã bình thường.** Trong 5 giờ (16:00–21:00, gồm các đợt đông nhất), tổng giây tính tiền của từng trigger là 23–125, cao nhất 18 giây trong một khoảng 5 phút; trước đó mỗi trigger bị tính khoảng 2.300–2.800 giây cho mỗi đợt. Hai trigger chưa xác nhận lúc trưa (`syncLoyaltyContractSpend`, `syncStudent360Contract`) còn 23 và 91 giây. Nguyên nhân gốc vẫn chưa rõ.

**Chưa kiểm chứng.** Chưa chạy `weekly-projection-safety.integration.cjs` (cần emulator). Chưa xem hóa đơn. Trang lịch quản trị đang mở một tuần cũ có tự làm mới khi tuần đó chỉ được đánh dấu hoãn hay không thì chưa thử trên trình duyệt; mở lại tuần thì chắc chắn được dựng lại.
