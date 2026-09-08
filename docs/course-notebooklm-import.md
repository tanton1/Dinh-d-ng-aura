# Nhập nội dung từ NotebookLM vào Aura Academy

Course Editor hỗ trợ nhập nội dung NotebookLM theo chương/bài học ở **Bước 2 – Nội dung Aura Academy**.

## File đầu vào

Chọn nhiều file cùng lúc:

- `manifest.json` (không bắt buộc): `chapterTitle`, `lessonTitle`, `sourceUrl`, `generatedAt`.
- `flashcards.csv`: cột `front,back,hint` (có thể dùng tên tiếng Việt như `Mặt trước,Mặt sau,Gợi ý`).
- `quiz.json`: mảng câu hỏi hoặc `{ "questions": [...] }` với `question`, `options`, `correctIndex`; có thể dùng `correctAnswer` thay cho `correctIndex`.
- Slide: PDF, PPT, PPTX.
- Video: MP4, WebM, OGG, MOV.
- Tài liệu: DOC, DOCX, TXT.

## Luồng an toàn

1. Chọn chương và bài học đích trong phần **Chi tiết bài học**.
2. Mở **Nhập nội dung NotebookLM**, chọn file.
3. Xem số lượng flashcard, câu hỏi, học liệu và lỗi theo từng file/dòng.
4. Chọn **Bổ sung**, **Thay nội dung cùng loại** hoặc **Tạo bài học mới**.
5. Bấm **Nhập vào bản nháp**.
6. Tải học liệu lên Firebase Storage (khi đang dùng Firebase), rồi bấm **Lưu bản nháp**.
7. Kiểm tra diff và gửi duyệt/xuất bản sau khi đã biên tập nội dung AI.

Nội dung đã xuất bản không bị sửa trực tiếp. Mỗi lesson và resource giữ provenance `NotebookLM`, mã lô nhập và hash file để lần nhập lại không tạo bản sao. Server ghi nhận lô nhập ở `courseImportBatches` cùng revision mới nhất.

## Xuất quiz từ NotebookLM

NotebookLM có nút tải flashcard CSV. Với quiz, yêu cầu NotebookLM trả về JSON thuần, không markdown:

```text
Xuất toàn bộ câu hỏi thành JSON hợp lệ, không markdown.
Mỗi phần tử gồm:
{
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "explanation": "...",
  "difficulty": 1,
  "mustPass": false
}
Chỉ dùng thông tin từ nguồn đã chọn, không thêm kiến thức ngoài nguồn.
```

Importer chỉ nhận dữ liệu hợp lệ và không công bố đáp án đúng trong payload học viên; đáp án được tách vào `quizKeys` khi lưu khóa học.
