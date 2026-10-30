# Kế hoạch tối ưu Aura dựa trên Graphify

Ngày 30/10/2026. Ưu tiên tiếp theo là giảm dữ liệu đọc ở các màn hình còn lấy tập lớn, đo chi phí theo thao tác và làm rõ phụ thuộc backend. Graphify đã được tích hợp vào công cụ phát triển để hỗ trợ truy vết trước mỗi thay đổi. Việc cài công cụ không tự làm giảm hóa đơn Firebase; mức tiết kiệm phải đo sau từng thay đổi nghiệp vụ.

## Bản triển khai cải thiện toàn app

Nhánh `codex/app-optimization-20261030` bổ sung báo cáo Academy và công nợ theo trang, cache tổng hợp dùng chung và trạng thái chưa đầy đủ; bỏ các listener toàn bộ enrollments/progress và nguồn danh bạ legacy trên màn tài chính. Hai vòng runtime hợp đồng/loyalty và các vòng type Academy/PT/finance/nutrition được tách mà giữ API tương thích. Mỗi endpoint mới kiểm tra quyền trước khi đọc cache.

Luồng tái ký giải thích kích hoạt/chuyển buổi và giữ yêu cầu chưa rõ kết quả để đối soát trước khi gửi lại. Ảnh AI hiện thời gian chờ không polling; số liệu chỉnh sửa đi cùng lần lưu bữa ăn hiện có. Onboarding đưa thói quen tùy chọn xuống sau thông tin cốt lõi, vẫn yêu cầu trả lời sức khỏe; buổi tập phân biệt bản nháp và xác nhận lưu. Báo cáo tiến độ có đường mở nhật ký/lịch để bổ sung ghi nhận.

Số đo mới lấy mẫu, không tạo thêm document cho mỗi read. Cách thu baseline, giới hạn quét 25.000 bản ghi mỗi nguồn, thứ tự phân trang công nợ và trình tự deploy nằm trong [hướng dẫn vận hành](../operations/OBSERVABILITY.md#operation-baseline-and-reporting-rollout-2026-10-30). Không coi bản triển khai local là đã rollout production hoặc đã đạt mức tiết kiệm cụ thể. Không xóa endpoint, mở các trang Academy đang ẩn, tăng quota AI hay bật Phòng tập ảo trong bản này.

[Snapshot sau điều chỉnh](../../tools/graphify/baselines/app-optimized-20261030.json) ghi nhận 562 file nguồn, không còn ứng viên vòng import trong phạm vi graph và 571 export backend (thêm bốn API báo cáo, không xóa endpoint cũ). Kiểm tra toàn bộ tại commit `d3de20a`: 1.620 test backend, 440 test frontend, 5 kịch bản báo cáo, 5 hồi quy xếp lịch và 33 kịch bản hành trình đạt; build và toàn bộ budget hiệu năng đạt. Bản đã hòa nhập các tab tài chính và điều chỉnh ghi nhận doanh thu của PR #79 và chính sách Bảo lưu còn nợ của PR #81; kiểm thử bổ sung đạt 74 kịch bản tài chính, 6 kịch bản cô lập nguồn đọc và 47 giao dịch backend liên quan. Tổng công nợ theo chi nhánh/nhóm hợp đồng được tính ở backend, không lấy tổng từ trang đang hiển thị. Phần đồng bộ PR #81 có 32 test báo cáo và 12 kiểm thử Firestore/cache đạt, bao gồm trả hết nợ, thanh toán dư, hủy và mở lại; phát hành backend trước web theo tám endpoint được ghi trong tài liệu vận hành. Kiểm thử Firestore xác nhận tổng hợp trên 11.002 bản ghi, cache dùng chung, snapshot nhất quán và làm mới sau thanh toán không nhận bản cũ công bố muộn. Thử tải queue 30 học viên với provider giả đạt; chưa suy ra tốc độ provider thật hay mức giảm hóa đơn.

Bản cuối đã hòa nhập thêm PR #82 về hủy/quyết toán hợp đồng: loại hợp đồng đã hủy khỏi mọi nhóm công nợ, giữ lịch sử tiền và đưa xét duyệt về hồ sơ học viên. Cache/cursor tài chính dùng v4. Nút đảo bút toán nhận quyền khả dụng theo từng trang từ backend, không suy luận từ danh sách công nợ chưa tải hết. Kiểm thử sau hòa nhập đạt 86 kịch bản tài chính, 5 báo cáo, 74 unit liên quan, 17 integration báo cáo/ledger/cache, 5 integration ledger sau sửa projection thiếu trạng thái, 56 Rules và 79 runtime/bảo mật; build và các budget đều đạt. Snapshot cuối gồm 7.493 node, 21.207 cạnh và không có ứng viên vòng import. Tám function của lượt đầu và ba cập nhật bổ sung (`listFinanceReceivables`, `listFinanceLedgerRegional`, `listFinanceLedger`) đã phát hành; tổng cộng 10 endpoint riêng biệt đạt kiểm tra serving. Web `200dcbf` đã lên cả hai tên miền, phân trang/lọc chi nhánh/làm mới/lịch sử tài chính đã kiểm tra trong phiên đăng nhập thực tế. [Bằng chứng phát hành](../../ops/app-optimization-release-20261030.json) bổ sung trạng thái production cho snapshot Graphify được tạo trước deploy. Rules của PR #82 đã khôi phục và đối chiếu hash trực tiếp trên named database.

## Trạng thái source và phát hành cập nhật ngày 30/10/2026

Ma trận source dùng **`8cdbbd2503b630e3ec4b605f345a6456825feac9`**, sau PR #90. Trạng thái phát hành được cập nhật thêm ngày 30/10/2026: PR #91–93 đã merge, backend liên quan đã phục vụ và **web SHA cuối đã được xác minh trên hai tên miền**. Phạm vi rollout này hoàn tất; kiểm tra hành trình trong phiên đăng nhập và số đo nghiệp vụ đại diện là bước riêng, không được suy ra từ release smoke.

| PR / phạm vi | Trạng thái đã xác minh | Giới hạn còn giữ |
| --- | --- | --- |
| [#87 — Tổng quan Push](https://github.com/tanton1/Dinh-d-ng-aura/pull/87) | Đã merge, phát hành `getPushAdminOverview` và web; đọc theo yêu cầu, cache dùng chung 60 giây, một read-only snapshot, phân trang và cap 25.000 mỗi nguồn; auth trước cache, số thiếu giữ unknown | Cold build vẫn đọc nguồn; TTL tính sau công bố không bảo đảm tuổi dữ liệu dưới 60 giây. Đây không phải queue gửi Push. [Thiết kế](PUSH_OVERVIEW_CACHE_2026-10-30.md) |
| [#88 — Telemetry thao tác](https://github.com/tanton1/Dinh-d-ng-aura/pull/88) | Đã merge; sáu endpoint gốc/Regional của Dashboard, Student 360 overview và renewal đã phát hành và kiểm tra revision/image phục vụ | Read/cache metrics chỉ bao phủ nơi có quan sát thật; không phải toàn bộ SDK/auth/rebuild. Mẫu smoke chưa phải cohort người dùng đại diện. [Phạm vi đo](../operations/OPERATION_TELEMETRY_COVERAGE_2026-10-30.md) |
| [#89 — Vòng đời đọc Academy](https://github.com/tanton1/Dinh-d-ng-aura/pull/89) | Đã merge và xác minh web; tách catalog khỏi invalidation summary, giữ scope phiên/quyền, gộp read, hoãn summary khi hidden và giữ force intent | Admin catalog vẫn có realtime listener; không tuyên bố mọi nguồn Academy dừng khi tab ẩn |
| [#90 — Manifest bằng chứng endpoint](https://github.com/tanton1/Dinh-d-ng-aura/pull/90) | Đã merge công cụ offline; capture SDK tại main 8cdbbd2 có 571 export, đối chiếu 569 ánh xạ cloud chính xác trong ba vùng | Công cụ không deploy/xóa endpoint; mọi dòng `deletionAllowed:false`. Owner, consumer động và mục đích tương thích vẫn cần review. [Hướng dẫn](../operations/ENDPOINT_EVIDENCE_MANIFEST.md) |
| [#91 — Telemetry event](https://github.com/tanton1/Dinh-d-ng-aura/pull/91) | Đã merge `f6c6b016668b56510f9dac53e4bed70145563ca5`; ba target `syncStaffOperationalSummary`, `syncSessionOperationalActions`, `syncStudent360OperationalActions` đạt health/traffic 100% lúc 13:06 UTC | Chỉ số read/write gắn vào ba handler này không đại diện mọi trigger hay Billing; cần quan sát nghiệp vụ sau phát hành |
| [#92 — Chặn Push thiếu audience](https://github.com/tanton1/Dinh-d-ng-aura/pull/92) | Đã merge `6469f8e2cdddb293e601601db8c014f9935417c2`; `dispatchPushBroadcast` phục vụ revision `dispatchpushbroadcast-00025-gup`, health/traffic 100% lúc 13:09 UTC; web cuối đã xác minh | Chặn vượt 1.000 selected ID, 2.000 source profiles cho all, 2.500 profiles cho category-directory, 2.000 device documents trước delivery; giữ draft. Không thay thế full server audience/queue/idempotency |
| [#93 — Vòng đời nguồn legacy](https://github.com/tanton1/Dinh-d-ng-aura/pull/93) | Đã merge `0b553397f8f185f226817b2eb345839c48ade940`; scope phiên/quyền/route và callback trả muộn của `DatabaseContext` đã kiểm thử; web cuối đã xác minh | Sửa vòng đời adapter không có nghĩa đã xác minh rollout V2 hoặc được xóa legacy |

CI và CodeQL của ba PR đều đạt; tree cuối `b6f096798c96d42266620be01467fcb4f6c2be68` khớp bản hòa nhập đã qua 136 kiểm tra tích hợp cùng build/budget. Lúc **2026-10-30T13:13:18Z**, [aurafitness-jet.vercel.app](https://aurafitness-jet.vercel.app) và [www.aurafitness.club](https://www.aurafitness.club) đều qua smoke kiểm SHA kỳ vọng `0b553397f8f185f226817b2eb345839c48ade940`, một lần thử mỗi tên miền; trạng thái Vercel thành công. Kiểm tra tiếp trong phiên đăng nhập thật đã xác nhận Dashboard, Push overview/history/composer và tổng quan tài chính cùng lựa chọn chi nhánh hiển thị; không gửi Push hoặc ghi giao dịch. Kiểm thử đổi tài khoản/quyền vẫn là bằng chứng từ fixture, không giả làm kiểm thử production. Sửa race của Student 360 overview đang là đợt riêng, chưa thuộc PR #91–93 hoặc trạng thái hoàn tất của bảng này.

Ma trận source năm miền ưu tiên đã có tại [READ_FLOW_MATRIX_2026-10-30](../operations/READ_FLOW_MATRIX_2026-10-30.md), với liên kết file/line cố định ở 8cdbbd2. Nó bao phủ Academy analytics, Finance details, danh bạ/Student 360, lịch quản trị và scan ảnh; **chưa phải inventory mọi trang**. Miền mã được xác định nhưng owner là người/nhóm vẫn unknown nếu chưa có xác nhận.

Toàn bộ kế hoạch vẫn chưa hoàn thành. Trạng thái theo từng đợt:

| Đợt | Đã xác minh | Phần tiếp tục |
| --- | --- | --- |
| 0 — Đo lường | Collector có giới hạn trang; cohort theo revision/vùng/auth/kết quả; ma trận năm miền, telemetry sáu callable đã phát hành; paired cold/warm fixture Academy/Finance đã đạt mục tiêu giảm document trả client | Mẫu sử dụng production đại diện, refresh/retry/role-scope và Billing theo SKU/region chưa đủ; không dùng p95 từ smoke làm SLO |
| 1 — Giảm đọc | Academy/Finance dùng summary/cursor; thông báo đọc theo tab, lịch sử cursor; overview Push có cache/snapshot | Full Push audience/queue còn mở; cold summary vẫn scan trong cap; adapter legacy chỉ thu hồi sau bằng chứng rollout và tương thích |
| 2 — Client/phụ thuộc | Hai runtime cycle, bốn type cycle và vòng đời summary/catalog Academy đã xử lý | Kiểm thử riêng callback session/authz và freshness của directory/Student 360; giữ key phiên/quyền/version; không làm lại PR #89 |
| 3 — Runtime/vòng đời | Weekly/background runtime và bốn reporting runtime có allowlist/parity; manifest offline đã merge | Chưa hoàn tất owner/handler/consumer động, caller cũ, health mọi revision và review retirement từng endpoint |
| 4 — Queue AI | Queue hiện có và kiểm thử giả burst 30 người; giữ worker 8/provider pool 12 | Chưa có mẫu queue đại diện, provider 429/cost/p95 hoặc kiểm thử trả phí; không tăng concurrency hoặc thêm key theo suy đoán |
| 5 — Graphify | Local AST/tooling đã khóa version; không dùng LLM/cloud | Workflow thủ công là lựa chọn sau pilot; chỉ thêm gate khi đã kiểm chứng độ chính xác |

Quan sát cũ 24 giờ kết thúc 2026-10-30T09:05:54.623Z có 8 lỗi AUTH chưa đăng nhập và 2 thành công AI Coach schema cũ. Cửa sổ bảy ngày `[2026-10-23T10:29:41.209Z, 2026-10-30T10:29:41.209Z)` có 57 mẫu và hoàn tất một trang log, nhưng thiếu telemetry chuẩn của ba handler trước PR #88. Hoàn tất pagination không chứng minh cohort đại diện hay đủ read/cache/queue metrics. Collector giữ unknown, tách revision/vùng/auth/kết quả; không tự gán một lỗi AUTH là smoke nếu nguồn không cung cấp. Chỉ các probe đã có bằng chứng phát hành mới được đánh dấu smoke.

**Billing vẫn chưa có input chi phí thực tế; người dùng đã xác nhận chưa có Billing export.** Một `datasets.list` chỉ đọc lúc 2026-10-30T12:07:22.102Z, giới hạn 100 và không tự phân trang, trả HTTP 200/0 dataset nhìn thấy trong `gen-lang-client-0815966909`; không có table rows hoặc BigQuery query job nào được chạy. Riêng kết quả API không loại trừ export ở dự án khác hoặc ngoài quyền xem. [Baseline cũ](../../ops/data-cost-seven-day-baseline-20261025.json) chỉ có Monitoring và trạng thái Billing đã liên kết. Muốn đo tiền cần báo cáo/export có usage window, service/SKU, region nếu có, currency, cost và credits; không cần API key mới. Không cộng Query/RunQuery aliases hoặc phân bổ chi phí cho callable chỉ theo tỷ lệ request.

**Vòng đời endpoint chưa đủ điều kiện retirement.** Metadata lúc 2026-10-30T11:42:10.250Z, trước đợt PR #91–93, có 569 function/service ánh xạ chính xác; 174 latest-created khác ready, với traffic quan sát ở revision ready trước đó. Đây là snapshot metadata, không phải kiểm tra container khỏe cho cả 569. Số 252 chỉ là lịch sử. Hai export source-only trong snapshot là `getPtTrainerAvailability` và `savePtTrainerAvailability` ở Singapore; các counterpart East của chúng đã deploy, không vì thế tự kết luận bản gốc dư. Cửa sổ activity 30 ngày có 304 service quan sát được (16 đủ 30 ngày, 288 thưa) và 265 không có series/unknown; toàn cửa sổ vẫn partial, không suy thành 265 service không hoạt động. Alias, 49 vị trí động của baseline và owner vẫn cần xác minh source/caller/trigger/client-version trước đề xuất xóa.

**Full Push delivery còn mở.** Tải đúng tab/history cursor và summary cache đã thực hiện; PR #92 chỉ chặn silent partial trước giao nhận. Cần tiếp tục [kế hoạch audience/delivery](PUSH_AUDIENCE_DELIVERY_PLAN_2026-10-30.md): chọn/preview người nhận phía server, snapshot xác nhận cố định, queue có receipt/idempotency, pagination thiết bị và kết quả đầy đủ. Không gửi riêng trang đang hiển thị, tự đổi nghĩa nhóm Academy, chia lượt gửi để vượt cap hoặc thay bằng vòng gửi đồng bộ không giới hạn. Browser category và client cũ gửi explicit IDs vẫn chưa chứng minh audience cố định/đầy đủ; lỗi sau admission vẫn có thể tạo kết quả giao nhận một phần.

## Mốc phân tích

Phân tích **ban đầu** dựa trên [main af311e9](https://github.com/tanton1/Dinh-d-ng-aura/tree/af311e9c144b2d2318fb0a4c751f1c1082c09c2d), gồm hàng đợi ảnh dinh dưỡng đã merge. Graph của các mốc lưu riêng. Các số cấu trúc bên dưới thuộc baseline đó; không diễn giải chúng là inventory live của main 8cdbbd2. Trạng thái triển khai hiện nay nằm ở bảng phía trên.

Graphify quét **539 file mã nguồn**, tạo **7.308 node và 20.681 cạnh** trong `src` và `functions`. Inventory callable bổ sung quét 416 file frontend và 123 file backend, tìm 348 vị trí gọi và 348 tên endpoint ứng viên. Có 49 vị trí động/tham số cần diễn giải thêm. Số liệu cấu trúc đầy đủ, commit và giới hạn phân tích nằm trong [baseline](../../tools/graphify/baselines/main-20261030.json).

Graph không bao gồm CSS, test, dữ liệu, script vận hành hay trạng thái cloud. Bảy file được extractor báo không tạo symbol, chủ yếu file dữ liệu sinh tự động và barrel export; vẫn cần kiểm tra bằng TypeScript/source khi đánh giá phạm vi. Các phát hiện về chi phí dưới đây là điểm cần đo, không phải kết quả Billing mới.

## Những phần đã tốt và cần giữ

| Luồng | Bằng chứng ở main | Hướng tiếp theo |
| --- | --- | --- |
| Lịch, workspace và delivery | Đã có revision listener, cơ chế hợp nhất refresh và tải theo scope; không còn các vòng gọi mạng 5 giây từng bị nêu | Kiểm tra chỉ tải lại đúng phần sau mutation; không thay bằng một vòng polling mới |
| Danh bạ học viên V2 | `DatabaseContext.tsx` tắt nguồn legacy khi cờ `admin-student-directory` bật | Xác minh rollout/traffic trước khi đầu tư thêm vào legacy |
| Finance overview, details và payroll | Nguồn chung đã thu hẹp; details dùng API scoped/cursor, route finance còn nhãn branches | Đo cold/warm và quyền, không triển khai lại việc bỏ directory students/contracts đã hoàn thành |
| Academy read | `academyReadService.ts` đã dùng single-flight theo session, payload và access revision; có cơ chế fallback read | Giữ boundary phân quyền; không tạo thêm cache chung vô hạn |
| Ảnh món ăn | Queue xử lý tối đa 8 job đồng thời, 12 suất dùng chung cho nutrition AI; theo dõi một job document | Đo queue wait và lỗi provider; không tạo key chỉ để chia cùng quota tài khoản |
| Timer giao diện | Phần lớn timer còn lại cập nhật giờ, ngày hoặc đếm thời gian tập | Không coi mọi `setInterval` là một lần đọc Firestore; service worker có kiểm tra update riêng mỗi 5 phút khi tab hiện |

Các giao dịch như xác nhận lịch, thanh toán, tái ký và trạng thái đang tập vẫn cập nhật ngay. Chốt cuối ngày phù hợp báo cáo tổng hợp; không áp dụng cho dữ liệu cần phản hồi tức thời.

## Phát hiện ban đầu và trạng thái hiện nay

**Nguồn đọc lớn ở baseline ban đầu — đã điều chỉnh.** Academy analytics từng gắn hai listener enrollments/progress 5.000; hiện consumer dùng summary theo quyền và cursor chi tiết, không còn đăng ký hai raw listener đó. Hàm legacy còn tồn tại không chứng minh route vẫn dùng. Cold summary vẫn scan có giới hạn ở backend và cần đo chi phí riêng; response nhỏ không đồng nghĩa source read nhỏ.

`DatabaseContext.tsx` còn adapter legacy cho một số route, mỗi nguồn directory tối đa 2.501 document để kiểm tra tràn. V2 tắt adapter ở route danh bạ khi bật; finance details đã bỏ students/contracts, route `admin-finance` chỉ còn branches. PR #93 sửa scope/callback của adapter đang còn cần, không phải quyết định retirement. Muốn thu hồi phải kiểm tra rollout V2, consumer thực, quyền, phiên bản client và thời gian tương thích.

**Hai nhóm vòng phụ thuộc backend — đã tách.** Vòng contract usage/projection và loyalty/projection/membership của baseline đã được tách core và service điều phối; các test giao dịch/replay giữ nguyên chính sách. Không triển khai lại việc tách, không suy ra tiết kiệm production chỉ từ việc hết vòng import.

**Bốn nhóm vòng ở type — đã tách.** Academy, nutrition presentation, finance và PT đã chuyển type dùng chung khỏi chiều import ngược. Baseline dùng `import type`, nên không được gọi đây là cùng loại lỗi với vòng require runtime. Giữ kiểm tra boundary khi domain thay đổi.

**Các đầu mối lớn.** Graph ghi nhận `functions/index.js` nhập trực tiếp 49 file ứng dụng, `NutritionPageController.tsx` 32, `AuraApplication.tsx` 26. `src/types.ts` được 99 file tham chiếu trong metric import; `firebaseFunctions.ts` được 53 file tham chiếu. Đó là phạm vi ảnh hưởng rộng cần review kỹ; không mặc định tách file sẽ giảm cold start hoặc chi phí.

**Kết quả callable phải được diễn giải.** Audit tìm 565 tên export backend, 221 tên chưa nối được frontend, 145 tên có nhiều binding và 148 cặp tên giống base/Regional/V2. Các con số này không phải số function dư trên cloud. Nhiều binding là cùng handler được spread rồi export lại; Regional là đường điều phối vùng hoặc tương thích client cũ.

Bốn tên ứng viên chưa có export (`confirmSessionAttendanceRegional`, `recordSessionAttendanceRegional`, `bulkRecordSessionAttendanceRegional`, `correctTeachingShiftRegional`) xuất phát từ phân tích hai nhánh của wrapper. Trong mã thực tế, `regionalOperationNames` không chứa bốn tên gốc này nên wrapper dùng endpoint gốc. Đây là false positive của phân tích tĩnh, không phải bốn lỗi endpoint đã xác nhận.

Ba tên có nhiều service tham chiếu là `listAcademyCourses`, `listAcademyCoursesRegional` và `saveCourseDraftAtomic`. Các lượt đọc có payload catalog/chapter/draft/template khác nhau và đã đi qua shared read service. Chỉ hợp nhất khi payload, quyền và mục đích thực sự giống nhau; không thêm dedup/retry mù cho lệnh ghi draft.

## Đợt 0 Đo lường và hoàn thiện bản đồ luồng

**Ưu tiên P0, 1–2 ngày kỹ thuật; thu số liệu đại diện khoảng 7 ngày.** Không cần chờ đủ 7 ngày mới sửa lỗi tính đúng nếu phát hiện được.

Trạng thái: collector và ma trận năm miền đã có; còn hoàn thiện mọi route/owner, cohort nghiệp vụ sau release và Billing. Khoảng bảy ngày phải đủ đại diện, không chỉ đủ thời gian hoặc hoàn tất pagination.

1. Với mỗi màn hình quan trọng, tạo ma trận route → service → callable/trigger → collection → projection → consumer. Bổ sung cạnh tên chuỗi bằng `aura-callables.json`; xác minh source ở các wrapper động. Gắn owner và loại read/write/event/cron/queue.
2. Ghi số đo theo thao tác ở telemetry hiện có: release, role/scope đã ẩn định danh, refresh reason, số request, số query logic, số document trả về, response bytes, latency p50/p95, lần retry, cache hit và projection lag. Không ghi ảnh, nội dung dinh dưỡng, token hay một document telemetry cho mỗi lượt đọc.
3. Lấy Billing theo SKU và region; đối chiếu compute, Firestore, log, storage/network và AI. Số query/document đo phía ứng dụng không tự bằng đơn vị tính phí Firestore Enterprise.
4. Chạy cùng kịch bản cho lần mở đầu, mở lại, chuyển tab, tab ẩn 10 phút, resume và một mutation. Gắn correlation ID để phân biệt refresh cần thiết với refresh trùng.

**Nghiệm thu:** Có baseline cho Academy analytics, Finance details, danh bạ, lịch và scan ảnh; xác định được request đến từ thao tác nào. Chỗ chưa có dữ liệu ghi unknown, không ghi 0. Không thêm collector polling 5 giây hoặc log thành công quá dày.

## Đợt 1 Giảm tải đọc có bằng chứng

**Ưu tiên P1, 3–5 ngày kỹ thuật; tách thành hai PR nhỏ.**

Trạng thái: Academy/Finance summary/cursor đã phát hành. Bảng dưới giữ contract nghiệm thu; không mở lại các hạng mục hoàn thành. Shared snapshot/cache hiện được dùng theo yêu cầu, không có aggregate trigger toàn lịch sử mới; full Push queue và retirement legacy là việc riêng còn mở.

| Hạng mục | Điều chỉnh cụ thể | Tiêu chí nghiệm thu |
| --- | --- | --- |
| Academy analytics | Thay hai listener enrollments/progress toàn cục bằng summary theo quyền và kỳ báo cáo. Chi tiết dùng cursor. Tái sử dụng aggregate sẵn có nếu đúng dữ liệu; chỉ tạo projection mới sau khi đối chiếu consumer | Mở dashboard summary không gắn hai listener raw 5.000; kết quả khớp fixture trên 5.000 record; thay đổi quyền không lộ cache |
| Độ mới báo cáo | Tổng hợp bằng event idempotent hoặc chốt cuối ngày tùy nhu cầu thực tế; hiện thời điểm cập nhật và nút làm mới. Reconcile theo phần bị ảnh hưởng khi sửa lùi ngày | Không scan toàn lịch sử trên mỗi source write; replay/out-of-order không nhân đôi số liệu; báo cáo sửa lùi ngày đúng |
| Finance details | Tách tab ledger/debt/contract; tìm học viên và hợp đồng theo server scope, cursor và filter. Dùng kết quả mutation để patch phần đang xem | Tab không dùng directory không query students/contracts; mở trang đầu chỉ tải giới hạn đã định; tổng tiền và quyền giữ nguyên |
| Danh bạ legacy | Kiểm tra rollout V2 thực tế. Nếu mọi consumer đã dùng V2 và có đủ thời gian tương thích, thu hồi adapter legacy từng nguồn | Không còn legacy listener từ route V2; fallback cần thiết vẫn có kiểm thử; không xóa vì graph thiếu cạnh |

**Kiểm thử:** UI theo vai trò/chi nhánh, phân trang, quyền đổi giữa lúc tải, offline/resume, transaction và rule tests liên quan. Query Explain đúng API Enterprise cho các query mới; Analyze có thực thi query thì chỉ dùng dataset/phạm vi được giới hạn.

**Đích đo đề xuất:** Trên fixture đủ lớn, giảm ít nhất 80% document trả về trong lần mở màn hình summary; số request lặp cùng scope sau một mutation không vượt số lần cần làm mới theo thiết kế. Đây là tiêu chí kiểm thử cần xác minh, không phải cam kết giảm 80% hóa đơn.

**Phần paired fixture đã xác minh:** [Phép đo Academy/Finance ngày 30/10/2026](../operations/REPORTING_READ_BUDGET_2026-10-30.md) dùng 5.501 bản ghi mỗi nguồn và trang 20, đạt mục tiêu giảm ít nhất 80% dòng document trả client so với full-list tổng hợp trên cùng fixture. Cold/warm tách số đọc nguồn, label, authorization và cache; tổng hợp khớp reference đầy đủ. Đây không phải phép đo UI cũ, token/transport Firebase, workload production đại diện hay Billing. Cặp đo không có mutation ở giữa; tiêu chí refresh sau mutation và các scope khác vẫn cần bằng chứng riêng.

## Đợt 2 Chuẩn hóa client và gỡ phụ thuộc vòng

**Ưu tiên P1/P2, 3–5 ngày kỹ thuật; giữ riêng thay đổi frontend và backend.**

Trạng thái: type/core cycles và lifecycle Academy đã hoàn thành ở các PR đã merge. Phần dưới là contract duy trì; chỉ sửa thêm khi có lỗi hoặc số đo mới, không coi việc tách lại module là backlog còn nguyên.

**Client Academy.** Giữ `callAcademyReadFunction` làm đường đọc chung. Đo rồi xử lý request giống hệt còn lặp; key phải bao gồm session, access revision, tên thao tác và toàn bộ payload có ý nghĩa. Cache có giới hạn dung lượng/TTL, xóa khi đổi phiên hoặc quyền. Không chia sẻ dữ liệu draft giữa user hay version. Hai đường `saveCourseDraftAtomic` giữ payload và idempotency riêng đến khi chứng minh cùng contract.

**Type boundary.** Chuyển type Academy, nutrition, finance, PT từ module UI/service sang file type thuần của từng domain. Xóa chiều import type ngược. Nghiệm thu: bốn nhóm vòng type được giải quyết, typecheck và test normalization/persistence đạt; không xuất hiện module Firebase mới trong bundle màn hình chỉ dùng type.

**Contract usage.** Tách quy tắc đếm buổi, canonical evidence và fingerprint vào `contract-usage-core` không phụ thuộc Firestore. Module projection gọi core; coordinator transaction gọi projection/core một chiều. Giữ đúng việc chuyển buổi, hết buổi trước ngày hết hạn, early handover và idempotency tái ký.

**Loyalty.** Tách reconciliation khỏi endpoint factory. Dashboard và membership gọi service điều phối được truyền dependency thay vì require ngược endpoint. Giữ receipt/ledger/budget và quyền hiện tại.

**Nghiệm thu backend:** Hai nhóm runtime cycle biến mất sau xác minh source; các test contract usage, renewal transaction, loyalty projection/ledger và emulator replay/concurrency đạt. Một event thử lại nhiều lần không phát sinh ghi nghiệp vụ trùng. Không tuyên bố tiết kiệm compute nếu chưa có số đo trước/sau.

## Đợt 3 Thu gọn entrypoint và vòng đời function

**Ưu tiên P2, 3–5 ngày kỹ thuật; cửa sổ quan sát riêng cho endpoint ít dùng.**

Trạng thái: bốn reporting runtime đã cô lập, manifest offline đã merge. Chưa hoàn tất lifecycle review, owner và dynamic consumers; không có quyết định xóa endpoint trong các PR này.

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

## Thứ tự tiếp tục và kiểm soát thay đổi

| Thứ tự | Đầu ra | Điều kiện chuyển tiếp |
| --- | --- | --- |
| Hoàn thành ở source / release đã ghi | Graphify/tooling, Academy/Finance scoped reads, type/core boundaries, reporting runtime, Push overview, telemetry callable, Academy lifecycle, manifest offline | Duy trì regression/parity; không làm lại chỉ vì kế hoạch ban đầu còn mô tả thiết kế |
| Rollout phạm vi đã hoàn tất | PR #91 event metrics, #92 Push admission, #93 legacy read lifecycle đã merge; backend live, web đúng SHA trên hai tên miền và smoke đọc trong phiên đăng nhập đã đạt | Tiếp tục quan sát nghiệp vụ đại diện; không coi rollout này là hoàn tất toàn kế hoạch |
| Tiếp theo có thể làm độc lập | Lifecycle/freshness Student 360; mở rộng ma trận/owner; đo workload production sau paired fixture Academy/Finance đã đạt | Có assertions về read/refresh, quyền và dữ liệu; chỉ số chưa quan sát giữ unknown |
| Tiếp theo của Push | Server audience preparation/preview, confirmation snapshot, queue và receipts | Audience đầy đủ, không đổi chính sách, thử replay/concurrency bằng transport giả trước rollout |
| Sau khi có input | Đối chiếu Billing SKU/region với cohort workload và provider usage | Không suy chi phí từ counters; không chạy query trả phí hoặc đổi export/IAM ngoài phạm vi được giao |
| Sau quan sát và review | Retirement legacy/endpoint và tuning AI concurrency | Caller cũ/trigger/queue/owner được xác nhận, đủ cửa sổ hiếm, có rollback; không xóa từ absence-of-series |
| Tùy chọn sau pilot | Workflow Graphify có giới hạn | Gate chỉ cho quy tắc đã xác minh độ chính xác, không bật watcher/log dày |

Ước lượng 12–21 ngày kỹ thuật là cho backlog ban đầu, không phải số ngày còn lại sau các PR đã hoàn thành. Phần còn lại cần ước lượng theo cohort, giới hạn dữ liệu và các consumer được xác minh; cửa sổ quan sát cloud tách khỏi thời gian lập trình. Không mở rộng sang làm mới giao diện hoặc gộp toàn bộ domain vào một PR.

Với mỗi PR runtime: chụp baseline → thay đổi nhỏ → test đúng miền → staging/emulator → rollout nhóm nhỏ → so sánh cùng scope → mở rộng. Nếu dữ liệu, quyền hoặc idempotency sai thì rollback ngay. Nếu thay đổi không giảm tải/độ trễ theo số đo, xem lại giả thuyết trước khi giữ thêm lớp cache/projection.

## Tài liệu sử dụng

- [Hướng dẫn Graphify của Aura](../../tools/graphify/README.md), gồm lệnh cài, build, query và xử lý graph cũ.
- [Graphify Labs](https://github.com/Graphify-Labs/graphify) và [CLI upstream](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/cli.py) là nguồn về công cụ; các nhận định nghiệp vụ dựa trên source Aura ở mốc đã nêu.
- Dùng kế hoạch này để tiếp nối các đợt tối ưu trước. Các hạng mục đã có ở main được đánh dấu giữ lại/đo tiếp, tránh triển khai trùng.
