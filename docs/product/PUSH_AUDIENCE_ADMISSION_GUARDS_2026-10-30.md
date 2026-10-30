# Push: chặn audience chưa đầy đủ trước khi gửi

Ngày 30/10/2026. Increment đầu của [kế hoạch audience và giao nhận](PUSH_AUDIENCE_DELIVERY_PLAN_2026-10-30.md), triển khai trên nền main `8cdbbd2503b630e3ec4b605f345a6456825feac9`. Chưa phát hành. Đây là chốt từ chối lượt gửi chưa kiểm tra đầy đủ, chưa phải giao nhận audience lớn qua queue.

## Phạm vi

`dispatchPushBroadcast` giữ nguyên tên, region, resource options, quyền claim/profile và chính sách người nhận hiện có. Mọi kiểm tra admission hoàn tất trước inbox, FCM, log hoặc dọn token lỗi. Vượt giới hạn trả lỗi `resource-exhausted` có lý do cố định và `noDeliveryStarted: true`; hết thời gian kiểm tra trả `deadline-exceeded`. Lỗi đọc thiết bị trả `unavailable`, không đưa lỗi database thô ra client.

| Đường gửi | Giới hạn kiểm tra | Khi vượt giới hạn |
| --- | --- | --- |
| Chọn ID trực tiếp, cá nhân hoặc nhóm | Tối đa 1.000 ID hợp lệ sau trim và dedupe | Từ chối toàn bộ; không cắt danh sách |
| Toàn bộ học viên | Đọc tối đa 2.001 hồ sơ từ `users`; 2.000 là mức nhận vào | Có bản ghi thứ 2.001 thì từ chối trước lọc vai trò/opt-out. Staff nằm đầu danh sách không che phần học viên bị bỏ sót |
| Nhóm do browser lọc theo mục tiêu/preference/Academy (`category`) | Kiểm tra nguồn `users` không filter, lấy tối đa 2.501 document ID | Vượt 2.500 thì từ chối vì danh bạ browser hiện bị giới hạn. Đúng 2.500 vẫn được xét; chọn một ID cụ thể không cần quét danh bạ |
| Thiết bị của audience đủ điều kiện | Tổng tối đa 2.000 document thiết bị; mỗi query 30 UID và lấy phần ngân sách còn lại cộng một sentinel | Document thứ 2.001 làm từ chối toàn bộ, kể cả là thiết bị tắt hoặc token thiếu. Không bỏ lặng trang/thiết bị vượt mức |
| Thời gian admission | 45 giây từ lúc vào handler, kiểm tra sau mỗi nguồn đọc và trước delivery | Hết thời gian thì chưa tạo giao nhận |

Các giới hạn trên là giới hạn xử lý tạm thời, không phải tổng audience của hệ thống. Query dùng projection để giảm payload nhưng không tuyên bố giảm số Firestore document reads. Số document trả về được chặn; SDK retries, empty-query minimums và index billing không được suy ra từ số này.

## Chính sách được giữ

- `all` vẫn lấy audience phía server, bỏ qua ID local và chỉ xét vai trò legacy thiếu/null/rỗng hoặc `student`.
- Explicit targets vẫn cho phép staff. `disabled: true`, `status: disabled`, master opt-out và từng danh mục giữ nguyên cách lọc.
- Bypass preference chỉ dành một ID duy nhất sau chuẩn hóa, chính admin gửi thử thiết bị của mình; không bypass disabled.
- Goal aliases và nghĩa Academy ở client không đổi. Academy vẫn là tài khoản học viên, không được diễn giải thành enrollment.
- Người không có thiết bị vẫn có inbox. Counters hiện có giữ nguyên nghĩa; FCM accepted không có nghĩa thiết bị đã hiển thị.
- Production không có Functions sẽ báo lỗi và giữ draft, không ghi inbox/log trực tiếp vào Firestore. Demo được chọn rõ ràng chỉ mô phỏng và lưu local; không gọi Functions hoặc ghi Firestore dù instance có được cấu hình.

## Kiểm thử

- Backend chạy chính block handler trong `index.js` với database/messaging giả: 1.001 selected, duplicate/trim, 2.000/2.001/2.501 hồ sơ, staff trước member, category 2.500/2.501, thiết bị đúng/vượt mức qua nhiều nhóm UID, lỗi ở query sau và deadline; rejection phải có **0 batch, 0 inbox, 0 FCM, 0 log, 0 cleanup**.
- Kiểm tra quyền và input sai; policy legacy/staff/disabled/opt-out/self-test; lookup error không lộ nội dung thô.
- Client kiểm tra production-unavailable và lỗi admission không fallback/retry, giữ nguyên lỗi của callable; goal aliases/preference/Academy giữ nghĩa.
- Browser dùng transport giả và chặn mạng ngoài: lỗi admission giữ draft/dialog, không hiển thị thành công hoặc refresh summary/history như một lượt gửi thành công.

## Phần còn mở

Chốt category chỉ phát hiện giới hạn hiện tại của nguồn danh bạ; không chứng minh danh sách browser luôn mới hoặc là snapshot cố định. Nhóm cũ có thể đổi giữa lúc chọn và gửi. Client cũ gửi explicit IDs mà không khai báo `category` không cung cấp đủ thông tin để server biết đó là nhóm bị cắt ở nơi khác.

Sau khi admission thành công, lỗi ở batch inbox/FCM/log sau vẫn có thể tạo kết quả một phần; timeout sau FCM có thể không rõ kết quả. Increment này **không thêm idempotency hoặc retry an toàn**, không tự chia thành nhiều lượt gửi để vượt cap và không gọi lại provider để thử nghiệm. Server audience preparation, queue, receipt, device pagination, fixed confirmation manifest và picker có pagination vẫn thuộc các đợt tiếp theo.
