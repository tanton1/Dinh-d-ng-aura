# Tổng quan Push: tổng hợp theo yêu cầu và dùng chung kết quả

Tiếp nối [kế hoạch tối ưu](GRAPHIFY_OPTIMIZATION_PLAN_2026-10-30.md) và [đọc thông báo theo tab](NOTIFICATION_READ_SCOPE_2026-10-30.md). Trước thay đổi, mỗi lần gọi `getPushAdminOverview` đọc toàn bộ users, devices, hai nguồn nhật ký trong 24 giờ và hai bản ghi mới nhất. Mở trang ở nhiều phiên quản trị lặp lại cùng phép tổng hợp.

## Cách đọc mới

- Mỗi yêu cầu vẫn kiểm tra token và hồ sơ quản trị hiện tại trước khi đọc cache. Giữ nguyên chính sách legacy `role` khớp ở hai phía, không thay bằng một quyền khác.
- Kết quả tổng hợp được giữ 60 giây sau khi xây dựng trong `systemOperationsDashboardCache`, với khóa riêng có phiên bản schema. Các quản trị cùng phạm vi toàn hệ thống dùng chung kết quả; không có cache hồ sơ theo tiến trình.
- Lease dùng chung chỉ cho một bên xây dựng kết quả ở một thời điểm. Yêu cầu làm mới chỉ nhận kết quả có snapshot nguồn mới hơn lần đọc xác nhận của nó; kết quả cũ công bố muộn không đáp ứng yêu cầu làm mới.
- Khi cần xây dựng, dùng một transaction chỉ đọc cho toàn bộ nguồn. Mỗi trang tối đa 500 document, chỉ chọn trường dùng trong phép tính. Cursor device giữ toàn bộ đường dẫn; nhật ký sắp theo timestamp và document ID để không mất bản ghi trùng thời gian.
- Profile chỉ giữ cờ cần thiết trong bộ nhớ. Token thiết bị chỉ tồn tại trong trang dữ liệu đang xử lý để kiểm tra điều kiện cũ; không trả về, lưu vào cache hay ghi log.
- Mỗi nguồn có giới hạn 25.000 document và đọc thêm một bản ghi để phát hiện vượt giới hạn. Không công bố tổng của phần đã đọc. Vượt giới hạn hoặc tổng số bị tràn trả `complete:false` với các chỉ số `null`; giao diện báo chưa thể xác nhận dữ liệu.
- Giữ công thức hiện có cho role trống/legacy, tài khoản vô hiệu hóa, tùy chọn Push, liên kết device qua `userId`, tổng FCM chấp nhận/lỗi và thời điểm nhật ký mới nhất. Đây là báo cáo tổng hợp, không thay đổi quyết định người nhận khi gửi.

Không thêm trigger hoặc lịch chạy. Cache hết hạn được xây dựng khi có người cần đọc; không có polling. Dùng cơ chế retention của collection cache hiện có. Các giới hạn runtime, tên endpoint, vùng, App Check, invoker và named database giữ nguyên.

## Độ mới và giao diện

Mở trang thông thường có thể nhận kết quả dùng chung. Giao diện hiện `asOf` từ thời điểm đọc máy chủ và nút Làm mới. `windowStart` ghi đúng mốc bắt đầu cửa sổ 24 giờ được dùng trong query. TTL tính từ lúc công bố cache, không phải cam kết độ tuổi dữ liệu luôn dưới 60 giây.

Làm mới, thử lại và cập nhật sau đăng ký thiết bị/gửi thông báo truyền `forceRefresh:true`. Nếu Tổng quan đang ẩn khi thao tác thành công, cờ cần dữ liệu mới được giữ tới lúc mở lại; không đọc ngầm tab ẩn. Phản hồi cũ không xóa cờ này và lỗi đọc không biến thành số 0. Client vẫn đọc được phản hồi phiên bản backend trước để triển khai backend/web theo từng bước.

## Đo lường và kiểm thử

Endpoint dùng telemetry lấy mẫu có sẵn, chỉ lưu trường cho phép, không lưu actor/source/correlation ID hoặc token. `logicalQueries` và `documentsReturned` ghi các truy vấn xác thực/nguồn đã quan sát; chưa bao gồm thao tác nội bộ của cache. Một cache hit vẫn có lần đọc hồ sơ quản trị và document cache. Không dùng các số này làm đơn vị hóa đơn Firestore.

Kiểm thử hành vi nằm ở `functions/push-overview-reads.test.js` và `functions/push-overview-reads.integration.cjs`: công thức legacy, phân trang vượt 3.000 hồ sơ, timestamp trùng, cursor collection group, vượt giới hạn ở từng nguồn, mất quyền khi cache còn mới, snapshot nhất quán, lease đồng thời và refresh sau thay đổi dữ liệu. Unit và emulator được nối vào `test:app-optimization` / `test:app-optimization-transaction` của CI.

Web bổ sung kiểm thử truyền cờ làm mới, báo cáo chưa đầy đủ, thời điểm nguồn và trở lại Tổng quan sau gửi. Các kiểm thử sử dụng transport giả/emulator, không gửi FCM thật.

## Phạm vi phát hành và phần còn mở

Chỉ cần deploy endpoint `getPushAdminOverview` ở `asia-southeast1` và bản web. Đối chiếu metadata toàn bộ export, kiểm thử, CI, image thực sự phục vụ và đọc màn hình production trước khi chốt. Không triển khai Rules/index/IAM hoặc endpoint gửi trong thay đổi này.

Cache giảm việc lặp tổng hợp trong cửa sổ dùng chung; lần hết hạn/làm mới vẫn quét nguồn trong giới hạn đã nêu. Cần số đo traffic thực tế trước khi kết luận mức giảm chi phí hoặc quyết định chuyển sang projection theo sự kiện.

Danh sách người nhận và retry của luồng gửi là bước riêng trong [kế hoạch audience/delivery](PUSH_AUDIENCE_DELIVERY_PLAN_2026-10-30.md). Thay đổi này không nâng các giới hạn 2.500/1.000/2.000 của luồng đó.
