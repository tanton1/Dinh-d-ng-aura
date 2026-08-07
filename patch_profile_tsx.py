import re

with open('src/pages/student/ProfilePage.tsx', 'r') as f:
    content = f.read()

# Remove the inline styles that were added earlier
content = re.sub(r'<style>\{`.*?`\}</style>', '', content, flags=re.DOTALL)

# Let's replace the whole profile-layout section with the new one.
# First, let's extract the part before `<section className="profile-layout">`
before_section = content.split('<section className="profile-layout">')[0]

# And the part after the section
after_section = content.split('</section>')[1]

new_section = '''<section className="profile-layout" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <aside className="profile-summary-new">
          <div className="profile-summary-bg"></div>
          <div className="profile-top-row">
            <div className="profile-avatar-wrapper">
              <div className="avatar-circle">
                <span>{initials}</span>
                <button className="edit-btn" aria-label="Đổi ảnh đại diện"><Pencil size={12} /></button>
              </div>
              <div className="status-indicator">
                <span className="dot"></span> Đang hoạt động
              </div>
            </div>
            <div className="profile-info-wrapper">
              <div className="pills-row">
                <span className="hello-pill">Xin chào 👋</span>
                <button className="view-profile-pill">Xem hồ sơ <ChevronRight size={14} /></button>
              </div>
              <h2>{displayName}</h2>
              <p>{email || 'Chưa có email'}</p>
              <span className="member-badge">AURA {membershipLabel} · HỒ SƠ AN TOÀN</span>
            </div>
          </div>

          <div className="profile-stats-card">
            <div className="stats-grid">
              <div className="stat-col">
                <span className="stat-icon red-icon"><Target size={20} /></span>
                <strong>{goals.length || '1'}</strong>
                <small>Mục tiêu</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon purple-icon"><Ruler size={20} /></span>
                <strong>{typeof heightCm === 'number' ? heightCm : '—'} <span className="unit">cm</span></strong>
                <small>Chiều cao</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon orange-icon"><Scale size={20} /></span>
                <strong>{typeof weightKg === 'number' ? weightKg : '—'} <span className="unit">kg</span></strong>
                <small>Cân nặng</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon pink-icon"><Calendar size={20} /></span>
                <strong>32</strong>
                <small>Ngày tham gia</small>
              </div>
            </div>
            <button className="outline-button-pink full" type="button" onClick={beginEdit} disabled={!onSave}>
              <Pencil size={15} /> {onSave ? 'Chỉnh sửa hồ sơ' : 'Chỉnh sửa hồ sơ'}
            </button>
          </div>
        </aside>

        <div className="coach-card-new" aria-label="Huấn luyện viên cá nhân sắp ra mắt">
          <div className="avatar-circle-sm"><UserRound size={24} /></div>
          <div className="info">
            <small>HUẤN LUYỆN VIÊN CÁ NHÂN</small>
            <strong>Sắp ra mắt</strong>
            <p>Bạn sẽ được thông báo khi có HLV phù hợp!</p>
          </div>
          <ChevronRight className="arrow" size={20} />
        </div>

        <article className="section-card">
          <div className="section-header-row">
            <h2>Mục tiêu & thể trạng</h2>
            {!editing && (
              <button className="text-button pink" type="button" onClick={beginEdit} disabled={!onSave}>
                Chỉnh sửa <ChevronRight size={16} />
              </button>
            )}
          </div>
          
          {editing ? (
            <form className="course-form-grid" onSubmit={saveProfile}>
              <label className="span-2"><span>Tên hiển thị</span><input required maxLength={80} autoComplete="name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} /></label>
              <label className="span-2"><span>Mục tiêu chính · phân cách bằng dấu phẩy hoặc xuống dòng</span><textarea maxLength={700} value={goalsInput} onChange={(event) => setGoalsInput(event.target.value)} placeholder="Ví dụ: Giảm mỡ, Tăng cơ, Cải thiện sức bền" /></label>
              <label><span>Chiều cao (cm)</span><input type="number" min="80" max="250" step="0.1" inputMode="decimal" value={heightInput} onChange={(event) => setHeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
              <label><span>Cân nặng (kg)</span><input type="number" min="20" max="500" step="0.1" inputMode="decimal" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
              
              <label>
                <span>Mục tiêu thay đổi cân nặng (kg)</span>
                <input type="number" step="0.5" min="-50" max="50" value={targetDeltaInput} onChange={(e) => setTargetDeltaInput(e.target.value)} placeholder="Ví dụ: -5 (giảm) hoặc +3 (tăng)" />
                <small style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px', display: 'block' }}>Nhập số âm (-) để giảm, số dương (+) để tăng cân</small>
              </label>
              <label>
                <span>Thời gian thực hiện (1–12 tháng)</span>
                <select value={timeframeInput} onChange={(e) => setTimeframeInput(e.target.value)}>
                  <option value="1">1 tháng</option>
                  <option value="2">2 tháng</option>
                  <option value="3">3 tháng (Khuyên dùng)</option>
                  <option value="4">4 tháng</option>
                  <option value="6">6 tháng</option>
                  <option value="9">9 tháng</option>
                  <option value="12">12 tháng (1 năm)</option>
                </select>
              </label>
              <label className="span-2">
                <span>Tốc độ tiến trình</span>
                <select value={speedPaceInput} onChange={(e) => setSpeedPaceInput(e.target.value as any)}>
                  <option value="slow">Thong thả & Bền vững (Chậm nhưng chắc chắn)</option>
                  <option value="standard">Tiêu chuẩn & An toàn (Được đề xuất)</option>
                  <option value="fast">Nhanh & Quyết liệt (Cần kỷ luật cao)</option>
                </select>
              </label>
              <div className="span-2 editor-footer">
                <span>Các thông tin sẽ được đồng bộ cùng Aura AI</span>
                <div>
                  <button className="outline-button" type="button" onClick={cancelEdit} disabled={savingProfile}>Hủy</button>
                  <button className="primary-button" type="submit" disabled={savingProfile}>{savingProfile ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {savingProfile ? 'Đang lưu...' : 'Lưu hồ sơ'}</button>
                </div>
              </div>
            </form>
          ) : (
            <div className="list-group">
              <div className="list-item">
                <div className="icon-wrapper red-soft"><Target size={20}/></div>
                <div className="item-content">
                  <small>Mục tiêu chính</small>
                  <strong>{goalsLabel || 'Chưa thiết lập'}</strong>
                </div>
                <div className="item-action">
                  <span className="status-pill pink-soft">Đang thực hiện</span>
                </div>
              </div>
              
              <div className="list-item">
                <div className="icon-wrapper purple-soft"><Ruler size={20}/></div>
                <div className="item-content">
                  <small>Chiều cao · Cân nặng</small>
                  <strong>{formatMeasurement(heightCm, 'cm')} · {formatMeasurement(weightKg, 'kg')}</strong>
                </div>
                <div className="item-action">
                  <span className="status-text green">BMI {heightCm && weightKg ? (weightKg / Math.pow(heightCm / 100, 2)).toFixed(1) : '--'}</span>
                </div>
              </div>

              <div className="list-item">
                <div className="icon-wrapper orange-soft"><Scale size={20}/></div>
                <div className="item-content">
                  <small>Thay đổi cân nặng mong muốn</small>
                  <strong>
                    {targetWeightDeltaKg != null
                      ? targetWeightDeltaKg < 0
                        ? `Giảm ${Math.abs(targetWeightDeltaKg)} kg`
                        : targetWeightDeltaKg > 0
                        ? `Tăng ${targetWeightDeltaKg} kg`
                        : 'Duy trì cân nặng'
                      : 'Chưa thiết lập'}
                  </strong>
                </div>
                <div className="item-action">
                  <span className="status-text dark">Còn {Math.abs(targetWeightDeltaKg || 0)} kg</span>
                </div>
              </div>
              
              <div className="list-item">
                <div className="icon-wrapper red-soft"><Calendar size={20}/></div>
                <div className="item-content">
                  <small>Thời gian thực hiện</small>
                  <strong>{profile?.targetTimeframeMonths || 3} tháng</strong>
                </div>
                <div className="item-action">
                  <div className="progress-mini">
                    <span className="progress-text pink">32%</span>
                    <div className="progress-bar-bg"><div className="progress-bar-fill pink" style={{width: '32%'}}></div></div>
                  </div>
                </div>
              </div>

              <div className="list-item">
                <div className="icon-wrapper red-soft"><Zap size={20}/></div>
                <div className="item-content">
                  <small>Tốc độ tiến trình</small>
                  <strong>{profile?.targetSpeedPace === 'slow' ? 'Thong thả' : profile?.targetSpeedPace === 'fast' ? 'Nhanh' : 'Tiêu chuẩn (~0.5 kg/tuần)'}</strong>
                </div>
                <div className="item-action">
                  <span className="status-text pink">Ổn định</span>
                </div>
              </div>
            </div>
          )}
        </article>
      </section>'''

with open('src/pages/student/ProfilePage.tsx', 'w') as f:
    f.write(before_section + new_section + after_section)
