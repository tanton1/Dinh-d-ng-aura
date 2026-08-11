const fs = require('fs');
let code = fs.readFileSync('src/services/nutritionService.ts', 'utf8');

const target = `  } catch (error) {
    console.warn('Direct AI endpoint fallback for generateMealReview:', error);
  }`;

const replacement = `  } catch (error: any) {
    console.warn('Direct AI endpoint fallback for generateMealReview:', error);
    if (error?.message === 'MISSING_GEMINI_API_KEY') {
      return 'Thiếu GEMINI_API_KEY trong môi trường production. Vui lòng cài đặt (Settings -> Secrets) để nhận nhận xét từ AI.';
    }
  }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/nutritionService.ts', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
