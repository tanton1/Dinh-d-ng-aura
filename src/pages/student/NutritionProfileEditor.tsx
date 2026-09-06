import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Target, Activity, Check, Info, Scale } from 'lucide-react'
import type { NutritionProfileDraft } from './NutritionPage'
import { calculateNutritionTargets, canonicalNutritionProfile, normalizeActivity } from '../../services/nutritionSyncService'

interface NutritionProfileEditorProps {
  initialProfile: NutritionProfileDraft
  onSave: (profile: NutritionProfileDraft) => void | Promise<void>
  onCancel: () => void
  effectiveWeight?: number
}

export default function NutritionProfileEditor({ initialProfile, onSave, onCancel, effectiveWeight }: NutritionProfileEditorProps) {
  const [profile, setProfile] = useState<NutritionProfileDraft>(() => canonicalNutritionProfile(initialProfile))

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const save = async () => {
    if (saving) return
    setSaving(true); setSaveError('')
    try { await onSave(canonicalNutritionProfile(profile)) }
    catch { setSaveError('Chưa lưu được hồ sơ. Thay đổi vẫn giữ trên màn hình, hãy thử lại.') }
    finally { setSaving(false) }
  }
  const setField = <K extends keyof NutritionProfileDraft>(field: K, value: NutritionProfileDraft[K]) => {
    setProfile((current) => {
      const next = { ...current, [field]: value }
      if (field === 'goal') {
        next.targetWeightDeltaKg = value === 'lose-fat' ? -4 : value === 'gain-muscle' ? 3 : 0
        next.targetWeightKg = current.weightKg + next.targetWeightDeltaKg
      }
      if (field === 'targetWeightDeltaKg') next.targetWeightKg = current.weightKg + Number(value)
      if (field === 'targetSpeedPace') next.targetTimeframeMode = 'pace'
      if (field === 'targetTimeframeMonths') next.targetTimeframeMode = 'duration'
      return next
    })
  }

  const metrics = useMemo(() => {
    if (!profile.heightCm || !profile.weightKg || !profile.age || !profile.biologicalSex || !profile.activityLevel) return null;
    
    const heightM = profile.heightCm / 100;
    const bmi = profile.weightKg / (heightM * heightM);
    
    let bmiCategory = '';
    let bmiColor = '';
    if (bmi < 18.5) { bmiCategory = 'Thiếu cân'; bmiColor = '#3b82f6'; }
    else if (bmi < 25) { bmiCategory = 'Bình thường'; bmiColor = '#22c55e'; }
    else if (bmi < 30) { bmiCategory = 'Thừa cân'; bmiColor = '#f59e0b'; }
    else { bmiCategory = 'Béo phì'; bmiColor = '#ef4444'; }

    const targets = calculateNutritionTargets(profile, effectiveWeight)
    const tdee = targets.tdee
    const targetCalories = targets.targetCaloriesKcal
    const expectation = 'Ước tính ban đầu cho người trưởng thành khỏe mạnh; theo dõi cân nặng để điều chỉnh.'
    const macroRatio = `${targets.proteinG} g đạm · ${targets.carbsG} g carb · ${targets.fatG} g béo`
    const action = profile.goal === 'lose-fat' ? 'Giảm mỡ' : profile.goal === 'gain-muscle' ? 'Tăng cơ' : 'Duy trì'
    const idealWeightLow = 18.5 * (heightM * heightM);
    const idealWeightHigh = 24.9 * (heightM * heightM);

    return { bmi, bmiCategory, bmiColor, tdee, targetCalories, expectation, macroRatio, action, idealWeightLow, idealWeightHigh };
  }, [profile, effectiveWeight]);

  return (
    <div className="nutrition-profile-editor">
      <header className="nutrition-profile-editor__header">
        <button className="back-button" onClick={onCancel}><ArrowLeft size={20} /></button>
        <h2>Hồ sơ & Kế hoạch</h2>
        <button className="save-button" disabled={saving} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
      </header>

      <div className="nutrition-profile-editor__content">
        {saveError && <p role="alert">{saveError}</p>}
        {calculateNutritionTargets(profile, effectiveWeight).issues.map((issue) => <p role="alert" key={issue}>{issue}</p>)}
        {calculateNutritionTargets(profile, effectiveWeight).targetAdjustmentReason && <p role="status">Mục tiêu kcal đã được điều chỉnh để phù hợp giới hạn khởi điểm và đủ macro. Thời gian đạt đích có thể dài hơn dự tính.</p>}
        {metrics && (
          <section className="nutrition-profile-editor__summary">
            <h3 style={{ color: metrics.bmiColor }}>{metrics.bmiCategory}</h3>
            
            <div className="bmi-gauge">
              <div className="bmi-tooltip" style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}>
                {metrics.bmi.toFixed(1)}
              </div>
              <div className="bmi-labels">
                <span>15</span><span style={{ left: '14%' }}>18.5</span><span style={{ left: '40%' }}>25</span><span style={{ left: '60%' }}>30</span><span style={{ right: 0 }}>40</span>
              </div>
              <div className="bmi-bar">
                <div className="bmi-marker" style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}></div>
              </div>
            </div>

            <div className="metrics-cards">
              <div className="metric-card">
                <Info size={16} />
                <small>Cân nặng chuẩn</small>
                <strong>{metrics.idealWeightLow.toFixed(1)} - {metrics.idealWeightHigh.toFixed(1)} kg</strong>
              </div>
              <div className="metric-card" style={{ background: 'var(--nutrition-green-soft)' }}>
                <Target size={16} />
                <small>Mục tiêu Calo</small>
                <strong>{metrics.targetCalories.toFixed(0)} kcal</strong>
              </div>
            </div>

            <div className="macro-suggestion">
              <strong>{metrics.action}</strong>
              <p>{metrics.expectation}</p>
              <p className="macro-ratio">{metrics.macroRatio}</p>
            </div>
          </section>
        )}

        <section className="nutrition-profile-editor__form">
          <h3>Thông tin cơ bản</h3>
          <div className="form-grid">
            <label>
              <span>Giới tính</span>
              <select value={profile.biologicalSex} onChange={(e) => setField('biologicalSex', e.target.value as any)}>
                <option value="male">Nam</option>
                <option value="female">Nữ</option>
              </select>
            </label>
            <label>
              <span>Tuổi</span>
              <input type="number" value={profile.age} onChange={(e) => setField('age', Number(e.target.value))} />
            </label>
            <label>
              <span>Chiều cao (cm)</span>
              <input type="number" value={profile.heightCm} onChange={(e) => setField('heightCm', Number(e.target.value))} />
            </label>
            <label>
              <span>Cân nặng (kg)</span>
              <input type="number" value={profile.weightKg} onChange={(e) => setField('weightKg', Number(e.target.value))} />
            </label>
          </div>

          <h3>Mục tiêu & Tiến trình</h3>
          <div className="goal-options">
            <button className={profile.goal === 'lose-fat' ? 'active' : ''} onClick={() => setField('goal', 'lose-fat')}>Giảm mỡ</button>
            <button className={profile.goal === 'gain-muscle' ? 'active' : ''} onClick={() => setField('goal', 'gain-muscle')}>Tăng cơ</button>
            <button className={profile.goal === 'maintain' ? 'active' : ''} onClick={() => setField('goal', 'maintain')}>Duy trì</button>
          </div>

          <div className="form-grid" style={{ marginTop: '12px' }}>
            <label>
              <span>Mục tiêu thay đổi (kg)</span>
              <input
                type="number"
                step="0.5"
                value={profile.targetWeightDeltaKg ?? (profile.goal === 'lose-fat' ? -4 : profile.goal === 'gain-muscle' ? 3 : 0)}
                onChange={(e) => setField('targetWeightDeltaKg', Number(e.target.value))}
                placeholder="Ví dụ: -5 (giảm) hoặc +3 (tăng)"
              />
            </label>

            <label>
              <span>Thời gian hoàn thành {profile.targetTimeframeMode === 'pace' ? '(đang dùng tốc độ)' : '(đang áp dụng)'}</span>
              <select
                value={profile.targetTimeframeMonths ?? 3}
                onChange={(e) => setField('targetTimeframeMonths', Number(e.target.value))}
              >
                <option value={1}>1 tháng (Nhanh)</option>
                <option value={2}>2 tháng</option>
                <option value={3}>3 tháng (Tiêu chuẩn)</option>
                <option value={4}>4 tháng</option>
                <option value={6}>6 tháng (Bền vững)</option>
                <option value={9}>9 tháng</option>
                <option value={12}>12 tháng (1 năm)</option>
              </select>
            </label>

            <label className="span-2">
              <span>Tốc độ thay cho thời hạn</span>
              <select
                value={profile.targetSpeedPace || 'standard'}
                onChange={(e) => setField('targetSpeedPace', e.target.value as any)}
              >
                <option value="slow">Thong thả & Bền vững (~0.3 kg/tuần)</option>
                <option value="standard">Tiêu chuẩn (~0.5 kg/tuần - Khuyên dùng)</option>
                <option value="fast">Nhanh & Tối đa (~0.8 kg/tuần)</option>
              </select>
            </label>
          </div>

          <h3>Vận động & Chế độ</h3>
          <div className="form-grid">
            <label>
              <span>Mức vận động</span>
              <select value={normalizeActivity(profile.activityLevel) ?? ''} onChange={(e) => setField('activityLevel', e.target.value as any)}>
                <option value="">Chọn mức vận động</option>
                <option value="sedentary">Ít vận động, không tập</option>
                <option value="light">Vận động nhẹ</option>
                <option value="moderate">Vừa</option>
                <option value="high">Nhiều</option>
              </select>
            </label>
            <label>
              <span>Dị ứng (cần tránh)</span>
              <input type="text" placeholder="Trống nếu không có" value={profile.allergies} onChange={(e) => setField('allergies', e.target.value)} />
            </label>
          </div>

          <h3>Nhắc nhở (Push Notification)</h3>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={profile.reminders?.water ?? false} 
                onChange={(e) => setField('reminders', { ...profile.reminders, water: e.target.checked } as any)} 
                style={{ width: '20px', height: '20px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Nhắc uống nước</span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Mỗi 2 tiếng trong ngày</span>
              </div>
            </label>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={profile.reminders?.breakfast ?? false} 
                onChange={(e) => setField('reminders', { ...profile.reminders, breakfast: e.target.checked } as any)} 
                style={{ width: '20px', height: '20px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Nhắc ghi bữa sáng</span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>08:00 mỗi ngày</span>
              </div>
            </label>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={profile.reminders?.lunch ?? false} 
                onChange={(e) => setField('reminders', { ...profile.reminders, lunch: e.target.checked } as any)} 
                style={{ width: '20px', height: '20px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Nhắc ghi bữa trưa</span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>13:00 mỗi ngày</span>
              </div>
            </label>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={profile.reminders?.dinner ?? false} 
                onChange={(e) => setField('reminders', { ...profile.reminders, dinner: e.target.checked } as any)} 
                style={{ width: '20px', height: '20px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Nhắc ghi bữa tối</span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>19:30 mỗi ngày</span>
              </div>
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}
