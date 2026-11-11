# Rà soát toàn hệ thống Aura Fitness OS: chi phí, hiệu năng, bảo mật

Ngày rà soát: 11/11/2026 (giờ Việt Nam). Mốc source: `1231e57` trên `main`. Nhánh làm việc: `claude/cost-perf-audit-20261111`, chưa push, chưa deploy.

Tài liệu này nối tiếp [phân tích chi phí 11/11](COST_USAGE_ANALYSIS_2026-11-11.md), [kế hoạch luồng dữ liệu 25/10](../product/DATA_FLOW_COST_OPTIMIZATION_PLAN_2026-10-25.md) và [audit 29/10](../APP_AUDIT_2026-10-29.md). Phần mới: bảng chi phí 42 ngày cho mọi dịch vụ, cấu hình thật của 602 function, độ trễ và lỗi theo từng service, kích thước document, và bốn thay đổi đã kiểm thử trên nhánh.

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
| 4 | C | `getPtScheduleWeeklyViewRegional`: 1.817 lượt/tuần, p50 khoảng 2,3 giây, p95 khoảng 18,6 giây, bộ nhớ p99 87% của 256 MiB. Chạy 1/6 vCPU ở Đài Loan trong khi database ở Singapore. | `functions/index.js` (`ptScheduleWorkspaceRegionalOnCall`), `pt-schedule-weekly-runtime.js` | Đề xuất P1. |
| 5 | C | `getMyTrainerWorkspaceRegional`: 1.590 lượt/tuần, p50 khoảng 2,1 giây, p95 khoảng 9,6 giây, 17% lượt là cold start 3,1 giây. | `functions/pt-operations-v2.js:1931` | Đề xuất P1, P3. |
| 6 | T | Mỗi lần dựng lại bảng lịch tuần đọc tài liệu 0,5 MB hai lần và ghi lại toàn bộ, kể cả khi chỉ cờ điều khiển đổi. `students` 260 KB, `contracts` 85 KB, `weeklySessionCoverage` 67 KB. | `rebuildPtScheduleWeeklyView` | Đề xuất P5. |
| 7 | T | Trigger thiếu chỗ khi sự kiện đến dồn: `processStudent360SourceQueue` trả 429 hoặc 500 cho 23% request, `syncPtScheduleWeeklyViewFromSession` 43%. Sự kiện được gửi lại nên bản dựng sẵn trễ. | `student-360-background-functions.js`, `index.js:1017` | Đề xuất P2. |
| 8 | T | 9.422 cold start mỗi tuần (11% request), trung bình 2,5 giây. `index.js` nạp 952 module; runtime rút gọn nạp khoảng 690. Khoảng 565 function chưa có runtime rút gọn. | `functions/index.js`, `background-runtime.js` | Đề xuất P3. |
| 9 | T | Job 15 phút đọc mọi bữa ăn chờ duyệt và action tương ứng dù không có gì đổi: khoảng 2.700 đơn vị đọc mỗi lượt, hơn 90% đơn vị đọc của một giờ không có người dùng. | `functions/nutrition-review-maintenance.js` | Nhánh (`a728389`). |
| 10 | T | Tài khoản staff và admin mở trang chủ thành viên gọi hai callable chỉ dành cho học viên: 398/1.332 lượt `getMyLoyaltyDashboard` và 354/3.034 lượt `listMyStudentPtSchedule` trả 403 trong 7 ngày. | `LoyaltyHomeCard.tsx`, `HomePage.tsx`, `ProgressPage.tsx`, `NotificationsPage.tsx` | Nhánh (`f553e15`). |
| 11 | T | Khoảng 25 function 256 MiB dùng 77–89% bộ nhớ ở p99 (ví dụ `refreshContractRenewalQueueScheduled` 89%, `listMyStudentPtScheduleRegional` 88%). Riêng việc nạp `index.js` đã chiếm khoảng 73%. | Cấu hình bộ nhớ trong `index.js` | Đề xuất P1. |
| 12 | T | App Check không bắt buộc với callable không phải AI. Người có tài khoản hợp lệ có thể gọi dồn dập; thiệt hại bị chặn bởi `maxInstances` 1–8 mỗi function. | `index.js:407`, biến `ENFORCE_APP_CHECK` | Đề xuất P8. |
| 13 | T | SMS OTP là dòng chi phí đáng kể so với phần còn lại: 94 SMS × 0,13 USD ≈ 12 USD mỗi tháng, tăng tuyến tính theo số lần đăng nhập bằng số điện thoại. | `AuthContext.tsx` (`sendPhoneOtp`) | Đề xuất P12. |
| 14 | T | Receipt chống lặp lưu nguyên kết quả và không có TTL: 1.840 `ptScheduleCommandReceipts` (khoảng 29 KB mỗi bản) và 547 `ptScheduleAdminEditReceipts` (khoảng 46 KB), tổng khoảng 78 MB, tức 20% dung lượng database, tăng khoảng 1.300 bản mỗi tuần. | `pt-schedule-v2.js:5007`, `index.js:1119` | Đề xuất P6. |
| 15 | T | Khóa học lưu nguyên khối: tài liệu `courses` tới 674 KB. `listAcademyCourses` đọc mọi khóa đã xuất bản trong transaction chỉ để trả metadata (khoảng 170 đơn vị đọc mỗi khóa). Mỗi bản `courseRevisions` cũng nặng tương tự. | `index.js:4201`, `academy-course-storage.js` | Đề xuất P7. |
| 16 | T | CI trên `main` đỏ vì ba test ghim 598 export trong khi có 605. Quy trình phát hành chính thức cần ref xanh nên các lần deploy gần đây phải làm tay. | 3 file test trong `functions/` | Nhánh (`308ceff`). |
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
| Merge bốn commit của nhánh này | CI xanh; bỏ khoảng 250 nghìn đơn vị đọc/ngày và 750 lượt gọi/tuần | Thấp | Thấp | 2 |
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

## Phụ lục: các đề xuất cần duyệt trước khi làm

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
