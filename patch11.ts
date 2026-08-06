import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove AI tab and logic
content = content.replace(
  "| 'low_ai'",
  ""
);
content = content.replace(
  "if (activeFilter === 'low_ai') return (m.aiScore ? m.aiScore < 75 : false) && m.status === 'pending'",
  ""
);
content = content.replace(
  /<button\s+type="button"\s+className=\{`aura-filter-pill-item \${activeFilter === 'low_ai'.*?<\/button>/gs,
  ""
);
// Remove AI Score tags from the UI
content = content.replace(/\{meal\.aiScore && \([\s\S]*?\}\)/g, "");
content = content.replace(/<span className="aura-ai-score-tag.*?<\/span>/g, "");
content = content.replace(/<span className="aura-ai-score-pill.*?<\/span>/g, "");
// Remove the AI banner
content = content.replace(/\{\/\* AI Banner Alert \*\/\}.*?<\/div>/gs, "");
// Remove the AI analysis section from meal detail view
content = content.replace(/\{\/\* AI Analysis Section.*?<\/svg>\s*<div className="aura-gauge-text">.*?<\/div>\s*<\/div>.*?<\/div>\s*<\/div>/gs, "");


fs.writeFileSync(file, content);
