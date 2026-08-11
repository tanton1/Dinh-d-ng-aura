const fs = require('fs');
let code = fs.readFileSync('src/services/nutritionService.ts', 'utf8');

const target = `    if (res.ok) {
      const data = await res.json()`;

const replacement = `    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error === 'Thiếu GEMINI_API_KEY trên server.') {
        throw new Error('Vui lòng cài đặt GEMINI_API_KEY trong môi trường production (Settings -> Secrets) để sử dụng phiên bản AI mới nhất. Phiên bản cũ trên Firebase không hỗ trợ các tính năng phân tích chi tiết.');
      }
      throw new Error(errData.error || 'Lỗi từ máy chủ AI');
    }
    if (res.ok) {
      const data = await res.json()`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/nutritionService.ts', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
