const fs = require('fs');
let code = fs.readFileSync('src/pages/student/ProfilePage.tsx', 'utf8');

const importsToAdd = `import { Bell } from 'lucide-react';\n`;
if (!code.includes('import { Bell }')) {
  code = code.replace("import { ", "import { Bell, ");
}

code = code.replace(
  `<div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <button className="primary-button" onClick={onEditProfile} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Pencil size={18} /> Cập nhật hồ sơ (Onboarding)</button>
            </div>`,
  ``
);

code = code.replace(
  `{membership === 'pro' ? <><ShieldCheck size={14}/> PRO</> : 'Gói Cơ Bản'}
            </div>
          </div>
        </div>`,
  `{membership === 'pro' ? <><ShieldCheck size={14}/> PRO</> : 'Gói Cơ Bản'}
            </div>
          </div>
          <button onClick={onEditProfile} style={{ background: 'linear-gradient(135deg, #ff7a18, #af002d 31.4%, #319197 100%)', color: 'white', border: 'none', borderRadius: '999px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.2)' }}>
            <Pencil size={14} /> Sửa
          </button>
        </div>`
);

const notifSection = `
        {/* Settings */}
        <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f3e8ff', padding: '8px', borderRadius: '12px' }}><Bell size={20} color="#a855f7" /></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Cài đặt Thông báo</h3>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#f8fafc', borderRadius: '16px' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '15px' }}>Nhắc nhở bữa ăn</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '4px' }}>Nhận thông báo ghi chép đúng giờ</div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 20, height: 20, accentColor: '#ff3f7d' }} checked={data.notificationsEnabled} onChange={() => {}} onClick={onEditProfile} />
            </label>
          </div>
        </div>
`;

code = code.replace(
  `{/* Actions */}`,
  `${notifSection}\n        {/* Actions */}`
);

fs.writeFileSync('src/pages/student/ProfilePage.tsx', code);
