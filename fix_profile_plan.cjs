const fs = require('fs');
let code = fs.readFileSync('src/pages/student/ProfilePage.tsx', 'utf8');

const before = `        {/* Lifestyle */}`;

const after = `        {/* Starting Plan */}
        {nutrition.targetCalories && (
          <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: '#f0f9ff', padding: '8px', borderRadius: '12px' }}><Target size={20} color="#0284c7" /></div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Kế hoạch khởi điểm</h3>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--aura-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
              Đây là các chỉ số mục tiêu được tính toán lúc bạn thiết lập hồ sơ. 
              Mục tiêu hàng ngày trong tab Dinh dưỡng có thể chênh lệch vì nó sẽ <strong>tự động điều chỉnh theo cân nặng thực tế</strong> mà bạn cập nhật mỗi ngày.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)' }}>Mục tiêu calo</div>
                <div style={{ fontSize: '20px', fontWeight: 800 }}>{Math.round(nutrition.targetCalories)} <small style={{ fontSize: '12px' }}>kcal</small></div>
              </div>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)' }}>Protein</div>
                <div style={{ fontSize: '20px', fontWeight: 800 }}>{Math.round(nutrition.protein)} <small style={{ fontSize: '12px' }}>g</small></div>
              </div>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)' }}>Carbs</div>
                <div style={{ fontSize: '20px', fontWeight: 800 }}>{Math.round(nutrition.carbs)} <small style={{ fontSize: '12px' }}>g</small></div>
              </div>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px' }}>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)' }}>Fat</div>
                <div style={{ fontSize: '20px', fontWeight: 800 }}>{Math.round(nutrition.fat)} <small style={{ fontSize: '12px' }}>g</small></div>
              </div>
            </div>
          </div>
        )}

        {/* Lifestyle */}`;

code = code.replace(before, after);
code = code.replace("  const data = fullProfile?.onboardingData || {};", "  const data = fullProfile?.onboardingData || {};\n  const nutrition = fullProfile?.nutritionProfile || {};");

fs.writeFileSync('src/pages/student/ProfilePage.tsx', code);
