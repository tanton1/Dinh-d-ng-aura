# Thanh toán kỳ trả góp — giai đoạn 1

Học viên trả kỳ đến hạn bằng VietQR ngay trong tab **Lịch → Hợp đồng**, báo "Tôi đã chuyển khoản", và kế toán xác nhận trong **Tài chính → Trả góp**. Không có cổng thanh toán; tiền đi thẳng vào tài khoản ngân hàng của Aura.

## Luồng

1. Học viên bấm **Thanh toán** ở một kỳ đang chờ (hoặc **Thanh toán ngay** trên thẻ nhắc, hoặc link trong thông báo `#/schedule?tab=contract&pay=<contractId>~<installmentId|outstanding>`).
2. `getMyInstallmentPayment` trả số tiền kỳ, hạn, tài khoản nhận và payload VietQR do server tạo. Nội dung chuyển khoản là mã cố định của kỳ: `AURA XXXXXXXX`.
3. Học viên bấm **Tôi đã chuyển khoản** → `submitMyInstallmentPaymentClaim` ghi `installmentPaymentClaims/{ipc_…}` trạng thái `submitted`. Báo cáo này **không** thay đổi hợp đồng hay sổ cái.
4. Kế toán thấy báo trong **Chờ xác nhận chuyển khoản**, đối chiếu sao kê theo nội dung, bấm **Ghi nhận**. Form thu tiền có sẵn mở ra đã điền kỳ, số tiền và quỹ.
5. `recordContractPayment` ghi phiếu thu như mọi khoản thu khác và, trong cùng transaction, chuyển báo sang `confirmed` và gửi thông báo cho học viên. Thu tại quầy cho cùng kỳ cũng tự đóng báo.
6. Nếu không thấy tiền: **Từ chối** kèm lý do → học viên nhận thông báo và thấy lý do trên màn thanh toán.

## Nhắc hạn

`sendInstallmentDueRemindersScheduled` chạy 08:00 giờ Việt Nam, nhắc ở 3 mốc: trước hạn 3 ngày, đúng hạn, quá hạn 3 ngày. Bỏ qua hợp đồng đã đóng/bảo lưu, học viên chưa liên kết tài khoản và kỳ học viên đã báo chuyển khoản. Thông báo trong app luôn được tạo; push đi theo công tắc `system/push_settings.enabled`. Mã thông báo cố định nên chạy lại không gửi trùng.

## Tài khoản nhận

**Sổ quỹ → VietQR**: chọn quỹ loại Ngân hàng, ngân hàng (hoặc nhập BIN), số tài khoản, tên chủ tài khoản. Học viên thấy tài khoản của chi nhánh mình; nếu cả hệ thống chỉ bật một tài khoản thì mọi chi nhánh dùng chung. Có nhiều tài khoản mà chi nhánh không có tài khoản riêng thì không hiện QR, để tiền không vào nhầm chi nhánh.

## Triển khai

1. `firebase deploy --only firestore:indexes` và chờ hai index `installmentPaymentClaims` ở trạng thái READY.
2. `firebase deploy --only firestore:rules` (collection mới chỉ cho callable).
3. Deploy Functions (5 callable + 1 scheduled; tổng manifest 591).
4. Cấu hình ít nhất một tài khoản trong **Sổ quỹ → VietQR**.
5. Deploy frontend.

## Kiểm thử

- `npm run test:installment-payments`: payload VietQR (CRC, cấu trúc NAPAS, client khớp server từng byte), mã chuyển khoản, quy tắc kỳ được trả, đóng báo khi ghi phiếu thu, kế hoạch nhắc hạn.
- `tests/installment-payment-ui/`: trang thử dựng component thật với callable giả lập (`npx vite --config tests/installment-payment-ui/vite.config.ts`).

## Chưa làm (giai đoạn 2–3)

- Tự khớp giao dịch qua webhook ngân hàng (SePay/Casso/PayOS). Mã `AURA XXXXXXXX` đã cố định theo kỳ để khớp được.
- Ảnh biên lai, trả gộp nhiều kỳ, trả một phần, xin dời hạn, ví điện tử, cộng điểm Aura khi trả đúng hạn.
- Chính sách quá hạn (hạn chế đặt buổi mới) — chưa chốt.
