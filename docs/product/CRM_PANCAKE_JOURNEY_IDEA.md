# CRM hành trình khách hàng: từ inbox page đến sau bán, đồng bộ tin nhắn qua Pancake

Ngày viết: 2026-11-08 · Trạng thái: **giai đoạn 1 đã dựng trong mã nguồn (chưa commit, chưa deploy), xem mục 0** · Phạm vi: Customer OS (lead → hợp đồng → Student 360 → giữ chân → tái ký → giới thiệu)

## 0. Giai đoạn 1 đã dựng (2026-11-08)

### Có gì

| Phần | Nội dung | Tệp |
| --- | --- | --- |
| Nhận tin | Webhook `pancakeWebhook` (asia-east1, public, khóa bí mật trong URL theo page, trả 200 ngay, chống trùng, TTL 30 ngày) → trigger `processCrmInboundEvent` đọc tin thật qua API Pancake rồi ghi CRM | `functions/crm-pancake-webhook.js`, `functions/crm-sync.js` |
| Đối soát, lịch sử, nhắc hạn | `runCrmMaintenanceScheduled` mỗi 5 phút: đối soát hội thoại thay đổi, phát hiện webhook im lặng, chạy tiếp backfill tối đa 90 ngày, báo bước quá hạn cho người nhận và quản lý chi nhánh | `functions/crm-sync.js` |
| Thắng khi có hợp đồng | Trigger `syncCrmCustomerFromContract`: hợp đồng mới của học viên có số điện thoại trùng khách CRM → giai đoạn Thắng, ngày ký, chủ chăm sóc (CSKH được giao, nếu không là PT chính), bước "Nhận bàn giao học viên mới", đổi thẻ Pancake | `functions/crm-sync.js` |
| Callable | `crmQuery` (hộp thư, pipeline, khách, tin nhắn, bước, nhân sự, giao CSKH, tìm học viên/báo giá, kết nối), `crmCommand` (giai đoạn, hồ sơ, giao Sales, ghi nhận, bước, lịch hẹn, nối học viên/báo giá, gộp, giao CSKH, xóa dữ liệu), `crmIntegrationCommand` (kết nối page, gắn thẻ/nhân viên, đổi khóa webhook, thay token, backfill, ngắt) | `functions/crm-functions.js`, `functions/crm-runtime.js` |
| Quyền | Vị trí mới `customer_care` (CSKH) và 8 quyền `crm.*` trong hợp đồng định danh; CSKH mang vai trò tương thích `sales` để không mở rules của coach | `shared/identity/identity-contract.json`, `functions/identity-access.js` |
| Giao diện | Trang "Hộp thư & CRM" cho admin (`admin-crm`) và nhân viên (`staff-crm`): Hộp thư, Pipeline, Chăm sóc (kèm giao học viên cho CSKH), Khách hàng, Kết nối Pancake; ngăn kéo hồ sơ khách có hội thoại chia mốc ngày ký. Menu, dock điện thoại của Sales và CSKH, vị trí CSKH ở trang Đội ngũ | `src/features/crm/*` |
| Dữ liệu | 12 collection `crm*` đóng với trình duyệt trong Rules; 24 index composite; TTL cho `crmInboundEvents`; tắt index các trường văn bản lớn | `firestore.rules`, `firestore.indexes.json` |
| Kiểm thử | 55 test (lõi, client, webhook, đồng bộ, callable, hợp đồng nguồn) trên bộ giả lập Firestore trong bộ nhớ; trang thử giao diện `tests/crm-ui` chạy bản demo | `functions/crm-*.test.js`, `npm run check:crm` |

### Khác với thiết kế bên dưới

- **Token page**: mã hóa AES-256-GCM rồi lưu ở `crmPancakePageSecrets` (Rules đóng hoàn toàn); khóa giải mã là secret `CRM_PANCAKE_TOKEN_KEY` trong Secret Manager. Không tạo một secret cho mỗi page vì Functions không có quyền quản trị Secret Manager.
- **Tin nhắn** nằm ở collection cấp cao `crmMessages` (lọc theo `conversationKey`), không phải subcollection. Không lưu trường `phase`: người chỉ xem sau bán được lọc theo `wonAt` lúc đọc, nên nối học viên muộn vẫn ẩn đúng phần tư vấn.
- **CSKH được giao** lưu ở `crmCareAssignments/{studentId}` thay vì trường trên `students`, để không kích hoạt các trigger chiếu Student 360.
- **Số điện thoại khách gõ trong chat** chỉ là gợi ý "Lưu số này"; Aura không tự nối hồ sơ theo số đó. Khi nhân viên lưu một số đã có ở hồ sơ khác, Aura đề xuất gộp.
- **Chỉ hội thoại inbox**; bình luận bài viết bị bỏ qua.
- **Không có nút "Tạo bộ thẻ AURA"** vì API công khai không có lệnh tạo thẻ; admin tạo thẻ trên Pancake rồi gắn với giai đoạn.
- **Bước bàn giao** khi có hợp đồng đầu tiên (thuộc giai đoạn 2 trong bảng 3.2) được làm sớm vì là điểm nối Sales → chủ chăm sóc.
- Thông báo quá hạn là thông báo trong app; chưa gửi push.

### Chưa làm (giai đoạn 2)

Mẫu bước chăm sóc và chuỗi onboarding tự động, bước PT qua Action Center, tab "Hành trình" trong Student 360, báo cáo phễu, thẻ hai chiều Pancake → Aura, sao chép ảnh đính kèm về Storage, job dọn dữ liệu theo thời hạn lưu.

### Triển khai lần đầu

1. Tạo secret **trước mọi lần deploy Functions** kể từ khi mã này vào `main`, vì Firebase kiểm tra mọi secret được khai báo: `firebase functions:secrets:set CRM_PANCAKE_TOKEN_KEY` với một chuỗi ngẫu nhiên từ 32 ký tự.
2. Deploy 24 index composite (`scripts/firebase-firestore-index-deploy.cjs`), rồi áp 6 field override gồm TTL bằng `node scripts/crm-firestore-config.cjs apply --confirm=…/crm:configure-retention` (script index chỉ tạo composite), rồi 7 function CRM có kiểm tra sức khỏe, rồi Firestore Rules, rồi push `main` cho Vercel. Database Enterprise không có index đơn trường mặc định, nên 5 trường loại trừ index đã ở trạng thái đúng; chỉ TTL cần bật.
   - **Phải deploy cả nhóm function định danh** cùng đợt: `getMyAccessContextOverflow`, `getMyAccessContext`, `listIdentityDirectoryRegional`, `listIdentityDirectory`, `assignStaffPositions`, `provisionStaffAccount`, `createAccountInvite`, `provisionStudentAccount`, `suspendAccountAccess`, `restoreAccountAccess`, `deleteUnusedStaffAccount`, `deleteMemberAccount`, `saveStaffOperationsProfile`, `saveStaffOperationsProfileRegional`, `applyDefaultTrainerSchedulingPolicy`. Quyền của người dùng do `getMyAccessContext*` tính từ bản `identity-contract.json` **đang chạy trên server** tại lúc đăng nhập; nếu chỉ deploy 7 function CRM thì admin không nhận được quyền `crm.*`, menu "Hộp thư & CRM" bị ẩn và không gán được vị trí CSKH (sự cố ngày 2026-11-08, sửa bằng cách deploy bổ sung nhóm này).
3. Gán vị trí CSKH cho nhân sự ở trang Đội ngũ Aura (kèm chi nhánh).
4. Admin mở Hộp thư & CRM → Kết nối Pancake: dán mã page và `page_access_token`, chọn chi nhánh, dán URL webhook hiện một lần vào cài đặt webhook của page trên Pancake, gắn thẻ và nhân viên, bấm lấy lại lịch sử.
5. Xác minh bằng tài khoản thật: payload webhook (lưu thô 30 ngày trong `crmInboundEvents.payloadJson`), tên trường của API hội thoại và tin nhắn, định dạng link mở hội thoại trên Pancake.

> **Quyết định Aura đã chốt ngày 2026-11-08**
> 1. Pancake đang dùng **gói trả phí** và **có webhook**. Webhook là đường nạp dữ liệu chính; polling chỉ để đối soát.
> 2. Aura **lưu toàn bộ nội dung tin nhắn**, không chỉ đoạn xem trước.
> 3. **Chủ chăm sóc sau bán** là nhân viên CSKH được giao học viên; nếu chưa giao, là **PT chính** của học viên.
> 4. Smax.ai được đánh giá ở mục 10 (giữ Pancake làm hộp thư, Smax chỉ là lớp bot tùy chọn từ giai đoạn 2); các quyết định còn mở nằm ở mục 11.

---

## 1. Mảnh ghép còn thiếu là gì

Aura hôm nay đã có gần đủ các "trạm" của hành trình khách hàng, nhưng chúng đứng rời nhau và không có trạm nào nối với nơi khách hàng thật sự xuất hiện lần đầu: **inbox của page** (Facebook, Instagram, Zalo OA, TikTok) đang được trả lời trên Pancake.

| Chặng | Có gì trong Aura | Thiếu gì |
| --- | --- | --- |
| Khách nhắn page | Không có gì. Sale đọc và trả lời trên Pancake, ghi nhớ bằng tay. | Không biết ai đã hỏi, ai chưa được trả lời, ai đang tư vấn tới đâu, nguồn khách từ đâu. |
| Tư vấn, báo giá | `salesLeads` (hồ sơ nháp: tên, SĐT, email, chi nhánh, sale phụ trách), `quotes`, `contractApprovals`. Sales Portal V2 mới chỉ làm báo giá. | Không có giai đoạn, không có việc cần làm tiếp, không có lịch hẹn trải nghiệm, không có lý do mất khách. Quyền `sales.leads.branch.view` đã khai báo nhưng chưa màn hình nào dùng. |
| Ký hợp đồng, tạo học viên | Hợp đồng, `provisionStudentAccount`, trả góp, VietQR, báo chuyển khoản. | Không có chuỗi onboarding (cài app, lịch rảnh, buổi đầu, hỏi cảm nhận). |
| Đồng hành trong gói | Student 360 (timeline, `studentCareActivities`: gọi, Zalo, ghi chú), Action Center (`operationalActions`, cờ còn tắt), nhắc nợ kỳ -3/0/+3 ngày, phát hiện 3 buổi vắng liên tiếp, Aura Club. | Các tín hiệu này chưa biến thành **bước chăm sóc có chủ, có hạn, có kịch bản**. Chưa có khái niệm "ai là người chăm sóc học viên này". |
| Tái ký | Pipeline tái ký đầy đủ: phân khúc, 7 giai đoạn, 8 mẫu tin Zalo, hoạt động, phê duyệt ưu đãi. | Đây là mẫu tốt nhất để mở rộng ra trước bán và sau bán. |
| Sau khi hết gói | Mã giới thiệu Aura Club. | Không có win-back, không xin phản hồi, không đo lý do rời. |
| Chuẩn thao tác | Trung tâm SOP: mỗi bước playbook có `say`, `avoid`, `done`, `escalate` và trường **`crm`** (ghi gì vào CRM). | Chưa có CRM để ghi, nên trường `crm` chỉ nằm trên giấy. |

Kết luận: mảnh ghép còn thiếu không phải một "trang CRM" nữa, mà là **một hồ sơ khách hàng xuyên suốt** nối Pancake với các trạm đã có, và **một bộ máy bước chăm sóc** biến SOP thành việc cụ thể cho từng người, mỗi ngày.

---

## 2. Nguyên tắc thiết kế

1. **Pancake vẫn là nơi chat.** Aura không viết lại hộp thư. Nhân viên đọc và trả lời trên Pancake; Aura nhận bản sao đầy đủ để biết ai, ở đâu trong hành trình, cần làm gì tiếp.
2. **Aura là nguồn sự thật về khách hàng và hành trình.** Giai đoạn, chủ phụ trách, bước chăm sóc, kết quả nằm ở Aura. Thẻ trên Pancake chỉ là tấm gương phản chiếu để sale thấy ngay trong hộp thư.
3. **Một khách hàng, nhiều kênh.** Một người có thể nhắn Facebook hôm nay, Zalo mai, rồi thành học viên. Hồ sơ `crmCustomers` gom tất cả, không tạo bản ghi theo kênh.
4. **Mọi bước chăm sóc đều trỏ về một bước SOP.** Nhân viên bấm "Xem SOP" là thấy đúng câu nên nói, điều nên tránh, tiêu chí xong. Trường `crm` của SOP trở thành tiêu chí hoàn tất bước.
5. **Ghi qua callable, không ghi trực tiếp Firestore từ trình duyệt**, có kiểm tra quyền, chi nhánh, revision và audit, giống trả góp và tái ký.
6. **Lưu toàn bộ hội thoại, nhưng ai thấy gì theo vai và theo mốc ký.** Sale, quản lý chi nhánh và admin thấy toàn bộ. PT chính và CSKH chỉ thấy phần hội thoại **từ ngày ký hợp đồng trở đi**; cuộc tư vấn giá trước đó không hiện với họ. Có thời hạn lưu và cách xóa theo yêu cầu khách (mục 5.4).
7. **Không gửi tin tự động cho tới khi có quy tắc rõ** (cửa sổ 24 giờ của Facebook, giờ yên lặng, tối đa 1 tin tự động/ngày, thẻ từ chối nhận tin).

---

## 3. Hành trình khách hàng và các giai đoạn

### 3.1 Trước bán (pipeline lead)

| Giai đoạn | Mã | Vào khi | Ra khi | SLA đề xuất |
| --- | --- | --- | --- | --- |
| Khách mới nhắn | `new_inbox` | Pancake báo hội thoại inbox mới hoặc khách cũ nhắn lại sau 90 ngày | Page đã trả lời lần đầu | Phản hồi đầu ≤ 5 phút trong giờ làm việc; 15 phút chưa trả lời → báo quản lý chi nhánh |
| Đủ thông tin | `qualified` | Có tên gọi, số điện thoại, mục tiêu tập, chi nhánh mong muốn | Có lịch hẹn hoặc đang tư vấn gói | 48 giờ không có hoạt động → bước "Theo dõi lần 2" |
| Đang tư vấn | `consulting` | Sale đã trao đổi gói, lịch, giá | Hẹn trải nghiệm hoặc gửi báo giá | 3 ngày không có hoạt động → nhắc |
| Đã hẹn trải nghiệm | `trial_booked` | Có ngày giờ, chi nhánh, PT đón | Khách đến hoặc không đến | Nhắc trước 1 ngày và 2 giờ; không đến → gọi lại trong 2 giờ |
| Đã trải nghiệm | `trial_done` | PT ghi nhận buổi đo chỉ số/tập thử | Gửi báo giá | Báo giá trong 24 giờ |
| Đã gửi báo giá | `quote_sent` | `quotes` tạo từ hồ sơ khách | Ký hợp đồng, đóng tiền | Nhắc nhẹ sau 2 ngày, lần 2 sau 5 ngày |
| Thắng | `won` | `contractApprovals` được duyệt, hợp đồng tạo, có phiếu thu | Chuyển sang hành trình sau bán | Tự động mở chuỗi onboarding và gán chủ chăm sóc |
| Mất | `lost` | Sale chọn lý do (giá, xa, hết nhu cầu, chọn nơi khác, không phản hồi…) | Vào nuôi lại | Win-back sau 30 và 90 ngày |
| Nuôi lại | `nurture` | Khách chưa sẵn sàng nhưng còn quan tâm | Nhắn lại hoặc chuyển `lost` | Chạm mỗi 14 ngày, tối đa 3 lần |

Các giai đoạn này mô phỏng đúng cách pipeline tái ký đang làm (`uncontacted → contacted → interested → quote_sent → follow_up → won/lost`), chỉ thêm hai trạm đặc thù của phòng tập là trải nghiệm và nuôi lại.

### 3.2 Sau bán (hành trình học viên)

**Chủ chăm sóc** = nhân viên CSKH được giao học viên (`students.careOwnerUid`); nếu học viên chưa được giao cho CSKH nào, chủ chăm sóc là PT chính của hợp đồng đang hiệu lực (`contracts.trainerId`). Bước liên quan trực tiếp buổi tập luôn thuộc PT chính dù có CSKH hay không. Khi đổi CSKH hoặc đổi PT, các bước đang mở được gán lại tự động.

| Pha | Mốc | Bước chăm sóc | Chủ | Kênh gợi ý |
| --- | --- | --- | --- | --- |
| Bàn giao | D0 (ký) | Sale bàn giao: mục tiêu, lịch rảnh, lưu ý sức khỏe; tạo học viên và tài khoản app; gửi hướng dẫn đăng nhập | Sale → chủ chăm sóc | Pancake/Zalo |
| Onboarding | D1 | Chào mừng, xác nhận lịch tuần đầu, giới thiệu PT | Chủ chăm sóc | Zalo |
|  | Sau buổi 1 | Hỏi cảm nhận buổi đầu, dặn dinh dưỡng cơ bản | PT chính | Zalo |
|  | Sau buổi 3 | Chốt mục tiêu 4 tuần, chụp ảnh tiến độ mốc 0 | PT chính | App (ảnh tiến độ) |
|  | D14 | Gọi hỏi hài lòng, mời tham gia Aura Club | Chủ chăm sóc | Gọi |
| Đồng hành | Mỗi 10 buổi | Đo lại chỉ số, tổng kết tiến độ, điều chỉnh giáo án | PT chính | App |
|  | Trước kỳ trả góp -3/0/+3 | Nhắc nợ kỳ (đã có); +3 ngày chưa trả → bước "Gọi nhắc thanh toán" | Hệ thống → chủ chăm sóc | Push, gọi |
|  | Vắng 2 buổi liên tiếp | Nhắn hỏi thăm; 3 buổi → gọi, cảnh báo nguy cơ nghỉ | PT chính → chủ chăm sóc, quản lý | Zalo, gọi |
|  | Không đặt lịch 7 ngày | Bước "Kéo lại nhịp tập" | Chủ chăm sóc | Zalo |
|  | Sinh nhật, mốc giảm cân | Lời chúc, kudos Aura Club | Hệ thống | Push |
| Tái ký | Hết hạn -30 ngày hoặc hết buổi | Mở hồ sơ tái ký (đã có pipeline); CRM hiển thị và nối, chủ chăm sóc được gắn làm người hỗ trợ | Sale | Theo pipeline tái ký |
| Sau gói | Hết hạn +7 ngày, chưa tái ký | Xin phản hồi ngắn, lý do rời | Chủ chăm sóc | Zalo |
|  | +30, +90 ngày | Win-back có ưu đãi quay lại | Sale | Pancake/Zalo |
| Giới thiệu | Sau buổi 10 hoặc khi khen | Gợi mã giới thiệu Aura Club | PT chính | App |

### 3.3 Kịch bản xuyên suốt (ví dụ)

1. 20:14, chị Lan nhắn page Facebook: "Gói giảm mỡ 3 tháng bao nhiêu em?". Pancake nhận tin và bắn webhook sang Aura.
2. Trong vài giây Aura tạo `crmCustomers/lan…` ở `new_inbox`, nguồn `facebook / page Aura Q7`, lưu tin nhắn vào `crmMessages`, mở bước "Phản hồi inbox trong 5 phút" cho sale trực ca (theo người được gán trên Pancake, hoặc round-robin của Pancake).
3. Sale trả lời trên Pancake, hỏi tên, số điện thoại, mục tiêu. Webhook báo tin của page → Aura khép bước, ghi `firstResponseSeconds = 160`.
4. Sale bấm "Đủ thông tin" trong Aura (hoặc gắn thẻ "AURA: Đủ thông tin" trên Pancake). Aura gắn thẻ ngược lại, mở bước "Hẹn trải nghiệm".
5. Hẹn thử 19:00 thứ Tư, chi nhánh Q7, PT Minh đón. Aura tạo lịch hẹn, bước "Nhắc trước 1 ngày", "Nhắc trước 2 giờ".
6. Khách đến, PT ghi nhận buổi đo InBody trong app → `trial_done`, bước "Gửi báo giá trong 24 giờ". Sale tạo báo giá từ hồ sơ khách (tên, SĐT điền sẵn) → `quote_sent`.
7. Khách đồng ý, đóng cọc, hợp đồng được duyệt → `won`, `wonAt` được ghi. Aura tạo học viên, nối `studentId`, gán chủ chăm sóc (CSKH chi nhánh Q7 nếu quản lý đã giao, nếu không là PT Minh), mở chuỗi D0, D1, buổi 1, buổi 3, D14.
8. Tháng thứ hai, chị Lan vắng 3 buổi. Action Center đã có cảnh báo; CRM biến nó thành bước "Gọi hỏi thăm" cho PT Minh với kịch bản SOP "Học viên vắng", đồng thời báo chủ chăm sóc. Kết quả gọi ghi vào timeline Student 360.
9. Tháng thứ ba, kỳ trả góp đến hạn: nhắc nợ như hiện tại; chị Lan trả qua VietQR, đính ảnh biên lai. Hết hạn -30 ngày, pipeline tái ký mở hồ sơ, CRM hiển thị cùng một dòng thời gian, và chị Lan nhắn page hỏi gói mới thì tin đó hiện ngay trong hồ sơ.

---

## 4. Mô hình dữ liệu (Firestore, chỉ ghi qua callable)

| Collection | Vai trò | Trường chính |
| --- | --- | --- |
| `crmCustomers/{customerId}` | Hồ sơ khách hợp nhất, một người một bản ghi | `displayName`, `phones[]` (chuẩn hóa E.164), `emails[]`, `branchId`, `stage`, `stageChangedAt`, `ownerUid` (sale), `careOwnerUid`, `careOwnerKind` (`customer_care`/`trainer`), `source {platform, pageId, adId?, firstContactAt}`, `studentId?`, `wonAt?`, `salesLeadId?`, `quoteIds[]`, `contractIds[]`, `renewalCaseId?`, `tags[]`, `goal`, `preferredSlots`, `lastInboundAt`, `lastOutboundAt`, `firstResponseSeconds`, `nextStepAt`, `lostReason?`, `consent {marketing, zns}`, `revision` |
| `crmChannelLinks/{platform_pageId_psid}` | Nối một hội thoại/khách Pancake với một `customerId` | `pageId`, `conversationId`, `pageCustomerId`, `platform`, `pancakeName`, `avatarUrl`, `phoneHints[]`, `customerId`, `linkedBy` (`auto_phone`, `manual`, `quote`, `student`), `linkedAt` |
| `crmConversations/{conversationId}` | Metadata hội thoại | `pageId`, `customerId`, `platform`, `assigneeUids[]`, `pancakeTags[]`, `unread`, `firstMessageAt`, `lastMessageAt`, `lastMessageFrom` (`customer`/`page`), `preview` (≤ 200 ký tự), `messageCount`, `backfillStatus`, `pancakeUrl`, `updatedAt` |
| `crmMessages/{conversationId}/items/{messageId}` | **Toàn bộ tin nhắn** | `pancakeMessageId`, `direction` (`in`/`out`), `senderKind` (`customer`/`page`/`system`), `senderPancakeUserId?`, `senderUid?` (nhân viên Aura đã map), `text`, `attachments[] {type, mime, pancakeUrl, storagePath?, width?, height?}`, `sentAt`, `platform`, `source` (`webhook`/`poll`/`backfill`), `phase` (`presale`/`postsale`, so `sentAt` với `customer.wonAt`), `deletedAt?` |
| `crmCareTemplates/{templateId}` | Mẫu bước chăm sóc, admin sửa được | `name`, `stage` hoặc `trigger` (`stage_enter`, `contract_start_offset`, `session_count`, `no_show_streak`, `inactive_days`, `installment_overdue`, `contract_end_offset`, `contract_ended_offset`), `offsetDays`, `ownerRole` (`sales`, `care_owner`, `trainer`, `branch_manager`), `channel`, `sopCode`, `sopStepIndex`, `messageTemplate`, `slaMinutes`, `active`, `branchScope[]` |
| `crmCareSteps/{stepId}` | Bước chăm sóc cụ thể cho một khách | `customerId`, `studentId?`, `templateId`, `title`, `dueAt`, `status` (`open`, `done`, `skipped`, `overdue`), `ownerUid`, `ownerRole`, `channel`, `sopCode`, `outcome`, `note`, `completedAt`, `completedBy`, `escalatedAt?` |
| `crmActivities/{activityId}` | Nhật ký trước bán (gọi, tin nhắn, đổi giai đoạn, phân công, hẹn) | `customerId`, `type`, `outcome`, `note`, `actorUid`, `actorName`, `channel`, `createdAt`. Khi đã có `studentId`, ghi thêm `studentTimelineEvents` để Student 360 thấy chung một dòng thời gian |
| `crmAppointments/{appointmentId}` | Lịch hẹn trải nghiệm | `customerId`, `branchId`, `startAt`, `trainerUid?`, `kind` (`trial`, `consult`, `inbody`), `status` (`booked`, `attended`, `no_show`, `cancelled`), `remindersSent[]` |
| `crmPancakePages/{pageId}` | Cấu hình và trạng thái đồng bộ từng page | `name`, `platform`, `branchId`, `enabled`, `tokenSecretName`, `webhookSecretName`, `webhookLastReceivedAt`, `webhookSuspectedDown`, `reconcileCursor`, `lastReconcileAt`, `lastError`, `tagMap {stage → tagId}`, `staffMap {pancakeUserId → uid}` |
| `crmInboundEvents/{eventId}` | Hộp sự kiện đầu vào, idempotent, lưu payload thô | `source` (`webhook`/`poll`), `topic`, `pageId`, `conversationId`, `messageId?`, `payload`, `receivedAt`, `processedAt`, `error?`; TTL 30 ngày |
| `students/{studentId}.careOwnerUid` | Trường mới trên học viên | Quản lý chi nhánh giao CSKH qua callable `assignStudentCareOwner`; `crmCustomers.careOwnerUid` phản chiếu |

Quy tắc nối khách (dedupe):

- Số điện thoại chuẩn hóa trùng → nối tự động, ghi `linkedBy: auto_phone`.
- Tạo báo giá hoặc hồ sơ nháp từ màn hình khách → nối ngay.
- Hợp đồng duyệt → `customer.studentId` và `wonAt` được gán trong cùng giao dịch với tạo học viên; toàn bộ tin từ `wonAt` trở đi mang `phase: postsale`.
- Không có số điện thoại → hồ sơ tạm theo kênh; khi khách cho số, Aura đề xuất gộp; nhân viên xác nhận, lịch sử hai bên nhập về một (giữ cả hai `channelLinks`).
- Khách cũ nhắn lại: `channelLink` đã có → không tạo khách mới, chỉ mở bước "Khách cũ nhắn lại" cho chủ chăm sóc (nếu đang là học viên) hoặc sale (nếu đã `lost`).

Quyền truy cập (mở rộng ma trận hiện có):

| Vai trò | Thấy gì | Làm gì |
| --- | --- | --- |
| Sales | Khách của mình + khách chi nhánh (`sales.leads.branch.view`); toàn bộ hội thoại | Đổi giai đoạn, ghi hoạt động, hẹn, tạo báo giá, nhận bước trước bán |
| **CSKH** (vị trí mới `customer_care`) | Học viên được giao; hội thoại từ ngày ký; Student 360 ở mức chăm sóc | Hoàn tất bước sau bán, ghi hoạt động, nhận bàn giao, đề xuất tái ký |
| PT chính / Coach online | Bước sau bán của học viên được gán; hội thoại từ ngày ký; không thấy tư vấn trước bán | Hoàn tất bước, ghi kết quả |
| Quản lý chi nhánh | Toàn chi nhánh, toàn bộ hội thoại | Phân công sale và CSKH, SLA, lý do mất, báo cáo |
| Admin | Tất cả | Cấu hình Pancake, mẫu bước, mapping thẻ, thời hạn lưu, xem audit |

Capability mới: `crm.customers.branch.view`, `crm.customers.self.manage`, `crm.messages.presale.read`, `crm.messages.postsale.read`, `crm.steps.assigned.manage`, `crm.care_owner.assign`, `crm.integration.manage`, `crm.message.send` (giai đoạn 3). Vị trí `customer_care` thêm vào `staffPositions` của `shared/identity/identity-contract.json` với `dashboard.view`, `crm.customers.branch.view`, `crm.steps.assigned.manage`, `crm.messages.postsale.read`, quyền chăm sóc Student 360 cho học viên được giao. Toàn bộ `crm*` chặn đọc/ghi từ trình duyệt trong Firestore Rules, giống `installmentPaymentClaims`.

---

## 5. Đồng bộ với Pancake: cách làm kỹ thuật

### 5.1 Những gì API Pancake cho phép (đã kiểm tra 2026-11-08)

Trang tài liệu chính thức `docs.pancake.vn` hôm nay trả chứng chỉ TLS hết hạn nên không đọc trực tiếp được; các điểm dưới đây tổng hợp từ kết quả tìm kiếm trên trang đó và ba tài liệu bên thứ ba mô tả cùng API. Cần đối chiếu lại bằng tài khoản Pancake của Aura trước khi code.

- **Token**: mỗi page có `page_access_token` **không hết hạn** cho đến khi bị tạo lại; tạo bằng `POST https://pages.fm/api/v1/pages/{page_id}/generate_page_access_token` với user token của tài khoản có quyền ADMINISTER trên page. Token truyền bằng query `page_access_token`.
- **Hội thoại**: `GET https://pages.fm/api/public_api/v2/pages/{page_id}/conversations` lọc theo `type=INBOX`, `tags`, `since`/`until` (Unix giây, khoảng tối đa khoảng 1 tháng), trả 60 hội thoại mỗi lần, mới nhất trước, phân trang bằng `last_conversation_id`. Mã hội thoại inbox dạng `<page_id>_<customer_psid>`.
- **Tin nhắn**: `GET .../v1/pages/{page_id}/conversations/{conversation_id}/messages` (phân trang bằng `current_count`); `POST` cùng đường dẫn với `action=reply_inbox` và `message` hoặc `content_ids` (media tải lên trước qua `POST .../upload_contents`).
- **Thẻ**: `GET .../pages/{page_id}/tags`; `POST .../conversations/{conversation_id}/tags` với `action: add|remove`, `tag_id`.
- **Phân công, đã đọc**: `POST .../conversations/{conversation_id}/assign` (`assignee_ids` là UUID nhân viên Pancake), `.../read`, `.../unread`; `GET .../pages/{page_id}/users` để lấy danh sách nhân viên.
- **Khách hàng**: `GET .../pages/{page_id}/page_customers`, `PUT .../page_customers/{id}` (`changes {name, gender, birthday…}`), ghi chú `POST/PUT/DELETE .../page_customers/{id}/notes`.
- **Thống kê**: `/statistics/pages`, `/statistics/tags`, `/statistics/users`, `/statistics/ads`, `/statistics/customer_engagements`.
- **Giới hạn**: 5 request/giây/page; lỗi thường trả HTTP 200 với `success: false` (mã 102 = token sai hoặc đã bị tạo lại); HTTP 429 khi vượt tốc độ.
- **Nền tảng**: Facebook, Instagram, Zalo, WhatsApp, TikTok. Facebook và Instagram chỉ cho trả lời tự do trong 24 giờ kể từ tin cuối của khách.
- **Webhook** (Aura xác nhận gói trả phí có): tài liệu công khai mình tìm được chỉ liệt kê các **chủ đề sự kiện** `messaging` (tin nhắn), `conversation` (hội thoại), `post` (bài viết/bình luận), `subscription`, `connect_status` (trạng thái kết nối page), cùng các hướng dẫn "Webhook bị tạm ngưng do tỷ lệ lỗi cao" và "Bật lại webhook". Cấu trúc payload, cách xác thực và cơ chế gửi lại **chưa có trong tài liệu công khai**: giai đoạn 0 sẽ đăng ký một endpoint thử để ghi lại payload thật của từng chủ đề trước khi viết bộ xử lý.

### 5.2 Kiến trúc

```text
Khách ──► Facebook / Zalo OA / Instagram / TikTok ──► Pancake (hộp thư, thẻ, phân công)
                                                        │  ▲
                              (A) webhook: messaging,   │  │ (C) gắn thẻ, phân công, ghi chú
                                  conversation          │  │     (giai đoạn 3: gửi tin mẫu)
                              (B) poll đối soát 10 phút ▼  │
                                        Cloud Functions: pancakeWebhook (onRequest) → crmInboundEvents
                                                        │
                                   processCrmInboundEvent (trigger onCreate, idempotent)
                                                        │
        crmMessages · crmConversations · crmChannelLinks · crmCustomers · crmCareSteps · crmActivities
                                                        │
                      callable đọc/ghi có quyền ──► Aura web (Hộp thư & CRM, Student 360, Việc hôm nay)
                                                        │
                      onSchedule: SLA, bước đến hạn, nhắc hẹn, đối soát, dọn dữ liệu ──► push + thông báo
```

- **(A) Webhook là đường chính.** Function HTTPS `pancakeWebhook` là endpoint `onRequest` đầu tiên của dự án (toàn bộ hiện là `onCall`). Đường dẫn chứa một secret riêng cho từng page (`/pancake/{pageId}/{webhookSecret}`), kiểm tra thêm chữ ký hoặc token nếu payload thật cho thấy Pancake có gửi. Function chỉ làm ba việc rồi trả 200 ngay: kiểm tra secret, ghi payload thô vào `crmInboundEvents` với `eventId = sha256(pageId, topic, conversationId, messageId hoặc updatedAt)`, cập nhật `webhookLastReceivedAt`. Trả 200 nhanh và ổn định là bắt buộc vì Pancake tạm ngưng webhook khi tỷ lệ lỗi cao; mọi lỗi xử lý nghiệp vụ nằm ở bước sau, không làm webhook thất bại.
- **Bộ xử lý** chạy bằng trigger `onCreate` trên `crmInboundEvents`: tìm `crmChannelLinks`, tạo hoặc cập nhật khách, ghi tin vào `crmMessages` (lấy thêm qua API `messages` nếu payload thiếu nội dung), cập nhật `crmConversations`, tính `firstResponseSeconds`, mở hoặc khép bước "Phản hồi inbox", áp quy tắc thẻ → giai đoạn. Chạy lại sự kiện cũ không nhân đôi dữ liệu.
- **(B) Polling chỉ để đối soát.** `reconcilePancakePagesScheduled` chạy mỗi 10 phút, với mỗi page lấy hội thoại có `since = lastReconcileAt - 15 phút`, so với `crmConversations`; hội thoại nào có `updated_at` mới hơn bản Aura giữ thì kéo tin còn thiếu. Nếu đối soát tìm thấy tin mới trong khi webhook im lặng quá 15 phút, đặt `webhookSuspectedDown = true` và báo admin (có thể webhook đã bị Pancake tạm ngưng, cần bật lại). Một page bận 300 hội thoại/ngày chỉ tốn vài request mỗi lần chạy, xa dưới 5 request/giây.
- **Backfill khi kết nối page**: job có cursor, chạy lại được, kéo 90 ngày hội thoại và toàn bộ tin nhắn của chúng, tôn trọng 5 request/giây, ghi `backfillStatus` từng hội thoại. Hồ sơ khách tạo từ backfill vào giai đoạn `new_inbox` nhưng gắn cờ `fromBackfill` để không mở bước SLA cho chuyện đã cũ.
- **Phản chiếu sang Pancake (C)**: đổi giai đoạn ở Aura → gắn thẻ `AURA: <giai đoạn>` và gỡ thẻ giai đoạn cũ; phân công ở Aura → `assign` trên Pancake theo `staffMap`. Chiều ngược lại, sự kiện `conversation` có thẻ thuộc `tagMap` → đổi giai đoạn ở Aura, ghi hoạt động `stage_change` với tác nhân "Pancake". Xung đột xử lý theo thời gian mới hơn; mọi lần đổi đều có hoạt động nên không mất dấu.
- **Bí mật**: `page_access_token` là token quyền quản trị page, lưu trong Secret Manager bằng `defineSecret` như `OPENROUTER_API_KEY`, không bao giờ đưa về trình duyệt; Firestore chỉ giữ `tokenSecretName`. Mã 102 → đặt page sang `needs_reconnect`, thông báo admin. Secret webhook cũng xoay được từ màn cài đặt.
- **Giờ Việt Nam** cho mọi mốc ngày (`Asia/Ho_Chi_Minh`), như trả góp.

### 5.3 Lưu toàn bộ tin nhắn: hệ quả thiết kế

- **Đọc**: màn hồ sơ khách và tab Hành trình đọc `crmMessages` qua callable có cursor (50 tin/lần, mới nhất trước), lọc theo `phase` đúng với quyền người xem. Hộp thư tự làm mới mỗi 30 giây; không dùng listener Firestore từ trình duyệt vì rules chặn đọc trực tiếp.
- **Tệp đính kèm**: giai đoạn 1 lưu `pancakeUrl` và loại tệp. Đường dẫn ảnh của Facebook thường hết hạn, nên giai đoạn 2 sao chép ảnh về Storage `crm-attachments/{pageId}/{conversationId}/{messageId}` (giới hạn 8 MB mỗi ảnh, bỏ qua sticker và video), xem bằng signed URL như ảnh biên lai trả góp.
- **Chi phí**: với khoảng 300 hội thoại và 3.000 tin mỗi ngày, số ghi Firestore tương ứng dưới 1 USD/tháng; ảnh sao chép về Storage là phần chi phí đáng kể hơn và tính riêng khi quyết định ở giai đoạn 2.
- **Ai thấy gì**: `phase` quyết định PT chính và CSKH thấy từ tin nào. Trường hợp học viên tái ký thì `wonAt` giữ mốc ký đầu tiên; mọi tin sau đó đều là sau bán.
- **Tìm kiếm**: giai đoạn 1 tìm theo tên, số điện thoại, thẻ, giai đoạn; tìm toàn văn nội dung tin để giai đoạn 3 (cần chỉ mục riêng, không làm trên Firestore).

### 5.4 Thời hạn lưu và quyền của khách

- Đề xuất: khách `lost`/`nurture` không hoạt động 24 tháng → ẩn danh hồ sơ (giữ số liệu phễu, xóa tên, số, nội dung tin); học viên → giữ trong thời gian hợp đồng và 24 tháng sau hợp đồng cuối. Job dọn chạy hàng tháng, có báo cáo trước khi xóa. Con số là đề xuất, Aura chốt ở mục 10.
- Khách yêu cầu xóa dữ liệu → callable `eraseCrmCustomer` xóa tin nhắn, tệp, hồ sơ và ghi một bản ghi audit không chứa dữ liệu cá nhân. Đây là nghĩa vụ theo quy định bảo vệ dữ liệu cá nhân hiện hành, nên nên có ngay từ giai đoạn 1 thay vì làm sau.
- `crmInboundEvents` (payload thô) TTL 30 ngày.

### 5.5 Gửi tin từ Aura (để giai đoạn 3)

- Chỉ gửi **mẫu đã duyệt** (giống 8 mẫu tái ký), có biến `{{customerName}}`, `{{staffName}}`, `{{branchName}}`, `{{appointmentAt}}`.
- Facebook/Instagram: chỉ gửi khi `lastInboundAt` trong 24 giờ; ngoài cửa sổ, nút chuyển thành "Mở Pancake" để nhân viên dùng tin nhắn mẫu/tag của Pancake. Zalo OA: theo cửa sổ tư vấn của Zalo; ZNS trả phí là chuyện khác, không đi qua đường này.
- Giờ yên lặng 21:00–08:00, tối đa 1 tin tự động/khách/ngày, thẻ "Không nhận tin" chặn tất cả.
- Mỗi lần gửi tạo `crmActivities` loại `message_out` và chính tin đó xuất hiện trong `crmMessages` qua webhook như mọi tin page gửi.

---

## 6. Giao diện

### 6.1 Admin, Sales, CSKH: trang "Hộp thư & CRM" (mục HỌC VIÊN & CHĂM SÓC)

Bốn tab trên một trang, dùng chung bộ lọc chi nhánh / người phụ trách / nguồn / khoảng ngày:

1. **Hộp thư**: hội thoại cần hành động, sắp theo SLA. Mỗi dòng: avatar và tên Pancake, nền tảng, đoạn xem trước, "chờ 7 phút", giai đoạn, người phụ trách, nút **Mở Pancake** (deep link tới hội thoại), **Ghi nhận**, **Đổi giai đoạn**. Huy hiệu: quá SLA, khách cũ nhắn lại, chưa có số điện thoại, chưa nối hồ sơ, học viên đang tập (để chủ chăm sóc nhận ra).
2. **Pipeline**: kanban 9 cột theo giai đoạn 3.1, đếm số khách và tổng giá trị báo giá, kéo thả hoặc nút đổi giai đoạn (bắt buộc lý do khi sang `lost`). Lọc nhanh: "Của tôi", "Quá SLA", "Hẹn hôm nay", "Nuôi lại đến hạn".
3. **Chăm sóc**: danh sách bước sau bán theo chủ chăm sóc, nhóm theo hôm nay / quá hạn / tuần này; quản lý chi nhánh có bảng giao học viên cho CSKH (chọn nhiều học viên, chọn CSKH, lý do).
4. **Khách hàng**: danh sách và chi tiết. Chi tiết gồm: đầu trang (tên, số, nguồn, chi nhánh, sale, chủ chăm sóc, giai đoạn, nút Gọi / Mở Pancake / Mở Zalo), **Bước tiếp theo** (các `crmCareSteps` đang mở, mỗi bước có nút "Xem SOP" mở đúng bước playbook, nút "Xong" với kết quả), **Hội thoại** (toàn bộ tin từ `crmMessages`, phân trang, có vạch "Ký hợp đồng" ngăn trước bán và sau bán, ảnh mở bằng signed URL), **Dòng thời gian** (hoạt động, đổi giai đoạn, hẹn, báo giá, hợp đồng), **Hành động**: Hẹn trải nghiệm, Tạo báo giá (điền sẵn), Tạo hồ sơ học viên, Giao CSKH, Gộp hồ sơ trùng, Xóa dữ liệu theo yêu cầu khách.

Staff dock: Sales thêm tab "CRM" vào Sales Portal V2 (hiện chỉ có báo giá); vị trí mới `customer_care` có dock gồm CRM (mở thẳng tab Chăm sóc), Student 360 và Việc hôm nay. Trên điện thoại, tab Hộp thư là màn mặc định của Sales, tab Chăm sóc là màn mặc định của CSKH.

### 6.2 Student 360: tab "Hành trình"

Khi khách đã là học viên: nguồn và ngày tiếp xúc đầu, sale đã bán, chủ chăm sóc hiện tại, các bước sau bán đã làm và đang mở, hội thoại Pancake từ ngày ký (đầy đủ, phân trang), lịch hẹn, cùng dòng thời gian hiện có. PT chính và CSKH không thấy phần tư vấn trước ký; sale và quản lý thấy toàn bộ.

### 6.3 PT chính và Coach online

Không có trang mới. Bước sau bán thuộc PT xuất hiện trong "Việc hôm nay" của Trainer Portal thông qua Action Center (`sourceType: crm_step`), có nút "Xem SOP", "Mở Zalo & ghi nhận" (đã có kiểu nút này ở lịch tuần), "Xong". Khi PT chính đồng thời là chủ chăm sóc (chưa có CSKH), các bước chăm sóc cũng vào cùng danh sách này, có nhãn "Chăm sóc" để phân biệt với việc huấn luyện.

### 6.4 Admin: Cài đặt → Kết nối Pancake

Thêm page: dán `page_access_token` (lưu vào Secret Manager qua callable `connectPancakePage`), Aura gọi `GET /tags` và `GET /users` để hiện danh sách thẻ và nhân viên cho việc mapping; chọn chi nhánh mặc định; Aura sinh URL webhook kèm secret để admin dán vào cài đặt webhook của page trên Pancake và chọn chủ đề `messaging`, `conversation`; nút "Gửi sự kiện thử" kiểm tra đường về; xem trạng thái: lần webhook cuối, lần đối soát cuối, cảnh báo nghi tạm ngưng, lỗi, số sự kiện 24 giờ, tiến độ backfill. Nút "Tạo bộ thẻ AURA" tạo 9 thẻ giai đoạn trên page nếu chưa có. Mục riêng cho thời hạn lưu và nhật ký xóa theo yêu cầu.

### 6.5 Báo cáo (Trung tâm điều hành và tab Báo cáo của CRM)

- Thời gian phản hồi đầu trung vị theo ca, theo sale, theo page.
- Phễu: inbox → đủ thông tin → hẹn → đến → báo giá → thắng, theo nguồn, chi nhánh, sale, tuần.
- Lý do mất, thời gian trung bình mỗi giai đoạn.
- Bước chăm sóc: mở, quá hạn, hoàn tất đúng hạn theo chủ chăm sóc (CSKH và PT chính) và theo mẫu.
- Sau bán: tỷ lệ onboarding hoàn tất trong 14 ngày, học viên nguy cơ đã được chăm sóc (đã có chỉ số `at_risk_followup` trong performance tự động), tỷ lệ tái ký, win-back thành công, số giới thiệu.
- Giai đoạn 3: nối `statistics/ads` của Pancake để tính chi phí mỗi lead và mỗi hợp đồng theo chiến dịch.

---

## 7. Bộ máy tự động hóa (quy tắc và bước)

| Tín hiệu | Nguồn đã có | Việc CRM làm |
| --- | --- | --- |
| Hội thoại inbox mới, page chưa trả lời sau 5 phút | Webhook `messaging` | Bước "Phản hồi inbox" cho người được gán; 15 phút → thông báo quản lý chi nhánh |
| Khách `qualified` không hoạt động 48 giờ | `crmActivities` | Bước "Theo dõi lần 2" với mẫu tin |
| Hẹn trải nghiệm | `crmAppointments` | Nhắc trước 1 ngày và 2 giờ; `no_show` → bước "Gọi lại trong 2 giờ" |
| Báo giá gửi 2 ngày và 5 ngày chưa phản hồi | `quotes` | Bước "Nhắc báo giá" |
| Hợp đồng duyệt | `contractApprovals` | `won`, `wonAt`, nối học viên, gán chủ chăm sóc, mở chuỗi D0/D1/buổi 1/buổi 3/D14 |
| Quản lý giao hoặc đổi CSKH, đổi PT chính | `students.careOwnerUid`, `contracts.trainerId` | Gán lại mọi bước đang mở cho chủ mới, ghi hoạt động `assignment` |
| Buổi đã điểm danh thứ 1, 3, 10, 20 | `sessions` | Bước hỏi cảm nhận, chốt mục tiêu, đo lại, gợi giới thiệu cho PT chính |
| 3 buổi vắng liên tiếp | `hasThreeConsecutiveNoShows` trong Action Center | Bước "Gọi hỏi thăm" cho PT chính, báo chủ chăm sóc; 48 giờ chưa xong → quản lý |
| Kỳ trả góp quá hạn 3 ngày | Nhắc nợ trong `installment-payments` | Bước "Gọi nhắc thanh toán" cho chủ chăm sóc, đóng khi `recordContractPayment` ghi phiếu thu |
| Học viên đang tập nhắn page | Webhook `messaging` + `channelLink` có `studentId` | Bước "Trả lời học viên" cho chủ chăm sóc nếu page chưa trả lời sau 15 phút |
| Hết hạn -30 ngày, hết buổi | Pipeline tái ký | Không tạo bước trùng; CRM hiển thị `renewalCaseId`, gắn chủ chăm sóc làm người hỗ trợ |
| Hết gói +7/+30/+90 ngày, không tái ký | `contracts` | Bước xin phản hồi (chủ chăm sóc), win-back (sale) |
| Thẻ Pancake "Không nhận tin" | Webhook `conversation` | Khóa mọi tin tự động và nhắc gửi tin |

Bộ máy chạy bằng `onSchedule` mỗi 15 phút (`materializeCrmCareStepsScheduled`): quét mẫu đang bật, tạo bước còn thiếu (idempotent theo `customerId + templateId + mốc`), gán chủ theo `ownerRole`, đánh dấu quá hạn, gửi nhắc qua thông báo trong app (`users/{uid}/notifications`) và push như trả góp đang làm. Cờ `crm-automation` tắt mặc định, bật theo chi nhánh để chạy thử.

---

## 8. Lộ trình triển khai

### Giai đoạn 0 · Chuẩn bị (3–5 ngày)

- Người quản trị page tạo `page_access_token` cho từng page; chốt page ↔ chi nhánh.
- Đăng ký một endpoint thử trên Functions, bật webhook với các chủ đề `messaging`, `conversation`, `connect_status`, ghi lại payload thật trong vài ngày để chốt cấu trúc, cách xác thực và hành vi gửi lại. Mọi đường dẫn API đối chiếu lại bằng tài khoản thật.
- Danh sách nhân viên Pancake ↔ tài khoản Aura; danh sách CSKH và cách giao học viên hiện tại ở từng chi nhánh.
- Chốt tên 9 giai đoạn, SLA, giờ làm việc, lý do mất, thời hạn lưu.
- Gắn mã SOP cho từng bước chăm sóc (dùng trường `crm` của playbook làm tiêu chí xong).

### Giai đoạn 1 · "Thấy khách và toàn bộ hội thoại từ inbox" (3 tuần)

- `functions/crm-pancake-client.js` (gọi API, giới hạn tốc độ, xử lý `success:false`, test bằng fixture), `crm-pancake-webhook.js` (`onRequest`, secret theo page, ghi sự kiện, trả 200), `crm-inbound-processor.js` (trigger, idempotent, ghi `crmMessages`), `crm-pancake-reconcile.js` (đối soát 10 phút, backfill 90 ngày), `crm-customers.js` (hồ sơ, nối, gộp, giai đoạn, hoạt động, xóa theo yêu cầu), `crm-care-owner.js` (giao CSKH, suy ra PT chính, gán lại bước), `crm-care-steps.js` (bước "Phản hồi inbox", "Trả lời học viên" và bước thủ công).
- Callable: `connectPancakePage`, `rotatePancakeWebhookSecret`, `listCrmInbox`, `listCrmPipeline`, `getCrmCustomer`, `listCrmMessages`, `updateCrmCustomerStage`, `recordCrmActivity`, `linkCrmCustomer`, `mergeCrmCustomers`, `createCrmAppointment`, `assignStudentCareOwner`, `eraseCrmCustomer`.
- Identity: vị trí `customer_care` và các capability `crm.*` trong `identity-contract.json`; màn Admin Roles thêm vị trí này.
- Nối vào luồng cũ: tạo báo giá và hồ sơ nháp từ khách CRM; hợp đồng duyệt → `won`, `wonAt`, `studentId`, chủ chăm sóc.
- Thẻ một chiều Aura → Pancake; phân công hai chiều.
- UI: trang Hộp thư & CRM với bốn tab, tab CRM trong Sales Portal, dock cho CSKH, Cài đặt Pancake có URL webhook và trạng thái.
- Rules chặn `crm*` từ trình duyệt; test callable, test webhook với payload mẫu ghi được ở giai đoạn 0, test đối soát và backfill với fixture, test rules; chạy thử với một page một chi nhánh trong 1 tuần trước khi mở rộng.

### Giai đoạn 2 · "Hành trình sau bán" (2–3 tuần)

- `crmCareTemplates` + bộ máy 15 phút; bộ mẫu mặc định theo bảng 3.2; màn admin sửa mẫu.
- Nối tín hiệu: buổi tập, vắng, trả góp quá hạn, hết gói; bước PT qua Action Center; tab Chăm sóc đầy đủ.
- Tab "Hành trình" trong Student 360; báo cáo phễu và SLA trên Trung tâm điều hành.
- Thẻ hai chiều Pancake → Aura; sao chép ảnh đính kèm về Storage; job dọn dữ liệu theo thời hạn lưu.

### Giai đoạn 3 · "Gửi từ Aura và đo hiệu quả" (2 tuần)

- Gửi mẫu qua Pancake trong cửa sổ cho phép; `statistics/ads` cho chi phí mỗi lead; tìm toàn văn nội dung tin.
- Tóm tắt hội thoại bằng AI (OpenRouter đã có trong dự án): gợi ý tên, mục tiêu, lịch rảnh, ngân sách để sale xác nhận một chạm; không tự ghi khi chưa xác nhận.

Mỗi giai đoạn deploy theo quy trình hiện tại: indexes → functions có promote và health gate → rules → push `main` cho Vercel.

---

## 9. Rủi ro và ràng buộc

- **Tài liệu API chính thức chưa đọc trực tiếp được** (chứng chỉ hết hạn ngày viết); các đường dẫn ở mục 5.1 và cấu trúc payload webhook phải xác minh bằng tài khoản Pancake của Aura ở giai đoạn 0.
- **Webhook có thể bị Pancake tạm ngưng khi tỷ lệ lỗi cao**: endpoint phải trả 200 nhanh và không bao giờ để lỗi nghiệp vụ làm hỏng phản hồi; đối soát 10 phút phát hiện im lặng bất thường.
- **Token quyền quản trị page** rất nhạy: chỉ ở Secret Manager, chỉ Function dùng, xoay token khi nhân sự quản trị page thay đổi.
- **Lưu toàn bộ tin nhắn** là dữ liệu cá nhân của cả người chưa mua: cần thông báo rõ với khách (trang chính sách), phân quyền theo vai và theo mốc ký như thiết kế, thời hạn lưu, và cách xóa theo yêu cầu có ngay từ giai đoạn 1.
- **Cửa sổ 24 giờ Facebook/Instagram** và quy định Zalo: mọi gửi tự động phải kiểm cửa sổ; ngoài cửa sổ chuyển về thao tác tay trên Pancake.
- **Trùng khách**: số điện thoại nhiều định dạng, một người nhiều tài khoản mạng xã hội; luôn có nút gộp và không gộp tự động khi không có số.
- **Đường dẫn ảnh Facebook hết hạn**: ảnh chỉ bền sau khi sao chép về Storage ở giai đoạn 2.
- **Chi phí đọc Firestore**: webhook ghi theo sự kiện, đối soát chỉ kéo phần thay đổi; bộ máy bước chạy theo trang và cursor như các job hiện có.

---

## 10. Smax.ai: đặt ở đâu trong kiến trúc

### 10.1 Smax.ai là gì (kiểm tra 2026-11-08)

- Nền tảng chatbot và hộp thư đa kênh của Việt Nam. Kênh kết nối theo tài liệu: Fanpage Facebook, Instagram, WhatsApp Business và WhatsApp cá nhân, Zalo OA, Zalo cá nhân, website (widget chat), TikTok Shop.
- Mạnh về tự động hóa: trình dựng kịch bản theo khối, GenAI (OpenAI, Groq, AI Seller PrimeV), kịch bản chăm sóc theo thời gian có khung giờ gửi trong ngày, broadcast, bám đuổi, Marketing Messages và Sponsored Messages, Form Builder, trigger Ads Lead, Meta Custom Audience, Payment hub, quản lý đơn.
- Có hộp thư riêng (module Nhắn tin): gộp kênh, chia hội thoại tự động và thủ công theo vai trò, tin nội bộ, thẻ, thuộc tính, segment, báo cáo supporter và marketer.
- Tích hợp: khối **JsonAPI** gọi API ngoài từ kịch bản (GET/POST/PUT/DELETE, header, body JSON) và lưu giá trị trả về vào thuộc tính khách; Google Sheet; gửi email; KiotViet, Nhanh, Sapo, Haravan. **Không có tích hợp Pancake.**
- **Partner API** (Swagger tại `api.smax.ai`, xác thực Bearer JWT): gửi khối hoặc tin tới khách (`POST /partner/bizs/{bizAlias}/send`, `POST .../pages/{page_pid}/threads/{tid}/messages`), đọc danh sách thread và tin, tìm hoặc tạo khách theo số điện thoại, danh sách page, danh sách thẻ (chỉ đọc), gửi ZNS (`POST .../pages/{page_pid}/send-zns`), kết bạn và nhắn Zalo Web, sản phẩm và đơn hàng. **Không có endpoint đăng ký webhook**; trang "API" trong phần tích hợp của tài liệu đang ghi "Tài liệu đang được cập nhật". FAQ của Smax nói REST API dùng để đồng bộ CRM và webhook dùng với nền tảng automation, và API cần gói Growth hoặc Enterprise.
- Gói (trang giá tiếng Anh, giá VND có thể khác): Free 1 kênh; Basic 25 USD/tháng, 3 kênh, 2 thành viên, 10.000 khách, 20.000 card; Growth 89 USD/tháng, 8 kênh, 8 thành viên, 50.000 khách, 100.000 card. Số khách tính cộng dồn không reset; vượt hạn mức khách hoặc card thì chatbot dừng.
- Điều phối bot và người: khối **On/Off Bot** (tắt trong khoảng thời gian, tắt đến thời điểm, tắt đến khi bật lại) và khối **Messenger Handover** theo Facebook Handover Protocol (Pass Control sang app khác theo app ID có thời hạn, Take Control). Tài liệu **không** mô tả việc bot tự tắt khi nhân viên trả lời từ một hộp thư khác như Pancake.

### 10.2 Ba cách đặt Smax.ai

| Phương án | Mô tả | Được gì | Mất gì, rủi ro gì |
| --- | --- | --- | --- |
| A. Chỉ Pancake (thiết kế mục 5) | Pancake là hộp thư và nguồn tin duy nhất; tự động hóa nằm trong Aura (bước chăm sóc) | Một nguồn sự thật, webhook đã có, nhân viên không đổi công cụ | Không có bot trả lời tự động; mọi tin phải người trả lời |
| B. Thay Pancake bằng Smax | Smax làm hộp thư, bot và nguồn đồng bộ về Aura qua Partner API (poll thread) | Bot và hộp thư trong một sản phẩm | Mất webhook đã trả tiền; Partner API không có webhook và tài liệu chưa đủ; nhân viên đổi công cụ; viết lại toàn bộ mục 5. **Không khuyến nghị.** |
| C. Smax là lớp bot phía trước, Pancake vẫn là hộp thư nhân viên và nguồn duy nhất của Aura | Smax kết nối cùng page/OA như app thứ hai; bot trả lời đầu ngoài giờ, trả lời câu hỏi thường gặp, thu tên, số điện thoại, mục tiêu, đặt hẹn thử; **tin bot gửi vẫn hiện trong Pancake và chảy về Aura qua webhook Pancake**, nên không phải đồng bộ tin từ Smax | Có bot, GenAI, kịch bản chăm sóc và ZNS mà không đổi kiến trúc dữ liệu | Bot và người có thể trả lời chồng nhau; cần Handover Protocol hoặc tắt bot khi người tham gia; Zalo OA hai ứng dụng cùng nhận tin cần kiểm tra; thêm một hệ thống phải cấu hình |

### 10.3 Cách nối Smax và Aura trong phương án C

- **Smax → Aura (thu thập lead)**: kịch bản Smax dùng khối JsonAPI gọi `POST .../smaxLeadIntake` (endpoint `onRequest` thứ hai, secret trong header) với `page_pid`, `customer_pid`, `platform`, tên, số điện thoại, mục tiêu, chi nhánh mong muốn, khung giờ, các thuộc tính khác. Aura tạo hoặc cập nhật `crmCustomers` (giai đoạn `qualified` khi đủ tên và số), nối `crmChannelLinks` theo cùng `psid` Facebook mà Pancake dùng, tạo `crmAppointments` nếu bot chốt được giờ thử, ghi hoạt động "Bot Smax thu thập thông tin". Aura trả JSON (`customerId`, mã hẹn, PT đón) để Smax lưu vào thuộc tính và nói lại với khách.
- **Aura → Smax (giai đoạn 3)**: gọi Partner API `/send` để gửi khối mẫu hoặc `/send-zns` cho ZNS (nhắc hẹn, nhắc nợ) thay cho gửi qua Pancake, vì Smax quản lý mẫu và hạn mức card; mỗi lần gửi ghi `crmActivities.message_out`, bản tin vẫn về Aura qua webhook Pancake.
- **Điều phối bot và người**: (1) bật Facebook Handover Protocol với Pancake là ứng dụng nhận quyền chính, Smax chỉ cầm hội thoại khi được kích hoạt và Pass Control sang app ID của Pancake khi khách muốn gặp người hoặc kịch bản xong; (2) lưới an toàn: khi webhook Pancake báo tin của page do nhân viên gửi, Aura gọi Partner API `/send` một khối chứa On/Off Bot "Tắt 2 giờ" cho khách đó, cần thử xem Smax chấp nhận; (3) giới hạn bot chỉ chạy ngoài giờ làm việc và cho tin đầu tiên của khách mới.
- **Dữ liệu**: Aura vẫn coi Pancake là nguồn tin nhắn duy nhất; thuộc tính Smax ghi vào `crmCustomers` qua intake; Aura đẩy giai đoạn ra thẻ Pancake như cũ, không đồng bộ thẻ với Smax vì Partner API chỉ đọc thẻ.

### 10.4 So với Botcake

Botcake là bot của hệ sinh thái Pancake, được giới thiệu là làm việc liền với Pancake Inbox và đồng bộ thẻ màu theo thời gian thực. Nếu nhu cầu chỉ là trả lời tự động cơ bản, thu số điện thoại và đặt hẹn, Botcake ít rủi ro điều phối hơn vì cùng một nhà cung cấp. Smax đáng chọn khi cần GenAI huấn luyện theo tài liệu Aura, kịch bản chăm sóc và bám đuổi mạnh, Zalo cá nhân, ZNS trong một chỗ. Có thể bắt đầu với Botcake rồi chuyển sang Smax; phần Aura (`smaxLeadIntake`, Handover) thiết kế để đổi nhà cung cấp bot mà không đổi CRM.

### 10.5 Cần xác minh với Smax và Pancake trước khi quyết

- Cách nhận JWT Partner API (chương trình đối tác hay chỉ cần gói Growth), giới hạn tốc độ, thời hạn token.
- Webhook của Smax có hay không, sự kiện gì, cấu hình ở đâu (FAQ nói có, tài liệu không có).
- Bot có tự tắt khi nhân viên trả lời từ Pancake không; Pancake có nhận Pass Control theo Handover Protocol không và app ID là gì.
- Zalo OA có cho hai ứng dụng cùng nhận và trả lời tin không.
- Giá VND, và việc chatbot dừng khi vượt hạn mức khách cộng dồn.

### 10.6 Khuyến nghị

Giữ Pancake làm hộp thư và nguồn tin duy nhất như mục 5. Không đưa Smax vào giai đoạn 1. Đến giai đoạn 2, nếu Aura muốn bot trả lời đầu, thu thông tin và nhắc hẹn tự động, chọn Botcake (ít rủi ro) hoặc Smax (mạnh hơn) theo phương án C, với endpoint `smaxLeadIntake` và Handover Protocol. Smax không thay được phần CRM trong Aura: bước chăm sóc theo SOP, chủ chăm sóc, nối hợp đồng, trả góp và tái ký là của Aura.

### 10.7 Phân tích: lấy tin nhắn về CRM Aura từ Pancake, Smax.ai hay nối thẳng API

Hai nguyên tắc trước khi so sánh:

- **Mỗi kênh chỉ có một nguồn đổ về Aura.** Nếu Facebook lấy từ Pancake thì không lấy thêm từ Smax, dù cả hai cùng nhận tin của page. Nguồn có thể khác nhau theo kênh (ví dụ Zalo OA từ nơi khác nếu Pancake chưa nối), nhưng không bao giờ hai nguồn cho một kênh.
- **Bộ nối tách riêng khỏi CRM.** Mọi nguồn đều được quy về một sự kiện nội bộ `{platform, pageId, externalCustomerId, conversationId, messageId, direction, senderKind, text, attachments, sentAt}` trong `functions/crm-ingest-adapters/<nguồn>.js`. Mục 5 chỉ phụ thuộc bộ nối Pancake; đổi nguồn sau này là viết bộ nối mới, không đụng `crmCustomers`, bước chăm sóc hay giao diện.

| Tiêu chí | Pancake | Smax.ai | Nối thẳng API Meta và Zalo OA | Hộp thư khác có API (ví dụ Chative) |
| --- | --- | --- | --- | --- |
| Kênh Aura cần (inbox và bình luận Facebook, Instagram, Zalo OA, TikTok, web) | Facebook, Instagram, Zalo, WhatsApp, TikTok trong một chỗ | Facebook, Instagram, WhatsApp, Zalo OA, Zalo cá nhân, web, TikTok Shop | Meta (Facebook và Instagram) một ứng dụng; Zalo OA ứng dụng riêng; TikTok hạn chế; mỗi kênh một tích hợp riêng | Facebook, Zalo OA, web theo tài liệu; mỗi Zalo OA chỉ nối một kênh |
| Nhận tin thời gian thực | Webhook (gói trả phí, Aura xác nhận); payload cần ghi thử ở giai đoạn 0 | Chưa thấy webhook trong API và tài liệu, chỉ FAQ nói có; không có thì phải poll Partner API | Webhook chuẩn, Meta ký `X-Hub-Signature-256`; Zalo OA webhook sự kiện `user_send_text` | Webhook có secret chia sẻ, gửi lại 5 lần cách 5 giây |
| Lấy lịch sử và backfill | API hội thoại theo `since`/`until` tối đa khoảng 1 tháng mỗi lần, 60 hội thoại mỗi trang, tin theo `current_count` | Partner API đọc danh sách thread và tin (cần role được cấp) | Meta Conversations API đọc được hội thoại page; Zalo OA lịch sử hạn chế | API contacts có; hội thoại chưa kiểm tra |
| Hộp thư cho nhân viên | Đang dùng, không đổi gì | Hộp thư riêng: đổi công cụ hoặc dùng hai hộp thư | Aura phải tự xây hộp thư (khối lượng rất lớn), hoặc vẫn giữ Pancake | Đổi công cụ |
| Gửi tin từ Aura (giai đoạn 3) | `reply_inbox` trong cửa sổ 24 giờ Facebook, tải media | Gửi khối, tin và ZNS qua Partner API | Graph API Send (24 giờ, message tags); Zalo OA tin tư vấn trong 48 giờ theo đa số nguồn; ZNS trả phí | Chưa kiểm tra |
| Định danh khách | `pageId_psid` | `customer_pid` (chính là psid) | PSID theo page; Zalo `user_id` theo OA | contact id riêng của nền tảng |
| Tài liệu và độ tin cậy API | Trang tài liệu lỗi chứng chỉ ngày kiểm tra; 5 request/giây; webhook bị tạm ngưng khi tỷ lệ lỗi cao | Swagger có, trang tích hợp API ghi "đang cập nhật", không có webhook; cần JWT đối tác | Tài liệu tốt nhất, nhưng phải qua App Review và Business Verification của Meta, chính sách đổi thường | Có tài liệu developer riêng |
| Chi phí thêm | Không, đã trả gói | API cần gói Growth khoảng 89 USD/tháng | API miễn phí; tốn công kỹ sư, duy trì app review; ZNS trả phí | Gói trả phí riêng, chưa kiểm tra giá |
| Thời gian tới bản chạy được | Ngắn nhất: 3 tuần như mục 8 | Trung bình, phụ thuộc JWT và webhook | Dài: review Meta vài tuần, xác minh OA, xây hộp thư | Trung bình, cộng đổi công cụ |
| Khóa chặt nhà cung cấp | Trung bình, giảm bằng bộ nối | Trung bình | Thấp nhất | Trung bình |

PSID Facebook là mã theo page, không theo ứng dụng, nên cùng một khách sẽ có cùng mã trên Pancake, Smax và Meta. Vì vậy `crmChannelLinks` khóa theo `platform + pageId + psid` vẫn đúng nếu sau này đổi hoặc thêm nguồn.

**Kết luận**

1. **Pancake là nguồn đồng bộ duy nhất ở giai đoạn 1 và 2.** Nhân viên đang trả lời ở đó, webhook đã có trong gói, API đủ cho backfill, thẻ và phân công, và đây là đường ngắn nhất tới bản chạy được. Điểm yếu (tài liệu, giới hạn 5 request/giây, tạm ngưng webhook) đều xử lý được bằng ghi payload thử, đối soát 10 phút và bộ nối tách riêng.
2. **Smax.ai không làm nguồn đồng bộ.** Thiếu webhook, tài liệu API chưa đủ, API cần gói Growth, và nếu dùng Smax làm bot thì tin bot gửi vẫn về Aura qua Pancake. Smax chỉ đóng góp dữ liệu qua `smaxLeadIntake` (10.3).
3. **Nối thẳng Meta và Zalo OA là phương án dự phòng dài hạn**, chỉ có lợi khi Aura muốn bỏ phí Pancake hoặc cần chữ ký webhook và độ trễ thấp hơn. Điều kiện là Aura phải tự xây hộp thư cho nhân viên hoặc vẫn trả Pancake, nên hiện không đáng.
4. **Hộp thư khác** (Chative có API và webhook rõ ràng) chỉ đáng cân nhắc nếu Aura muốn thay Pancake vì lý do giá hay tính năng hộp thư, không phải vì CRM. Khi đó bộ nối mới chạy song song với bộ nối Pancake một tuần, trùng lặp loại theo `platform + psid + sentAt ± 2 giây + băm nội dung`, rồi tắt nguồn cũ.

---

## 11. Quyết định

### Đã chốt (2026-11-08)

| # | Câu hỏi | Quyết định | Hệ quả trong thiết kế |
| --- | --- | --- | --- |
| 1 | Gói Pancake có API và webhook không? | Gói trả phí, có webhook | Webhook là đường chính (5.2 A), polling chỉ đối soát (5.2 B), endpoint `onRequest` đầu tiên của dự án |
| 2 | Lưu nội dung tin nhắn ở mức nào? | Toàn bộ | Collection `crmMessages`, backfill 90 ngày, `phase` để phân quyền, thời hạn lưu và xóa theo yêu cầu (5.3, 5.4) |
| 3 | Ai sở hữu bước sau bán? | CSKH được giao học viên; nếu chưa giao, PT chính | Trường `students.careOwnerUid`, vị trí `customer_care`, `ownerRole: care_owner`, gán lại bước khi đổi người (3.2, 4, 7) |

### Còn mở

1. Mỗi chi nhánh một page hay dùng chung một page? Ai là quản trị page để tạo token?
2. Tên 9 giai đoạn, SLA phản hồi (5 phút giờ làm việc?), giờ làm việc theo chi nhánh.
3. Thời hạn lưu: 24 tháng cho khách không mua và 24 tháng sau hợp đồng cuối cho học viên có hợp lý không?
4. PT chính và CSKH chỉ thấy hội thoại từ ngày ký (đề xuất), hay thấy toàn bộ?
5. Zalo tiếp tục qua Zalo cá nhân (link `zalo.me` như hiện nay) hay chuyển về Zalo OA trên Pancake để đồng bộ được?
6. Giai đoạn 3 có cho gửi tin từ Aura không, hay chỉ gắn thẻ và luôn trả lời trên Pancake?
7. CSKH có được thấy số liệu tài chính của học viên (còn nợ kỳ nào) để gọi nhắc thanh toán không? Đề xuất: thấy trạng thái kỳ và số tiền kỳ đó, không thấy toàn bộ sổ quỹ.
8. Có dùng bot trả lời tự động không, và nếu có thì Botcake hay Smax.ai (mục 10)? Nếu Smax.ai: xin JWT Partner API ở gói nào, và Pancake có nhận Pass Control không?

---

## 12. Nguồn tham khảo

- Pancake API Reference (chính thức, tiếng Việt): https://docs.pancake.vn/vi/developers/api-reference
- Pancake API Reference (chính thức, tiếng Anh): https://docs.pancake.vn/english/developers/api-reference
- Pancake POS Open API, mục Receiving webhooks: https://pos.pancake.vn/developers/api/en
- Mô tả Page API và chủ đề webhook từ bên thứ ba: https://anythingmcp.com/marketplace/pancake, https://clawhub.ai/suminhthanh/pancake-skills, https://glama.ai/mcp/servers/netfull95/pancake-api-mcp/schema
- Smax.ai, mục lục tài liệu tiếng Việt: https://tailieu.smax.ai/llms.txt (kết nối kênh, Nhắn tin, On/Off Bot, Messenger Handover, JsonAPI, Kịch bản chăm sóc, Gói cước)
- Smax.ai Partner API (Swagger): https://smax.ai/api/partner/docs
- Smax.ai bảng giá tiếng Anh: https://launch-smax.dorik.io/Pricing
- Botcake (bot của Pancake): https://botcake.io/resources/faq
- Chative.io developer docs và kết nối Zalo OA: https://api.chative.io/docs/, https://chative.io/docs/zalo-oa
- Meta Messenger Platform webhooks: https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks.md
- Cửa sổ tin tư vấn Zalo OA 48 giờ (tài liệu bên thứ ba, cần đối chiếu developers.zalo.me): https://developers.esms.vn/en/esms-api/send-sms-api/send-zalo-message-consulting-in-text-form
- Trong repo: `functions/contract-renewals.js` (pipeline và mẫu tin), `functions/action-center.js` (`operationalActions`), `functions/student-360.js` (`studentCareActivities`, timeline), `functions/pt-operations-v2.js` (`salesLeads`, `quotes`, `contractApprovals`), `src/features/sop-center/types.ts` (trường `crm` của bước SOP), `shared/identity/identity-contract.json` (vị trí và capability), `docs/product/INSTALLMENT_PAYMENT_PHASE1.md`.
