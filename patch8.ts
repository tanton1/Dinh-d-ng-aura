import fs from 'fs';
const file = 'src/pages/student/CapturedMealDetail.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove DEFAULT_INGREDIENTS entirely
content = content.replace(/const DEFAULT_INGREDIENTS: Record<string, AiFoodItem\[\]> = \{[\s\S]*?\}\n\n/g, '');
// just in case it didn't match perfectly, let's do a more robust replace
