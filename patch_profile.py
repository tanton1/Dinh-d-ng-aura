import re

with open('src/styles.css', 'a') as f:
    f.write('''
/* --- NEW PROFILE PAGE REDESIGN --- */
.profile-page {
  background: #fdfafc;
}

.profile-summary-new {
  position: relative;
  background: linear-gradient(180deg, #fff2f6 0%, #ffffff 100%);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
  padding: 20px;
  border: 1px solid rgba(255, 45, 145, 0.05);
}

.profile-summary-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 180px;
  background: url('data:image/svg+xml;utf8,<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><path d="M0,120 Q100,80 200,130 T400,100 L400,0 L0,0 Z" fill="%23ffeaf1" opacity="0.6"/></svg>') no-repeat center top;
  background-size: cover;
  z-index: 0;
  pointer-events: none;
}

.profile-top-row {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
}

.profile-avatar-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.avatar-circle {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff4c4c, #ff1a8c);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 32px;
  font-weight: 700;
  box-shadow: 0 8px 16px rgba(255, 26, 140, 0.3);
}

.avatar-circle .edit-btn {
  position: absolute;
  bottom: 0;
  right: -4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: white;
  border: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  padding: 0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #666;
  font-weight: 500;
}

.status-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
}

.profile-info-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.pills-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.hello-pill {
  background: rgba(255, 180, 0, 0.15);
  color: #d97706;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 12px;
}

.view-profile-pill {
  background: transparent;
  color: #333;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid #ddd;
  padding: 4px 8px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.profile-info-wrapper h2 {
  font-size: 24px;
  margin: 0 0 2px;
  color: #111;
  font-weight: 800;
}

.profile-info-wrapper p {
  font-size: 12px;
  color: #666;
  margin: 0 0 8px;
}

.profile-info-wrapper .member-badge {
  align-self: flex-start;
  background: #ffe4f0;
  color: #ff1a8c;
  font-size: 9px;
  font-weight: 800;
  padding: 4px 8px;
  border-radius: 8px;
  text-transform: uppercase;
}

.profile-stats-card {
  position: relative;
  z-index: 1;
  background: white;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.04);
}

.stats-grid {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.stat-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  flex: 1;
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.stat-icon.red-icon { background: #ffe4e6; color: #f43f5e; }
.stat-icon.purple-icon { background: #f3e8ff; color: #a855f7; }
.stat-icon.orange-icon { background: #ffedd5; color: #f97316; }
.stat-icon.pink-icon { background: #fce7f3; color: #ec4899; }

.stat-col strong {
  font-size: 18px;
  color: #111;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-col strong .unit {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  margin-left: 1px;
}

.stat-col small {
  font-size: 10px;
  color: #888;
}

.outline-button-pink {
  width: 100%;
  padding: 12px;
  border: 1px solid #ff1a8c;
  border-radius: 12px;
  background: transparent;
  color: #ff1a8c;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: 0.2s;
}

.outline-button-pink:active {
  background: rgba(255, 26, 140, 0.05);
}

.coach-card-new {
  display: flex;
  align-items: center;
  background: white;
  border-radius: 16px;
  padding: 16px;
  gap: 12px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.03);
  margin-top: 20px;
}

.coach-card-new .avatar-circle-sm {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #dcfce7;
  color: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
}

.coach-card-new .info {
  flex: 1;
}

.coach-card-new .info small {
  display: block;
  font-size: 9px;
  color: #888;
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 2px;
}

.coach-card-new .info strong {
  display: block;
  font-size: 15px;
  color: #111;
  margin-bottom: 2px;
}

.coach-card-new .info p {
  margin: 0;
  font-size: 11px;
  color: #666;
}

.coach-card-new .arrow {
  color: #999;
}

.section-card {
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.03);
  margin-top: 20px;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-header-row h2 {
  font-size: 18px;
  margin: 0;
  color: #111;
}

.section-header-row .text-button.pink {
  color: #ff1a8c;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.list-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.list-item .icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-wrapper.red-soft { background: #ffe4e6; color: #f43f5e; }
.icon-wrapper.purple-soft { background: #f3e8ff; color: #a855f7; }
.icon-wrapper.orange-soft { background: #ffedd5; color: #f97316; }

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-content small {
  font-size: 11px;
  color: #666;
}

.item-content strong {
  font-size: 14px;
  color: #111;
}

.item-action {
  text-align: right;
  display: flex;
  align-items: center;
}

.status-pill {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
}
.status-pill.pink-soft { background: #ffe4f0; color: #ff1a8c; }

.status-text {
  font-size: 12px;
  font-weight: 700;
}
.status-text.green { color: #22c55e; }
.status-text.dark { color: #333; }
.status-text.pink { color: #ff1a8c; }

.progress-mini {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  width: 60px;
}
.progress-mini .progress-text {
  font-size: 13px;
  font-weight: 800;
}
.progress-mini .progress-text.pink { color: #ff1a8c; }
.progress-mini .progress-bar-bg {
  width: 100%;
  height: 4px;
  background: #f1f1f1;
  border-radius: 2px;
  overflow: hidden;
}
.progress-mini .progress-bar-fill.pink {
  height: 100%;
  background: #ff1a8c;
}
''')

