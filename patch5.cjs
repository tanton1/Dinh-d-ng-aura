const fs = require('fs');
let code = fs.readFileSync('src/services/nutritionService.ts', 'utf8');

const target = `    if (response.ok) {
      const data = await response.json();
      return data.text || 'AI Coach chưa có phản hồi.';
    }`;

const replacement = `    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (errData.error === 'Thiếu GEMINI_API_KEY trên server.') {
        throw new Error('MISSING_GEMINI_API_KEY');
      }
      throw new Error(errData.error || 'Lỗi từ máy chủ AI');
    }
    if (response.ok) {
      const data = await response.json();
      return data.text || 'AI Coach chưa có phản hồi.';
    }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/nutritionService.ts', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
