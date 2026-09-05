# Aura PT Schedule Optimizer V10

## Mục tiêu

1. Xếp được ít nhất một buổi cho nhiều học viên nhất có thể.
2. Sau khi phủ học viên, tiếp tục xếp đủ mục tiêu tuần của từng người.
3. Ghép ca 2 học viên trước khi mở thêm ca mới.
4. Ưu tiên PT chính, PT phụ nhưng không bỏ trống học viên khi PT khác cùng chi nhánh có thể dạy.
5. Tránh ba ngày tập liên tiếp khi còn phương án khác; không dùng quy tắc này để làm học viên mất buổi.

## Luồng chạy

### 1. Chuẩn hóa dữ liệu đầu vào

- Chỉ lấy học viên và PT đang hoạt động trong chi nhánh đã chọn.
- Xác định đúng một hợp đồng còn hiệu lực theo ngày của từng buổi.
- Trừ quota đã dùng và các buổi đang giữ chỗ.
- Loại ngày nghỉ, ca PT OFF/nghỉ phép, ca vượt sức chứa và lịch rảnh chưa xác nhận.
- Giữ bất biến các buổi đã publish, đã khóa hoặc đã tính buổi.

### 2. Tạo toàn bộ cạnh có thể xếp

Mỗi cạnh `học viên → PT + ngày + giờ` chỉ tồn tại khi:

- Cùng chi nhánh.
- Học viên và PT đều rảnh.
- Không trùng một buổi khác của học viên trong ngày.
- Hợp đồng hợp lệ, không bảo lưu và còn quota.
- Ca PT còn chỗ.

PT được phân loại trên từng cạnh:

- `primary`: PT chính.
- `secondary`: PT phụ.
- `support`: PT khác đang hoạt động trong cùng chi nhánh.
- `open`: hợp đồng không chỉ định PT; mọi PT cùng chi nhánh ngang quyền và không cảnh báo.

### 3. Phủ học viên tối đa

Vòng đầu dùng matching có đường tăng để mỗi học viên khả thi nhận một buổi trước. Học viên ít phương án nhất và hợp đồng sắp hết hạn được xét trước. Một học viên linh hoạt có thể được chuyển sang ca khác để nhường ca duy nhất cho học viên bị giới hạn.

### 4. Xếp đủ mục tiêu tuần

Chạy nhiều vòng, mỗi vòng tối đa một buổi cho mỗi học viên còn thiếu. Thứ tự lựa chọn trong một vòng:

1. Ghép vào ca đang có một học viên.
2. Không tạo chuỗi ba ngày liên tiếp nếu có lựa chọn tương đương.
3. PT chính.
4. PT phụ.
5. PT hỗ trợ cùng chi nhánh.
6. PT chính thức chưa đạt mục tiêu ca/ngày.
7. Cân tải theo mục tiêu và hạng PT.

Mục tiêu ca/ngày là ưu tiên phân bổ, không phải trần làm mất lịch của học viên. PT đã đạt hoặc vượt mốc vẫn được xếp thêm nếu đó là cách tăng số buổi được phục vụ; không phát sinh bước xác nhận riêng vì vượt mốc.

### 5. Pass cứu buổi thiếu

Sau các vòng matching thông thường, optimizer chụp lại toàn bộ học viên còn thiếu và chạy một pass tìm kiếm có giới hạn:

1. Học viên chưa có buổi nào.
2. Học viên còn thiếu nhiều buổi.
3. Học viên còn ít phương án khả thi.
4. Học viên thiếu kéo dài và hợp đồng gần hết hạn.

Với mỗi học viên, hệ thống thử tối đa nhiều phương án thay vì nhận ngay kết quả đầu tiên:

- Ghép vào ca `1/2`.
- Dùng ca trống của PT còn khả năng nhận.
- Dùng ca hợp lệ của PT đã vượt mốc tải.
- Di chuyển một entry tự động linh hoạt.
- Chạy chuỗi đổi chỗ tối đa bốn bước để giải phóng slot hiếm.

Các phương án được nhìn trước trên nhóm học viên còn thiếu. Thứ tự chọn là: giữ khả năng phủ học viên, giữ tổng buổi có thể cứu, tăng số học viên có thể đủ mục tiêu, tăng ca đôi, giảm ca lẻ, giảm PT hỗ trợ và cuối cùng giảm số lần di chuyển.

Nếu hết ngân sách tìm kiếm, kết quả được ghi `SEARCH_LIMIT_REACHED`; hệ thống không kết luận sai rằng học viên hoàn toàn không thể xếp.

### 6. Gom ca và chạy lại

Chỉ di chuyển các entry tự động chưa khóa. Hệ thống thử ghép hai ca lẻ thành ca đôi nếu vẫn giữ đúng hợp đồng, lịch rảnh, sức chứa, một buổi/ngày và không tạo thêm chuỗi ba ngày liên tiếp.

Sau khi gom ca, slot vừa trống được đưa lại vào pass phủ và pass cứu thiếu. Chu trình lặp đến khi không còn cải thiện hoặc đạt giới hạn tìm kiếm an toàn.

### 7. Gắn cảnh báo PT hỗ trợ

Nếu hợp đồng có PT chính/phụ nhưng buổi được giao cho PT khác:

- Buổi vẫn hợp lệ và có thể publish.
- Entry và session được đánh dấu `trainerAssignmentWarning`.
- Ô lịch, chi tiết ca, hồ sơ học viên và bước xác nhận publish hiển thị cảnh báo màu cam.
- Audit log ghi nhận đây là PT hỗ trợ.

Nếu hợp đồng không có PT chính/phụ, mọi PT cùng chi nhánh đều được xem là phù hợp và không hiển thị cảnh báo.

## Điều kiện chặn vẫn giữ nguyên

PT hỗ trợ không được phép vượt qua các điều kiện: khác chi nhánh, PT không hoạt động, không có lịch rảnh, đang nghỉ, ca đầy, học viên trùng ngày, hợp đồng không hợp lệ, hợp đồng bảo lưu hoặc hết quota.
