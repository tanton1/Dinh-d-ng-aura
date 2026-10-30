# Tải dữ liệu quản trị thông báo theo tab

Đợt này tiếp tục kế hoạch Graphify, giới hạn ở vòng đời đọc trên web. Không thay đổi audience, xác nhận gửi, kiểm tra quyền backend hoặc cấu hình cloud; không gửi thông báo thật trong kiểm thử.

| Tab | Nguồn đọc khi mở |
| --- | --- |
| Tổng quan | Cấu hình xác nhận từ máy chủ và tổng hợp Push |
| Gửi | Mẫu thông báo; listener danh bạ trong thời gian tab có nhu cầu |
| Tự động hóa | Cấu hình và 10 lần chạy gần nhất |
| Lịch sử | 25 thông báo mỗi trang, cursor timestamp/document ID; 10 lần tự động hóa gần nhất |
| UI 4.0 | Danh bạ và cấu hình rollout hiện có |

Các nguồn đã tải được giữ trong phiên màn hình. Không thêm polling hay đọc khi tab trình duyệt trở lại foreground. Đổi tài khoản hoặc phiên bản quyền xóa dữ liệu màn hình; phản hồi đến muộn không được thay thế dữ liệu phiên mới. Danh bạ ngừng nghe khi rời tab Gửi/UI 4.0.

Lịch sử có nút tải tiếp và làm mới. Bộ lọc chỉ áp dụng cho các bản ghi đã tải, ghi rõ trên giao diện. Làm mới giữ số trang đã mở; lỗi không đưa lịch sử riêng tư từ localStorage trở lại. Lưu cấu hình không đọc lại lịch sử; sửa mẫu chỉ làm mới mẫu. Gửi thành công đánh dấu lịch sử đã thay đổi và chỉ làm mới tổng hợp nếu tab Tổng quan đang mở. Nội dung soạn, tìm mẫu, bộ lọc lịch sử và cấu hình chưa lưu được giữ khi chuyển tab.

Cấu hình quản trị dùng `getDocFromServer`; chưa đọc được máy chủ thì không cho lưu bằng mặc định/cache offline. Chỉ số tổng hợp chưa xác nhận hiển thị `—`, có thao tác thử lại. Các consumer cấu hình cũ vẫn dùng chính sách đọc trước đây.

Danh sách mẫu và lịch sử quản trị đọc từ máy chủ; không dùng cache offline để thay cho lần đọc bị từ chối. Collection mẫu production rỗng được hiển thị là rỗng, không tự tạo mẫu. Mẫu mặc định chỉ còn ở demo; quản trị có thể tạo mẫu mới bằng drawer hiện có. Lưu/xóa/bật tắt mẫu chỉ ghi đúng document, không đọc toàn bộ collection trước khi ghi. Bật/tắt mẫu đã mất báo lỗi thay vì tạo document thiếu nội dung. Lỗi ghi giữ nguyên bản nháp hoặc dòng đang xem và hiện thông báo; không tự báo thành công.

Kiểm thử gồm transport giả ở Chrome/WebKit, phân trang 2.507 bản ghi, ranh giới trang, đổi phiên và phản hồi trễ, retry, giữ draft, xác nhận gửi và trường hợp cấu hình chỉ còn cache offline. Các fixture chặn mạng ngoài và không gọi Firebase/FCM thật. Chạy `npm run test:notification-reads` và `npm run test:notification-read-ui`; hai suite cũng được nối vào nhóm data-cost hiện có.

## Phần còn mở

- `getPushAdminOverview` vẫn quét toàn bộ users/devices ở backend. Cache dùng chung và projection là đợt riêng; bản này không chứng minh mức giảm hóa đơn.
- Composer/UI rollout vẫn dùng danh bạ giới hạn 2.500 người. API tìm người nhận và giải quyết toàn bộ audience ở server chưa được thay thế.
- Backend gửi vẫn giữ giới hạn cũ: 1.000 ID được chọn và 2.000 hồ sơ cho `all`. Cần một đợt riêng xử lý đầy đủ audience/queue, không lấy trang đang hiển thị làm toàn bộ nhóm.
- Lịch sử tự động hóa vẫn chỉ gồm 10 lần gần nhất; giao diện không gọi đây là toàn bộ lịch sử.
- Chưa triển khai production trong đợt kiểm thử này. Không thay đổi Rules, index hoặc endpoint backend.
