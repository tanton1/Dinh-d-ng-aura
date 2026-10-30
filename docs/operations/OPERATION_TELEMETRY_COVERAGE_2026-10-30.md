# Bổ sung phạm vi số đo thao tác

Cửa sổ log bảy ngày kết thúc 2026-10-30T10:29:41.209Z có 57 mẫu nhưng không có số đo chuẩn của Dashboard, Student 360 và tái ký. Kiểm tra source xác nhận ba handler chưa dùng wrapper telemetry chuẩn; việc không có mẫu không chứng minh các chức năng không được sử dụng.

Bản điều chỉnh này đặt `withPrivateFunctionTelemetry` tại ba handler gốc. Các alias vùng dùng cùng factory và ghi cùng tên thao tác; Cloud Run resource labels và release giữ thông tin service/revision để collector tách cohort. Không thay đổi đăng ký callable, phân quyền, response, lỗi, giao dịch, cơ chế chống trùng hoặc cấu hình tài nguyên.

| Thao tác | Endpoint dùng chung handler | Số đo bổ sung |
| --- | --- | --- |
| `getOperationsDashboard` | Gốc và `getOperationsDashboardRegional` | Cache memory/shared/miss; query và document trả về ở các scoped query đã gắn quan sát; aggregate count chỉ ghi một query, không coi số đếm là document trả về |
| `getStudent360Overview` | Gốc và `getStudent360OverviewRegional` | Lần đọc projection/usage view thực sự chạy; tuổi projection khi có timestamp hợp lệ; cờ freshness theo response cache hiện có |
| `renewPtContract` | Gốc và `renewPtContractRegional` | Kết quả, độ trễ, response bytes được lấy mẫu; chưa gán số query/document cho giao dịch |

Wrapper giữ chính sách hiện có: mặc định lấy mẫu 10% thành công, 100% lỗi. Log mới chỉ chứa nhãn thao tác/release, trạng thái xác thực dạng boolean, phân loại lỗi và số đo. Không chứa actor ID, source ID, correlation ID, token, request, response hay thông điệp lỗi. Mã lỗi ngoài allowlist được đổi thành `internal`. Lỗi sink đồng bộ hoặc bất đồng bộ không thay đổi kết quả nghiệp vụ; không chờ gửi log, tạo document telemetry hay chạy lại handler.

Các số query/document chỉ bao gồm những lượt đọc được gắn quan sát trực tiếp. Chưa bao gồm toàn bộ đọc phân quyền, shared-cache control, projection rebuild, join, retry nội bộ Firestore SDK hoặc công việc của lời gọi đã được hợp nhất. Lượt đọc lỗi không có snapshot xác nhận thì chưa có số document. Không lấy số hàng trong response hoặc số đếm aggregate làm đơn vị đọc. Các trường chưa đo được tiếp tục vắng mặt, không được thay thành 0.

`cacheHits` của Student 360 nghĩa là projection đạt yêu cầu freshness của luồng hiện có; nó không khẳng định đã tránh một lượt đọc Firestore. Tuổi projection là thời gian từ `generatedAtMillis`, không phải độ trễ của mọi nguồn dữ liệu. Dashboard có thể tái sử dụng một promise đang chạy mà không ghi thêm hit/miss, tránh gọi sự hợp nhất request là một cache đọc mới.

Các log nghiệp vụ cũ của Dashboard/Student 360 vẫn giữ nguyên. Cam kết loại định danh ở trên áp dụng cho những log chuẩn mới được thêm trong đợt này, không phải tuyên bố đã làm sạch mọi log của ứng dụng.

Collector bổ sung `getPushAdminOverview` vào danh sách cần quan sát. Nếu chưa có mẫu, nó hiện `unknown`; không suy ra không có traffic. Kiểm thử bao gồm thiếu số đo, cohort theo endpoint/release/auth, sample thành công, lỗi, sink hỏng, identity của response/exception, không retry giao dịch, đọc thực tế và cache mở lại. Chưa phát hành hoặc thu mẫu production bằng nhánh này; chưa suy ra p95 đại diện hay mức giảm Billing.
