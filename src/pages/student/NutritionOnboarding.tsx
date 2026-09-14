import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleAlert, Info, Sparkles, Target, X } from 'lucide-react'
import type { NutritionProfileDraft } from '../../features/nutrition/types'
import { DEFAULT_PROFILE, GOAL_OPTIONS } from '../../features/nutrition/profileDefaults'

export function NutritionSetupPrompt({ onStart }: { onStart?: () => void }) {
  return (
    <div className="page nutrition-page nutrition-page--workspace nutrition-setup-page" data-testid="nutrition-setup-prompt">
      <section className="nutrition-setup-card" aria-labelledby="nutrition-setup-title">
        <div className="nutrition-setup-card__glow nutrition-setup-card__glow--pink" />
        <div className="nutrition-setup-card__glow nutrition-setup-card__glow--orange" />
        <span className="nutrition-setup-card__mark"><Target size={25} /></span>
        <span className="nutrition-kicker">AURA NUTRITION</span>
        <h1 id="nutrition-setup-title">Thiết lập mục tiêu dinh dưỡng</h1>
        <p>Hoàn thành onboarding Aura một lần để tính mục tiêu năng lượng, macro và gợi ý phù hợp với cơ thể của bạn.</p>
        <div className="nutrition-setup-card__facts">
          <span><CheckCircle2 size={16} /> Chỉ số cơ thể</span>
          <span><CheckCircle2 size={16} /> Mục tiêu cá nhân</span>
          <span><CheckCircle2 size={16} /> Nhịp sống & ăn uống</span>
        </div>
        <button type="button" className="nutrition-setup-card__button" onClick={onStart} disabled={!onStart}>
          <Sparkles size={18} /> Thiết lập mục tiêu <ChevronRight size={18} />
        </button>
        <small>Bạn có thể cập nhật lại mục tiêu bất cứ lúc nào trong trang Cá nhân.</small>
      </section>
    </div>
  )
}

interface NutritionOnboardingProps {
  onComplete: (profile: NutritionProfileDraft) => void
  initialProfile?: NutritionProfileDraft
  onCancel?: () => void
  editing?: boolean
}

export default function NutritionOnboarding({ onComplete, initialProfile = DEFAULT_PROFILE, onCancel, editing = false }: NutritionOnboardingProps) {
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState<NutritionProfileDraft>(initialProfile)

  const setField = <K extends keyof NutritionProfileDraft>(field: K, value: NutritionProfileDraft[K]) => {
    setProfile((current) => {
      const next = { ...current, [field]: value }
      if (field === 'targetWeightDeltaKg') next.targetWeightKg = current.weightKg + Number(value)
      if (field === 'targetSpeedPace') next.targetTimeframeMode = 'pace'
      if (field === 'targetTimeframeMonths') next.targetTimeframeMode = 'duration'
      return next
    })
  }

  return (
    <div className="nutrition-onboarding-shell" data-testid="nutrition-onboarding">
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--one" />
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--two" />
      <section className="nutrition-onboarding" aria-labelledby="nutrition-onboarding-title">
        <header className="nutrition-onboarding__header">
          <span className="nutrition-ai-mark"><Sparkles size={16} /> {editing ? 'Cập nhật kế hoạch' : 'Aura Nutrition AI'}</span>
          <span className="nutrition-onboarding__step">Bước {step} / 4</span>
          <div className="nutrition-onboarding__progress" aria-label={`Tiến độ ${Math.round((step / 4) * 100)}%`}>
            <span style={{ width: `${(step / 4) * 100}%` }} />
          </div>
        </header>

        {step === 1 && (
          <div className="nutrition-onboarding__body">
            <span className="nutrition-kicker">BẮT ĐẦU TỪ MỤC TIÊU</span>
            <h1 id="nutrition-onboarding-title">Bạn muốn thay đổi điều gì?</h1>
            <p>Aura sẽ dùng mục tiêu này để đề xuất năng lượng, macro và thực đơn phù hợp.</p>
            <div className="nutrition-goal-grid">
              {GOAL_OPTIONS.map((option) => {
                const Icon = option.icon
                const active = profile.goal === option.value
                return (
                  <button
                    type="button"
                    className={active ? 'active' : ''}
                    key={option.value}
                    onClick={() => {
                      setField('goal', option.value)
                      if (option.value === 'lose-fat' && (!profile.targetWeightDeltaKg || profile.targetWeightDeltaKg > 0)) setField('targetWeightDeltaKg', -4)
                      else if (option.value === 'gain-muscle' && (!profile.targetWeightDeltaKg || profile.targetWeightDeltaKg < 0)) setField('targetWeightDeltaKg', 3)
                      else if (option.value === 'maintain') setField('targetWeightDeltaKg', 0)
                    }}
                    aria-pressed={active}
                  >
                    <span><Icon size={22} /></span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <i>{active && <Check size={14} />}</i>
                  </button>
                )
              })}
            </div>
            <div className="nutrition-form-grid" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--nutrition-line, #e5e7eb)' }}>
              {profile.goal !== 'maintain' ? (
                <label className="nutrition-field"><span>Mục tiêu thay đổi (kg)</span><div><input type="number" step="0.5" value={profile.targetWeightDeltaKg ?? (profile.goal === 'lose-fat' ? -4 : 3)} onChange={(event) => setField('targetWeightDeltaKg', Number(event.target.value))} /><small>kg</small></div></label>
              ) : (
                <label className="nutrition-field"><span>Trạng thái</span><div><input type="text" disabled value="Duy trì vóc dáng hiện tại" /></div></label>
              )}
              <label className="nutrition-field"><span>Thời gian hoàn thành</span><select value={profile.targetTimeframeMonths ?? 3} onChange={(event) => setField('targetTimeframeMonths', Number(event.target.value))}><option value={1}>1 tháng (Cực ngắn)</option><option value={2}>2 tháng</option><option value={3}>3 tháng (Khuyên dùng)</option><option value={4}>4 tháng</option><option value={6}>6 tháng (Bền vững)</option><option value={9}>9 tháng</option><option value={12}>12 tháng (1 năm)</option></select></label>
              <label className="nutrition-field" style={{ gridColumn: 'span 2' }}><span>Tốc độ tiến trình kỳ vọng</span><select value={profile.targetSpeedPace || 'standard'} onChange={(event) => setField('targetSpeedPace', event.target.value as NutritionProfileDraft['targetSpeedPace'])}><option value="slow">Thong thả & Bền vững (~0.25 - 0.4 kg/tuần)</option><option value="standard">Tiêu chuẩn & An toàn (~0.5 - 0.7 kg/tuần - Đề xuất)</option><option value="fast">Nhanh & Quyết liệt (~0.8 - 1.0 kg/tuần)</option></select></label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="nutrition-onboarding__body"><span className="nutrition-kicker">CHỈ SỐ CƠ BẢN</span><h1 id="nutrition-onboarding-title">Hiểu cơ thể của bạn</h1><p>Các số liệu được dùng để ước tính nhu cầu năng lượng ban đầu và có thể chỉnh bất cứ lúc nào.</p><div className="nutrition-form-grid">
            <label className="nutrition-field"><span>Tuổi</span><div><input type="number" min="18" max="90" value={profile.age} onChange={(event) => setField('age', Number(event.target.value))} /><small>tuổi</small></div></label>
            <label className="nutrition-field"><span>Giới tính sinh học</span><select value={profile.biologicalSex} onChange={(event) => setField('biologicalSex', event.target.value as NutritionProfileDraft['biologicalSex'])}><option value="female">Nữ</option><option value="male">Nam</option></select></label>
            <label className="nutrition-field"><span>Chiều cao</span><div><input type="number" min="120" max="230" value={profile.heightCm} onChange={(event) => setField('heightCm', Number(event.target.value))} /><small>cm</small></div></label>
            <label className="nutrition-field"><span>Cân nặng hiện tại</span><div><input type="number" min="30" max="250" step="0.1" value={profile.weightKg} onChange={(event) => setField('weightKg', Number(event.target.value))} /><small>kg</small></div></label>
          </div><div className="nutrition-privacy-note"><Info size={16} /><span>Dữ liệu sức khỏe chỉ được dùng để cá nhân hóa kế hoạch của bạn.</span></div></div>
        )}

        {step === 3 && (
          <div className="nutrition-onboarding__body"><span className="nutrition-kicker">NHỊP SỐNG & ĂN UỐNG</span><h1 id="nutrition-onboarding-title">Một kế hoạch bạn có thể theo lâu dài</h1><p>Cho Aura biết mức vận động và những ràng buộc quan trọng trong bữa ăn.</p><div className="nutrition-form-grid">
            <label className="nutrition-field"><span>Mức vận động hằng ngày</span><select value={profile.activityLevel} onChange={(event) => setField('activityLevel', event.target.value as NutritionProfileDraft['activityLevel'])}><option value="sedentary">Ít vận động, không tập</option><option value="light">Vận động nhẹ</option><option value="low">Vận động nhẹ (hồ sơ cũ)</option><option value="moderate">Vận động vừa</option><option value="high">Vận động nhiều</option></select></label>
            <label className="nutrition-field"><span>Số buổi tập / tuần</span><div><input type="number" min="0" max="14" value={profile.trainingSessions} onChange={(event) => setField('trainingSessions', Number(event.target.value))} /><small>buổi</small></div></label>
            <label className="nutrition-field"><span>Phong cách ăn uống</span><select value={profile.eatingStyle} onChange={(event) => setField('eatingStyle', event.target.value)}><option>Không giới hạn</option><option>Ăn chay</option><option>Thuần chay</option><option>Ít tinh bột</option><option>Không gluten</option></select></label>
            <label className="nutrition-field"><span>Dị ứng / thực phẩm cần tránh</span><input type="text" value={profile.allergies} placeholder="Ví dụ: hải sản, đậu phộng…" onChange={(event) => setField('allergies', event.target.value)} /></label>
          </div><div className="nutrition-safety-note"><CircleAlert size={17} /><span>Nếu bạn đang mang thai, điều trị bệnh hoặc có rối loạn ăn uống, hãy tham khảo chuyên gia trước khi áp dụng.</span></div></div>
        )}

        {step === 4 && (
          <div className="nutrition-onboarding__body"><span className="nutrition-kicker">CÁ THỂ HÓA THỰC ĐƠN</span><h1 id="nutrition-onboarding-title">Chi tiết cho kế hoạch 7 ngày</h1><p>Giúp Aura gợi ý thực đơn phù hợp với thời gian, ngân sách và sở thích của bạn.</p><div className="nutrition-form-grid">
            <label className="nutrition-field"><span>Số bữa ăn mỗi ngày</span><select value={profile.mealsPerDay || 3} onChange={(event) => setField('mealsPerDay', Number(event.target.value))}><option value={2}>2 bữa (VD: Nhịn ăn gián đoạn)</option><option value={3}>3 bữa (Sáng, Trưa, Tối)</option><option value={4}>4 bữa (Thêm 1 bữa phụ)</option><option value={5}>5 bữa (Chia nhỏ trong ngày)</option></select></label>
            <label className="nutrition-field"><span>Ngân sách thực phẩm</span><select value={profile.budget || 'medium'} onChange={(event) => setField('budget', event.target.value as NutritionProfileDraft['budget'])}><option value="low">Tiết kiệm</option><option value="medium">Tiêu chuẩn</option><option value="high">Linh hoạt / Thoải mái</option></select></label>
            <label className="nutrition-field"><span>Thời gian nấu nướng</span><select value={profile.prepTime || 'medium'} onChange={(event) => setField('prepTime', event.target.value as NutritionProfileDraft['prepTime'])}><option value="quick">Nhanh gọn (&lt; 20 phút)</option><option value="medium">Vừa phải (20 - 45 phút)</option><option value="long">Có nhiều thời gian (&gt; 45 phút)</option></select></label>
            <label className="nutrition-field"><span>Khẩu vị / Vùng miền yêu thích</span><select value={profile.favoriteCuisine || 'Đa dạng'} onChange={(event) => setField('favoriteCuisine', event.target.value)}><option>Đa dạng</option><option>Món Việt truyền thống</option><option>Món Tây / Âu</option><option>Món Á (Nhật, Hàn, Thái...)</option></select></label>
            <label className="nutrition-field" style={{ gridColumn: 'span 2' }}><span>Món ăn không thích</span><input type="text" value={profile.dislikes || ''} placeholder="Ví dụ: hành, mướp đắng, cá mè..." onChange={(event) => setField('dislikes', event.target.value)} /></label>
          </div></div>
        )}

        <footer className="nutrition-onboarding__footer">
          <button type="button" className="nutrition-secondary-button" onClick={() => step === 1 && onCancel ? onCancel() : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 && !onCancel}>{step === 1 && onCancel ? <X size={17} /> : <ArrowLeft size={17} />} {step === 1 && onCancel ? 'Hủy' : 'Quay lại'}</button>
          <button type="button" className="nutrition-primary-button" onClick={() => step < 4 ? setStep((current) => current + 1) : onComplete(profile)}>{step < 4 ? 'Tiếp tục' : 'Tạo kế hoạch của tôi'} {step < 4 ? <ArrowRight size={17} /> : <Sparkles size={17} />}</button>
        </footer>
      </section>
    </div>
  )
}
