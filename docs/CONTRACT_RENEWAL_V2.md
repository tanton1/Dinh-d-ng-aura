# Aura Contract Renewal V2

## Phạm vi vận hành

Trang `Tái ký & gia hạn` là nguồn thao tác duy nhất cho hợp đồng tái ký. Các nút tái ký cũ trong hồ sơ học viên chỉ chuyển người dùng tới workspace này; chúng không được tự tạo hợp đồng hoặc khoản thu.

| Nhóm | Phạm vi |
| --- | --- |
| Sales | Chỉ hồ sơ được gán cho chính tài khoản |
| Quản lý chi nhánh | Hồ sơ thuộc các chi nhánh được cấp |
| Admin/Super Admin | Toàn hệ thống |

Quyền được tính từ Identity V2. Trình duyệt không đọc/ghi trực tiếp `contractRenewalCases`, `contractRenewalActivities` hoặc `contractRenewalApprovals`.

## Vòng đời hồ sơ

```text
uncontacted → contacted → interested → quote_sent → follow_up
                                                   ↘ won
                                                    lost
```

- Hàng đợi được đối chiếu lúc `06:00 Asia/Ho_Chi_Minh` mỗi ngày.
- Chỉ hợp đồng mới nhất của mỗi học viên được đưa vào hàng đợi.
- Hồ sơ thắng/thất bại được giữ làm lịch sử, không bị công việc đồng bộ xóa.
- Nhắc việc chỉ được tạo trong notification center nội bộ. Scheduler không gửi Zalo, SMS, email hoặc FCM.

## SLA và ưu tiên

Ưu tiên kết hợp tình trạng hợp đồng, số buổi còn lại, hạn xử lý và hành động tiếp theo. Các trạng thái hiển thị:

- `overdue`: đã quá ngày SLA/hẹn.
- `due_today`: đến hạn hôm nay.
- `upcoming`: chưa tới hạn.
- `done`: hồ sơ đã thắng hoặc thất bại.

Hệ thống giới hạn dữ liệu trả về theo trang. Search, chi nhánh, người phụ trách, giai đoạn, rủi ro, SLA và phê duyệt đều được xử lý ở callable, không tải collection xuống browser.

## Báo giá và phê duyệt

Mọi tái ký phải có báo giá bất biến trước khi tạo hợp đồng.

Yêu cầu một người khác phê duyệt khi:

- mức giảm giá lớn hơn `10%`; hoặc
- chuyển tiếp hơn `3` buổi chưa sử dụng.

Người gửi không thể tự duyệt. Approval hết hạn sau 7 ngày. Admin cũng không được bỏ qua ngưỡng này.

## Giao dịch tái ký

`renewPtContract` kiểm tra revision của case, hợp đồng, package, quote và approval trước khi chạy một Firestore transaction. Transaction tạo/cập nhật đồng thời:

1. hợp đồng mới và liên kết hợp đồng nguồn;
2. lịch trả góp;
3. ledger khoản thu đầu kỳ;
4. biến động tài khoản quỹ;
5. quote/approval đã sử dụng;
6. case thắng và activity audit.

Khóa idempotency được kiểm tra trước revision để retry cùng yêu cầu trả lại kết quả cũ thay vì tạo trùng.

## Rollout

1. Chạy Functions tests, TypeScript, build và performance budget.
2. Deploy callable/scheduled Functions.
3. Deploy composite indexes và chờ trạng thái `READY`.
4. Deploy Firestore Rules callable-only.
5. Gọi `refreshContractRenewalQueue` với `apply=false` để xem số lượng dự kiến.
6. Admin xác nhận rồi gọi lại với `apply=true`.
7. Deploy Vercel frontend.
8. Smoke test lần lượt bằng Sales, Quản lý chi nhánh và Admin.

Không deploy frontend V2 trước Functions V2. Rollback giao diện bằng Vercel release trước; không xóa case, activity, quote, approval, ledger hoặc hợp đồng đã tạo.
