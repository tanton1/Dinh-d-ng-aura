const fs = require('fs');
let code = fs.readFileSync('src/services/nutritionService.ts', 'utf8');

const target = `  } catch (e) {
    console.warn('Direct AI endpoint fallback:', e)
  }`;

const replacement = `  } catch (e: any) {
    console.warn('Direct AI endpoint fallback:', e)
    if (e?.message === 'MISSING_GEMINI_API_KEY') {
      throw new Error('Thiếu GEMINI_API_KEY trong môi trường production (Cài đặt -> Secrets). Hệ thống không thể sử dụng phiên bản AI mới để phân tích chi tiết.');
    }
  }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/nutritionService.ts', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
