# Rà soát toàn hệ thống Aura Fitness OS: chi phí, hiệu năng, bảo mật

Ngày rà soát: 11/11/2026 (giờ Việt Nam). Mốc source: `1231e57` trên `main`. Nhánh làm việc: `claude/cost-perf-audit-20261111`.

**Cập nhật 16:10 ngày 11/11:** sau khi được duyệt, các commit của nhánh cùng ba đề xuất P1, P2, P6 đã lên `main` (`31a00c7`) và production. Chi tiết, số đo và phần chưa làm nằm ở [mục I](#i-áp-dụng-đề-xuất-và-deploy-ngày-1111). Các mục 0 đến H giữ nguyên nội dung lúc rà soát; cột trạng thái ở mục B đã được cập nhật.

Tài liệu này nối tiếp [phân tích chi phí 11/11](COST_USAGE_ANALYSIS_2026-11-11.md), [kế hoạch luồng dữ liệu 25/10](../product/DATA_FLOW_COST_OPTIMIZATION_PLAN_2026-10-25.md) và [audit 29/10](../APP_AUDIT_2026-10-29.md). Phần mới: bảng chi phí 42 ngày cho mọi dịch vụ, cấu hình thật của 602 function, độ trễ và lỗi theo từng service, kích thước document, và năm thay đổi đã kiểm thử trên nhánh.

## 0. Kết luận

1. **Chi phí hiện tại thấp; gần như toàn bộ tiền của 6 tuần qua nằm ở ba sự cố**, không nằm ở vận hành bình thường. Mức nền Cloud Run là 30–45 nghìn vCPU-giây mỗi ngày. Khoảng 14–20/10 con số này là 4–9 triệu mỗi ngày. Ngày 07–11/11 là 130–140 nghìn do bảy trigger bị tính tiền thời gian chờ.
2. **Hai bản sửa ngày 11/11 của phiên phân tích chi phí có hiệu lực.** Đơn vị đọc Firestore giảm từ 1,1–1,6 triệu mỗi giờ xuống 25–117 nghìn ở ba giờ đầu sau deploy. Đơn vị ghi giảm từ 30–42 nghìn xuống 3–5 nghìn mỗi giờ. Cửa sổ đo còn ngắn, cần đo lại sau 7 ngày.
3. **Việc quan trọng nhất còn lại là chốt chặn, không phải tối ưu thêm.** Cả ba sự cố đều kéo dài nhiều ngày trước khi có người nhìn thấy. Nhánh này thêm một công cụ chỉ-đọc phát hiện đúng ba kiểu đó trong vòng một ngày.
4. **Điểm yếu lớn nhất về trải nghiệm là độ trễ của hai màn hình vận hành**: bảng lịch tuần của admin (p95 khoảng 18,6 giây) và không gian làm việc của PT (p95 khoảng 9,6 giây).
5. Mục tiêu giảm 30%: so với mức nền trước 11/11, ước tính theo giá niêm yết giảm 35–65% sau các bản sửa đã deploy. Đây là dự phóng từ số đo sử dụng; **chưa đối chiếu hóa đơn** vì tài khoản không có Billing export.

## 1. Phạm vi và phương pháp

- Quét tự động 100% file được Git theo dõi (1.914 file): mọi điểm đọc ghi Firestore, listener, timer, callable, trigger, lịch chạy, lệnh gọi AI, truy vấn không giới hạn, phụ thuộc không dùng, file không được tham chiếu.
- Đọc sâu từng dòng các đường có rủi ro chi phí hoặc bảo mật: khởi tạo `functions/index.js`, các runtime rút gọn, `pt-schedule-weekly-view.js`, các job theo lịch, hàng đợi Student 360, bảo trì duyệt bữa ăn, webhook CRM, `DatabaseContext.tsx`, khởi động client, hai file rules. Phần còn lại (khoảng 270 nghìn dòng mã và 80 nghìn dòng test) được rà theo mẫu, **không** đọc từng dòng.
- Số đo production lấy từ Cloud Monitoring, `gcloud` chỉ-đọc và Cloud Billing Catalog. Không ghi gì lên production. Khảo sát kích thước document chỉ tính số byte, không in nội dung.
- Mọi con số tiền là **mức sử dụng đo được × giá niêm yết**. Chỉ báo cáo Billing mới xác nhận được số thực trả.

## A. Bản đồ kiến trúc và dịch vụ đang dùng

```text
Trình duyệt (PWA React 19 + Vite 7, Vercel build từ main)
  ├─ Firebase Auth (email, Google, OTP điện thoại chỉ cho số VN)
  ├─ Callable: tên *Regional / *Overflow ở asia-east1 trước, bản gốc ở asia-southeast1 khi lỗi hạ tầng
  ├─ Firestore listener: hồ sơ, tín hiệu thay đổi, một số trang quản trị cũ
  └─ Storage: ảnh tiến độ, ảnh bữa ăn, media khóa học
Cloud Functions Gen 2 = Cloud Run (602 service, Node 22)
  ├─ 523 HTTPS (callable, 22 job Cloud Scheduler, 1 webhook Pancake, 1 hàng đợi Cloud Tasks)
  └─ 79 trigger Firestore qua Eventarc
Firestore Enterprise, database tên riêng, asia-southeast1, PITR 7 ngày
  └─ nguồn chuẩn → trigger → bản dựng sẵn (contractUsageViews, studentOperationalViews,
     operationalActions, ptScheduleWeeklyViews, operationsDailyAggregates, loyalty…)
```

| Dịch vụ | Trạng thái đo được ngày 11/11 |
| --- | --- |
| Cloud Run / Functions | 602 service: 410 ở asia-southeast1, 157 ở asia-east1, 35 ở asia-southeast2. Tất cả `minInstances = 0`. CPU chỉ cấp khi có request và startup CPU boost bật (kiểm tra trên 2 service mẫu). 583 service dùng 256 MiB. 343 service dùng 1/6 vCPU. |
| Firestore | 4 database Enterprise trong project. Chỉ database production có lưu lượng: 0,38 GiB dữ liệu, 0,38 GiB PITR, 199 composite index, 15 chính sách TTL, không có lịch backup. |
| Cloud Scheduler | 22 job. Dày nhất: mỗi phút (1), mỗi 5 phút (3), mỗi 15 phút (1), mỗi 30 phút (4). |
| Cloud Storage | 3,2 GiB. Bucket Firebase mặc định nằm ở **US-EAST1** (0,46 GiB, 534 object). |
| Identity Platform | 94 SMS OTP trong 30 ngày, chỉ cho phép số Việt Nam. |
| App Check | Chỉ bắt buộc với callable AI; 563 function để `ENFORCE_APP_CHECK=false`. |
| Realtime Database | Chỉ backend đọc ghi vị trí giao hàng; rules chặn mọi client. |
| AI (apikey.fun, OpenRouter) | 41 lượt quét ảnh, 5 lượt Coach, 5 bản nháp thực đơn, 3 nhận xét bữa ăn trong 30 ngày. |
| Google Maps, Gemini API trực tiếp | Không có lưu lượng trong 7 ngày. |
| Ngoài Google Cloud | Vercel (hosting), GitHub Actions (CI), Pancake (CRM, chưa nối trang nào). Không đo được chi phí từ đây. |

Quota Cloud Run của project: 20 vCPU và 100 instance chạy đồng thời mỗi vùng, tối đa 3 vùng. Đây là lý do của nhãn `quota-safe`, CPU phân số và việc chia ba vùng.

## B. 20 vấn đề đáng chú ý nhất

Mức độ: **C** cao, **T** trung bình, **N** nhỏ. Trạng thái: *đã sửa* (trên `main`), *nhánh* (trên nhánh này, chưa deploy), *đề xuất* (cần duyệt).

| # | Mức | Vấn đề và bằng chứng | Vị trí | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | C | Bảy trigger bị tính 1,45 triệu giây instance trong 7 ngày cho 6.063 request (134–383 giây mỗi request, bình thường 0,5–2 giây). Nguyên nhân phía nền tảng chưa rõ. | `syncPtScheduleWeeklyViewFromContract*`, `syncStudent360Contract*`, `sync*OperationalActions`, `syncLoyaltyContractSpend` | Đã sửa bằng deploy lại 11/11. Nhánh thêm cảnh báo. |
| 2 | C | Khoảng 14–20/10 Cloud Run cấp phát 45 triệu vCPU-giây và 24,5 triệu GiB-giây trong 6 ngày, gấp 200 lần mức nền. Khớp với việc vài trăm function có instance tối thiểu. | Cấu hình deploy thời điểm đó | Đã hết từ 24/10. Nhánh thêm cảnh báo cấu hình. |
| 3 | C | Trigger tìm bảng lịch tuần bằng cách query tài liệu 430–650 KB; Firestore Enterprise tính đơn vị đọc theo cả tài liệu. Chiếm gần hết 10–11 triệu đơn vị đọc mỗi ngày. | `functions/pt-schedule-weekly-view.js` | Đã sửa (`35d39f4`, `eb5bb77`). |
| 4 | C | `getPtScheduleWeeklyViewRegional`: 1.817 lượt/tuần, p50 khoảng 2,3 giây, p95 khoảng 18,6 giây, bộ nhớ p99 87% của 256 MiB. Chạy 1/6 vCPU ở Đài Loan trong khi database ở Singapore. | `functions/index.js` (`ptScheduleWorkspaceRegionalOnCall`), `pt-schedule-weekly-runtime.js` | Đã deploy P1 ngày 11/11 (mục I). |
| 5 | C | `getMyTrainerWorkspaceRegional`: 1.590 lượt/tuần, p50 khoảng 2,1 giây, p95 khoảng 9,6 giây, 17% lượt là cold start 3,1 giây. | `functions/pt-operations-v2.js:1931` | Đã deploy P1 ngày 11/11; P3 chưa làm. |
| 6 | T | Mỗi lần dựng lại bảng lịch tuần đọc tài liệu 0,5 MB hai lần và ghi lại toàn bộ, kể cả khi chỉ cờ điều khiển đổi. `students` 260 KB, `contracts` 85 KB, `weeklySessionCoverage` 67 KB. | `rebuildPtScheduleWeeklyView` | Đề xuất P5. |
| 7 | T | Trigger thiếu chỗ khi sự kiện đến dồn: `processStudent360SourceQueue` trả 429 hoặc 500 cho 23% request, `syncPtScheduleWeeklyViewFromSession` 43%. Sự kiện được gửi lại nên bản dựng sẵn trễ. | `student-360-background-functions.js`, `index.js:1017` | Đã deploy P2 ngày 11/11. |
| 8 | T | 9.422 cold start mỗi tuần (11% request), trung bình 2,5 giây. `index.js` nạp 952 module; runtime rút gọn nạp khoảng 690. Khoảng 565 function chưa có runtime rút gọn. | `functions/index.js`, `background-runtime.js` | Đề xuất P3. |
| 9 | T | Job 15 phút đọc mọi bữa ăn chờ duyệt và action tương ứng dù không có gì đổi: khoảng 2.700 đơn vị đọc mỗi lượt, hơn 90% đơn vị đọc của một giờ không có người dùng. | `functions/nutrition-review-maintenance.js` | Đã deploy ngày 11/11 (`a728389`). |
| 10 | T | Tài khoản staff và admin mở trang chủ thành viên gọi hai callable chỉ dành cho học viên: 398/1.332 lượt `getMyLoyaltyDashboard` và 354/3.034 lượt `listMyStudentPtSchedule` trả 403 trong 7 ngày. | `LoyaltyHomeCard.tsx`, `HomePage.tsx`, `ProgressPage.tsx`, `NotificationsPage.tsx` | Đã lên bản web ngày 11/11 (`f553e15`). |
| 11 | T | Khoảng 25 function 256 MiB dùng 77–89% bộ nhớ ở p99 (ví dụ `refreshContractRenewalQueueScheduled` 89%, `listMyStudentPtScheduleRegional` 88%). Riêng việc nạp `index.js` đã chiếm khoảng 73%. | Cấu hình bộ nhớ trong `index.js` | Đã deploy cho 4 function trên 86%; phần còn lại theo dõi. |
| 12 | T | App Check không bắt buộc với callable không phải AI. Người có tài khoản hợp lệ có thể gọi dồn dập; thiệt hại bị chặn bởi `maxInstances` 1–8 mỗi function. | `index.js:407`, biến `ENFORCE_APP_CHECK` | Đề xuất P8. |
| 13 | T | SMS OTP là dòng chi phí đáng kể so với phần còn lại: 94 SMS × 0,13 USD ≈ 12 USD mỗi tháng, tăng tuyến tính theo số lần đăng nhập bằng số điện thoại. | `AuthContext.tsx` (`sendPhoneOtp`) | Đề xuất P12. |
| 14 | T | Receipt chống lặp lưu nguyên kết quả và không có TTL: 1.840 `ptScheduleCommandReceipts` (khoảng 29 KB mỗi bản) và 547 `ptScheduleAdminEditReceipts` (khoảng 46 KB), tổng khoảng 78 MB, tức 20% dung lượng database, tăng khoảng 1.300 bản mỗi tuần. | `pt-schedule-v2.js:5007`, `index.js:1119` | Đã deploy P6, TTL bật ngày 11/11. |
| 15 | T | Khóa học lưu nguyên khối: tài liệu `courses` tới 674 KB. `listAcademyCourses` đọc mọi khóa đã xuất bản trong transaction chỉ để trả metadata (khoảng 170 đơn vị đọc mỗi khóa). Mỗi bản `courseRevisions` cũng nặng tương tự. | `index.js:4201`, `academy-course-storage.js` | Đề xuất P7. |
| 16 | T | CI trên `main` đỏ vì ba test ghim 598 export trong khi có 605. Quy trình phát hành chính thức cần ref xanh nên các lần deploy gần đây phải làm tay. | 3 file test trong `functions/` | Đã lên `main` (`308ceff`). |
| 17 | N | 251 trong 602 function không có request nào trong 30 ngày (233 HTTPS). Không tốn tiền khi nghỉ nhưng làm chậm deploy, chiếm 410/1.000 service ở Singapore và mở rộng bề mặt tấn công. | `ops/function-lifecycle.json` | Đề xuất P9. |
| 18 | N | Bucket Storage mặc định ở US-EAST1 trong khi người dùng, Functions và Firestore ở châu Á: mỗi lần tải ảnh đi vòng qua Mỹ. | Cấu hình project | Đề xuất P11. |
| 19 | N | Functions có 5 cảnh báo phụ thuộc (1 thấp, 4 trung bình, đều gián tiếp qua `google-gax` và `@google-cloud/storage`). Root: `server.ts` và bốn gói của nó (`@google/genai`, `express`, `express-rate-limit`, `zod`) không thuộc ứng dụng đang chạy; `dotenv` không được import. | `functions/package-lock.json`, `server.ts`, `package.json` | Đề xuất P10. |
| 20 | N | Shell sau đăng nhập 284 KiB gzip cho mọi vai trò: SDK Firestore 145 KiB, CSS dùng chung 178 KiB thô. 15 file nguồn không còn được tham chiếu (101 KB). `DatabaseContext` còn bảy nhánh listener không route nào bật. | `AuraApplication.tsx`, `DatabaseContext.tsx:572–640` | Đề xuất P13. |

Ghi chú thêm, không xếp hạng: 3 database Firestore không dùng (1 database staging từ 19/08 còn bật PITR), bucket migration 0,6 GiB, bucket `gcf-v2-sources` không có lifecycle (1,9 GiB). Tổng chi phí của nhóm này dưới 0,2 USD mỗi tháng; chỉ nên dọn khi tiện.

## C. Chi phí theo dịch vụ

Giá lấy từ Cloud Billing Catalog ngày 11/11/2026: đơn vị đọc Firestore Enterprise 0,061 USD/triệu, đơn vị ghi 0,32 USD/triệu (Singapore); Cloud Run 0,0000336 USD/vCPU-giây và 0,0000035 USD/GiB-giây (Singapore, Jakarta), 0,000024 và 0,0000025 (Đài Loan); SMS Việt Nam 0,13 USD.

| Dịch vụ | Mức dùng đo được (7 ngày đến 11/11) | Ước tính / tháng trước sửa | Nguyên nhân chính | Sau các bản sửa (dự phóng) |
| --- | --- | ---: | --- | ---: |
| Firestore: đọc | 79,3 triệu đơn vị (11,3 triệu/ngày) | 20,6 USD | Vấn đề 3 | 2–4 USD |
| Firestore: ghi | 5,7 triệu đơn vị (0,82 triệu/ngày) | 7,5 USD | Ghi lại bảng lịch tuần 0,5 MB | 0,2–1 USD |
| Firestore: lưu trữ, PITR | 0,38 GiB + 0,38 GiB | 0,1 USD | | 0,1 USD |
| Cloud Run: tuần có bất thường | 1,6 triệu giây instance; 93 nghìn vCPU-giây cấp phát mỗi ngày | 71–100 USD | Vấn đề 1 | xem dòng dưới |
| Cloud Run: mức nền | 108 nghìn giây instance/tuần; 30–45 nghìn vCPU-giây/ngày | 6–36 USD | Cold start (vấn đề 8) | 0–30 USD sau free tier |
| Identity Platform SMS | 94 SMS / 30 ngày | 12,2 USD | Vấn đề 13 | 12,2 USD |
| Cloud Scheduler | 22 job | 1,9 USD | | 1,9 USD |
| Secret Manager, Artifact Registry, Storage, Logging | 7 secret; 1,9 GiB; 3,2 GiB; khoảng 1 GiB log/tháng | dưới 1 USD | | dưới 1 USD |
| AI, Maps, Gemini | khoảng 55 lượt AI / 30 ngày; Maps và Gemini bằng 0 | không đáng kể | | không đáng kể |
| **Tổng Google Cloud** | | **49–79 USD (nền), 114–143 USD (tuần bất thường)** | | **17–50 USD** |

Hai cận của Cloud Run: cận dưới là thời gian instance tính tiền × CPU cấu hình (đúng với mô tả giá); cận trên dùng số đo CPU cấp phát, vốn tính cả phần CPU tăng cường lúc khởi động. Free tier hằng tháng (180 nghìn vCPU-giây, 360 nghìn GiB-giây) tương đương khoảng 6 USD. Cách xác định cận nào đúng nằm ở mục H.

Bảng 42 ngày (ước tính Cloud Run theo cận trên, giá Singapore; mỗi ngày là 24 giờ kết thúc lúc 13:00 giờ Việt Nam):

| Giai đoạn | vCPU-giây/ngày | Đơn vị đọc/ngày | Ước tính USD/ngày |
| --- | ---: | ---: | ---: |
| 30/09–03/10 | 6 nghìn | 1,7 triệu | 0,3 |
| 04–13/10 | 15–500 nghìn | 1,4–10 triệu | 0,6–19 |
| 14–20/10 | 4–9 triệu | 3–11 triệu | 22–325 tùy cách tính (xem ghi chú) |
| 21–26/10 | 0,07–2,8 triệu | 5–53 triệu | 5–104 |
| 27/10–06/11 (nền) | 30–45 nghìn | 8–30 triệu (31/10: 70 triệu) | 1,8–6 |
| 07–10/11 (bất thường) | 129–142 nghìn | 9–14 triệu | 5,3–6,4 |

Ghi chú 14–20/10: nếu phần cấp phát đó là instance tối thiểu đang nghỉ thì giá là 0,0000035 USD/vCPU-giây, tổng 6 ngày khoảng 245 USD; nếu là CPU đang hoạt động thì khoảng 1.600 USD. Hóa đơn tháng 10 cho biết con số nào đúng.

## D. Ưu tiên theo Tác động × Công sức × Rủi ro

| Việc | Tác động | Công sức | Rủi ro | Thứ tự |
| --- | --- | --- | --- | --- |
| Chạy `cost:guard` hằng ngày, đặt budget alert trong Billing | Chặn sự cố 100–1.600 USD | Thấp | Không | 1 |
| Merge các commit của nhánh này | CI xanh; bỏ khoảng 250 nghìn đơn vị đọc/ngày và 750 lượt gọi/tuần | Thấp | Thấp | 2 |
| Đo lại 7 ngày sau các bản sửa 11/11; đối chiếu Billing | Biết con số thật | Thấp | Không | 3 |
| P1: CPU và bộ nhớ cho ba callable chậm nhất | p95 từ 10–19 giây xuống vài giây (cần đo) | Thấp | Trung bình (quota) | 4 |
| P2: sức chứa cho hai trigger bị từ chối | Hết 23–43% request bị gửi lại | Thấp | Trung bình | 5 |
| P6: TTL cho receipt | Chặn 20% dung lượng tăng vô hạn | Thấp | Trung bình (retention) | 6 |
| P12: giảm phụ thuộc SMS OTP | 12 USD/tháng, tăng theo người dùng | Trung bình | Sản phẩm | 7 |
| P3: runtime rút gọn cho callable nhiều lượt | Cold start ngắn hơn khoảng 1,3 giây, bớt 26 MB | Trung bình | Trung bình | 8 |
| P8: bật App Check theo đợt | Giảm rủi ro lạm dụng | Trung bình | Trung bình | 9 |
| P5: tách payload bảng lịch tuần | Bớt phần lớn đơn vị ghi còn lại, mở nhanh hơn | Cao | Cao | 10 |
| P7: chuyển khóa học sang lưu theo chương | Bớt 170 đơn vị đọc mỗi khóa mỗi lượt | Trung bình | Trung bình (migration) | 11 |
| P9, P10, P11, P13: dọn function, phụ thuộc, bucket, CSS | Vệ sinh, bề mặt tấn công | Trung bình | Thấp đến cao | 12 |

## E. Trước và sau

**Đã đo trên production (bản sửa của `main`, deploy 11/11):**

| Chỉ số | Trước | Sau | Nguồn |
| --- | ---: | ---: | --- |
| Đơn vị đọc Firestore mỗi giờ, giờ làm việc | 1,1–1,6 triệu | 25–117 nghìn | Monitoring, 08:00–14:00 ngày 11/11 |
| Đơn vị ghi Firestore mỗi giờ | 30–42 nghìn | 3–5 nghìn | Monitoring |
| Giây instance tính tiền của một trigger hợp đồng mỗi đợt trừ buổi | 2.300–2.800 | 6–28 | [Phân tích 11/11](COST_USAGE_ANALYSIS_2026-11-11.md) |
| `cost:guard` 24 giờ trước | 10 cảnh báo | | Chạy lúc 14:13 ngày 11/11 |
| `cost:guard` 2 giờ sau hai lần deploy | | 0 cảnh báo | Chạy lúc 14:13 ngày 11/11 |

**Đo cục bộ trên nhánh này (chưa deploy):**

| Chỉ số | `main` | Nhánh |
| --- | ---: | ---: |
| Test thất bại trong `npm run test:app-optimization` và `check:weekly-view` | 3 | 0 |
| `npm --prefix functions run check` | 1.864 / 1.864 | 1.866 / 1.866 |
| `npm run test:profile-sync` | 395 / 395 | 401 / 401 |
| `npm run test:function-lifecycle` | 39 / 39 | 48 / 48 |
| Typecheck, build, toàn bộ performance budget | qua | qua |
| `node scripts/check-css-colors.mjs` (bước đầu của `npm run ci`) | 3 lỗi | qua |
| JS khởi động | 41,0 KiB | 41,4 KiB |
| Tổng tải khởi động gzip | 130,2 KiB | 130,3 KiB |
| Shell sau đăng nhập gzip | 283,9 KiB | 283,9 KiB |
| Lượt đọc `mealReviews` của job 15 phút khi không có gì đến hạn (test) | mỗi lượt | tối đa một lượt mỗi giờ |
| Lượt gọi backend khi staff/admin mở trang chủ thành viên (test) | 2 lượt bị 403 | 0 |

**Chưa đo được:** hiệu quả trên production của hai commit `a728389` và `f553e15` (cần deploy), và độ trễ sau các đề xuất P1–P3.

## F. Số đã xác minh và số dự phóng

- **Xác minh từ số đo của Google:** mọi con số sử dụng (đơn vị đọc ghi, request, giây instance, vCPU-giây, cold start, độ trễ, mã lỗi, dung lượng, SMS), cấu hình 602 function, quota, giá niêm yết.
- **Dự phóng:** mọi con số USD; cột "sau các bản sửa" (ngoại suy từ 3 giờ sau deploy, giờ trưa ít lưu lượng); kích thước document (lấy mẫu 6 tài liệu mỗi collection, tính xấp xỉ theo quy tắc kích thước của Firestore).
- **Chưa xác minh từ Billing:** không có Billing export sang BigQuery và tài khoản không đọc được budget. Chưa xem hóa đơn tháng 10 và tháng 11.
- **Chưa biết:** nguyên nhân phía nền tảng của vấn đề 1; nguyên nhân chính xác của giai đoạn 14–20/10; chi phí Vercel và nhà cung cấp AI.

## G. Thay đổi trên nhánh, kiểm thử, rủi ro, rollback

| Commit | Nội dung | File | Deploy cần thiết |
| --- | --- | --- | --- |
| `308ceff` | Ba test ghim số export 598 → 605 | `functions/event-operation-metrics.test.js`, `pt-schedule-weekly-runtime.test.js`, `reporting-read-runtime.test.js` | Không |
| `31e22a7` | Công cụ chốt chặn chi phí chỉ-đọc và 9 test | `scripts/cloud-cost-guard.cjs`, `scripts/cloud-cost-guard.test.cjs`, `package.json` | Không |
| `f553e15` | Service trả sẵn lỗi 403 đã biết thay vì gọi backend; 6 test | `src/identity/sessionAccess.ts`, `src/contexts/AuthContext.tsx`, `src/features/loyalty/loyaltyService.ts`, `src/services/studentPtScheduleService.ts`, `tests/session-access.test.ts`, `package.json` | Web |
| `a728389` | Job SLA duyệt bữa ăn bỏ qua lượt quét khi không gì có thể đổi; 2 test mới, 1 test sửa | `functions/nutrition-review-maintenance.js`, `functions/nutrition-reviews.test.js`, `functions/index.js` | Một function: `reopenSnoozedOperationalActionsScheduled` |
| `799c1f7` | Ba màu của trang thông báo lấy từ design token thay cho mã hex | `src/pages/student/NotificationsPage.css` | Web |

Kiểm thử đã chạy trên nhánh: typecheck, build, performance budget, repo hygiene, quét secret, `test:profile-sync`, `test:regional-reads`, `test:data-cost`, `test:app-optimization`, `test:function-lifecycle`, `test:callable-audit`, `functions check`, `functions test`, `check:weekly-view`. Tất cả qua.

Kiểm thử trình duyệt (Playwright, Chrome cục bộ, bản build `e2e`), tất cả qua:

| Bộ test | Phạm vi | Kết quả |
| --- | --- | ---: |
| `tests/e2e`, project `chromium` | Đăng nhập, shell học viên, staff, admin, Student 360, lịch PT, lương, tái ký, Aura Club, dinh dưỡng, SOP | 245 / 245 |
| `tests/e2e`, project `mobile-chromium` | Cùng phạm vi trên màn hình điện thoại | 245 / 245 |
| `npm run test:schedule-ui` | Không gian xếp lịch của admin | 135 / 135 |
| `npm run test:workspace-sync-ui` (Chromium) | Lịch học viên và PT tự làm mới theo tín hiệu | 40 / 40 |
| `npm run test:loyalty-operations-ui` (Chromium) | Aura Club phía thành viên và vận hành | 29 / 29 |

Chưa chạy: test rules và các test tích hợp cần Firestore emulator (nhánh không đổi rules, index hay transaction ghi), Playwright trên WebKit, và đăng nhập thật theo từng vai trò trên production. Các bộ trình duyệt dùng dữ liệu mẫu, nên chúng bảo vệ giao diện và luồng thao tác chứ không chứng minh số liệu production.

Rủi ro còn lại:

- `a728389`: một bữa ăn chờ duyệt do công cụ cũ ghi với thời điểm gửi trong quá khứ có thể được nâng mức cảnh báo trễ tối đa 60 phút thay vì 15 phút. Bản ghi tạo qua ứng dụng không bị ảnh hưởng vì thời điểm gửi luôn là lúc ghi.
- `f553e15`: nếu vai trò của một tài khoản đổi từ admin sang học viên giữa phiên, hai thẻ trên trang chủ chỉ hiện lại sau khi quyền được đồng bộ lại (lần mở ứng dụng kế tiếp).
- `31e22a7`: ngưỡng mặc định của đơn vị đọc ghi được đặt khi mới có 3 giờ số liệu sau sửa; cần chỉnh sau 7 ngày.

Rollback: mỗi commit độc lập, `git revert <sha>` là đủ. Không commit nào đổi schema, rules, index, quyền hay dữ liệu. Với `a728389`, tài liệu trạng thái `systemJobs/nutritionReviewSla` có thêm trường; bản cũ bỏ qua các trường đó.

## H. Theo dõi sau deploy

1. **Mỗi ngày:** `npm run cost:guard -- --project=<project id> --inventory=live`. Mã thoát 1 nghĩa là có cảnh báo. Công cụ báo: service bị tính quá 30 giây instance mỗi request, function có instance tối thiểu, CPU cấp phát trên 90 nghìn vCPU-giây/ngày, đơn vị đọc trên 6 triệu/ngày, đơn vị ghi trên 0,6 triệu/ngày, ước tính trên 4 USD/ngày, và trigger từ chối hơn 20% sự kiện.
2. **Sau 7 ngày:** chạy `node scripts/cloud-usage-snapshot.cjs --project=<id> --days=7 --hourly=48`, ghi mức nền mới, hạ ngưỡng đọc ghi của `cost:guard` xuống khoảng gấp đôi mức nền.
3. **Đối chiếu Billing một lần:** Billing → Reports, nhóm theo SKU, chọn ngày 02/11. Nếu SKU CPU của Cloud Run functions ghi khoảng 30 nghìn vCPU-giây thì hóa đơn theo số đo cấp phát (cận trên ở mục C); nếu khoảng 6 nghìn thì theo cận dưới. Xem thêm tổng tháng 10 để biết giai đoạn 14–20/10 đã tốn bao nhiêu.
4. **Đặt budget và cảnh báo trong Billing** ở mức 50%, 90%, 100% của ngân sách tháng. Việc này cần quyền Billing của chủ tài khoản.
5. **Bật Billing export sang BigQuery** để các lần rà soát sau dùng số thật.
6. Sau khi deploy `a728389`: log `operational_actions_scheduled_maintenance` phải có `mealReviewSweepSkipped: true` ở phần lớn các lượt.
7. Sau khi deploy web có `f553e15`: số response 403 của `getMyLoyaltyDashboardRegional` và `listMyStudentPtScheduleRegional` phải giảm về gần 0.

## I. Áp dụng đề xuất và deploy ngày 11/11

Chủ dự án duyệt việc sửa theo đề xuất, commit và deploy. Đã áp dụng **P1, P2, P6** cùng các thay đổi có sẵn của nhánh. Mười đề xuất còn lại không áp dụng; lý do ở mục I.8.

### I.1 Cấu hình trước và sau (P1, P2)

Cột "Sau" là giá trị đọc lại từ Cloud Run sau deploy. Cột lý do là số đo 04–11/11.

| Function | Trước | Sau | Lý do |
| --- | --- | --- | --- |
| `getPtScheduleWeeklyViewRegional`, `getPtScheduleWeeklyView` | 1/6 vCPU, 256 MiB | 1 vCPU, 512 MiB | 1.821 lượt; p50 2,3 giây; p95 18,6 giây; bộ nhớ p99 87% |
| `getMyTrainerWorkspaceRegional` | 1/6 vCPU, 256 MiB, 1 request mỗi instance | 1 vCPU, 512 MiB, 8 request mỗi instance | 1.589 lượt; p50 2,1 giây; p95 9,6 giây; 16% lượt phải khởi động instance |
| `getMyPerformanceScoreV2` | 1/6 vCPU, 256 MiB | 1 vCPU, 512 MiB | 280 lượt; p50 2,1 giây; p95 7,2 giây |
| `listMyStudentPtScheduleRegional` | 1/6 vCPU, 256 MiB | 1/3 vCPU, 512 MiB | bộ nhớ p99 88% |
| `refreshContractRenewalQueueScheduled` | 1/6 vCPU, 256 MiB | 1/3 vCPU, 512 MiB | bộ nhớ p99 89% |
| `processStudent360SourceQueue` | tối đa 3 instance | tối đa 6 instance | 3.191 trên 13.953 sự kiện bị từ chối (23%) |
| `syncPtScheduleWeeklyViewFromSession` | tối đa 1 instance | tối đa 3 instance | 1.072 trên 2.480 sự kiện bị từ chối (43%) |

- Số instance tối đa của các callable không đổi và không function nào có instance tối thiểu. Khi cả bốn callable 1 vCPU cùng chạm trần, chúng chiếm 9 trong 20 vCPU quota của asia-east1. Đỉnh 7 ngày của vùng này là 17 instance xử lý cùng lúc; trước hôm nay 151 trong 157 function của vùng dùng 1/6 hoặc 1/2 vCPU.
- Căn cứ chọn tăng CPU: cùng handler `getMyTrainerWorkspace` trên cấu hình 1 vCPU ở asia-southeast1 có p50 khoảng 0,26 giây (5.844 lượt trong 30 ngày đến 11/11), so với 2,1 giây trên 1/6 vCPU. Hai cấu hình đó khác nhau cả về CPU lẫn vị trí (bản ở asia-southeast1 nằm cùng vùng với database), nên đây là căn cứ để thử chứ chưa phải mức cải thiện; mức thật phải chờ số đo ở mục I.6.
- Hai function chỉ tăng bộ nhớ vẫn dùng kiểu CPU Gen 1, nên phần CPU tự tăng theo bộ nhớ từ 1/6 lên 1/3 vCPU.
- P2: các lượt từ chối dồn vào hai kiểu đợt, không phải thiếu chỗ thường xuyên. `processStudent360SourceQueue` nhận 450–540 sự kiện mỗi phút lúc 00:06 hằng đêm, khi job tái ký chạm mọi hợp đồng. `syncPtScheduleWeeklyViewFromSession` nhận khoảng 1.400 lượt giao trong 4 phút sau lần xuất bản lịch tối 08/11 và từ chối 1.034 lượt. Sự kiện bị từ chối được gửi lại nên không mất dữ liệu, nhưng trang học viên và bảng lịch tuần bị trễ. Chỉ số instance tăng; CPU, bộ nhớ và cơ chế gửi lại giữ nguyên.
- Không chuyển hai hàm đọc lịch về asia-southeast1 (phần "cân nhắc" của P1), vì việc đó đổi địa chỉ callable mà client đang gọi.

### I.2 Receipt tự hết hạn (P6)

- Bảy chỗ ghi `ptScheduleCommandReceipts` và `ptScheduleAdminEditReceipts` nay thêm `expiresAt` bằng thời điểm lệnh cộng 30 ngày (`functions/command-receipt-retention.js`), cùng thời hạn với receipt của trung tâm SOP.
- Chính sách TTL trên `expiresAt` của hai collection ở trạng thái `ACTIVE` từ 16:08 ngày 11/11. Lệnh áp: `node scripts/schedule-receipt-firestore-config.cjs apply --confirm=<database>/schedule-receipts:configure-retention`. Chế độ `status` của script chỉ đọc.
- 1.840 và 547 receipt hiện có không có `expiresAt`, nên chính sách không bao giờ xóa chúng. Receipt đầu tiên bị xóa sớm nhất vào 11/12/2026. Muốn dừng trước ngày đó chỉ cần tắt TTL (mục I.7).
- Vì vậy 78 MB hiện có không giảm. Thay đổi này chỉ chặn phần tăng khoảng 1.300 receipt mỗi tuần. Xóa receipt cũ là thao tác xóa dữ liệu và cần duyệt riêng.

### I.3 Commit mới trên `main`

| Commit | Nội dung | Test đi kèm |
| --- | --- | --- |
| `7ba27e0` | P1: CPU và bộ nhớ cho các hàm đọc ở bảng I.1 | `functions/capacity-profile.test.js` đọc manifest deploy thật, ghim cả các function lân cận phải giữ nguyên; cập nhật `pt-schedule-weekly-runtime.test.js`, `nutrition-reviews.test.js` |
| `a94b33f` | P2: số instance của hai trigger | cùng `capacity-profile.test.js` |
| `31a00c7` | P6: `expiresAt` cho receipt, khai báo TTL trong `firestore.indexes.json`, script áp TTL | test trong `pt-schedule-workflows.test.js`, `pt-schedule-admin-edit.test.js`, `scripts/schedule-receipt-firestore-config.test.cjs` |

So với `1231e57`, manifest deploy của đúng 8 trong 605 function thay đổi, đều nằm ở bảng I.1.

### I.4 Kiểm thử trước khi đẩy lên `main`

| Bước | Kết quả |
| --- | ---: |
| Repo hygiene, màu CSS, typecheck, build, performance budget | qua |
| `test:profile-sync` | 401 / 401 |
| `test:regional-reads` | 225 / 225 |
| `test:function-lifecycle` | 52 / 52 |
| `test:app-optimization` | 98 / 98 |
| `test:data-cost` | 51 / 51 |
| `test:production-smoke`, `test:callable-audit`, `test:eat-clean`, `test:cooking`, `test:payroll-pdf`, `test:installment-payments`, `test:notification-center` | 23, 7, 5, 5, 3, 22, 5 (tất cả qua) |
| `functions check` | 1.868 / 1.868 |
| `functions test` | 1.812 / 1.812 |
| `functions check:weekly-view`, `check:apikey-fun` | 59 / 59, 6 / 6 |
| Test tích hợp trên Firestore emulator (7 file về lệnh lịch, hàng đợi Student 360, bảng lịch tuần) | 41 / 45 |

Bốn test emulator thất bại nằm trong `functions/weekly-projection-safety.integration.cjs` và thất bại y hệt trên `1231e57`. Chúng còn mong đợi cờ `dirty` cho tuần cũ, trong khi commit `eb5bb77` sáng 11/11 đã chủ động chỉ tăng `dirtyGeneration` cho tuần cũ. Đây là test chưa được cập nhật, không phải lỗi của các thay đổi ở mục này. Bộ Playwright không chạy lại vì ba commit mới không đổi mã client; kết quả cũ ở mục G.

### I.5 Deploy

- **Web:** Vercel build từ `main` tại `31a00c7`. `npm run production:smoke` với SHA mong đợi đã qua lúc 15:45.
- **Functions:** 15 function, deploy lần lượt từ một bản sao sạch của `31a00c7`, theo đúng bước "Deploy backend Functions sequentially" của `release-production.yml` (deploy, chuyển traffic sang revision mới, cổng kiểm tra sức khỏe, tự rollback khi lỗi). Cả 15 đều qua cổng kiểm tra.

| Function | Vùng | Xong (giờ VN) | Revision trước | Revision mới |
| --- | --- | --- | --- | --- |
| `getPtScheduleWeeklyView` | asia-east1 | 15:37 | `…-stg-df4b4b3fcec3` | `…-stg-7ddb05250b9b` |
| `getPtScheduleWeeklyViewRegional` | asia-east1 | 15:40 | `…-stg-9f13a5ae7e40` | `…-stg-24c617e36b1d` |
| `getMyPerformanceScoreV2` | asia-east1 | 15:42 | `…-stg-2bfb9864db6b` | `…-stg-5ac7ef8ad871` |
| `getMyTrainerWorkspaceRegional` | asia-east1 | 15:44 | `…-stg-e8b1860a770c` | `…-stg-bf5015c9e33d` |
| `listMyStudentPtScheduleRegional` | asia-east1 | 15:46 | `…-stg-83db3439fdbc` | `…-stg-24ff0be40e93` |
| `syncPtScheduleWeeklyViewFromSession` | asia-southeast1 | 15:48 | `…-stg-3c959f7f5840` | `…-stg-a9ab4cbc8306` |
| `processStudent360SourceQueue` | asia-southeast1 | 15:50 | `…-stg-764cc9fc4a11` | `…-stg-ca717a66ee94` |
| `refreshContractRenewalQueueScheduled` | asia-southeast1 | 15:52 | `…-stg-82e4bff13580` | `…-stg-31fa6ac9809b` |
| `reopenSnoozedOperationalActionsScheduled` | asia-southeast1 | 15:54 | `…-00015-luv` | `…-stg-45b0fc02094d` |
| `createHistoricalPtSession` | asia-southeast1 | 15:56 | `…-stg-36f045b76b48` | `…-stg-e15bbf4d1d81` |
| `createHistoricalPtSessionRegional` | asia-east1 | 15:58 | `…-stg-a20c7f0bf58b` | `…-stg-c0d7588d2f9f` |
| `applyPtScheduleDraftCommand` | asia-southeast1 | 16:00 | `…-stg-5eb386bfcace` | `…-stg-d108667b6b40` |
| `applyPtScheduleDraftCommandRegional` | asia-east1 | 16:02 | `…-stg-9e2ada8c76aa` | `…-stg-a8fca89bbc40` |
| `adminEditPtSchedule` | asia-southeast1 | 16:04 | `…-stg-60c7eb3d4577` | `…-stg-da7c6e3413e0` |
| `adminEditPtScheduleRegional` | asia-east1 | 16:06 | `…-stg-9472491f2028` | `…-stg-83c336c8dbba` |

Tên revision đầy đủ là tên service viết thường nối với phần đuôi trong bảng.

**Deploy lại một function đưa toàn bộ mã `main` hiện tại của function đó lên.** Một số function trong bảng được deploy lần trước từ 23/10 đến 01/11, nên lần này nhận thêm các thay đổi đã merge từ đó. Đã đọc diff của `pt-operations-v2.js`, `student-360-source-queue.js` và `student-360.js` kể từ lần deploy trước: phần thay đổi không nằm trong các handler được deploy (hàng đợi chỉ thêm đo đếm, không đổi cấu trúc tài liệu). Với sáu function lệnh lịch, các commit đi kèm là `aee283e`, `7c07cdc`, `8ab4620`, `b757019`; phần này chỉ được bảo đảm bằng bộ test, không được đọc lại từng dòng.

### I.6 Số đo sau deploy

**Đã đo được trong 40 phút đầu:**

| Chỉ số | Trước | Sau | Nguồn |
| --- | ---: | ---: | --- |
| Đơn vị đọc Firestore của một lượt quét SLA bữa ăn (mỗi 15 phút) | 2.100–2.700 | 6 | Monitoring theo phút; lượt 16:14 ghi `mealReviewSweepSkipped: true`. Lượt 15:59 là lượt đầu của bản mới nên vẫn đọc đủ một vòng. |
| Cấu hình của 8 function ở bảng I.1 | cột "Trước" | khớp cột "Sau" | Đọc lại từ Cloud Run sau deploy |
| Log mức ERROR trên 15 service vừa deploy | | 0 | Cloud Logging, 15:37–16:20 |
| `cost:guard`, 2 giờ quanh thời điểm deploy | | không cảnh báo | Cloud Run quy đổi 37.292 vCPU-giây mỗi ngày, trong mức nền 30–45 nghìn |
| TTL của hai collection receipt | chưa có | `ACTIVE` | `schedule-receipt-firestore-config.cjs status` |
| Bản web production | | `31a00c7` | `npm run production:smoke` với SHA mong đợi |

**Chưa đo được, vì cần lưu lượng thật:**

- **Độ trễ sau P1.** Trong 40 phút sau deploy chỉ có 4 lượt `getMyTrainerWorkspaceRegional`, 7 lượt `listMyStudentPtScheduleRegional`, 1 lượt `getMyPerformanceScoreV2` và chưa có lượt `getPtScheduleWeeklyViewRegional` nào. Chừng đó không đủ để kết luận. Cần đo lại sau ít nhất một ngày làm việc và so với cột "Trước" của bảng I.1.
- **P2.** Phép thử đầu tiên là đợt 00:06 đêm 11/11 cho `processStudent360SourceQueue` và lần xuất bản lịch kế tiếp cho `syncPtScheduleWeeklyViewFromSession`. Với trigger thứ hai, ba instance làm nhanh gấp ba nhưng một đợt 400 buổi vẫn có thể bị từ chối một phần ở những giây đầu.
- **Commit `f553e15`.** Số response 403 của hai callable học viên cần một đến hai ngày để thấy giảm, vì người dùng phải tải bản web mới.
- **P6.** Receipt đầu tiên có `expiresAt` chỉ xuất hiện khi admin thao tác lịch lần tới; lần xóa đầu tiên là sau 11/12/2026.

**Lưu ý khi đọc số lượt và độ trễ.** Số đo của Cloud Run gồm cả request kiểm tra CORS (OPTIONS) mà trình duyệt gửi trước lượt gọi thật; các request này xong trong vài mili giây. Với `getPtScheduleWeeklyViewRegional`, 758 trong 1.682 request của ba ngày 08–11/11 là OPTIONS. Nếu coi nhóm dưới 150 ms là OPTIONS, thì trong 7 ngày có khoảng 1.078 lượt đọc bảng lịch tuần thật, và 654 lượt trong đó (61%) mất hơn 6 giây. Tức là trước hôm nay admin thường chờ lâu hơn nhiều so với con số p50 2,3 giây. Khi so sánh trước sau, hãy dùng cùng một cách tính.

**Ước tính chi phí của P1 (dự phóng, giá niêm yết).** Trường hợp xấu nhất là thời gian xử lý không giảm chút nào: năm function ở bảng I.1 khi đó thêm khoảng 14.700 vCPU-giây và 5.000 GiB-giây mỗi tuần, tức khoảng 1,6 USD mỗi tháng. Nếu thời gian xử lý giảm theo CPU thì chi phí gần như không đổi. P2 và P6 không làm tăng chi phí đáng kể; P6 chặn phần lưu trữ tăng thêm.

**Cách đo lại.** Trong Cloud Run console: chọn service, tab Metrics, biểu đồ Request latencies và Request count theo mã trả về. Hoặc chạy `npm run cost:guard -- --project=gen-lang-client-0815966909 --inventory=live` (cảnh báo khi một trigger từ chối hơn 20% sự kiện). Các script chỉ-đọc dùng cho mục này (`focus.cjs`, `dist.cjs`, `burst.cjs`, `revisions.cjs`) và số đo "trước" nằm trong thư mục riêng không commit `.migration-private/cost-audit-20261111/apply-20261111/` của worktree rà soát.

### I.7 Rollback

- **Một function:** chuyển traffic về revision trước trong bảng I.5, ví dụ `gcloud run services update-traffic getmytrainerworkspaceregional --region=asia-east1 --to-revisions=getmytrainerworkspaceregional-stg-e8b1860a770c=100 --project=gen-lang-client-0815966909`. Revision cũ mang theo cấu hình CPU, bộ nhớ và số instance cũ. Lưu ý `scripts/cloud-run-functions-rollback.cjs` chỉ ghim revision đang phục vụ khi một lần deploy hỏng giữa chừng; nó không quay về revision trước của một lần deploy đã thành công.
- **Mã nguồn:** `git revert 7ba27e0`, `a94b33f` hoặc `31a00c7` (ba commit độc lập), rồi deploy lại các function liên quan.
- **TTL:** `gcloud firestore fields ttls update expiresAt --collection-group=ptScheduleCommandReceipts --disable-ttl --database=<database> --project=gen-lang-client-0815966909`, và tương tự cho `ptScheduleAdminEditReceipts`. Receipt đã bị xóa không khôi phục được ngoài cửa sổ PITR 7 ngày, nên nếu muốn dừng thì dừng trước 11/12/2026.
- **Web:** `git revert f553e15` hoặc `799c1f7` rồi đẩy lên `main`.

### I.8 Đề xuất không áp dụng và lý do

| Đề xuất | Lý do chưa làm |
| --- | --- |
| P3 runtime rút gọn | Đổi cách nạp module của các callable nhiều lượt nhất. Không nên đi cùng đợt đổi tài nguyên, vì khi đó không tách được nguyên nhân nếu độ trễ đổi. Làm sau khi có số đo của P1. |
| P4 gộp job theo lịch | Phải đổi tên function và xóa job Cloud Scheduler cũ. Xóa tài nguyên cloud nằm ngoài phạm vi được phép. |
| P5 tách payload bảng lịch tuần | Thay đổi cấu trúc dữ liệu của lịch tập, rủi ro cao; cần thiết kế và migration riêng. |
| P7 khóa học theo chương | Là migration dữ liệu production; cần backup và chạy thử được duyệt. |
| P8 App Check | Client khởi tạo App Check kiểu lười; bật bắt buộc khi chưa theo dõi tỷ lệ token hợp lệ có thể khóa người dùng thật. |
| P9 vòng đời function | Là xóa tài nguyên cloud. |
| P10 `npm audit fix` | Đổi phiên bản thư viện gRPC và Storage của mọi function ở lần deploy kế tiếp. Nên là một đợt riêng, có theo dõi, không trộn với thay đổi hôm nay. |
| P11 bucket Storage | Cần bucket mới và sao chép dữ liệu. |
| P12 OTP | Là quyết định sản phẩm. |
| P13 dọn frontend | 15 file không còn được tham chiếu không nằm trong bản build, nên xóa không đổi gì cho người dùng. Trong đó có các thẻ ảnh tiến độ và huy hiệu, trông như tính năng đang tạm cất; xóa hay giữ là quyết định sản phẩm. |
| Bộ nhớ cho khoảng 20 function còn lại ở vấn đề 11 | Không có lỗi tràn bộ nhớ nào của chúng trong 14 ngày. Chỉ bốn function trên 86% được tăng. |

### I.9 Phát hiện thêm trong lúc làm, chưa xử lý

1. Bốn test emulator trong `functions/weekly-projection-safety.integration.cjs` cần cập nhật theo cách đánh dấu tuần cũ của `eb5bb77` (mục I.4).
2. `listBusinessPerformanceRegional` bị tràn bộ nhớ 256 MiB một lần ngày 31/10. Không lặp lại trong 14 ngày; nên tăng lên 512 MiB khi deploy function này lần tới.
3. `listMyStudentPtScheduleRegional` là callable của học viên có nhiều lượt nhất trong nhóm này (3.030 lượt mỗi tuần, p50 khoảng 0,6 giây). Cùng handler trên cấu hình 1 vCPU ở asia-southeast1 có p50 khoảng 0,03 giây (21.314 lượt trong 30 ngày đến 11/11). Hôm nay nó mới được tăng lên 1/3 vCPU; nếu số đo sau P1 tốt, đây là ứng viên kế tiếp cho 1 vCPU.
4. Emulator Firestore không chạy được từ thư mục có dấu tiếng Việt trong đường dẫn (`Aura Dinh Dưỡng`); phải chạy từ một bản sao ở đường dẫn không dấu.

## Phụ lục: các đề xuất (P1, P2, P6 đã áp dụng ngày 11/11, xem mục I)

- **P1. Tài nguyên cho callable chậm.** Đặt 1 vCPU và 512 MiB cho `getPtScheduleWeeklyViewRegional`, `getMyTrainerWorkspaceRegional`, `getMyPerformanceScoreV2`; cân nhắc đưa hai hàm đọc lịch về asia-southeast1 cạnh database. Mỗi hàm thêm tối đa 2 vCPU vào quota 20 vCPU của vùng. Đo p50 và p95 trước sau trên một hàm rồi mới làm tiếp. Với các function ở vấn đề 11, tăng bộ nhớ lên 512 MiB.
- **P2. Sức chứa trigger.** `processStudent360SourceQueue` và `syncPtScheduleWeeklyViewFromSession` đang `concurrency 1` với 3 và 1 instance. Thử tăng instance cho hàm thứ nhất; với hàm thứ hai, các sự kiện cùng tuần tranh nhau một tài liệu trạng thái nên cần gộp dấu theo tuần trước khi tăng song song.
- **P3. Runtime rút gọn.** Mở rộng mẫu `background-runtime.js` cho `getMyAccessContextOverflow`, `listMyStudentPtScheduleRegional`, `getMyTrainerWorkspaceRegional`, `trackProductEventOverflow`, `getMyLoyaltyDashboardRegional` kèm test đối chiếu metadata như bốn runtime hiện có.
- **P4. Gộp job theo lịch.** Bốn job 30 phút và sáu job hằng giờ luôn cold start (2.352 lần mỗi tuần). Gộp vào một job 5 phút đang ấm sẽ bỏ gần hết số đó, nhưng đổi tên function và job Scheduler nên cần kế hoạch chuyển đổi.
- **P5. Tách payload bảng lịch tuần.** Đưa cờ điều khiển ra khỏi payload để lượt dựng lại không đổi nội dung không phải ghi 0,5 MB; tách `students` khỏi ma trận lịch.
- **P6. TTL cho receipt.** Thêm `expiresAt` (ví dụ 30 ngày) khi ghi `ptScheduleCommandReceipts` và `ptScheduleAdminEditReceipts`, rồi bật TTL cho hai collection. Đây là thay đổi retention nên cần duyệt.
- **P7. Khóa học theo chương.** Chuyển các khóa còn lưu nguyên khối sang `chapters-v1` bằng công cụ sẵn có trong `academy-course-storage.js`, có backup và chạy thử.
- **P8. App Check.** Theo dõi tỷ lệ token hợp lệ, bật bắt buộc theo nhóm function, bắt đầu từ nhóm ghi tiền và hợp đồng.
- **P9. Vòng đời function.** Dùng `scripts/evaluate-function-lifecycle.cjs` với danh sách 251 function không có lưu lượng 30 ngày; không xóa chỉ dựa trên số request.
- **P10. Phụ thuộc.** `npm audit fix` trong `functions/` trên một bản cài sạch, chạy toàn bộ test rồi mới commit lockfile. Quyết định giữ hay bỏ `server.ts` cùng ba test đang đọc nó.
- **P11. Bucket Storage.** Chuyển vùng cần bucket mới và sao chép dữ liệu; chỉ làm khi lượng ảnh tăng đủ để độ trễ thành vấn đề.
- **P12. OTP.** Giữ phiên đăng nhập dài (đã làm), ưu tiên email hoặc Google cho người dùng cũ, cân nhắc kênh OTP rẻ hơn trong nước.
- **P13. Frontend.** Đo CSS coverage của shell theo vai trò trước khi tách; xóa bảy nhánh listener chết trong `DatabaseContext` và 15 file không còn tham chiếu sau khi xác nhận test không dùng.
