import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "if (activeFilter === 'pending_response') return m.status === 'pending'",
  "if (activeFilter === 'pending_response') return m.status === 'pending' && !(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)"
);

// Also remove `overdueMeals`, `highPriorityMeals`, `pendingMeals`, `approvedMeals` variables if they are unused now to avoid TS errors
// But they might be used in VIEW 2 (batch). Let's keep them if they don't break anything.

fs.writeFileSync(file, content);
