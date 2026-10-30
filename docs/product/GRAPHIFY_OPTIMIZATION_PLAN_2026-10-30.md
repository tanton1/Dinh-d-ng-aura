# Kế hoạch tối ưu Aura dựa trên Graphify

Ngày 30/10/2026. Ưu tiên tiếp theo là giảm dữ liệu đọc ở các màn hình còn lấy tập lớn, đo chi phí theo thao tác và làm rõ phụ thuộc backend. Graphify đã được tích hợp vào công cụ phát triển để hỗ trợ truy vết trước mỗi thay đổi. Việc cài công cụ không tự làm giảm hóa đơn Firebase; mức tiết kiệm phải đo sau từng thay đổi nghiệp vụ.

## Bản triển khai cải thiện toàn app

Nhánh `codex/app-optimization-20261030` bổ sung báo cáo Academy và công nợ theo trang, cache tổng hợp dùng chung và trạng thái chưa đầy đủ; bỏ các listener toàn bộ enrollments/progress và nguồn danh bạ legacy trên màn tài chính. Hai vòng runtime hợp đồng/loyalty và các vòng type Academy/PT/finance/nutrition được tách mà giữ API tương thích. Mỗi endpoint mới kiểm tra quyền trước khi đọc cache.

Luồng tái ký giải thích kích hoạt/chuyển buổi và giữ yêu cầu chưa rõ kết quả để đối soát trước khi gửi lại. Ảnh AI hiện thời gian chờ không polling; số liệu chỉnh sửa đi cùng lần lưu bữa ăn hiện có. Onboarding đưa thói quen tùy chọn xuống sau thông tin cốt lõi, vẫn yêu cầu trả lời sức khỏe; buổi tập phân biệt bản nháp và xác nhận lưu. Báo cáo tiến độ có đường mở nhật ký/lịch để bổ sung ghi nhận.

Số đo mới lấy mẫu, không tạo thêm document cho mỗi read. Cách thu baseline, giới hạn quét 25.000 bản ghi mỗi nguồn, thứ tự phân trang công nợ và trình tự deploy nằm trong [hướng dẫn vận hành](../operations/OBSERVABILITY.md#operation-baseline-and-reporting-rollout-2026-10-30). Không coi bản triển khai local là đã rollout production hoặc đã đạt mức tiết kiệm cụ thể. Không xóa endpoint, mở các trang Academy đang ẩn, tăng quota AI hay bật Phòng tập ảo trong bản này.

[Snapshot sau điều chỉnh](../../tools/graphify/baselines/app-optimized-20261030.json) ghi nhận 552 file nguồn, không còn ứng viên vòng import trong phạm vi graph và 569 export backend (thêm bốn API báo cáo, không xóa endpoint cũ). Kiểm tra cuối: 1.594 test backend, 440 test frontend, 5 kịch bản báo cáo, 5 hồi quy xếp lịch và 33 kịch bản hành trình đạt; build và toàn bộ budget hiệu năng đạt. Kiểm thử Firestore xác nhận tổng hợp trên 11.002 bản ghi, cache dùng chung, snapshot nhất quán và làm mới sau thanh toán không nhận bản cũ công bố muộn. Thử tải queue 30 học viên với provider giả đạt; chưa suy ra tốc độ provider thật hay mức giảm hóa đơn.

## Mốc phân tích

Phân tích chính dựa trên [main af311e9](https://github.com/tanton1/Dinh-d-ng-aura/tree/af311e9c144b2d2318fb0a4c751f1c1082c09c2d), gồm thay đổi hàng đợi ảnh dinh dưỡng đã merge. Bản này được tách khỏi checkout đang có nhiều thay đổi chưa commit. Graph của hai bản lưu riêng; kết luận dưới đây dùng main.

Graphify quét **539 file mã nguồn**, tạo **7.308 node và 20.681 cạnh** trong `src` và `functions`. Inventory callable bổ sung quét 416 file frontend và 123 file backend, tìm 348 vị trí gọi và 348 tên endpoint ứng viên. Có 49 vị trí động/tham số cần diễn giải thêm. Số liệu cấu trúc đầy đủ, commit và giới hạn phân tích nằm trong [baseline](../../tools/graphify/baselines/main-20261030.json).

Graph không bao gồm CSS, test, dữ liệu, script vận hành hay trạng thái cloud. Bảy file được extractor báo không tạo symbol, chủ yếu file dữ liệu sinh tự động và barrel export; vẫn cần kiểm tra bằng TypeScript/source khi đánh giá phạm vi. Các phát hiện về chi phí dưới đây là điểm cần đo, không phải kết quả Billing mới.

## Những phần đã tốt và cần giữ

| Luồng | Bằng chứng ở main | Hướng tiếp theo |
| --- | --- | --- |
| Lịch, workspace và delivery | Đã có revision listener, cơ chế hợp nhất refresh và tải theo scope; không còn các vòng gọi mạng 5 giây từng bị nêu | Kiểm tra chỉ tải lại đúng phần sau mutation; không thay bằng một vòng polling mới |
| Danh bạ học viên V2 | `DatabaseContext.tsx` tắt nguồn legacy khi cờ `admin-student-directory` bật | Xác minh rollout/traffic trước khi đầu tư thêm vào legacy |
| Finance overview và payroll | Nguồn chung đã thu hẹp theo màn hình | Chỉ xử lý các tab chi tiết còn cần students/contracts |
| Academy read | `academyReadService.ts` đã dùng single-flight theo session, payload và access revision; có cơ chế fallback read | Giữ boundary phân quyền; không tạo thêm cache chung vô hạn |
| Ảnh món ăn | Queue xử lý tối đa 8 job đồng thời, 12 suất dùng chung cho nutrition AI; theo dõi một job document | Đo queue wait và lỗi provider; không tạo key chỉ để chia cùng quota tài khoản |
| Timer giao diện | Phần lớn timer còn lại cập nhật giờ, ngày hoặc đếm thời gian tập | Không coi mọi `setInterval` là một lần đọc Firestore; service worker có kiểm tra update riêng mỗi 5 phút khi tab hiện |

Các giao dịch như xác nhận lịch, thanh toán, tái ký và trạng thái đang tập vẫn cập nhật ngay. Chốt cuối ngày phù hợp báo cáo tổng hợp; không áp dụng cho dữ liệu cần phản hồi tức thời.

## Các phát hiện cần xử lý

**Nguồn đọc lớn còn lại.** `src/services/firebaseService.ts` đăng ký toàn bộ enrollments và collection group progress với giới hạn 5.000 mỗi nguồn. `AuraApplication.tsx` chỉ bật hai nguồn này ở các view analytics có quyền, nên không phải mọi lần mở app đều tải chúng. Các trang báo cáo này nên nhận summary phù hợp màn hình và chỉ phân trang chi tiết khi người dùng mở.

`DatabaseContext.tsx` vẫn có adapter legacy cho students/contracts, mỗi nguồn tối đa 2.501 document kiểm tra tràn. Danh bạ V2 đã vô hiệu hóa adapter ở route đó khi bật; `admin-finance-details` vẫn sử dụng directory. Vì vậy phải kiểm tra màn hình/cờ nào thực sự mở listener trước khi đánh giá số đọc có thể giảm.

**Hai nhóm vòng phụ thuộc backend.** `contract-usage.js` và `contract-usage-view.js` gọi qua lại, trong đó có require trì hoãn bên trong hàm. Nhóm loyalty nối `loyalty.js` → projection/membership → `loyalty.js`. Đây là phụ thuộc runtime cần tách phần tính toán và điều phối; chưa có bằng chứng chỉ riêng các vòng này gây lỗi production.

**Bốn nhóm vòng ở type.** Academy review/workbook ↔ `academyLearningService.ts`; nutrition presentation ↔ `NutritionWorkspace.tsx`; finance normalization ↔ service; PT normalization ↔ service. Chiều ngược dùng `import type`, nên không tạo cùng vòng require runtime. Nên chuyển type dùng chung sang module riêng khi sửa domain tương ứng, ưu tiên thấp hơn đọc dữ liệu và tính đúng.

**Các đầu mối lớn.** Graph ghi nhận `functions/index.js` nhập trực tiếp 49 file ứng dụng, `NutritionPageController.tsx` 32, `AuraApplication.tsx` 26. `src/types.ts` được 99 file tham chiếu trong metric import; `firebaseFunctions.ts` được 53 file tham chiếu. Đó là phạm vi ảnh hưởng rộng cần review kỹ; không mặc định tách file sẽ giảm cold start hoặc chi phí.

**Kết quả callable phải được diễn giải.** Audit tìm 565 tên export backend, 221 tên chưa nối được frontend, 145 tên có nhiều binding và 148 cặp tên giống base/Regional/V2. Các con số này không phải số function dư trên cloud. Nhiều binding là cùng handler được spread rồi export lại; Regional là đường điều phối vùng hoặc tương thích client cũ.

Bốn tên ứng viên chưa có export (`confirmSessionAttendanceRegional`, `recordSessionAttendanceRegional`, `bulkRecordSessionAttendanceRegional`, `correctTeachingShiftRegional`) xuất phát từ phân tích hai nhánh của wrapper. Trong mã thực tế, `regionalOperationNames` không chứa bốn tên gốc này nên wrapper dùng endpoint gốc. Đây là false positive của phân tích tĩnh, không phải bốn lỗi endpoint đã xác nhận.

Ba tên có nhiều service tham chiếu là `listAcademyCourses`, `listAcademyCoursesRegional` và `saveCourseDraftAtomic`. Các lượt đọc có payload catalog/chapter/draft/template khác nhau và đã đi qua shared read service. Chỉ hợp nhất khi payload, quyền và mục đích thực sự giống nhau; không thêm dedup/retry mù cho lệnh ghi draft.

## Đợt 0 Đo lường và hoàn thiện bản đồ luồng

**Ưu tiên P0, 1–2 ngày kỹ thuật; thu số liệu đại diện khoảng 7 ngày.** Không cần chờ đủ 7 ngày mới sửa lỗi tính đúng nếu phát hiện được.

1. Với mỗi màn hình quan trọng, tạo ma trận route → service → callable/trigger → collection → projection → consumer. Bổ sung cạnh tên chuỗi bằng `aura-callables.json`; xác minh source ở các wrapper động. Gắn owner và loại read/write/event/cron/queue.
2. Ghi số đo theo thao tác ở telemetry hiện có: release, role/scope đã ẩn định danh, refresh reason, số request, số query logic, số document trả về, response bytes, latency p50/p95, lần retry, cache hit và projection lag. Không ghi ảnh, nội dung dinh dưỡng, token hay một document telemetry cho mỗi lượt đọc.
3. Lấy Billing theo SKU và region; đối chiếu compute, Firestore, log, storage/network và AI. Số query/document đo phía ứng dụng không tự bằng đơn vị tính phí Firestore Enterprise.
4. Chạy cùng kịch bản cho lần mở đầu, mở lại, chuyển tab, tab ẩn 10 phút, resume và một mutation. Gắn correlation ID để phân biệt refresh cần thiết với refresh trùng.

**Nghiệm thu:** Có baseline cho Academy analytics, Finance details, danh bạ, lịch và scan ảnh; xác định được request đến từ thao tác nào. Chỗ chưa có dữ liệu ghi unknown, không ghi 0. Không thêm collector polling 5 giây hoặc log thành công quá dày.

## Đợt 1 Giảm tải đọc có bằng chứng

**Ưu tiên P1, 3–5 ngày kỹ thuật; tách thành hai PR nhỏ.**

| Hạng mục | Điều chỉnh cụ thể | Tiêu chí nghiệm thu |
| --- | --- | --- |
| Academy analytics | Thay hai listener enrollments/progress toàn cục bằng summary theo quyền và kỳ báo cáo. Chi tiết dùng cursor. Tái sử dụng aggregate sẵn có nếu đúng dữ liệu; chỉ tạo projection mới sau khi đối chiếu consumer | Mở dashboard summary không gắn hai listener raw 5.000; kết quả khớp fixture trên 5.000 record; thay đổi quyền không lộ cache |
| Độ mới báo cáo | Tổng hợp bằng event idempotent hoặc chốt cuối ngày tùy nhu cầu thực tế; hiện thời điểm cập nhật và nút làm mới. Reconcile theo phần bị ảnh hưởng khi sửa lùi ngày | Không scan toàn lịch sử trên mỗi source write; replay/out-of-order không nhân đôi số liệu; báo cáo sửa lùi ngày đúng |
| Finance details | Tách tab ledger/debt/contract; tìm học viên và hợp đồng theo server scope, cursor và filter. Dùng kết quả mutation để patch phần đang xem | Tab không dùng directory không query students/contracts; mở trang đầu chỉ tải giới hạn đã định; tổng tiền và quyền giữ nguyên |
| Danh bạ legacy | Kiểm tra rollout V2 thực tế. Nếu mọi consumer đã dùng V2 và có đủ thời gian tương thích, thu hồi adapter legacy từng nguồn | Không còn legacy listener từ route V2; fallback cần thiết vẫn có kiểm thử; không xóa vì graph thiếu cạnh |

**Kiểm thử:** UI theo vai trò/chi nhánh, phân trang, quyền đổi giữa lúc tải, offline/resume, transaction và rule tests liên quan. Query Explain đúng API Enterprise cho các query mới; Analyze có thực thi query thì chỉ dùng dataset/phạm vi được giới hạn.

**Đích đo đề xuất:** Trên fixture đủ lớn, giảm ít nhất 80% document trả về trong lần mở màn hình summary; số request lặp cùng scope sau một mutation không vượt số lần cần làm mới theo thiết kế. Đây là tiêu chí kiểm thử cần xác minh, không phải cam kết giảm 80% hóa đơn.

## Đợt 2 Chuẩn hóa client và gỡ phụ thuộc vòng

**Ưu tiên P1/P2, 3–5 ngày kỹ thuật; giữ riêng thay đổi frontend và backend.**

**Client Academy.** Giữ `callAcademyReadFunction` làm đường đọc chung. Đo rồi xử lý request giống hệt còn lặp; key phải bao gồm session, access revision, tên thao tác và toàn bộ payload có ý nghĩa. Cache có giới hạn dung lượng/TTL, xóa khi đổi phiên hoặc quyền. Không chia sẻ dữ liệu draft giữa user hay version. Hai đường `saveCourseDraftAtomic` giữ payload và idempotency riêng đến khi chứng minh cùng contract.

**Type boundary.** Chuyển type Academy, nutrition, finance, PT từ module UI/service sang file type thuần của từng domain. Xóa chiều import type ngược. Nghiệm thu: bốn nhóm vòng type được giải quyết, typecheck và test normalization/persistence đạt; không xuất hiện module Firebase mới trong bundle màn hình chỉ dùng type.

**Contract usage.** Tách quy tắc đếm buổi, canonical evidence và fingerprint vào `contract-usage-core` không phụ thuộc Firestore. Module projection gọi core; coordinator transaction gọi projection/core một chiều. Giữ đúng việc chuyển buổi, hết buổi trước ngày hết hạn, early handover và idempotency tái ký.

**Loyalty.** Tách reconciliation khỏi endpoint factory. Dashboard và membership gọi service điều phối được truyền dependency thay vì require ngược endpoint. Giữ receipt/ledger/budget và quyền hiện tại.

**Nghiệm thu backend:** Hai nhóm runtime cycle biến mất sau xác minh source; các test contract usage, renewal transaction, loyalty projection/ledger và emulator replay/concurrency đạt. Một event thử lại nhiều lần không phát sinh ghi nghiệp vụ trùng. Không tuyên bố tiết kiệm compute nếu chưa có số đo trước/sau.

## Đợt 3 Thu gọn entrypoint và vòng đời function

**Ưu tiên P2, 3–5 ngày kỹ thuật; cửa sổ quan sát riêng cho endpoint ít dùng.**

1. Tách `functions/index.js` theo domain bằng các bước nhỏ, giữ nguyên export name, region, trigger, runtime options, App Check, IAM và secret bindings. Ưu tiên handler đang có phần nghiệp vụ trực tiếp trong entrypoint. Chỉ giữ một cách đăng ký cho từng export sau khi đối chiếu binding và kiểm thử manifest.
2. Lập manifest endpoint canonical: tên/vùng, loại trigger, handler, consumer, trạng thái tương thích, owner, revision thực sự phục vụ và ngày xem xét tiếp theo. Regional/V2 được ghi rõ mục đích, không gộp chỉ vì tên gần giống.
3. Kết hợp static audit với inventory cloud, traffic vào serving revision, Scheduler/Eventarc/Cloud Tasks, admin scripts và phiên bản client đang còn dùng. `latest-created` chưa ready không đồng nghĩa function ngừng phục vụ.
4. Đánh giá candidate ít nhất 30 ngày hoạt động và đủ bao phủ lịch chạy hiếm; job chạy tháng cần cửa sổ dài hơn. Không có request trong một cửa sổ không đủ để xóa trigger theo sự kiện. Số liệu thiếu giữ trạng thái chưa kết luận.
5. Chuyển consumer sang endpoint chuẩn trước, quan sát, giảm cấu hình dư nếu phù hợp rồi mới đề xuất retire. Khi xóa phải có bản cấu hình khôi phục, source revision và kế hoạch rollback; không xóa queue còn job.

**Nghiệm thu:** Manifest trước/sau không mất endpoint đang dùng; deploy thử một nhóm nhỏ, xác minh source của revision đang nhận traffic, health/transport và quyền. Theo dõi cold start, lỗi và latency; rollback ngay khi sai contract/phân quyền. Không có thao tác xóa function nào được thực hiện trong lần cài Graphify này.

## Đợt 4 Tối ưu hàng đợi AI theo số đo

**Ưu tiên P2, 1–2 ngày kỹ thuật sau khi có baseline.** Giữ queue ảnh hiện tại; không triển khai lại phần đã hoàn thành.

- Theo dõi queue depth, tuổi job lâu nhất, thời gian chờ và xử lý p50/p95, 429, retry và chi phí mỗi kết quả thành công. Phân biệt giới hạn worker 8 với 12 suất provider dùng chung trong nutrition AI và trần tài khoản 15 đã kiểm tra ở dashboard trước đó.
- Kiểm tra 30 người gửi đồng thời bằng provider giả trước; thêm trường hợp retry, đóng/mở app, ảnh trùng, queue quá hạn và một job chậm. Đo cả AI Coach/meal review khi cùng dùng pool. Kiểm thử giả không chứng minh latency provider thật.
- Chỉ tăng concurrency khi còn quota thực tế và p95/429 cho phép. Xem xét fairness giữa ảnh và Coach nếu một loại chiếm hết suất; giữ tổng dưới hạn mức dùng chung, tính cả ứng dụng khác trên tài khoản.
- Không retry mù khi chưa rõ provider đã tính tiền; giữ receipt, fingerprint và việc đọc lại kết quả sau timeout. Xóa ảnh trung gian theo chính sách hiện có.

**Nghiệm thu:** Không nhân đôi kết quả/charge do retry của Aura, queue thoát sau burst, job lỗi được phân loại rõ. Mức p95 được chốt sau baseline thực tế, không hứa tất cả 30 ảnh hoàn thành trong một khoảng thời gian suy đoán.

## Đợt 5 Dùng Graphify lâu dài với chi phí thấp

**Ưu tiên P2, khoảng 1 ngày kỹ thuật sau pilot.** Dùng graph để truy vấn phạm vi ảnh hưởng trước PR; sau thay đổi chạy lại build khi cần. Không bật watcher theo từng lần gõ hoặc buộc mọi job CI dựng graph toàn repo.

Giai đoạn đầu để báo cáo ở chế độ hỗ trợ review. Sau khi xử lý false positive, có thể thêm workflow chạy thủ công hoặc theo thay đổi domain, cache môi trường cài đặt, giới hạn thời gian và lưu artifact ngắn hạn. Chỉ đặt gate cho quy tắc đã có độ chính xác tốt, ví dụ runtime cycle mới hoặc export bị mất; số node/community tăng không phải lý do chặn PR.

Graphify phục vụ truy vết cấu trúc; auditor của Aura nối endpoint dạng chuỗi; telemetry/Billing xác nhận tải và chi phí. Ba nguồn này bổ sung cho nhau. Không đưa graph hoặc dữ liệu vận hành lên Graphify Cloud trong phương án hiện tại.

## Thứ tự triển khai và kiểm soát thay đổi

| Thứ tự | Đầu ra | Điều kiện chuyển tiếp |
| --- | --- | --- |
| Đã làm | Cài Graphify, khóa version, build hai snapshot, wrapper kiểm tra scope/độ mới, baseline và kế hoạch | Dùng ngay trên máy phát triển |
| PR 1 | Ma trận luồng và telemetry bổ sung vừa đủ | Có số đo theo thao tác, không lộ dữ liệu nhạy cảm |
| PR 2 | Academy analytics đọc summary/chi tiết có cursor | Đúng số liệu, quyền và giảm tải trên cùng fixture |
| PR 3 | Finance details và kết thúc legacy còn thực sự hoạt động | Kiểm chứng rollout V2 và quyền trước khi thu hồi nguồn |
| PR 4–5 | Type boundary; contract usage và loyalty bỏ runtime cycle | Test nghiệp vụ/transaction/replay đạt |
| PR 6 | Entry point và manifest vòng đời endpoint | Serving revision, caller cũ và trigger được đối chiếu |
| PR 7 | Điều chỉnh queue AI nếu số đo yêu cầu; workflow graph tùy chọn | Có baseline, thử tải giả, rollout và rollback rõ ràng |

Ước lượng 12–21 ngày kỹ thuật cho toàn bộ backlog nếu mọi hạng mục vẫn cần sau đo lường; không cộng cửa sổ quan sát cloud vào thời gian lập trình. Phần có thể làm ngay và tác động trực tiếp nhất là PR 1–3. Không mở rộng sang làm mới giao diện hoặc gộp toàn bộ domain vào một PR.

Với mỗi PR runtime: chụp baseline → thay đổi nhỏ → test đúng miền → staging/emulator → rollout nhóm nhỏ → so sánh cùng scope → mở rộng. Nếu dữ liệu, quyền hoặc idempotency sai thì rollback ngay. Nếu thay đổi không giảm tải/độ trễ theo số đo, xem lại giả thuyết trước khi giữ thêm lớp cache/projection.

## Tài liệu sử dụng

- [Hướng dẫn Graphify của Aura](../../tools/graphify/README.md), gồm lệnh cài, build, query và xử lý graph cũ.
- [Graphify Labs](https://github.com/Graphify-Labs/graphify) và [CLI upstream](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/cli.py) là nguồn về công cụ; các nhận định nghiệp vụ dựa trên source Aura ở mốc đã nêu.
- Dùng kế hoạch này để tiếp nối các đợt tối ưu trước. Các hạng mục đã có ở main được đánh dấu giữ lại/đo tiếp, tránh triển khai trùng.
