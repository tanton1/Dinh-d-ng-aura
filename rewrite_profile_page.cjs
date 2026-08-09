const fs = require('fs');
const path = 'src/pages/student/ProfilePage.tsx';
let code = fs.readFileSync(path, 'utf8');

// Replace the User Identity Card to make it stand out more
const newProfileHeader = `
        {/* User Identity - Hero Style */}
        <div style={{ position: 'relative', padding: '32px 24px', background: 'linear-gradient(135deg, #1e293b, #0f172a)', borderRadius: '24px', overflow: 'hidden', color: 'white', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
          <div style={{ position: 'absolute', top: '-50%', left: '-20%', width: '150%', height: '150%', background: 'radial-gradient(circle, rgba(255, 63, 125, 0.15) 0%, rgba(0,0,0,0) 60%)', pointerEvents: 'none' }}></div>
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '40px', background: 'linear-gradient(135deg, #ff8a38, #ff3f7d)', padding: '2px' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: '40px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserRound size={40} color="#ff3f7d" />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 4px', color: 'white' }}>{displayName || 'Thành viên Aura'}</h2>
              <p style={{ color: '#94a3b8', margin: '0 0 12px', fontSize: '14px' }}>{email}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: membership === 'pro' ? 'linear-gradient(135deg, #3b82f6, #60a5fa)' : 'rgba(255,255,255,0.1)', color: 'white', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>
                  {membership === 'pro' ? <><ShieldCheck size={14}/> PRO</> : 'Gói Cơ Bản'}
                </div>
                <button onClick={onEditProfile} style={{ background: 'linear-gradient(135deg, #ff8a38, #ff3f7d)', color: 'white', border: 'none', borderRadius: '999px', padding: '6px 14px', fontSize: '12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.3)' }}>
                  <Pencil size={12} /> Cập nhật
                </button>
              </div>
            </div>
          </div>
        </div>`;

// Replace the old user identity card using regex
code = code.replace(/\{\/\* User Identity \*\/\}[\s\S]*?\{\/\* Basic Stats \*\/\}/, newProfileHeader + '\n        {/* Basic Stats */}');

// Improve Notification settings
const newNotif = `
        {/* Settings */}
        <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: 'linear-gradient(to bottom, #a855f7, #ec4899)' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f3e8ff', padding: '8px', borderRadius: '12px' }}><Bell size={20} color="#a855f7" /></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Quản lý thông báo</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#f8fafc', borderRadius: '16px' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px', color: '#0f172a' }}>Nhắc nhở bữa ăn (3 mốc)</div>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '4px' }}>{data.mealTimes ? data.mealTimes.join(' • ') : '07:30 • 12:00 • 19:00'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={onEditProfile} style={{ background: 'white', color: '#ff3f7d', border: '1px solid #ffdde5', borderRadius: '999px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  Thiết lập
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 20, height: 20, accentColor: '#ff3f7d' }} checked={data.notificationsEnabled !== false} readOnly />
                </label>
              </div>
            </div>
          </div>
        </div>
`;

code = code.replace(/\{\/\* Settings \*\/\}[\s\S]*?\{\/\* Actions \*\/\}/, newNotif + '        {/* Actions */}');

fs.writeFileSync(path, code);
