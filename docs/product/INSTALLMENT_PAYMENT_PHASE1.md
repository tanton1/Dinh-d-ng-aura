# Thanh toán kỳ trả góp — giai đoạn 1

Học viên trả kỳ đến hạn bằng VietQR ngay trong tab **Lịch → Hợp đồng**, báo "Tôi đã chuyển khoản", và kế toán xác nhận trong **Tài chính → Trả góp**. Không có cổng thanh toán; tiền đi thẳng vào tài khoản ngân hàng của Aura.

## Luồng

1. Học viên bấm **Thanh toán** ở một kỳ đang chờ (hoặc **Thanh toán ngay** trên thẻ nhắc, hoặc link trong thông báo `#/schedule?tab=contract&pay=<contractId>~<installmentId|outstanding>`).
2. `getMyInstallmentPayment` trả số tiền kỳ, khoảng được trả (`minAmount`–`maxAmount`), các kỳ sau, tài khoản nhận và payload VietQR do server tạo. Nội dung chuyển khoản là **tên học viên + mã kỳ**, tối đa 25 ký tự (giới hạn NAPAS), ví dụ `HUYNH THI HAI AU VK669NZ7`. Tên dài giữ họ và tên, rồi chỉ tên; mã 8 ký tự cố định theo kỳ để khớp.
3. Học viên có thể **sửa số tiền** kỳ này: từ 100.000đ (hoặc đúng số kỳ nếu nhỏ hơn) đến toàn bộ công nợ còn lại. App dựng lại mã QR theo số tiền đã chọn (cùng thuật toán với server) và cho xem trước phần chênh lệch sẽ đi đâu.
4. Học viên bấm **Tôi đã chuyển khoản** → bước **Gửi bằng chứng chuyển khoản**: chọn ảnh chụp màn hình giao dịch thành công (không bắt buộc) và ghi chú → `submitMyInstallmentPaymentClaim` ghi `installmentPaymentClaims/{ipc_…}` trạng thái `submitted` với `amount` đã chọn và `installmentAmount` của kỳ. Báo cáo này **không** thay đổi hợp đồng hay sổ cái. Nếu chưa gửi ảnh, màn chờ xác nhận có mục **Bằng chứng chuyển khoản** để gửi sau (`action: 'attach_proof'`), hoặc gửi ảnh khác thay ảnh cũ.
5. Kế toán thấy báo trong **Chờ xác nhận chuyển khoản**, đối chiếu sao kê theo nội dung, bấm **Ghi nhận**. Form thu tiền có sẵn mở ra đã điền kỳ, số tiền và quỹ; kế toán sửa số tiền theo đúng sao kê nếu khác.
6. `recordContractPayment` ghi phiếu thu như mọi khoản thu khác và, trong cùng transaction, chuyển báo sang `confirmed` và gửi thông báo cho học viên. Thu tại quầy cho cùng kỳ cũng tự đóng báo.
7. Nếu không thấy tiền: **Từ chối** kèm lý do → học viên nhận thông báo và thấy lý do trên màn thanh toán.

## Ảnh biên lai

- App thu nhỏ ảnh về JPEG tối đa 1600px cạnh dài (giữ chữ sao kê đọc được, đổi HEIC thành JPEG) rồi tải lên `installment-proofs/{uid}/{claimId}/proof-<thời điểm>.jpg` trước khi gọi callable. Storage SDK chỉ tải khi học viên gửi ảnh.
- `storage.rules`: chỉ chủ tài khoản được tạo, tối đa 8MB, JPG/PNG/WebP, metadata `ownerUid`, `claimId`, `resourceKind: installment-payment-proof` phải khớp đường dẫn; không ai sửa hay xóa, kể cả admin không đọc trực tiếp.
- Callable kiểm lại đường dẫn và metadata trong Storage trước khi gắn ảnh vào báo; nếu báo không nhận ảnh (lỗi, sai số tiền…) server xóa ảnh vừa tải.
- Học viên và kế toán xem ảnh qua link ký 30 phút. Kế toán thấy ảnh ngay trong **Chờ xác nhận chuyển khoản** và trong form **Ghi nhận**; link hết hạn thì bấm làm mới.
- Gửi ảnh sau tăng `revision` của báo, nên kế toán đang mở bản cũ phải tải lại trước khi từ chối. Tối đa 10 lần gửi ảnh mỗi báo.

## Trả khác số kỳ

`functions/installment-schedule.js` (bản client: `src/domain/payments/installmentSchedule.ts`) chia lại lịch khi số tiền ghi nhận khác số kỳ:

- Kỳ được trả giữ **đúng số tiền đã nhận** và chuyển sang `paid`.
- **Thiếu**: phần thiếu cộng vào kỳ chờ kế tiếp; không còn kỳ nào sau thì tạo kỳ mới `<id>-rest`, hạn 30 ngày sau hạn cũ (hoặc sau ngày thu nếu muộn hơn). Đã đủ 24 kỳ thì từ chối.
- **Dư**: phần dư trừ dần vào các kỳ sau (gần nhất trước), kỳ nào về 0 thì bỏ khỏi lịch.
- Tổng các kỳ chờ luôn giảm đúng bằng số tiền thu, nên lịch vẫn khớp công nợ còn lại.
- Phiếu thu lưu `installmentSchedule.before/after`; **đảo phiếu** trả lại lịch cũ nếu lịch chưa đổi từ đó, còn không thì mở lại kỳ với số đã thu.

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

- `npm run test:installment-payments`: payload VietQR (CRC, cấu trúc NAPAS, client khớp server từng byte), nội dung chuyển khoản theo tên, khoảng số tiền được trả, chia lại lịch khi trả thiếu/dư (client khớp server), đóng báo khi ghi phiếu thu, kế hoạch nhắc hạn.
- `tests/installment-payment-ui/`: trang thử dựng component thật với callable giả lập (`npx vite --config tests/installment-payment-ui/vite.config.ts`).

## Chưa làm (giai đoạn 2–3)

- Tự khớp giao dịch qua webhook ngân hàng (SePay/Casso/PayOS). Mã 8 ký tự cuối nội dung đã cố định theo kỳ để khớp được.
- Xin dời hạn, ví điện tử, cộng điểm Aura khi trả đúng hạn.
- Chính sách quá hạn (hạn chế đặt buổi mới) — chưa chốt.
