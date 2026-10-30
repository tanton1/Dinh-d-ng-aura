# Sửa lỗi và tối ưu sau kiểm tra Graphify — 30/10/2026

Phạm vi bắt đầu từ main `5e5337036207d48016fdadeceef29ed0a88b726c`. Các sửa đổi dưới đây xử lý năm lỗi đã tái hiện trong lần kiểm tra Graphify, đồng thời giảm việc đọc lại dữ liệu và tải giao diện. Quy tắc ghi nhận tiền thu, doanh thu thực hiện và công thức tính lương được giữ nguyên.

## Tính đúng và quyền truy cập

- **Chất lượng PT:** phản hồi và mẫu số buổi tập dùng cùng phạm vi PT, chi nhánh và ngày tập. Áp dụng điều kiện trước giới hạn trang; có cursor và trạng thái dữ liệu chưa đầy đủ.
- **Performance:** phân trang bằng chứng trong phạm vi đã được cấp quyền; checklist hồ sơ được đọc riêng theo PT để không phụ thuộc trang bằng chứng đang mở. Cursor gắn tài khoản và bộ lọc.
- **Học viên 360:** kết quả nhật ký chỉ được đưa lên màn hình nếu vẫn thuộc tab, khoảng ngày và phạm vi yêu cầu hiện tại.
- **Aura Club:** mất quyền, đổi tài khoản hoặc đổi phiên đăng nhập xóa dữ liệu riêng tư đang giữ trong giao diện. Các lỗi quyền từ trang con và thao tác cập nhật cũng làm đóng nội dung cũ.
- **Thông báo:** mỗi lượt gửi có receipt, danh sách người nhận cố định, ID inbox cố định và tiến độ từng người nhận. Retry hoặc tải lại trang tiếp tục cùng lượt. FCM không có cam kết exactly-once: nếu mất xác nhận, hệ thống ghi nhận kết quả chưa rõ và không tự gửi lại phần đó. Client cũ dùng chống trùng theo nội dung/người gửi/nhóm nhận trong 24 giờ; lượt chưa hoàn tất hoặc chưa rõ kết quả tiếp tục giữ receipt.

## Dữ liệu và giao diện

**Thành viên Aura Club** chuyển sang truy vấn theo hạng, tên hoặc số điện thoại trên máy chủ. Mỗi trang mặc định 30 thành viên; không tự tải hết danh sách. Tổng và số từng hạng lấy từ toàn bộ projection phù hợp, không phải độ dài trang. Tìm tên hỗ trợ tiền tố từ/cụm từ, bỏ dấu; số điện thoại bỏ dấu cách và dấu phân cách. Trước khi trả dữ liệu ví, backend kiểm tra lại hồ sơ và chi nhánh hiện tại. Projection đồng bộ theo sự kiện nên tổng có thể trễ ngắn; nếu phát hiện trang chưa đồng bộ, tổng chuyển thành chưa xác định. Thời điểm backfill không được coi là watermark của toàn bộ dữ liệu.

**Danh bạ Học viên V2 dành cho admin** lọc từ hồ sơ và các hợp đồng liên quan, gồm cả hồ sơ chưa có projection. Ngày tham gia và điều kiện được tập trong tuần là hai bộ lọc khác nhau: một hồ sơ mới không mặc nhiên có hợp đồng đã đến ngày tập. Cursor giữ cùng snapshot trong tối đa 15 phút. Mỗi yêu cầu xét tối đa 500 hồ sơ; giao diện tự tiếp tục tối đa ba trang rỗng rồi cho người dùng bấm tiếp. Tổng chưa hoàn tất được ghi rõ, không trình bày một phần danh sách thành toàn bộ. Cờ rollout toàn cục không bị thay đổi.

**Performance** dùng lại dữ liệu buổi tập trong cùng phép tính, đọc gia hạn theo từng nhóm có giới hạn. Không thêm cache điểm thiếu cơ chế vô hiệu hóa. **Bảng lương** lưu bằng chứng kiểm tra buổi tập tại bước duyệt và kiểm tra lại khi khóa; dữ liệu đã thay đổi khiến thao tác khóa bị từ chối trước khi tạo bút toán. Kỳ khóa/trả có snapshot hợp lệ không quét lại toàn bộ tháng khi xem; kỳ cũ chưa có bằng chứng vẫn được kiểm tra trực tiếp. Tên nhân sự đã lưu trong kỳ không bị truy vấn lại.

**Báo cáo kinh doanh** hiển thị “Chưa đủ dữ liệu” khi nguồn bị giới hạn; không dùng tổng một phần làm KPI hay biểu đồ hoàn chỉnh. Các chỉ số đối soát chỉ bị ẩn theo nguồn dữ liệu mà chúng phụ thuộc.

**Giao diện** dùng chung màu hồng–cam, nút gọn và khoảng cách theo mẫu Học viên. Các panel Tài chính và Bảng lương tải khi mở. So sánh artifact gzip JS+CSS, sau khi trừ bootstrap và shell: Tài chính/Tổng quan từ 87.395 xuống 16.890 byte; phần tĩnh trang Bảng lương từ 71.491 xuống 45.175 byte. Đây là kích thước build, không phải phép đo CPU hoặc tốc độ mạng thực tế.

## Vận hành và phát hành

Thêm telemetry cho worker Student360 và tác vụ weekly để phân biệt poll, claim, việc được gộp và số lần rebuild. Không thêm truy vấn hoặc ghi Firestore chỉ để đo. Các bộ đếm chỉ phản ánh queue control/discovery đã quan sát, không đại diện toàn bộ billed reads. `queueWaitMs` là tuổi yêu cầu được gộp gần nhất. Giữ nguyên lịch chạy và tài nguyên cho đến khi có mẫu trước/sau phù hợp; không giảm tần suất chỉ dựa trên CPU allocation.

Ba HTTP 503 trong cửa sổ kiểm tra đã được nối với request/revision: đều đã qua kiểm tra đăng nhập và xảy ra trên revision đang phục vụ. Overview ghi nhận lỗi dependency `unavailable`, có thể thử lại; log refresh chưa đủ để kết luận nguyên nhân. Không có cơ sở thay cơ chế khóa hay công bố đã sửa nguyên nhân ba lỗi này. Bổ sung phân loại reason/phase giới hạn và telemetry riêng cho overview/refresh, không ghi định danh, nội dung request hoặc thông báo lỗi thô, để phân biệt các lần lỗi tiếp theo.

35 chỉ mục tạo thêm được liệt kê trong `ops/graphify-fixes-indexes-20261030.json`. Công cụ chỉ tạo chỉ mục thiếu, không xóa chỉ mục khác. Script `scripts/backfill-loyalty-member-directory.cjs` mặc định chỉ đọc; apply yêu cầu nguồn đã commit sạch, SHA và tên database chính xác. Script chỉ ghi projection/thông tin sẵn sàng, không sửa hồ sơ, ví điểm, chứng từ hoặc buổi tập.

Thứ tự phát hành: đợi chỉ mục READY → deploy callable/trigger theo manifest → backfill projection và xác minh → phát hành frontend. Mỗi endpoint phải được kiểm tra đúng image digest, revision đang phục vụ và traffic. Với Push, đợi hết thời gian tối đa của handler cũ sau chuyển traffic trước khi xác nhận hoàn tất cutover.

Các regression được đưa vào CI: phân trang hơn 1.000 thành viên; danh bạ hơn 2.500 hồ sơ; nhóm 31 hồ sơ mới/29 đủ điều kiện tuần; scope PT; replay và lỗi giữa chừng khi gửi; đổi phiên/mất quyền; race khi đổi bộ lọc; dữ liệu kỳ lương đổi giữa duyệt và khóa; nguồn báo cáo bị giới hạn. Không gửi thông báo thật hoặc tạo nghiệp vụ tài chính trong kiểm thử.
