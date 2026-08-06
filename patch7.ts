import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const overdueSection = `
        {/* SECTION 0: QUÁ HẠN */}
        {overdueMeals.length > 0 && (
          <div className="aura-dash-group-section">
            <div className="aura-group-header-row" style={{ color: '#dc2626' }}>
              <h3>Quá hạn - Trễ SLA ({overdueMeals.length})</h3>
              <button
                type="button"
                className="aura-see-all-link"
                onClick={() => setViewMode('batch')}
              >
                Xem tất cả &gt;
              </button>
            </div>

            <div className="aura-priority-cards-grid">
              {overdueMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="aura-priority-meal-card cursor-pointer"
                  onClick={() => handleOpenDetail(meal.id)}
                  style={{ borderColor: '#fecaca', background: '#fff5f5' }}
                >
                  <div className="aura-card-photo-wrapper">
                    <img src={meal.img} alt={meal.studentName} />
                    <span className="aura-badge-priority-top" style={{ background: '#ef4444' }}>
                      <AlertCircle size={10} /> Quá hạn
                    </span>
                  </div>
                  <div className="aura-card-info-side">
                    <h4>{meal.studentName}</h4>
                    <span className="aura-card-time text-red-600">{meal.time}</span>
                    <div className="aura-card-macros">
                      <span className="macro-kcal"><Flame size={12} /> {meal.totalKcal} kcal</span>
                    </div>
                  </div>
                  <div className="aura-card-action-side">
                    <button type="button" className="aura-review-btn">
                      Duyệt ngay
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
`;

content = content.replace(
  "{/* SECTION 1: ƯU TIÊN CAO */}",
  overdueSection + "\n        {/* SECTION 1: ƯU TIÊN CAO */}"
);

fs.writeFileSync(file, content);
