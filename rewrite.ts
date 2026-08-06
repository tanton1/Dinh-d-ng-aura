import fs from 'fs';

const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
const content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');
const startIdx = lines.findIndex(l => l.includes('// VIEW 1: OVERVIEW DASHBOARD'));

if (startIdx === -1) {
    console.error("Could not find VIEW 1 start");
    process.exit(1);
}

const before = lines.slice(0, startIdx - 1).join('\n'); // keep lines before VIEW 1

const newView = `
  // ==========================================
  // VIEW 1: OVERVIEW DASHBOARD ("DUYỆT BỮA ĂN")
  // ==========================================
  return (
    <div className="aura-nutrition-dashboard-screen">
      {/* Top Header Bar */}
      <header className="aura-dash-top-bar">
        <div className="aura-dash-brand">
          <small className="aura-brand-eyebrow">AURA ACADEMY</small>
          <h1 className="aura-brand-title">Duyệt bữa ăn</h1>
        </div>
        <div className="aura-dash-actions">
          <button
            type="button"
            className="aura-icon-circle-btn"
            onClick={() => {
              const term = prompt('Tìm kiếm bữa ăn (tên học viên, món ăn...):', searchTerm)
              if (term !== null) setSearchTerm(term)
            }}
          >
            <Search size={18} />
          </button>
          <button type="button" className="aura-icon-circle-btn relative">
            <Bell size={18} />
            <span className="aura-bell-badge">3</span>
          </button>
        </div>
      </header>

      <div className="aura-dash-body-content">
        {/* Welcome Hero Card */}
        <div className="aura-welcome-hero-card">
          <div className="aura-hero-text-col">
            <h2>Chào buổi sáng, Coach!</h2>
            <p>Hôm nay bạn có {allMeals.filter((m) => m.status === 'pending').length} bữa ăn cần duyệt.</p>
          </div>
          <div className="aura-hero-stats-badge">
            <div className="aura-stat-circle">
              <span className="text-2xl">📋</span>
            </div>
          </div>
        </div>

        {/* 4-Stat KPI Grid */}
        <div className="aura-kpi-stats-grid">
          <div className={\`aura-kpi-card orange cursor-pointer \${activeFilter === 'pending_response' ? 'ring-2 ring-orange-500' : ''}\`} onClick={() => setActiveFilter('pending_response')}>
            <div className="aura-kpi-icon">
              <Clock size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.status === 'pending' && !(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)).length}</strong>
            <span className="aura-kpi-lbl">Chờ duyệt</span>
          </div>

          <div className={\`aura-kpi-card pink cursor-pointer \${activeFilter === 'overdue' ? 'ring-2 ring-pink-500' : ''}\`} onClick={() => setActiveFilter('overdue')}>
            <div className="aura-kpi-icon">
              <AlertCircle size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.status === 'pending' && Boolean(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)).length}</strong>
            <span className="aura-kpi-lbl">Trễ SLA</span>
          </div>

          <div className={\`aura-kpi-card green cursor-pointer \${activeFilter === 'approved' ? 'ring-2 ring-emerald-500' : ''}\`} onClick={() => setActiveFilter('approved')}>
            <div className="aura-kpi-icon">
              <CheckCircle2 size={16} />
            </div>
            <strong className="aura-kpi-val">{allMeals.filter((m) => m.status === 'approved').length}</strong>
            <span className="aura-kpi-lbl">Đã duyệt</span>
          </div>

          <div className="aura-kpi-card purple">
            <div className="aura-kpi-icon">
              <Percent size={16} />
            </div>
            <strong className="aura-kpi-val">{onTimePercentage}%</strong>
            <span className="aura-kpi-lbl">SLA (60p)</span>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="aura-dash-search-row">
          <div className="aura-search-input-box">
            <Search size={16} className="aura-search-icon" />
            <input
              type="text"
              placeholder="Tìm tên học viên, món ăn..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button type="button" className="aura-filter-settings-btn" onClick={() => setViewMode('batch')}>
            <SlidersHorizontal size={18} />
          </button>
        </div>

        {/* Render filtered meals directly */}
        <div className="aura-dash-group-section" style={{ marginTop: '16px' }}>
          <div className="aura-pending-meals-list">
            {filteredMeals.length === 0 ? (
               <div className="text-center py-8 text-gray-400">Không có dữ liệu phù hợp.</div>
            ) : filteredMeals.map((meal) => {
              const isOverdue = meal.status === 'pending' && Boolean(meal.createdAtTimestamp && (now - meal.createdAtTimestamp) > 3600000);
              return (
                <div
                  key={meal.id}
                  className="aura-pending-meal-item-row cursor-pointer relative"
                  onClick={() => handleOpenDetail(meal.id)}
                  style={isOverdue ? { borderColor: '#fecaca', background: '#fff5f5' } : {}}
                >
                  <div className="aura-item-thumb">
                    <img src={meal.img} alt={meal.studentName} />
                  </div>

                  <div className="aura-item-details flex-1">
                    <div className="aura-item-top flex justify-between items-center mb-1">
                      <strong className="aura-student-name flex items-center gap-2">
                        {meal.studentName}
                        {isOverdue && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Trễ SLA</span>}
                      </strong>
                      <span className={\`aura-item-time \${isOverdue ? 'text-red-600 font-medium' : ''}\`}>{meal.time}</span>
                    </div>

                    <div className="aura-item-sub flex justify-between items-center mb-2">
                      <span className="aura-meal-type text-gray-500 text-xs">{meal.mealType || 'Bữa ăn'}</span>
                      {meal.status === 'approved' ? (
                        <span className="aura-status-approved-badge flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-100">
                          <Check size={12} /> Đã duyệt
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400 font-medium">Chờ duyệt</span>
                      )}
                    </div>

                    <div className="aura-item-macros flex gap-3 text-[12px] text-gray-600">
                      <span className="flex items-center gap-1"><Flame size={12} className="text-orange-500" /> <strong>{meal.totalKcal}</strong> kcal</span>
                      <span><strong>{meal.totalProtein}g</strong> đạm</span>
                      <span><strong>{meal.totalCarb || 38}g</strong> carb</span>
                      <span><strong>{meal.totalFat || 9}g</strong> béo</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* App Bottom Navigation Bar */}
      <nav className="aura-app-bottom-navbar">
        <button
          type="button"
          className="aura-nav-item active"
          onClick={() => onNavigate?.('admin_nutrition_reviews')}
        >
          <span className="aura-nav-icon">🥗</span>
          <span>Duyệt Meal</span>
        </button>
        <button
          type="button"
          className="aura-nav-item"
          onClick={() => onNavigate?.('admin_programs')}
        >
          <span className="aura-nav-icon">📋</span>
          <span>Chương trình</span>
        </button>
        <button
          type="button"
          className="aura-nav-item"
          onClick={() => onNavigate?.('admin_roles')}
        >
          <span className="aura-nav-icon">⚙️</span>
          <span>Thêm</span>
        </button>
      </nav>
    </div>
  )
}
`;

fs.writeFileSync(file, before + '\n' + newView);

