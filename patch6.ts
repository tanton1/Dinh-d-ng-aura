import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// Update KPI Stats Grid
content = content.replace(
  '<div className="aura-kpi-card orange">',
  '<div className={`aura-kpi-card orange cursor-pointer ${activeFilter === \'pending_response\' ? \'ring-2 ring-orange-500\' : \'\'}`} onClick={() => setActiveFilter(\'pending_response\')}>'
);
content = content.replace(
  '<div className="aura-kpi-card pink">',
  '<div className={`aura-kpi-card pink cursor-pointer ${activeFilter === \'priority\' ? \'ring-2 ring-pink-500\' : \'\'}`} onClick={() => setActiveFilter(\'priority\')}>'
);
content = content.replace(
  '<div className="aura-kpi-card green">',
  '<div className={`aura-kpi-card green cursor-pointer ${activeFilter === \'approved\' ? \'ring-2 ring-emerald-500\' : \'\'}`} onClick={() => setActiveFilter(\'approved\')}>'
);
content = content.replace(
  '<div className="aura-kpi-card purple">',
  '<div className="aura-kpi-card purple cursor-pointer">'
);
content = content.replace(
  '<strong className="aura-kpi-val">92%</strong>',
  '<strong className="aura-kpi-val">{onTimePercentage}%</strong>'
);

// Add Overdue to Quick Filter Pills
const pillHtml = `
            <button
              type="button"
              className={\`aura-filter-pill-item \${activeFilter === 'overdue' ? 'active' : ''}\`}
              onClick={() => setActiveFilter('overdue')}
            >
              Quá hạn <span className="pill-count">{allMeals.filter((m) => m.status === 'pending' && Boolean(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)).length}</span>
            </button>`;

content = content.replace(
  '<div className="aura-filter-pills-scroll">',
  '<div className="aura-filter-pills-scroll">' + pillHtml
);

fs.writeFileSync(file, content);
