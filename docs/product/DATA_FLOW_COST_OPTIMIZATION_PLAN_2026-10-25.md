**Kế hoạch tối ưu đọc ghi dữ liệu và Functions của Aura**

Ngày lập: 25/10/2026, giờ Việt Nam. Đã bắt đầu thực hiện D0–D1 trong nhánh riêng; trạng thái kiểm thử và phát hành được ghi tại `ops/data-cost-optimization-20261025.json`. Các đợt D2–D5 vẫn nằm trong phạm vi kế hoạch, chưa được coi là hoàn thành.

Ưu tiên giảm truy vấn rộng, tải lại không cần thiết và chuỗi xử lý phát sinh từ một thay đổi. Giữ tính đúng của hợp đồng, số buổi, tiền và điểm thưởng. Phòng tập ảo dùng luồng trạng thái hoạt động riêng để không làm tăng tải cho các nghiệp vụ đó.

**1. Phạm vi và số liệu nền**

Rà soát working tree tại HEAD `3b849644131577b01a92b099d8fb4de36a9c85ff`, gồm cả thay đổi chưa commit của công việc Academy khác. Audit tĩnh bao phủ 365 file frontend, 171 module UI và 102 file backend. Có 342 vị trí gọi và 547 tên export backend trong source; đây không phải số lần gọi hay số deployment. 204 export không tìm thấy tham chiếu frontend trực tiếp không đồng nghĩa không sử dụng.

Metadata production kiểm tra lúc 00:29 ngày 25/10 xác nhận database là **Firestore Native Enterprise, asia-southeast1**. Cửa sổ 24 giờ gần nhất từ 00:24 ngày 24/10 đến 00:24 ngày 25/10, cho phép trễ thu thập năm phút:

| Chỉ số Monitoring | 24 giờ trước | 24 giờ gần nhất |
| --- | ---: | ---: |
| Document read operations | 2.574.309 | 2.458.472 |
| Document write operations | 46.300 | 69.032 |
| Read units riêng series RunQuery | 16.090.620 | 47.749.867 |
| Cloud Run requests toàn project | 10.114 | 12.048 |

Hai series `Query` và `RunQuery` có tổng bằng nhau; không cộng chúng thành tổng tiền. Cửa sổ gồm sử dụng thực, deploy và hoạt động chuyển đổi dữ liệu. Chưa thể gán biến động cho một màn hình hoặc khẳng định hiệu quả của một release. Artifact số liệu nằm ở `tmp/data-cost-plan-20261025/usage-observation.json`; các truy vấn audit chỉ lấy metadata/Monitoring, không đọc hồ sơ học viên hoặc gọi callable nghiệp vụ.

Trong cửa sổ 23:24 ngày 24/10 đến 00:24 ngày 25/10, Monitoring ghi nhận:

| Service | Requests | HTTP 429 | HTTP 5xx |
| --- | ---: | ---: | ---: |
| syncPtScheduleWeeklyViewFromStudent | 1.682 | 1.311 | 0 |
| syncStudent360Student | 1.073 | 666 | 36 |
| syncStudent360Renewal | 229 | 13 | 52 |

Đây là lý do ưu tiên kiểm tra từ chối request, retry và độ trễ projection. Chưa suy ra lỗi mất dữ liệu, nguyên nhân 429 hoặc tình trạng hiện tại sau cửa sổ này. Truy vấn log để phân loại lỗi cũng bị Cloud Logging trả HTTP 429, chưa nhận được log; cần hoàn tất bước này trước khi thay đổi retry/lease. Bằng chứng giới hạn truy vấn: `tmp/data-cost-plan-20261025/student360-error-observation.json`.

Enterprise tính phí theo lượng dữ liệu được xử lý, cả document/index, cùng các đơn vị ghi, realtime và sự kiện. Update một trường nhỏ trên document lớn vẫn có thể chịu chi phí theo kích thước document; cần xem cấu trúc lưu trữ, không chỉ số trường gửi lên. [Firestore Enterprise pricing](https://cloud.google.com/firestore/enterprise/pricing).

**2. Những tối ưu đã có cần giữ**

- Không thấy network polling 5 giây còn lại trong source frontend đã rà. Timer hiển thị đồng hồ, timeout Auth và retry hữu hạn không được tính là polling dữ liệu.
- Schedule/PT workspace đã đồng bộ theo tín hiệu, gộp yêu cầu làm mới và hạn chế refresh khi tab ẩn/offline. Schedule admin dùng dữ liệu theo branch/week thay cho chín listener legacy.
- Đã gỡ trigger tính buổi trùng; writer contract usage có transaction và chống xử lý lặp. Dashboard cache đã dùng TTL.
- Nutrition có summary theo ngày, cache/receipt cho nhiều luồng AI; reminder đã dùng `nextDueAt` và bootstrap có cursor. Tài liệu chi phí ngày 12/10 còn mô tả scan users cũ nên cần cập nhật.
- Loyalty dashboard đã chuyển sang summary; overview toàn hệ thống có ngân sách bảy business document reads, ngoài auth và panel chi tiết. Danh sách thành viên đã phân trang và chỉ hydrate wallet của trang đang xem.
- Một số ledger queries đã đưa filter xuống database; các regional reader đã dùng minInstances 0. Routing vùng giải quyết tải/quota, chưa tự chứng minh giảm phí database.
- Academy learner đã đọc catalog metadata và chapter theo lựa chọn. Video time-update là state local; không ghi Firestore mỗi frame.

Bằng chứng: `ops/function-operations.txt`, `ops/read-offload-20261024.json`, `ops/read-pagination-offload-20261024.json`, `ops/read-wave3-offload-20261024.json`, `ops/aura-club-reads-20261024.json` và source hiện tại.

**3. Chính sách cập nhật theo nhu cầu nghiệp vụ**

Các mức dưới là mục tiêu thiết kế để kiểm thử, không phải SLO production đã đo.

| Dữ liệu | Cách cập nhật đề xuất | Phạm vi đọc |
| --- | --- | --- |
| Phòng tập ảo, ca hôm nay, điều phối giao hàng | Khi trạng thái thay đổi; mục tiêu hiển thị trong vài giây khi mạng bình thường | Chi nhánh, người phụ trách, ngày hoặc order đang mở |
| Lịch tuần, availability, giáo án | Bootstrap rồi nhận revision mới; refresh sau save/discard hoặc resume nếu đã đổi | Người dùng và tuần/chương trình đang xem |
| Hợp đồng, tiền, số buổi, điểm thưởng | Mutation xác nhận bằng transaction; đọc nguồn có thẩm quyền trước khi quyết định ghi | Đối tượng nghiệp vụ được chọn |
| Dashboard vận hành | Summary cập nhật theo sự kiện; có `asOf`, version và trạng thái đầy đủ | Chi nhánh và kỳ đang chọn |
| Báo cáo lịch sử, KPI Academy | Dữ liệu chốt ngày; làm mới khi sửa lùi ngày hoặc theo yêu cầu | Kỳ báo cáo, không tải raw history toàn bộ |
| Bài học, catalog, cấu hình ít đổi | Cache theo phiên bản; nội dung được phân quyền tải khi mở | Course/chapter/catalog được chọn |
| Bản nháp học tập | Lưu local tức thì; cloud sau khoảng ngừng nhập và trước nộp/chuyển bước | Bản nháp của người dùng |
| Vị trí giao hàng | Chỉ trong phiên giao hàng đang hoạt động, có giới hạn tần suất riêng | Một order và người được cấp quyền |

Không dồn giao dịch và trạng thái vận hành đến cuối ngày. Chốt cuối ngày phù hợp báo cáo/tổng hợp, không phù hợp xác nhận tiền, gia hạn hoặc học viên đang tập.

**4. Luồng đọc và ghi mục tiêu**

Luồng đọc: mở màn hình → kiểm tra quyền hiện tại → lấy summary/trang đầu đúng scope → theo dõi revision hoặc projection nhỏ khi cần realtime → chỉ tải phần thay đổi. Tab chi tiết tự lấy dữ liệu khi mở. Cache chứa khóa user, phạm vi quyền, filter và version; đổi tài khoản/quyền phải xóa dữ liệu cũ.

Luồng ghi: thao tác → kiểm tra quyền và dữ liệu → nhận `requestId` ổn định → transaction kiểm tra revision/receipt → ghi nguồn chuẩn cùng các kết quả bắt buộc nguyên tử → trả kết quả chuẩn cho UI. Báo cáo thứ cấp nhận sự kiện và cập nhật đúng phần bị ảnh hưởng. UI nhận patch và revision đã xử lý, không tự gọi lại toàn workspace rồi lại refresh vì cùng một tín hiệu.

Không đặt toàn bộ projection vào một transaction lớn. Chỉ dữ liệu buộc nhất quán ngay mới ghi cùng transaction; báo cáo có thể cập nhật sau, kèm độ mới và khả năng rebuild. Ghi lại cùng request phải trả receipt cũ; timeout chưa rõ kết quả phải tra receipt trước khi thử lại, đặc biệt khi có endpoint nhiều vùng.

Firestore có thể gửi lại event và không bảo đảm thứ tự. Guard so sánh trường nghiệp vụ giúp giảm đọc/ghi bên trong handler, nhưng vẫn có invocation của trigger đã được giao. Muốn giảm invocation cần giảm source writes hoặc tổ chức lại subscription sau khi chứng minh các consumer vẫn được cập nhật. [Firestore trigger semantics](https://firebase.google.com/docs/functions/firestore-events).

**5. Đợt 0 — Sửa tính đúng và bổ sung đo lường**

**D0.0 — Xác minh đợt lỗi request và backlog.** Đối chiếu revision thực sự phục vụ, từng nhóm response code, Eventarc/PubSub backlog và tuổi event chưa xử lý, lease contention và projection lag của ba service trên. Phân biệt handler trả 429, runtime capacity và dịch vụ phụ thuộc; không gán nguyên nhân khi chưa có bằng chứng. Kiểm tra hoạt động backfill/deploy trùng cửa sổ trước khi tăng tải hoặc giảm maxInstances. Giữ retry nghiệp vụ; chỉ điều chỉnh concurrency/capacity hoặc nhịp backfill sau khi xác định nút nghẽn. Nghiệm thu: quan sát backlog thoát và projection bắt kịp; sự kiện bị thử lại không làm sai số buổi, tiền hoặc quyền.

**D0.1 — Sửa hàng đợi Student 360.** `functions/student-360.js:27,1467` và `functions/index.js:771,788` dùng document path ba segment `systemJobs/student360ProjectionRefreshQueue/{studentId}`. SDK local đã xác nhận path này không hợp lệ; reader bắt lỗi nên có thể trả stale mà không enqueue. Thống nhất path bốn segment, ví dụ `systemJobs/student360ProjectionRefreshQueue/requests/{studentId}`; producer, trigger và worker cùng dùng một helper. Dùng transaction/watermark chống enqueue trùng giữa instance, log lỗi chuẩn hóa. Kiểm tra revision production trước rollout; lỗi source chưa chứng minh image đang phục vụ có cùng lỗi.

Nghiệm thu: emulator thật chạy stale-read → queue → projection mới; replay, nhiều request đồng thời, worker chết rồi retry; test đường dẫn bằng SDK thật thay vì mock permissive. Reader vẫn có fallback phù hợp khi hàng đợi lỗi.

**D0.2 — Chặn nightly renewal ghi đè và xử lý dữ liệu thiếu.** `functions/contract-renewals.js:672–755` scan ngoài transaction, dựng case có stage/note/quote từ snapshot cũ rồi batch merge. Đồng thời contracts có cap 5.000 nhưng vẫn deactivate case không nằm trong kết quả dựng được. Sửa writer chỉ patch trường tính toán; bảo vệ bằng transaction hoặc precondition updateTime. Phân trang, checkpoint đầy đủ; tuyệt đối không deactivate vì không thấy trong một scan thiếu. Đây là nguy cơ từ source, chưa có bằng chứng đã xảy ra production.

Nghiệm thu: Sales đổi note/stage/quote hoặc xác nhận won trong lúc job chạy không bị ghi đè; fixture trên 5.000 contracts; retry batch và crash/resume; dry-run đối chiếu trước bật writer.

**D0.3 — Thiết lập số đo theo thao tác.** Mở rộng telemetry hiện có ở `functions/observability.js` và service client: operation, release, correlationId, refreshReason, duration, queries, documentsReturned, responseBytes, writesAttempted, writesChanged, retries, cacheTier, projectionLag, targetsInvalidated. Đếm truy vấn logic riêng với attempts của transaction. Không gọi các bộ đếm này là billed units nếu chỉ đo phía ứng dụng.

Lấy Billing export/SKU và provider usage; tách Firestore read/write/realtime/event units, compute, storage, network, logs, build/artifact và AI. Phân biệt chạy nghiệp vụ với backfill/deploy/repair; lấy mẫu log thành công và tổng hợp, giữ lỗi/quota cần điều tra, tránh tạo một collection telemetry write cho từng lượt đọc. Baseline tối thiểu bảy ngày hoạt động đại diện; không phải chờ đủ bảy ngày mới sửa hai lỗi trên.

Lập danh mục query của renewal, business reporting, Student 360 và daily rebuild: bộ lọc, sort, scope, indexes, document sizes và tỷ lệ dữ liệu xử lý/kết quả trả về. Kiểm access plan bằng API Explain phù hợp Enterprise; nếu cần Analyze, dùng phạm vi có ngân sách vì query sẽ thực thi. So sánh cùng scope/dataset trước và sau. Ưu tiên index phục vụ query cần thiết ngay trong đợt này và đợt 3; chưa loại index trước khi xác minh dependency. `limit`, cursor hay response nhỏ hơn không tự bảo đảm scan và billed units giảm tương ứng.

Nghiệm thu: dashboard theo endpoint và màn hình có mẫu trước/sau cùng loại thao tác; không log dữ liệu sức khỏe, nội dung bài học riêng hoặc token; metrics thiếu thể hiện unknown, không coi là zero.

**6. Đợt 1 — Giảm tải thừa ở giao diện và các lần ghi không đổi**

| Hạng mục | Bằng chứng hiện tại | Điều chỉnh | Nghiệm thu |
| --- | --- | --- | --- |
| D1.1 Finance theo tab | `src/contexts/DatabaseContext.tsx:113,486–495`: overview vẫn mở students/contracts, mỗi nguồn limit 2.501 | Đăng ký nguồn theo consumer; overview/cashbook chỉ summary + branch; ledger/debt mở nguồn riêng rồi chuyển cursor | Overview/cashbook không query directory students/contracts; số tiền và quyền giữ nguyên |
| D1.2 Delivery polling | `DeliveryPage.tsx:115`, `EatCleanDispatchTab.tsx:140`, `EatCleanTrackingPanel.tsx:108`: 30s/30s/15s, chưa chặn tab ẩn | Bước đầu chặn hidden/offline, một request đang chạy, resume một lần; tách selection khỏi load dependency; patch kết quả mutation | Tab ẩn 10 phút không có read callable mới; không chồng request; order hoàn thành dừng tracking |
| D1.3 Progress reattach | `src/pages/student/ProgressPage.tsx:323–353`: đổi category gắn lại weight/body/check-in listeners | Tách effect ổn định khỏi photos/category; photos lịch sử có cursor | Đổi tab mười lần không gắn lại ba listener nền; chỉ tải photos khi cần |
| D1.4 Action Center guard | `functions/action-center.js:594–603`: session event có thể đọc 20 buổi gần nhất | So sánh field ảnh hưởng no-show, thứ tự và scope trước query | Note/metadata không liên quan tạo zero business reads; đổi status/date/student vẫn cập nhật đúng |
| D1.5 Mở wizard tái ký | `functions/contract-renewals.js:788–813`: prepare vẫn tăng revision/set case | So sánh dữ liệu nghiệp vụ; chỉ ghi khi lần đầu manuallyOpened hoặc nội dung đổi | Mở lại không đổi không ghi case/tăng revision; báo giá và quyền vẫn đọc đủ mới |
| D1.6 Loyalty mission | `functions/loyalty.js:815,829,843,1100,1114`: set timestamp dù kết quả mission không đổi | So sánh payload và source revision; bỏ ghi không đổi, giữ progress-only change | Replay không tăng điểm và không ghi lại mission; đo comparison reads so với writes tránh được |

Polling 30s tạo tối đa lý thuyết 120 lần/giờ/tab, 15s là 240, chưa kể bootstrap/mutation. Đây là phép tính từ tần suất source, không phải traffic production đã đo. Giải pháp chuẩn cho delivery nằm ở đợt 2; guard là bước chuyển tiếp.

**7. Đợt 2 — Thay polling còn lại bằng cập nhật đủ tin cậy**

**D2.1 Availability.** `src/pages/student/StudentAvailabilityPage.tsx:241–246,369` vừa nghe marker vừa poll 90–105s. Marker chỉ chứa `updatedStudentId`; khi hidden hoặc đang có draft, callback có thể bỏ qua và không giữ pending version. Không xóa polling ngay. Bổ sung revision theo user/week hoặc cơ chế giữ đầy đủ version đã đổi; bootstrap trả version đã đọc. Khi đang sửa, giữ thông báo thay đổi và reconcile sau save/discard/resume. Tách response availability khỏi lịch sử sessions/requests không cần trên trang.

Nghiệm thu: admin sửa A rồi B liên tiếp, cả hai nhận đúng; không ghi đè draft; mount chỉ một bootstrap; sau khi bảo đảm coverage, để màn hình yên 30 phút không gọi lại định kỳ.

**D2.2 Giáo án học viên.** `src/pages/student/StudentPtWorkoutPage.tsx:177,244` nạp plan và history mỗi 90–105s. Cache plan theo owner/program revision; history chỉ tải khi mở, trang 20–30 dòng. Tín hiệu training revision khi PT đổi plan/ghi buổi. Nghiệm thu: ở plan không tải history, cập nhật PT xuất hiện một lần, cursor không đọc lại các trang trước.

**D2.3 Delivery realtime.** Xây dữ liệu hiển thị nhỏ theo dispatcher/shipper/order, kiểm soát quyền server/rules; trạng thái nhận qua listener khi mở. Static config tải theo version. Client RTDB hiện chưa mở quyền đọc, nên chuyển listener phải triển khai projection và rules phù hợp trước, không thay API một cách máy móc.

**D2.4 GPS.** `src/features/delivery/useDriverLocationPublisher.ts:59–76` và `functions/eat-clean.js:3506–3568` dùng điều kiện khoảng cách HOẶC thời gian; nhiễu GPS có thể tăng lần gửi. Backend đã lưu điểm vị trí trong RTDB, không mirror mọi điểm vào Firestore, nhưng mỗi callable vẫn xác thực/đọc delivery và RTDB. Thêm min interval cứng, lọc accuracy/outlier, giữ latest point và max-age riêng; chốt ngưỡng bằng độ mới cần thiết, không mặc định giá trị nhỏ nhất. Chỉ cân nhắc direct RTDB write sau khi có rules giới hạn job, chủ thể, thời gian và payload.

Nghiệm thu: GPS callback 1Hz không vượt cap đã chọn; completed/cancelled hoặc đổi tài khoản dừng publish; người ngoài order không đọc được vị trí.

**D2.5 Revision sau mutation.** `TrainerPortalV2.tsx:447–456` vừa patch vừa load, đồng thời marker có thể xếp thêm refresh. Mutation trả accepted revision + patch; client chỉ reconcile khi version mới hơn. Tín hiệu branch/week/user/section chỉ tách khi tiết kiệm reads lớn hơn chi phí thêm marker writes. Test cả hai thứ tự marker-before-response và response-before-marker. Một batch 30 điểm danh tạo tối đa một lượt reconcile cho mỗi màn hình bị ảnh hưởng, nếu server đã commit cùng revision hợp nhất.

Không detach mọi listener ngay khi tab mất focus. Listener nhỏ có thể giữ trong thời gian ngắn; tab rời màn hình phải cleanup. Đo reconnect/initial-query cost trước khi chọn hidden grace, vì cấu hình cache Firestore hiện mặc định memory, persistent cache chỉ bật qua flag.

**8. Đợt 3 — Phân trang ở database và summary riêng**

| Hạng mục | Vấn đề còn lại | Thay đổi và kiểm thử bắt buộc |
| --- | --- | --- |
| D3.1 Renewal cases | `contract-renewals.js:515–536,865–881`: mỗi trang lại scan tới 5.001 case mỗi query scope rồi slice | Chuẩn hóa filter/sort, index và cursor thật; stats có version/scope riêng. Test nhiều role/branch, alias PT cũ, đổi scope giữa trang và risk theo ngày |
| D3.2 Finance/history | `finance-ledger.js:568–570` tính summary toàn bộ ở mỗi cursor; `business-reporting.js:577–586` đọc thêm history cho summary | Cursor-only không tính lại summary; legacy default giữ tương thích. Refresh summary khi mở, đổi filter, mutation, quyền hoặc version. Không dùng TTL tùy tiện cho số tiền |
| D3.3 Business reports | `business-reporting.js:466–478` đọc dữ liệu ngày của mọi branch rồi lọc; cap các nguồn cộng tới 30.704 docs, ngoài auth | Push branch predicate với index; dữ liệu thiếu branch phải có semantics/backfill. Summary ngày cho scope lớn; test >10.000 dòng ngoài branch không làm mất kết quả đúng |
| D3.4 Academy admin | `AuraApplication.tsx:164–169,354–360`, `firebaseService.ts:341–355,952–958`: enrollment/progress tới 5.000 mỗi loại và directory tới 2.500 | Summary course/cohort, directory cursor 50; progress chi tiết chỉ khi chọn học viên. Giữ route gate hiện có để editor không tải analytics toàn kho. Test >5.000 progress, sửa completion/enrollment, thay quyền |
| D3.5 Progress charts | `ProgressPage.tsx:311–321`: ba raw-log listeners, mỗi loại cap 1.000 | Biểu đồ theo daily summary; chi tiết một ngày đọc raw. Thể hiện coverage, xử lý sửa/xóa lịch sử; test 90 ngày vượt 1.000 logs vẫn đúng |
| D3.6 Dashboard cold miss | `operations-dashboard.js:813,831–867`: vẫn hydrate contracts/students và danh sách khác; coalesce chỉ cùng process | Tách cards/detail; cursor detail; cache có scope/version và lease build giữa instance. Không stale quyền hoặc số tiền dùng để ghi. Test simultaneous misses và version đổi giữa build |

Ngân sách đề xuất: trang danh sách lấy pageSize + một lookahead trên mỗi phân vùng quyền cần truy vấn; auth/config có ngân sách riêng. Đây là số document trả về, không cam kết read units tương đương. Dùng Query Explain/Analyze đúng API Enterprise hỗ trợ để xem scan và index; Analyze có thực thi/chi phí, chỉ chạy có phạm vi. Hồ sơ cũ từng ghi planner-only API không được hỗ trợ, nên không coi việc index READY là bằng chứng query đã chọn index. [Enterprise query optimization](https://docs.cloud.google.com/firestore/native/docs/enterprise-optimize-query-performance).

**9. Đợt 4 — Giảm chuỗi trigger và rebuild lịch sử**

**D4.1 Student 360 theo miền dữ liệu.** `student-360.js:1230–1259,2137–2148` chỉ nutrition có đường cập nhật riêng; nguồn khác có thể đọc tới 1.000 sessions + 1.000 attendance và nhiều lịch sử khác. Tách phần schedule, contract, finance, training/progress; giữ một summary hợp nhất version và timeline theo ID sự kiện. Gom thay đổi cùng student bằng durable dirty mask/watermark, dùng chung lease cho event/on-demand/reconcile. Mỗi worker chỉ đọc miền dirty; full rebuild giữ cho repair. Test duplicate, sự kiện cũ, đổi chủ sở hữu, delete, partial/full race, mốc ngày/tuần và worker crash.

**D4.2 Weekly view.** `pt-schedule-weekly-view.js:808–855,939–950` profile/contract có thể invalidate mọi tuần của branch, retry còn tăng generation. Thêm fingerprint cho đúng dependency và receipt/source watermark; chỉ chọn tuần chịu ảnh hưởng sau khi thống nhất semantics lịch sử. Không giới hạn lịch sử tùy tiện nếu sửa lùi ngày còn ảnh hưởng validation. Test liên cơ sở và event tới trong lúc rebuild.

**D4.3 Aggregate dashboard ban đêm.** `index.js:614–622`, `operations-dashboard-aggregates.js:297–334` rebuild 366 ngày, đọc năm nguồn và viết lại baseline/buckets. Giữ incremental writer; bổ sung coverage/generation theo branch/day, dirty-day queue và đối soát gần đây có cursor. Full history chạy bootstrap/repair. Chuyển generation nguyên tử sau khi nguồn complete; không đổi đơn giản 366 thành 7 vì sẽ làm sai nghĩa coverage. Test >20.000 records, sửa lùi ngày, xóa/chuyển branch, cập nhật đồng thời và crash/resume.

**D4.4 Renewal due queue.** `contract-renewals.js:238,282,1374` activation/status/queue vẫn đọc nhiều inventory. Sau D0.2, chuẩn hóa `nextTransitionAt` và truy vấn đến hạn; contract/usage event đưa đúng học viên vào dirty queue. Nightly xử lý mốc ngày và reconciliation có cursor. Test hết buổi trước hết ngày, hợp đồng nối tiếp, tạm dừng, đổi ngày, hết hạn và retry không chuyển buổi hai lần.

**D4.5 Loyalty lịch sử.** `loyalty.js:727–729,862,973–979` có thể đọc toàn attendance, 13 availability và lịch sử nutrition. Dùng contribution ngày/tuần/tháng, checkpoint chuỗi liên tiếp và shared monthly budget transaction; sửa kỳ nào xử lý kỳ đó và phụ thuộc streak cần thiết. Không cắt đơn giản bốn tuần vì thưởng chuỗi dài có semantics riêng. Shadow so sánh điểm, progress, reversal và giới hạn tháng; giữ full reconcile cho repair.

**D4.6 Staff assignment.** `staff-managed-summary.js:55–69` có sáu query alias, mỗi query limit 750. Chuẩn hóa index phân công, backfill có cursor rồi query một representation. Test một PT nhiều vai trò/cùng contract, đổi PT, hai contract của một student; giữ nghĩa đếm hợp đồng.

Các projection mới chỉ nên xây khi chi phí đọc tránh được lớn hơn tổng chi phí ghi duy trì, trigger, repair và storage. Ký hiệu Q là lượt xem, M là thay đổi dữ liệu: so sánh `Q × phần chi phí đọc giảm` với `M × chi phí duy trì tăng + repair + storage/network`. Đo theo đơn vị billed/bytes, không thay bằng số document đơn thuần.

**10. Đợt 5 — AI, bản nháp, tài nguyên và vòng đời**

- **D5.1 Content AI:** `generative-ai.js:347–372` chưa có durable receipt như Nutrition AI; frontend single-flight chỉ bảo vệ cùng tab. Bổ sung requestId, payload hash, trạng thái pending/succeeded/unknown và tra kết quả sau timeout. Cache theo owner/scope/prompt/model/schema version; yêu cầu tạo bản khác có nonce. Không bảo đảm exactly-once với provider nếu provider không hỗ trợ idempotency; trạng thái chưa rõ không tự gọi trả phí lần nữa. Test hai instance, reload và timeout sau provider success.
- **D5.2 Workbook:** `useAcademyWorkbook.ts:53–119` đã có local draft, debounce 600ms, chống concurrent và flush trước nộp. Đo số cloud saves; cân nhắc 1,5–3s idle, hash chống no-op và giới hạn lần sync, giữ flush/navigate/recovery/conflict revision. Patch ít field không bảo đảm giảm billed write units trên document lớn; tách các phần thường đổi nếu phép đo cho thấy cần.
- **D5.3 Runtime:** giữ minInstances 0 cho nhóm hiện có; benchmark theo read I/O, transaction, AI wait và optimizer. So sánh fractional CPU/concurrency 1 với 1 CPU/concurrency phù hợp trên workload thực; chọn chi phí cho một thao tác thành công với p95/error mục tiêu. maxInstances là giới hạn scale, không phải số instance luôn tính tiền. Không tăng hoặc hạ đồng loạt.
- **D5.4 Regions:** tiếp tục dùng ba vùng đã có, writer/trigger cần dữ liệu lớn ưu tiên gần database khi quota cho phép. Đo latency và network của alias liên vùng. Không coi chuyển function sang vùng khác là giảm lượt đọc; không tạo worker/scheduler cùng nghiệp vụ chạy đồng thời ở hai vùng.
- **D5.5 Retention/index:** rà index trên payload lớn và trường không query, cache/receipt hết hạn, log thành công, ảnh và build artifacts. TTL đã có ở nhiều cache, chỉ xác minh policy thực sự active và tránh trùng cleanup. Giữ receipt đủ vòng retry/đối soát; không áp TTL xóa giao dịch tài chính để tiết kiệm. Loại index phải dựa trên query inventory đúng edition. [Firestore index guidance](https://firebase.google.com/docs/firestore/best-practices).
- **D5.6 Telemetry:** event giá trị thấp hiện đã dedupe và nhiều event chỉ ghi log, không Firestore. Nếu còn đáng kể, batch/sample event thành công ở client; giữ sự kiện nghiệp vụ/lỗi cần đối soát. Đo chi phí telemetry trước khi thêm hệ thống đo mới.
- **D5.7 Endpoint lifecycle:** giữ quy trình `ops/function-lifecycle.txt`. Mốc sớm nhất 06/11 cho nhóm pipeline/weekly, 22/11 MealPlan, 22/12 nhóm hiếm/tài chính kèm đủ chu kỳ. Hết ngày không tự đủ điều kiện; cần traffic, caller cũ/fallback/script, source fingerprint và rollback. Bốn maintenance wrapper giữ theo registry. Revision latest không nhận traffic không chứng minh service đang chết; kiểm tra revision thật đang phục vụ.

**11. Phòng tập ảo áp dụng kiến trúc tối ưu từ đầu**

Hoạt động riêng liên kết `sessionId`: checked-in → training ↔ resting → ended; scheduled chỉ thuộc danh sách sắp tới. Điểm danh hiện tại có thể completed ngay khi xác nhận và auto-present sau 48 giờ, nên không dùng để suy ra đang tập.

Mỗi thao tác hợp lệ ghi activity và projection hiển thị nhỏ trong transaction; một bản ghi mỗi hoạt động, scope branch/day, không một document chứa cả phòng. Listener chỉ lấy người có mặt và phần quyền cho phép. Chuyển khu/nghỉ không sửa sessions/attendance/contract. Đồng hồ chạy local, không heartbeat callable 5s. Chỉ khi nghiệp vụ kết thúc cần xác nhận buổi mới gọi core attendance hiện có với chống lặp.

Khi quên kết thúc hoặc dữ liệu quá cũ, hiển thị cần xác nhận; không tự trừ buổi, không coi đóng app là rời phòng. Nếu cần online presence, thiết kế riêng, không đồng nhất với hiện diện vật lý. Pilot một branch, quyền quản lý/PT trước; kiểm thử reconnect, hai thiết bị, PT nhiều học viên, hủy ca, đổi branch và không phát sinh financial/loyalty writes do thao tác hiện diện đơn thuần.

Ví dụ giả định để so sánh cơ chế: 20 màn hình mở tám giờ và polling 5s tạo 115.200 read-callable attempts/ngày, chưa kể retry. Cập nhật theo sự kiện bỏ phần gọi định kỳ này, nhưng vẫn có chi phí bootstrap, document thay đổi × số người xem, rules, projection writes và reconnect. Không dùng ví dụ này để dự báo hóa đơn thực tế.

**12. Thứ tự triển khai và tiêu chí hoàn thành**

| Đợt | Phạm vi | Phụ thuộc | Điều kiện chuyển tiếp |
| --- | --- | --- | --- |
| 0 | D0.0–D0.3: triage request/backlog, đúng queue, an toàn renewal, telemetry/query plans | Kiểm source và revision production; không chờ đủ baseline để sửa lỗi | Backlog/lag được kiểm soát; test race/path/cap đạt; có baseline query |
| 1 | D1.1–D1.6: listener theo tab, guard, no-op | Contract API hiện tại | UI/network budget và nghiệp vụ tương đương |
| 2 | D2.1–D2.5: version đủ coverage, delivery/GPS, mutation reconcile | Projection/rules/index và client tương thích | Test bỏ lỡ event, draft, offline, hai thiết bị đạt rồi mới tắt poll |
| 3 | D3.1–D3.6: cursor và summary | Index READY, backfill chuẩn hóa scope/version | Query budget, coverage, exact totals và quyền đạt |
| 4 | D4.1–D4.6: delta projection, partition repair | D0; baseline; writer có fencing | Shadow parity đạt, nguồn đầy đủ, replay không lệch |
| 5 | D5.1–D5.7: AI/runtime/retention/lifecycle | Dữ liệu chi phí và các mốc quan sát | Chi phí/thao tác giảm, p95/lỗi không xấu đi |
| Phòng tập ảo | Activity projection riêng | D0 và quy ước event/version D2 | Pilot chính xác, không ghi buổi/tiền trùng |

Các hạng mục UI độc lập trong đợt 1 có thể làm song song. Đợt 3–4 chia theo domain, mỗi PR có phạm vi nhỏ; không đồng thời thay mọi writer, summary và frontend. Trước sửa file Academy đang thay đổi ở nhánh công việc khác phải phối hợp và rebase để tránh đè tiến độ.

Mỗi thay đổi projection: schema/index/rules tương thích → writer mới có cờ → backfill có cursor và giới hạn tải → so sánh shadow trên mẫu đủ loại nghiệp vụ → đánh dấu coverage ready → bật reader cho một scope → mở rộng → giữ repair/rollback. Shadow/backfill cũng phát sinh chi phí, phải có thời hạn và ngân sách, không chạy hai luồng mãi.

Ngân sách nghiệm thu đề xuất:

- Màn hình không đổi dữ liệu: không polling đọc nghiệp vụ sau bootstrap. Giữ refresh có mục đích khi quyền/cache/tài nguyên đang dùng hết hạn, retry hữu hạn và recovery; ví dụ gia hạn signed media URL trong `CourseLessonRuntime.tsx:140–152` và chapter revalidation trong `useAcademyChapterDelivery.ts:63,77–81`. Realtime listener vẫn có chi phí ban đầu/cập nhật; GPS hoạt động có cap riêng.
- Tab ẩn không phát read callable định kỳ mới; chuyển tab không gắn lại nguồn không đổi.
- Bấm lặp/timeout retry tạo một kết quả nghiệp vụ; không thêm hợp đồng, thu tiền, trừ buổi hay điểm thưởng lần hai.
- No-op update không ghi lại timestamp/revision của projection; semantic guard không bỏ sót thay đổi thật.
- Pagination không đọc lại toàn lịch sử để tính summary; có completeness/cursor, không im lặng coi dữ liệu bị cap là đầy đủ.
- Quyền được kiểm tra mới ở server; cache không vượt tài khoản/branch/role. Hạ quyền phải xóa dữ liệu đang giữ và vô hiệu hóa thao tác.
- Financial/contract/points totals khớp fixture và đối soát; sai khác hoặc lộ quyền thì dừng ngay. Áp gate hiện có: route failure >0,5% hoặc JS errors >1% phiên thì rollback surface sau khi xác định cửa sổ và cỡ mẫu phù hợp.
- Deploy kiểm đúng image/revision mới nhận traffic, Eventarc/Scheduler active, không chỉ dựa CLI exit 0. Rollback reader theo cờ; projection phiên bản cũ giữ cho tới khi hết cửa sổ quan sát.

Kết quả cần đánh giá là chi phí cho một nghiệp vụ thành công và trải nghiệm tương ứng. Chưa đặt mức tiết kiệm tiền hoặc phần trăm cho toàn app khi chưa đối chiếu Billing, provider usage và loại traffic. Ưu tiên đầu tiên là D0, D1, sau đó D2 và các truy vấn rộng D3; các projection phức tạp D4 được xếp tiếp theo số đo thực tế.
