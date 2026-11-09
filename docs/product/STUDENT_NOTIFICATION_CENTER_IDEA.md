# Trung tâm thông báo học viên: nhắc lịch tập, thanh toán, lịch rảnh

Ngày 09/11/2026. **Trạng thái: đợt 1 và đợt 2 đã triển khai (xem mục 6 và 7), đợt 3 là đề xuất.** Phân tích trên main `7efe37c`.

Mục tiêu: học viên bấm nút chuông là mở một trang thông báo đầy đủ, chia tab theo nội dung **Lịch tập · Thanh toán · Lịch rảnh · Khác**. Tab nào còn tin chưa đọc thì có badge đỏ kèm số. Hệ thống tự nhắc đúng lúc ba việc học viên hay quên: đến buổi tập, thanh toán kỳ trả góp, gửi lịch rảnh trước giờ chốt.

## 1. Hiện trạng

| Thành phần | Đã có | Còn thiếu |
| --- | --- | --- |
| Hộp thư `users/{uid}/notifications` | Server tạo; học viên chỉ được sửa `read`, `readAt`, `updatedAt`. Mã tài liệu cố định theo `dedupeKey` nên job chạy lại không gửi trùng (`createScheduledNotification` trong `functions/index.js`) | Không có `expiresAt`/TTL nên hộp thư chỉ lớn lên. Type `NotificationCategory` ở client thiếu `payment`, `system`, `operations` dù backend đang ghi các giá trị này |
| Nút chuông `NotificationCenter.tsx` | Dropdown 320px, 50 tin mới nhất, "Đánh dấu đã đọc" toàn bộ, bấm tin mở `actionUrl` | Một danh sách trộn mọi loại, không phân tab. **Ẩn hoàn toàn ở màn hình ≤767px** (`styles-aura.css`), nên học viên dùng điện thoại hiện không có nút thông báo |
| Push FCM web | `public/sw.js` hiện banner nền và mở đúng `actionUrl`; banner foreground; thiết bị trong `users/{uid}/devices`; công tắc `system/push_settings.enabled`; `deliverScheduledPushes` gom theo nội dung và dọn token hỏng | Chưa có kênh ngoài web push |
| Cài đặt học viên | `notificationSettings`: bật/tắt, giờ yên tĩnh 21:30–07:00, tối đa 3 lần/ngày, 4 nhóm nội dung (bữa ăn, tập luyện, Academy, HLV) | Chưa có nhóm riêng cho thanh toán và lịch rảnh |
| Job tự động | Nhắc bữa ăn mỗi phút; `sendInstallmentDueRemindersScheduled` 08:00 với 3 mốc trước hạn 3 ngày, đúng hạn, quá hạn 3 ngày; `remindUnconfirmedPtAttendanceScheduled` cho PT | `workoutReminderTime` trong cấu hình Push admin chưa được backend dùng |

Producer đang ghi vào hộp thư học viên: nhắc trả góp và ghi nhận thanh toán, báo chuyển khoản bị từ chối (`payment`); yêu cầu đổi/hủy/bù/thêm buổi được duyệt hoặc từ chối, OFF/bảo lưu duyệt hoặc từ chối (`workout`); khen từ PT, điểm Aura Club (`loyalty`); duyệt nhật ký ăn (`nutrition`); CRM (`general`); Eat Clean (`system`); push thủ công từ admin.

Chưa có thông báo nào cho: lịch tuần vừa được xếp; nhắc trước buổi tập; buổi bị admin hủy hoặc dời; nhắc gửi lịch rảnh trước giờ chốt; báo đã chốt hoặc được mở lại; xác nhận đã nhận lịch rảnh; xác nhận đã nhận báo chuyển khoản; gói sắp hết buổi hoặc sắp hết hạn; mời đánh giá buổi tập.

Lỗi nhỏ nên sửa cùng đợt: thông báo nhắc PT xác nhận điểm danh ghi `body`/`route` thay vì `message`/`actionUrl`, nên trên chuông chỉ thấy tiêu đề, không có nội dung và không bấm được.

## 2. Trải nghiệm đề xuất

### 2.1 Nút chuông

- Hiện trên cả desktop và mobile. Trên mobile đặt cạnh avatar trong topbar, vùng bấm 44×44.
- Badge đỏ là tổng tin chưa đọc của mọi tab, tối đa "9+". `aria-label` dạng "Thông báo, 4 chưa đọc".
- Học viên bấm chuông thì điều hướng tới `#/notifications`, không mở dropdown. Staff và admin tạm giữ dropdown hiện có cho tới đợt 3.

### 2.2 Trang `#/notifications`

Route mới `notifications` trong `StudentView`, query `tab=schedule|payment|availability|other`, tiêu đề topbar "Thông báo".

1. **Header**: "Thông báo", nút "Đánh dấu đã đọc" áp cho tab đang mở, link "Cài đặt nhắc nhở" sang trang Cá nhân.
2. **Dải tab dính trên** (sticky), 4 cột bằng nhau, tái dùng kiểu `push-admin-tabs` của trang Push admin: Lịch tập · Thanh toán · Lịch rảnh · Khác. Tab có tin chưa đọc hiện badge đỏ kèm số ở góc nhãn, "9+" khi vượt. Trên mobile nhãn rút gọn nhưng badge giữ nguyên.
3. **Khối "Cần làm ngay"** (tối đa 2 thẻ) tính từ dữ liệu sống của `listMyStudentPtSchedule`, không phụ thuộc hộp thư: kỳ trả góp quá hạn hoặc đến hạn → "Thanh toán ngay"; lịch rảnh tuần sau chưa gửi và còn dưới 72 giờ → "Gửi lịch rảnh"; buổi tập hôm nay → "Xem buổi hôm nay". Thẻ tự biến mất khi việc đã xong, không cần đánh dấu đọc.
4. **Dòng thời gian theo ngày**: Hôm nay · Hôm qua · Tuần này · Cũ hơn. Mỗi tin có icon theo loại, tiêu đề, nội dung 1–2 dòng, thời gian tương đối, chấm chưa đọc và một chip hành động: Thanh toán · Mở lịch · Gửi lịch rảnh · Đánh giá. Bấm tin là đánh dấu đọc rồi mở `actionUrl`.
5. Mỗi tab tải 25 tin, nút "Tải thêm". Trạng thái rỗng viết riêng cho từng tab, ví dụ tab Lịch rảnh: "Chưa có nhắc nhở. Aura sẽ báo trước giờ chốt lịch rảnh mỗi tuần."

Tab mặc định khi mở: ưu tiên tab có tin chưa đọc theo thứ tự Thanh toán quá hạn → Lịch tập có buổi hôm nay hoặc mai → Lịch rảnh sắp chốt → Khác. Không có tin chưa đọc thì mở tab lần trước (localStorage), rồi mới tới Lịch tập. Tham số `?tab=` trong link luôn thắng, để push và thẻ Home trỏ thẳng đúng tab.

Accessibility: dải tab dùng `role="tablist"`; một vùng `role="status" aria-atomic` duy nhất đọc "3 thông báo mới về lịch tập" khi số thay đổi, không gắn live region cho từng badge; chip tối thiểu 44px; tôn trọng `prefers-reduced-motion`.

### 2.3 Nội dung từng tab

#### Lịch tập (category `workout`)

| Sự kiện | Khi nào | Tiêu đề · nội dung mẫu | Link | Mã chống trùng |
| --- | --- | --- | --- | --- |
| Lịch tuần đã xếp | Ngay khi `publishPtSchedule` phát hành tuần W cho chi nhánh; gửi cho học viên có ≥1 buổi; lần phát hành sau có `diff` thay đổi buổi của học viên thì gửi "Lịch tuần có thay đổi" | "Lịch tập tuần 10–16/11 đã sẵn sàng" · "3 buổi: T2 18:00, T4 18:00, T6 19:00 · PT Minh" | `#/schedule?tab=next-week` | `schedule-published-{weekId}-v{publishedVersion}` |
| Nhắc trước 1 ngày | 19:00 hằng ngày (lấy từ `workoutReminderTime`), buổi `scheduled` của ngày mai | "Mai bạn có buổi PT 18:00" · "PT Minh · Aura Quận 7. Cần đổi hoặc hủy miễn phí, hãy gửi yêu cầu trước 18:00 hôm nay." | `#/schedule?tab=this-week` hoặc `next-week` | `session-d1-{sessionId}` |
| Nhắc trước 2 giờ | Job mỗi giờ đúng :00, buổi hôm nay có `hour` = giờ hiện tại + 2 | "Còn 2 giờ đến buổi tập" · "18:00 · PT Minh. Nhớ mang nước và khăn." | `#/schedule?tab=this-week` | `session-h2-{sessionId}` |
| Buổi bị hủy hoặc dời | Trong transaction hủy/dời của `pt-schedule-admin-edit.js` và các đường hủy do PT nghỉ | "Buổi T4 18:00 đã dời sang 19:00" · "Lý do: PT bận đột xuất. Không trừ buổi." | `#/schedule?tab=this-week` | `session-changed-{sessionId}-r{revision}` |
| Đã nhận yêu cầu | Khi học viên gửi yêu cầu đổi/hủy/bù/thêm; giữ nguyên thông báo duyệt và từ chối hiện có | "Đã nhận yêu cầu đổi buổi T4" · "Aura phản hồi trước 18:00. Theo dõi ở tab Yêu cầu." (in-app, không push) | `#/schedule?tab=requests` | `session-request-{requestId}-received` |
| Mời đánh giá buổi tập | Khi điểm danh `completed`, trong cửa sổ 72 giờ của `session-feedback.js` | "Buổi tập hôm nay thế nào?" · "Đánh giá 30 giây giúp PT Minh và Aura tốt hơn." | `#/schedule?tab=history` | `feedback-{sessionId}` |

Nhắc trước 2 giờ không đẩy push trong giờ yên tĩnh (buổi 07:00 sẽ rơi vào 05:00); tin vẫn nằm trong app. Buổi đã bị hủy trước giờ nhắc thì không nhắc. Hợp đồng đang bảo lưu thì không có buổi nên không phát sinh nhắc.

#### Thanh toán và gói tập (category `payment`)

| Sự kiện | Khi nào | Tiêu đề · nội dung mẫu | Link | Mã chống trùng |
| --- | --- | --- | --- | --- |
| Nhắc trước hạn | Giữ 3 mốc hiện có: trước 3 ngày, đúng hạn, quá hạn 3 ngày | Giữ nguyên copy hiện có trong `installment-payment-core.js` | `#/schedule?tab=contract&pay=…` | Giữ `installment-due-…` |
| Quá hạn kéo dài | Thêm mốc quá hạn 7 và 14 ngày, sau đó mỗi tuần; dừng khi học viên đã báo chuyển khoản, hợp đồng bảo lưu hoặc đóng (giữ quy tắc của `planInstallmentReminders`) | "Kỳ thanh toán đã quá hạn 7 ngày" · "Gói PT 24 buổi · 4.000.000đ · hạn 02/11. Nếu bạn đã chuyển, hãy bấm Tôi đã chuyển khoản." | như trên | `installment-overdue-{claimId}-{days}` |
| Đã nhận báo chuyển khoản | Trong `submitMyInstallmentPaymentClaim` | "Đã nhận báo chuyển khoản kỳ 2" · "4.000.000đ. Kế toán xác nhận trong 24 giờ làm việc." (in-app, không push) | `#/schedule?tab=contract` | `installment-claim-{claimId}-received` |
| Đã ghi nhận / chưa xác nhận được | Giữ nguyên hai thông báo hiện có | | | |
| Gói sắp hết buổi | Còn ≤3 buổi hoặc ≤10% tổng buổi, kiểm tra 08:30 hằng ngày | "Gói PT 24 buổi còn 3 buổi" · "Hãy trao đổi với PT để giữ nhịp tập." | `#/schedule?tab=contract` | `contract-sessions-low-{contractId}-{remaining}` |
| Gói sắp hết hạn | `endDate` còn 14 ngày, 3 ngày, và 1 ngày sau khi hết hạn | "Gói tập hết hạn sau 14 ngày" · "Hết hạn 23/11. Liên hệ Aura để tái ký hoặc gia hạn." | `#/schedule?tab=contract` | `contract-ending-{contractId}-{milestone}` |

Hai mốc gói tập bỏ qua hợp đồng `frozen` hoặc đang trong kỳ bảo lưu, dùng lại `contractPreservedOn` của `contract-renewals.js`, để không lặp lỗi vừa sửa ở mục Tái ký. Thông báo thanh toán là giao dịch nên không chịu opt-out theo nhóm; chỉ giờ yên tĩnh áp cho push.

#### Lịch rảnh (category mới `availability`)

Mốc tính theo giờ chốt C của tuần kế: `availabilityCutoff(weekId, policy)` trong `pt-operations-v2.js`. Mặc định C là Chủ nhật 12:00 trước tuần. Admin đổi chính sách thì mốc tự dịch theo.

| Mốc | Mặc định | Điều kiện | Tiêu đề · nội dung mẫu |
| --- | --- | --- | --- |
| C−72h | Thứ Năm 12:00 | Tuần kế chưa có lịch nguồn `weekly` (đang là missing, inherited, legacy_default hoặc draft); hợp đồng còn buổi; không OFF hoặc bảo lưu trọn tuần | "Tuần sau bạn rảnh khi nào?" · "Gửi lịch rảnh trước Chủ nhật 12:00 để Aura xếp đúng khung bạn muốn." |
| C−18h | Thứ Bảy 18:00 | Như trên | "Còn 18 giờ để gửi lịch rảnh" · "Chưa gửi thì Aura dùng lịch tuần 03/11 của bạn, 6 khung." hoặc "Bạn chưa có lịch nào, Aura sẽ không xếp được buổi." |
| C−3h | Chủ nhật 09:00 | Như trên | "Chốt lịch rảnh lúc 12:00 hôm nay" · "Chỉ còn 3 giờ. Gửi ngay để có buổi tuần sau." |
| C | Chủ nhật 12:00 | Mọi học viên đang tập | "Đã chốt lịch rảnh tuần 10–16/11" · "Aura dùng 6 khung bạn đã gửi." hoặc "Aura dùng lịch gần nhất của bạn." hoặc "Bạn chưa có lịch rảnh, hãy liên hệ PT." (in-app; chỉ push cho người chưa có lịch) |
| Mở lại | Ngay khi `reopenPtStudentAvailability` | "Admin đã mở lại lịch rảnh đến 20:00 10/11" · "Bạn có thể điều chỉnh và gửi lại." |
| Đã nhận lịch | Ngay khi `saveMyStudentAvailability` | "Đã nhận lịch rảnh tuần 10–16/11 · 6 khung" (in-app, không push). Chấm dứt nhầm lẫn kiểu Mie: học viên tưởng đã gửi nhưng chưa |

Link: `#/student-availability?week={weekId}`; trang Lịch rảnh cần đọc thêm tham số `week`. Mã chống trùng `availability-{weekId}-{milestone}`. Job mỗi giờ tính mốc theo chính sách, duyệt `students` đang tập có `accountUid`, đọc đúng tài liệu `ptAvailability/{studentId}_{weekId}` bằng `getAll`.

#### Khác

Dinh dưỡng, Academy, Aura Club, HLV và Aura AI, CRM, Eat Clean, thông báo chung từ admin. Giữ nguyên hành vi và copy hiện có.

### 2.4 Quy tắc chung

- Hộp thư luôn ghi. Push chỉ đi khi học viên bật thông báo, có thiết bị, nhóm nội dung tương ứng đang bật và ngoài giờ yên tĩnh.
- Thêm 3 công tắc trong `NotificationSettingsCard`: Buổi tập (`sessionReminders`), Thanh toán trước hạn (`paymentReminders`, chỉ tắt được nhắc trước hạn; quá hạn và giao dịch luôn gửi), Lịch rảnh (`availabilityReminders`). `acceptsPushCategory` đọc thêm 3 cờ này.
- Giới hạn `maxDaily` áp cho tin nhắc nhở. Sự kiện giao dịch như hủy buổi, ghi nhận thanh toán, duyệt yêu cầu không tính vào giới hạn.
- Mỗi tin có `expiresAt`: nhắc buổi tập 7 ngày sau buổi; lịch rảnh 7 ngày sau khi tuần kết thúc; thanh toán 90 ngày; sự kiện khác 60 ngày. Bật TTL trên trường `notifications.expiresAt` của collection group, giống `crmInboundEvents`. Hộp thư gọn và badge không bị tin cũ làm nhiễu.
- "Đánh dấu đã đọc" từng tab cập nhật `read`, `readAt`, `updatedAt` cho tin chưa đọc của tab đó, theo lô tối đa 200, đúng whitelist Rules hiện có.
- Khi học viên hoàn tất hành động từ chính tin đó, ví dụ bấm Thanh toán rồi báo chuyển khoản, tin được đánh dấu đọc.

## 3. Dữ liệu và kỹ thuật

Tài liệu thông báo giữ tương thích ngược, thêm trường:

```text
users/{uid}/notifications/{dedupeKey}
  title, message, type, category, actionUrl, read, createdAt, dateString   // như cũ
  + kind       'session_d1' | 'session_h2' | 'schedule_published' | 'session_changed' | 'feedback_invite'
               | 'installment_due' | 'installment_overdue' | 'claim_received' | 'contract_ending' | 'contract_sessions_low'
               | 'availability_remind' | 'availability_locked' | 'availability_reopened' | 'availability_received'
  + entity     { sessionId?, contractId?, installmentId?, weekId?, requestId? }
  + priority   'high' | 'normal'
  + ctaLabel   'Thanh toán' | 'Mở lịch' | 'Gửi lịch rảnh' | 'Đánh giá'
  + expiresAt  Timestamp
```

Tab suy từ `category`: `workout` → Lịch tập; `payment` → Thanh toán; `availability` → Lịch rảnh; còn lại → Khác. Không cần trường `tab` riêng.

Backend:

- `functions/student-reminders.js` (mới): hàm thuần `planSessionReminders`, `planAvailabilityReminders`, `planContractLifecycleReminders` kèm test, theo mẫu `planInstallmentReminders`; dùng chung `createScheduledNotification` và `deliverScheduledPushes` hiện có.
- Scheduled: `sendSessionRemindersScheduled` (mỗi giờ :00), `sendAvailabilityRemindersScheduled` (mỗi giờ :05), `sendContractLifecycleRemindersScheduled` (08:30 hằng ngày). `sendInstallmentDueRemindersScheduled` mở rộng thêm mốc quá hạn.
- Hook sự kiện: `pt-schedule-publish.js` (lịch tuần), `pt-schedule-admin-edit.js` (hủy/dời), `saveMyStudentAvailability` và `reopenPtStudentAvailability` (lịch rảnh), `submitMyInstallmentPaymentClaim` (đã nhận báo), hoàn tất điểm danh (mời đánh giá).
- Cấu hình Push admin: dùng `workoutReminderTime` làm giờ nhắc trước 1 ngày; thêm `sessionReminderLeadHours` mặc định 2 và công tắc bật tắt từng nhóm nhắc trong tab Tự động hóa.
- Sửa `remindUnconfirmedPtAttendance` sang `message` và `actionUrl`.

Client:

- `src/pages/student/NotificationsPage.tsx` và CSS riêng. `notificationService.ts` thêm `subscribeToUnreadNotifications` (listener `where('read','==',false)`, giới hạn 200, dùng tính badge), `listNotificationsPage(category, cursor)` (25 tin một trang, `orderBy createdAt desc`), `markCategoryAsRead`.
- `AppShell.tsx`: bỏ ẩn chuông trên mobile; với học viên bấm chuông thì `navigate('notifications')`; `viewTitles.notifications = 'Thông báo'`; không thêm vào dock 5 nút dưới.
- `StudentAvailabilityPage.tsx` đọc `?week=`. `NotificationSettingsCard.tsx` thêm 3 công tắc. Cập nhật `NotificationCategory` và `AppNotification` trong `types.ts`.
- `sw.js` giữ nguyên; `actionUrl` của tin mới trỏ thẳng tới hành động, không trỏ về trang thông báo.

Rules, index, TTL:

- Rules không đổi quyền đọc và ghi; whitelist `read`, `readAt`, `updatedAt` đã đủ.
- Truy vấn `category == X orderBy createdAt desc` và `read == false` trên subcollection cần được kiểm tra trên database Enterprise này, vì tài liệu CRM ghi nhận DB không có index đơn trường mặc định. Nếu cần, thêm 2 index composite cho collection group `notifications` trước khi phát hành.
- TTL: field override `notifications.expiresAt`, áp bằng script cấu hình như đợt CRM.

Chi phí đọc: badge dựa trên một listener tin chưa đọc, thường dưới 20 tài liệu. Mỗi tab đọc 25 tài liệu khi mở, không polling. Job theo giờ quét `sessions` theo `date` (đã có index) và `students` đang tập, cỡ vài trăm tài liệu mỗi lần.

## 4. Lộ trình

| Đợt | Nội dung | Kết quả |
| --- | --- | --- |
| 1 (khoảng 1 tuần) | Trang `#/notifications` 4 tab và badge; hiện chuông trên mobile; map producer hiện có vào tab; category `availability`; 3 công tắc cài đặt; sửa shape nhắc PT; nhắc buổi trước 1 ngày; nhắc lịch rảnh C−18h; xác nhận đã nhận lịch rảnh | Học viên có trang thông báo dùng được; hai nhắc nhở quan trọng nhất chạy |
| 2 | Lịch tuần đã xếp; hủy/dời buổi; nhắc 2 giờ; mời đánh giá; đủ mốc lịch rảnh, báo chốt và mở lại; đã nhận báo chuyển khoản; quá hạn 7 và 14 ngày; gói sắp hết buổi và hết hạn; TTL | Đủ ba nhóm nhắc nhở |
| 3 | Tổng kết tuần; kênh Zalo OA hoặc SMS nếu có; trang tab cho staff: Ca dạy · Yêu cầu · Vận hành | Mở rộng |

Kiểm thử: unit cho các planner (mốc thời gian, giờ yên tĩnh, bảo lưu, OFF, chống trùng); Playwright cho trang tab, badge và đánh dấu đọc; smoke production sau deploy. Deploy functions theo recipe hiện có, từ bản sao sạch của commit đã push.

## 5. Cần chốt

1. 4 tab hay 3 tab. Bỏ "Khác" thì tin dinh dưỡng, Academy, Aura Club phải nằm ở tab nào.
2. Giờ nhắc trước 1 ngày: 19:00 hay 20:00.
3. Cho phép học viên tắt nhắc trước hạn thanh toán hay bắt buộc.
4. Có gửi "Đã chốt lịch rảnh" cho người đã gửi lịch không, hay chỉ cho người chưa gửi.
5. Nhắc gói sắp hết hạn gửi cho học viên có làm nhiễu luồng tái ký của sales không.

## 6. Đợt 1 đã code (09/11/2026)

Giao diện:

- Route `#/notifications?tab=schedule|payment|availability|other` (`src/pages/student/NotificationsPage.tsx`, CSS cùng tên), bố cục kiểu hộp thư gọn: header gradient Aura có tiêu đề và hai nút biểu tượng (đánh dấu đã đọc theo tab, cài đặt nhắc nhở); tab chữ có gạch chân và chấm đỏ khi còn tin chưa đọc; mỗi tin là một dòng gồm icon tròn theo loại, tiêu đề, nội dung tối đa 2 dòng, chấm chưa đọc và thời gian ngắn ("40 phút", "Hôm qua", "3 ngày"). Dòng ghim "cần làm" lấy từ `listMyStudentPtSchedule` (kỳ trả góp đến hạn hoặc quá hạn, lịch rảnh tuần sau chưa gửi, buổi tập hôm nay) có nút hành động, và bị ẩn khi đã có tin chưa đọc mở cùng chỗ. "Xem thêm" tải 50 tin một trang. Một vùng `role="status"` duy nhất đọc số tin chưa đọc khi thay đổi. Trên điện thoại trang tràn viền ngay dưới thanh trên cùng.
- Quy tắc tab, badge, tab mặc định và nhãn thời gian nằm trong `src/features/notifications/notificationTabs.ts`. Tab suy từ `category`: `workout` → Lịch tập, `payment` → Thanh toán, `availability` → Lịch rảnh, còn lại → Khác.
- Chuông: học viên bấm thì mở trang (`onOpenPage` trong `NotificationCenter.tsx`), staff và admin giữ dropdown. Chuông hiện trên mobile (`styles-aura.css`).
- Đọc dữ liệu không cần index mới: một listener 60 tin mới nhất, một listener tin chưa đọc (tối đa 200) để tính badge, trang cũ hơn đọc bằng `startAfter(createdAt)` rồi lọc tab ở client (`notificationService.ts`).
- Cài đặt: ba công tắc `sessionReminders`, `paymentReminders`, `availabilityReminders` trong `NotificationSettingsCard.tsx`. Trang Lịch rảnh đọc `?week=`.

Backend (`functions/student-reminders.js`, test `student-reminders.test.js`, `npm run check:student-reminders`):

- `sendSessionRemindersScheduled`: chạy mỗi giờ, gửi trong giờ `workoutReminderTime` của `system/push_settings` (mặc định 19:00) một tin cho mỗi học viên có buổi `scheduled` ngày mai, gom nhiều buổi vào một tin, mã `session-d1-{ngày}-{studentId}`. Công tắc `autoSessionReminders`.
- `sendAvailabilityRemindersScheduled`: chạy mỗi giờ phút :05, gửi khi còn `availabilityReminderLeadHours` (mặc định 18) trước giờ chốt của tuần kế tính từ `availabilityCutoff`. Chỉ nhắc học viên có hợp đồng `active` còn buổi, không OFF hoặc bảo lưu trọn tuần, và tuần kế chưa có lịch nguồn `weekly`. Mã `availability-{weekId}-before-18h-{studentId}`. Công tắc `autoAvailabilityReminders`.
- Push đi sau khi kiểm tra `notificationSettings` của học viên (bật tắt chung, công tắc nhóm, giờ yên tĩnh); tin trong app luôn được tạo. `createScheduledNotification` lưu thêm `kind`, `entity`, `priority`, `ctaLabel`, `expiresAt`.
- `saveMyStudentAvailability` (cả bản Regional) ghi biên nhận "Đã nhận lịch rảnh tuần …" vào hộp thư, một tài liệu mỗi tuần, làm mới khi gửi lại.
- `remindUnconfirmedPtAttendance` chuyển sang `message` và `actionUrl` nên PT thấy được nội dung và bấm mở được.

## 7. Đợt 2 đã code (09/11/2026)

Mọi nội dung chữ nằm trong `functions/student-reminders.js` (hàm thuần, test trong `student-reminders.test.js`). `index.js` có các hàm dùng chung `writeStudentNotices` (ghi hộp thư, mặc định không ghi đè; chế độ `replace` ghi đè thành chưa đọc), `pushStudentNotices` và `deliverStudentNotices`. Push luôn đi qua kiểm tra cài đặt học viên và giờ yên tĩnh, mỗi lượt FCM chỉ một tin cho một người.

| Nhóm | Sự kiện | Nơi tạo | Mã chống trùng |
| --- | --- | --- | --- |
| Lịch tập | Nhắc trước giờ tập (mặc định 2 giờ, chỉnh 1–6) | `sendSessionRemindersScheduled`, mỗi giờ, bỏ qua trong giờ yên tĩnh | `session-soon-{sessionId}` |
| Lịch tập | Mời đánh giá buổi đã tập, còn trong cửa sổ 72 giờ, chưa đánh giá | cùng job, chạy lúc 10:00, 14:00, 18:00, 21:00 | `feedback-{sessionId}` |
| Lịch tập | Lịch tuần đã sẵn sàng hoặc có thay đổi, liệt kê các buổi | `publishPtSchedule` (cả bản Regional) sau khi commit | `schedule-week-{weekId}-{studentId}`, ghi đè |
| Lịch tập | Admin thêm, dời hoặc hủy một buổi đã publish | `adminEditPtSchedule` (cả bản Regional) | `session-changed-{sessionId}-r{revision}` |
| Lịch rảnh | Nhắc 72 giờ, 18 giờ, 3 giờ trước giờ chốt | `sendAvailabilityRemindersScheduled` | `availability-{weekId}-before-{N}h-{studentId}` |
| Lịch rảnh | Đã chốt lịch rảnh: gửi mọi học viên đang tập, chỉ push cho người chưa có lịch riêng | cùng job, giờ ngay sau chốt | `availability-{weekId}-locked-{studentId}` |
| Lịch rảnh | Admin mở lại lịch rảnh (in-app và push) | `reopenPtStudentAvailability` (cả bản Regional) | `availability-{weekId}-reopened-{studentId}` |
| Thanh toán | Quá hạn 7, 14, rồi mỗi tuần đến 56 ngày | `sendInstallmentDueRemindersScheduled`, mốc thêm vào `REMINDER_OFFSETS` | `installment-due-{claim}-after_{N}` |
| Thanh toán | Đã nhận báo chuyển khoản (chỉ in-app) | `submitMyInstallmentPaymentClaim` | `installment-claim-{claim}-r{revision}-received` |
| Thanh toán | Gói còn ít buổi (≤3 hoặc ≤10%), gói đã hết buổi, còn 14 ngày, 3 ngày, hết hạn hôm nay | `sendContractLifecycleRemindersScheduled` 08:30 | `contract-sessions-low-{id}`, `contract-sessions-out-{id}`, `contract-ending-{id}-d{N}` |

Quy tắc gói tập: bỏ qua học viên đã có hợp đồng `future` (đã tái ký) và hợp đồng đang trong kỳ bảo lưu; số buổi lấy từ `contractUsageViews`, thiếu thì lấy từ hợp đồng. Mốc "1 ngày sau hết hạn" trong thiết kế được đổi thành "hết hạn hôm nay" để không phải quét hợp đồng `expired`.

Cài đặt: tab Tự động hóa của trang Push admin có 4 công tắc (`autoSessionReminders`, `autoFeedbackInvites`, `autoAvailabilityReminders`, `autoContractReminders`), giờ nhắc buổi ngày mai (`workoutReminderTime`, mặc định giao diện đổi từ 17:00 thành 19:00) và số giờ nhắc lại (`sessionReminderLeadHours`). Học viên tắt "Nhắc thanh toán trước hạn" chỉ tắt mốc trước 3 ngày.

TTL: `firestore.indexes.json` có override `notifications.expiresAt` (TTL, không đánh index). Áp bằng `node scripts/notification-firestore-config.cjs apply --confirm=…/notifications:configure-retention`. Tin không có `expiresAt` không bao giờ bị xóa.

Deploy đợt 1 và 2: `sendSessionRemindersScheduled`, `sendAvailabilityRemindersScheduled`, `sendContractLifecycleRemindersScheduled` (mới), `sendInstallmentDueRemindersScheduled`, `saveMyStudentAvailability`, `saveMyStudentAvailabilityRegional`, `remindUnconfirmedPtAttendanceScheduled`, `dispatchPushBroadcast`, `publishPtSchedule`, `publishPtScheduleRegional`, `adminEditPtSchedule`, `adminEditPtScheduleRegional`, `reopenPtStudentAvailability`, `reopenPtStudentAvailabilityRegional`, `submitMyInstallmentPaymentClaim`; TTL; web theo Vercel.

Còn lại cho đợt 3: buổi do PT báo nghỉ, tổng kết tuần, kênh Zalo OA hoặc SMS, trang tab cho staff.
