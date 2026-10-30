# Graphify cho Aura

Graphify tạo bản đồ file, symbol, import và lời gọi để hỗ trợ đọc mã, đánh giá phạm vi thay đổi và chọn phần cần tối ưu. Aura dùng bản chính thức `graphifyy==0.9.97` từ [Graphify Labs](https://github.com/Graphify-Labs/graphify). Phiên bản và các phụ thuộc Python được khóa trong `requirements.txt`; bộ đọc callable dùng TypeScript 5.8.3 với lockfile riêng.

Đây là công cụ phát triển. Nó không nằm trong bundle web, Cloud Functions hay luồng xử lý người dùng. Chi phí phân tích AST là tài nguyên máy phát triển; build đã chạy với 0 token LLM. Không cần bổ sung key apikey.fun.

## Cài đặt và sử dụng

Yêu cầu Node/npm của dự án và Python 3.12. Trên Windows, có thể dùng Python đi kèm Codex; installer tự tìm. Nếu dùng Python riêng, đặt `AURA_GRAPHIFY_PYTHON` bằng đường dẫn executable. Không thay Python hay cấu hình Codex toàn máy.

```powershell
# Tại thư mục gốc Aura, cài dependency của checkout nếu chưa có.
npm.cmd ci --ignore-scripts
npm.cmd run graphify:install
npm.cmd run graphify:build
npm.cmd run graphify -- stats
npm.cmd run graphify -- query "DatabaseContext" --budget 1500
npm.cmd run graphify -- explain "DatabaseProvider"
npm.cmd run graphify -- path "DatabaseContext.tsx" "firebaseFirestore.ts"
```

Trên macOS/Linux dùng `npm` thay `npm.cmd`; lock hiện đã được kiểm tra trên Windows x64/Python 3.12. Không cần activate venv. Wrapper gọi đúng interpreter tại `.tools/graphify/venv`.

`build` kiểm tra hash của mã nguồn, cấu hình phạm vi và auditor. Khi không đổi, công cụ dùng lại graph đã xác minh. Khi có thay đổi, công cụ dựng lại graph AST đầy đủ. Không bật watcher, hook Git, MCP server hoặc job CI tự động.

Lý do dựng lại đầy đủ: trong kiểm thử 0.9.97, lượt incremental không đổi mã vẫn loại một số reference node; `--force` cũng có thể merge graph cũ. Wrapper tách graph cũ trước extraction, phục hồi graph cũ khi thất bại và chỉ đánh dấu hoàn tất khi graph, báo cáo và inventory đều thành công. Manifest bị vô hiệu hóa khi build thất bại. Nếu mã thay đổi giữa chừng, build bị từ chối và cần chạy lại.

## Phạm vi và đầu ra

`.graphifyignore` chỉ cho phép `src/` và `functions/`, gồm cả `src/lib/`. Bỏ test, fixture, node_modules, build, tài liệu, dữ liệu JSON/CSV, ảnh và file môi trường. `--code-only --no-dedup` tránh semantic extraction và tránh gộp hai symbol chỉ vì tên gần giống; `cluster-only --no-label` không dùng LLM đặt tên cụm.

| File trong `graphify-out/` | Công dụng |
| --- | --- |
| `graph.html` | Graph tương tác. Graph lớn được gộp theo community; dùng query để xem symbol chi tiết |
| `graph.json` | Dữ liệu graph do Graphify tạo |
| `GRAPH_REPORT.md` | Báo cáo Graphify, có phân loại EXTRACTED/INFERRED |
| `aura-structure.json` | Import giữa file, điểm tập trung phụ thuộc, nhóm vòng phụ thuộc cần kiểm tra |
| `aura-callables.json` và `.txt` | Inventory do auditor TypeScript sẵn có của Aura tạo |
| `aura-source-manifest.json` | Checkout, commit, hash từng file và hash graph để kiểm tra độ mới |

Toàn bộ output và venv được Git bỏ qua. Không đưa graph lớn hoặc cache vào deployment. Nếu công cụ báo graph cũ, chạy lại build; không dùng graph cũ để quyết định xóa function. Để build callable inventory đúng, checkout nguồn phải có dependency Firebase: thiếu declaration của SDK có thể khiến auditor bỏ sót transport alias; wrapper đã chặn trường hợp này.

## Tách bản main và thay đổi đang làm

Thư mục làm việc có thể khác bản đã phát hành. Dùng worktree riêng và output riêng:

```powershell
npm.cmd run graphify -- build --source 'C:\path\to\reviewed-checkout' --name main
npm.cmd run graphify -- query 'nutritionScanQueue' --budget 1500 --source 'C:\path\to\reviewed-checkout' --name main
npm.cmd run graphify -- stats --source 'C:\path\to\reviewed-checkout' --name main
```

Copy `.graphifyignore` vào checkout nguồn trước khi build và cài dependency của checkout đó. `--name main` lưu ở `graphify-out/main/`. Query phải dùng lại đúng `--source` và `--name`. Công cụ từ chối dùng graph của checkout khác, nguồn đã đổi hoặc graph bị sửa ngoài quy trình.

Baseline ngày 30/10/2026 dùng main `af311e9c144b2d2318fb0a4c751f1c1082c09c2d`, quét 539 file. Graph của thư mục làm việc đang có thay đổi riêng được lưu ở output mặc định, không được xem là trạng thái production. Số liệu gọn để review nằm trong `baselines/main-20261030.json`.

## Cách đọc kết quả đúng

- `calls`/`imports` là bằng chứng tĩnh; một số cạnh suy luận vẫn có thể xuất hiện dù không dùng LLM. Xác minh cạnh quan trọng bằng mã tại source location.
- Type-only import vẫn có thể tạo vòng trong graph. Không suy ra lỗi runtime hoặc bundle chậm chỉ từ vòng này.
- Firebase callable là tên chuỗi qua network, không phải lời gọi JS liên file. Đọc `aura-callables.json` cùng graph để nối màn hình → service → endpoint; đọc handler để xác định collection và quyền.
- Nhiều service cùng dùng endpoint không chứng minh gửi trùng. So sánh payload, session, scope và request thực tế.
- Không tìm thấy tham chiếu frontend không chứng minh function không dùng: còn scheduler, trigger, worker, admin script và client cũ.
- Các nhóm community và số cạnh có thể thay đổi theo phiên bản/thuật toán. Không dùng số cạnh hoặc số dòng làm mục tiêu tiết kiệm tiền.

## Bảo trì

Nâng version trong PR riêng: cập nhật lock, xác minh upstream, build một corpus nhỏ, kiểm tra transport inventory và khả năng query rồi mới cập nhật baseline. Tham khảo [pyproject chính thức](https://github.com/Graphify-Labs/graphify/blob/v8/pyproject.toml) và [CLI chính thức](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/cli.py). Không chạy `graphify install` mặc định trong dự án: installer upstream có thể thêm hook/instructions luôn bật, trong khi Aura dùng wrapper có phạm vi rõ ràng.

Nếu gỡ tích hợp, bỏ ba script npm, `.graphifyignore`, `scripts/graphify.mjs`, `tools/graphify/` và các link tài liệu liên quan. Cache `graphify-out/` và venv `.tools/graphify/` chỉ là dữ liệu local có thể bỏ sau khi xác minh đúng đường dẫn. Không có bước gỡ nào cần tác động Firebase/Vercel.
