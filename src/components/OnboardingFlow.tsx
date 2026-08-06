import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Check,
  Activity,
  Target,
  User,
  Info,
  Scale,
  ShieldCheck,
  Flame,
  Dumbbell,
  Calendar,
  Zap,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Heart,
  CalendarDays,
  TrendingDown,
  TrendingUp,
  Coffee,
  Footprints,
  Clock,
  CheckCircle2,
  Loader2,
} from 'lucide-react'

export interface OnboardingData {
  goal: 'lose-fat' | 'gain-muscle' | 'maintain'
  age: number
  biologicalSex: 'female' | 'male'
  heightCm: number
  weightKg: number
  targetWeightDeltaKg: number
  targetTimeframeMonths: number
  targetSpeedPace: 'slow' | 'standard' | 'fast'
  activityLevel: 'low' | 'moderate' | 'high'
  trainingSessions: number
}

interface OnboardingFlowProps {
  initialName?: string
  onComplete: (data: OnboardingData) => Promise<void> | void
}

export default function OnboardingFlow({ initialName, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [data, setData] = useState<Partial<OnboardingData>>({
    goal: 'lose-fat',
    biologicalSex: 'male',
    age: undefined,
    heightCm: undefined,
    weightKg: undefined,
    targetWeightDeltaKg: -4,
    targetTimeframeMonths: 3,
    targetSpeedPace: 'standard',
    activityLevel: 'moderate',
    trainingSessions: 3,
  })

  const [customDeltaInput, setCustomDeltaInput] = useState<string>('')
  const [useCustomDelta, setUseCustomDelta] = useState(false)

  const handleNext = () => setStep((s) => Math.min(5, s + 1))
  const handleBack = () => setStep((s) => Math.max(0, s - 1))

  const handleGoalSelect = (selectedGoal: 'lose-fat' | 'gain-muscle' | 'maintain') => {
    let defaultDelta = 0
    if (selectedGoal === 'lose-fat') defaultDelta = -4
    else if (selectedGoal === 'gain-muscle') defaultDelta = 3

    setData((prev) => ({
      ...prev,
      goal: selectedGoal,
      targetWeightDeltaKg: defaultDelta,
    }))
    setUseCustomDelta(false)
    setCustomDeltaInput('')
    setTimeout(handleNext, 180)
  }

  const handleComplete = async () => {
    if (
      data.goal &&
      data.age &&
      data.biologicalSex &&
      data.heightCm &&
      data.weightKg &&
      data.activityLevel &&
      data.targetWeightDeltaKg !== undefined &&
      data.targetTimeframeMonths !== undefined &&
      data.targetSpeedPace
    ) {
      setIsSubmitting(true)
      try {
        await onComplete({
          goal: data.goal,
          age: data.age,
          biologicalSex: data.biologicalSex,
          heightCm: data.heightCm,
          weightKg: data.weightKg,
          targetWeightDeltaKg: data.targetWeightDeltaKg,
          targetTimeframeMonths: data.targetTimeframeMonths,
          targetSpeedPace: data.targetSpeedPace,
          activityLevel: data.activityLevel,
          trainingSessions: data.trainingSessions || 3,
        })
      } catch (err) {
        console.error('Error completing onboarding:', err)
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  const stepVariants = {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -16, scale: 0.98 },
  }

  // Calculate BMI and TDEE
  const metrics = useMemo(() => {
    if (!data.heightCm || !data.weightKg || !data.age || !data.biologicalSex || !data.activityLevel || !data.goal) return null

    const heightM = data.heightCm / 100
    const bmi = data.weightKg / (heightM * heightM)

    let bmiCategory = ''
    let bmiColor = ''
    if (bmi < 18.5) { bmiCategory = 'Thiếu cân'; bmiColor = '#3b82f6' }
    else if (bmi < 25) { bmiCategory = 'Bình thường'; bmiColor = '#10b981' }
    else if (bmi < 30) { bmiCategory = 'Thừa cân'; bmiColor = '#f59e0b' }
    else { bmiCategory = 'Béo phì'; bmiColor = '#ef4444' }

    // Mifflin-St Jeor Equation
    let bmr = 10 * data.weightKg + 6.25 * data.heightCm - 5 * data.age
    bmr += (data.biologicalSex === 'male' ? 5 : -161)

    const activityMultipliers = {
      low: 1.2,
      moderate: 1.55,
      high: 1.725,
    }
    const tdee = bmr * activityMultipliers[data.activityLevel]

    // Goal adjustments based on target delta and timeframe
    const delta = data.targetWeightDeltaKg ?? (data.goal === 'lose-fat' ? -4 : data.goal === 'gain-muscle' ? 3 : 0)
    const timeframeMonths = data.targetTimeframeMonths ?? 3
    const totalWeeks = timeframeMonths * 4.33
    const weeklyRateKg = totalWeeks > 0 ? delta / totalWeeks : 0

    // Calorie deficit/surplus estimation: 1kg fat/muscle ~ 7700 kcal
    const dailyCalorieAdjustment = (delta * 7700) / (totalWeeks * 7)
    let targetCalories = Math.round(tdee + dailyCalorieAdjustment)

    // Bounds safety
    if (targetCalories < 1200) targetCalories = 1200
    if (targetCalories > 4000) targetCalories = 4000

    let expectation = 'Ổn định cân nặng & tối ưu sức khỏe'
    let macroRatio = 'Protein (20%) · Lipid (25%) · Glucid (55%)'
    let action = 'Duy trì năng lượng'

    if (data.goal === 'lose-fat') {
      expectation = `Giảm khoảng ${Math.abs(weeklyRateKg).toFixed(2)} kg/tuần`
      macroRatio = 'Protein (30%) · Lipid (25%) · Glucid (45%)'
      action = `Thâm hụt ${Math.abs(Math.round(dailyCalorieAdjustment))} kcal/ngày`
    } else if (data.goal === 'gain-muscle') {
      expectation = `Tăng khoảng ${Math.abs(weeklyRateKg).toFixed(2)} kg/tuần`
      macroRatio = 'Protein (25%) · Lipid (25%) · Glucid (50%)'
      action = `Dư thừa ${Math.abs(Math.round(dailyCalorieAdjustment))} kcal/ngày`
    }

    const targetWeight = Math.max(30, Number((data.weightKg + delta).toFixed(1)))
    const idealWeightLow = Number((18.5 * (heightM * heightM)).toFixed(1))
    const idealWeightHigh = Number((24.9 * (heightM * heightM)).toFixed(1))

    // Estimate finish date
    const targetDate = new Date()
    targetDate.setMonth(targetDate.getMonth() + timeframeMonths)
    const formattedDate = targetDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

    return {
      bmi,
      bmiCategory,
      bmiColor,
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      targetCalories,
      expectation,
      macroRatio,
      action,
      delta,
      targetWeight,
      weeklyRateKg,
      idealWeightLow,
      idealWeightHigh,
      timeframeMonths,
      formattedDate,
    }
  }, [data])

  return (
    <div className="onboarding-container">
      {/* Dynamic ambient glowing circles */}
      <div className="onboarding-bg-glow glow-1" />
      <div className="onboarding-bg-glow glow-2" />

      <div className="onboarding-content">
        <AnimatePresence mode="wait">
          {/* STEP 0: Welcome & Gender */}
          {step === 0 && (
            <motion.div
              key="step0"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="step-badge">
                <Sparkles size={14} />
                <span>BƯỚC 1 / 6 · BẮT ĐẦU</span>
              </div>

              <div className="onboarding-icon-wrapper gradient-pod">
                <User size={36} />
              </div>
              <h1>Chào mừng {initialName || 'bạn'}!</h1>
              <p>Hãy để Aura tìm hiểu một chút về bạn để xây dựng lộ trình luyện tập và dinh dưỡng cá nhân hóa.</p>

              <div className="onboarding-options">
                <h3 className="section-label">Giới tính sinh học</h3>
                
                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.biologicalSex === 'male' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, biologicalSex: 'male' })
                    handleNext()
                  }}
                >
                  <div className="card-icon-pod blue-pod">
                    <User size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Nam giới</strong>
                    <small>Tối ưu hóa BMR & chỉ số cho nam</small>
                  </div>
                  {data.biologicalSex === 'male' && <Check className="card-check" size={20} />}
                </button>

                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.biologicalSex === 'female' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, biologicalSex: 'female' })
                    handleNext()
                  }}
                >
                  <div className="card-icon-pod pink-pod">
                    <Heart size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Nữ giới</strong>
                    <small>Tối ưu hóa BMR & tỷ lệ dinh dưỡng cho nữ</small>
                  </div>
                  {data.biologicalSex === 'female' && <Check className="card-check" size={20} />}
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 1: Main Goal */}
          {step === 1 && (
            <motion.div
              key="step1"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="step-badge">
                <Target size={14} />
                <span>BƯỚC 2 / 6 · MỤC TIÊU CỐT LÕI</span>
              </div>

              <div className="onboarding-icon-wrapper gradient-pod">
                <Target size={36} />
              </div>
              <h1>Mục tiêu chính của bạn?</h1>
              <p>Mục tiêu này là cơ sở để Aura tính toán thâm hụt hoặc dư thừa calo hợp lý.</p>

              <div className="onboarding-options">
                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.goal === 'lose-fat' ? 'active' : ''}`}
                  onClick={() => handleGoalSelect('lose-fat')}
                >
                  <div className="card-icon-pod red-pod">
                    <Flame size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Giảm mỡ & Giảm cân</strong>
                    <small>Thâm hụt calo khoa học, bảo toàn cơ bắp</small>
                  </div>
                  {data.goal === 'lose-fat' && <Check className="card-check" size={20} />}
                </button>

                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.goal === 'gain-muscle' ? 'active' : ''}`}
                  onClick={() => handleGoalSelect('gain-muscle')}
                >
                  <div className="card-icon-pod purple-pod">
                    <Dumbbell size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Tăng cơ & Tăng cân</strong>
                    <small>Dư thừa calo thông minh, hỗ trợ phục hồi tập luyện</small>
                  </div>
                  {data.goal === 'gain-muscle' && <Check className="card-check" size={20} />}
                </button>

                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.goal === 'maintain' ? 'active' : ''}`}
                  onClick={() => handleGoalSelect('maintain')}
                >
                  <div className="card-icon-pod green-pod">
                    <ShieldCheck size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Duy trì vóc dáng & Sức khỏe</strong>
                    <small>Cân bằng calo, cải thiện thể lực toàn diện</small>
                  </div>
                  {data.goal === 'maintain' && <Check className="card-check" size={20} />}
                </button>
              </div>

              <div className="onboarding-actions">
                <button type="button" className="secondary-button" onClick={handleBack}>
                  <ArrowLeft size={16} /> Quay lại
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Detailed Target Goals (Kg & Timeframe) */}
          {step === 2 && (
            <motion.div
              key="step2"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="step-badge">
                <Scale size={14} />
                <span>BƯỚC 3 / 6 · MỤC TIÊU CHI TIẾT</span>
              </div>

              <div className="onboarding-icon-wrapper gradient-pod">
                <Scale size={36} />
              </div>
              <h1>
                {data.goal === 'lose-fat'
                  ? 'Muốn giảm bao nhiêu kg?'
                  : data.goal === 'gain-muscle'
                  ? 'Muốn tăng bao nhiêu kg?'
                  : 'Mục tiêu duy trì thể trạng'}
              </h1>
              <p>Xác định rõ con số mục tiêu và khoảng thời gian thực hiện mong muốn.</p>

              {data.goal !== 'maintain' ? (
                <>
                  {/* Target Kg Selector */}
                  <div className="target-section-box">
                    <label className="section-label-bold">
                      <Scale size={16} />
                      <span>Số kg mong muốn {data.goal === 'lose-fat' ? 'giảm' : 'tăng'}:</span>
                    </label>

                    <div className="pill-grid">
                      {(data.goal === 'lose-fat' ? [-2, -4, -6, -8, -10] : [2, 3, 5, 8, 10]).map((val) => (
                        <button
                          key={val}
                          type="button"
                          className={`pill-button ${data.targetWeightDeltaKg === val && !useCustomDelta ? 'active' : ''}`}
                          onClick={() => {
                            setData({ ...data, targetWeightDeltaKg: val })
                            setUseCustomDelta(false)
                          }}
                        >
                          {val < 0 ? `Giảm ${Math.abs(val)} kg` : `Tăng ${val} kg`}
                        </button>
                      ))}
                    </div>

                    <div className="custom-input-row" style={{ marginTop: '10px' }}>
                      <button
                        type="button"
                        className={`pill-button ${useCustomDelta ? 'active' : ''}`}
                        onClick={() => setUseCustomDelta(true)}
                      >
                        Con số khác:
                      </button>
                      {useCustomDelta && (
                        <div className="input-with-unit">
                          <input
                            type="number"
                            step="0.5"
                            placeholder="Ví dụ: 5"
                            value={customDeltaInput}
                            onChange={(e) => {
                              setCustomDeltaInput(e.target.value)
                              const num = parseFloat(e.target.value) || 0
                              const signedNum = data.goal === 'lose-fat' ? -Math.abs(num) : Math.abs(num)
                              setData({ ...data, targetWeightDeltaKg: signedNum })
                            }}
                            className="custom-number-input"
                            autoFocus
                          />
                          <span>kg</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timeframe Selector */}
                  <div className="target-section-box" style={{ marginTop: '16px' }}>
                    <label className="section-label-bold">
                      <Calendar size={16} />
                      <span>Thời gian thực hiện mong muốn:</span>
                    </label>

                    <div className="pill-grid">
                      {[
                        { months: 1, label: '1 tháng (4 tuần)' },
                        { months: 2, label: '2 tháng (8 tuần)' },
                        { months: 3, label: '3 tháng (Khuyên dùng)', recommended: true },
                        { months: 6, label: '6 tháng' },
                        { months: 12, label: '12 tháng (1 năm)' },
                      ].map((item) => (
                        <button
                          key={item.months}
                          type="button"
                          className={`pill-button ${data.targetTimeframeMonths === item.months ? 'active' : ''}`}
                          onClick={() => setData({ ...data, targetTimeframeMonths: item.months })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pace Selector */}
                  <div className="target-section-box" style={{ marginTop: '16px' }}>
                    <label className="section-label-bold">
                      <Zap size={16} />
                      <span>Tốc độ tiến trình:</span>
                    </label>

                    <div className="pace-options">
                      {[
                        { value: 'slow', title: 'Thong thả & Bền vững', sub: '~0.3 kg/tuần (Nhiều thời gian)' },
                        { value: 'standard', title: 'Tiêu chuẩn & Vừa sức', sub: '~0.5 kg/tuần (Đề xuất)', rec: true },
                        { value: 'fast', title: 'Nhanh & Quyết liệt', sub: '~0.8 kg/tuần (Kỷ luật cao)' },
                      ].map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          className={`pace-card ${data.targetSpeedPace === p.value ? 'active' : ''}`}
                          onClick={() => setData({ ...data, targetSpeedPace: p.value as any })}
                        >
                          <div>
                            <strong>{p.title}</strong>
                            <small>{p.sub}</small>
                          </div>
                          {data.targetSpeedPace === p.value && <Check size={18} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Calculation Preview Highlight Card */}
                  {metrics && (
                    <div className="highlight-summary-banner" style={{ marginTop: '16px' }}>
                      <div className="banner-title">
                        <Sparkles size={16} />
                        <span>DỰ TÍNH TIẾN TRÌNH LỤC TRÌNH</span>
                      </div>
                      <div className="banner-grid">
                        <div>
                          <small>Mục tiêu thay đổi</small>
                          <strong>{metrics.delta < 0 ? `Giảm ${Math.abs(metrics.delta)} kg` : `Tăng ${metrics.delta} kg`}</strong>
                        </div>
                        <div>
                          <small>Cân nặng dự kiến</small>
                          <strong>{metrics.targetWeight} kg</strong>
                        </div>
                        <div>
                          <small>Tốc độ dự kiến</small>
                          <strong>{Math.abs(metrics.weeklyRateKg).toFixed(2)} kg/tuần</strong>
                        </div>
                        <div>
                          <small>Ngày hoàn thành</small>
                          <strong>{metrics.formattedDate}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="highlight-summary-banner">
                  <div className="banner-title">
                    <ShieldCheck size={18} />
                    <span>DUY TRÌ VÓC DÁNG CHUẨN</span>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                    Bắt đầu kế hoạch duy trì với 0 kg thay đổi, tập trung vào việc hình thành thói quen ăn uống lành mạnh và tập luyện bền vững.
                  </p>
                </div>
              )}

              <div className="onboarding-actions">
                <button type="button" className="secondary-button" onClick={handleBack}>
                  <ArrowLeft size={16} /> Quay lại
                </button>
                <button type="button" className="primary-button pink-orange-btn" onClick={handleNext}>
                  Tiếp tục <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Age & Body Metrics */}
          {step === 3 && (
            <motion.div
              key="step3"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="step-badge">
                <CalendarDays size={14} />
                <span>BƯỚC 4 / 6 · CHỈ SỐ CƠ THỂ</span>
              </div>

              <div className="onboarding-icon-wrapper gradient-pod">
                <Scale size={36} />
              </div>
              <h1>Chỉ số cơ thể hiện tại</h1>
              <p>Cung cấp chính xác tuổi, chiều cao và cân nặng để đánh giá BMI & chỉ số BMR chuẩn.</p>

              <div className="onboarding-input-group">
                {/* Age Input with Slider */}
                <div className="input-card">
                  <div className="input-card-header">
                    <label>
                      <CalendarDays size={16} /> Tuổi của bạn (năm)
                    </label>
                    <div className="input-value-badge">
                      {data.age ? `${data.age} tuổi` : <span className="ghost-hint">Chưa nhập (Ví dụ: 25)</span>}
                    </div>
                  </div>
                  <div className="input-row-slider">
                    <input
                      type="range"
                      min="14"
                      max="80"
                      value={data.age || 25}
                      onChange={(e) => setData({ ...data, age: parseInt(e.target.value) })}
                      className="range-slider"
                    />
                    <input
                      type="number"
                      min="10"
                      max="100"
                      placeholder="Gợi ý: 25"
                      value={data.age === undefined ? '' : data.age}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value)
                        setData({ ...data, age: val })
                      }}
                      className="onboarding-input-field number-box"
                    />
                  </div>
                </div>

                {/* Height Input with Slider */}
                <div className="input-card" style={{ marginTop: '12px' }}>
                  <div className="input-card-header">
                    <label>
                      <Scale size={16} /> Chiều cao (cm)
                    </label>
                    <div className="input-value-badge">
                      {data.heightCm ? `${data.heightCm} cm` : <span className="ghost-hint">Chưa nhập (Ví dụ: 170)</span>}
                    </div>
                  </div>
                  <div className="input-row-slider">
                    <input
                      type="range"
                      min="130"
                      max="210"
                      value={data.heightCm || 170}
                      onChange={(e) => setData({ ...data, heightCm: parseInt(e.target.value) })}
                      className="range-slider"
                    />
                    <input
                      type="number"
                      min="100"
                      max="230"
                      placeholder="Gợi ý: 170"
                      value={data.heightCm === undefined ? '' : data.heightCm}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value)
                        setData({ ...data, heightCm: val })
                      }}
                      className="onboarding-input-field number-box"
                    />
                  </div>
                </div>

                {/* Weight Input with Slider */}
                <div className="input-card" style={{ marginTop: '12px' }}>
                  <div className="input-card-header">
                    <label>
                      <Scale size={16} /> Cân nặng hiện tại (kg)
                    </label>
                    <div className="input-value-badge">
                      {data.weightKg ? `${data.weightKg} kg` : <span className="ghost-hint">Chưa nhập (Ví dụ: 65)</span>}
                    </div>
                  </div>
                  <div className="input-row-slider">
                    <input
                      type="range"
                      min="35"
                      max="160"
                      step="0.5"
                      value={data.weightKg || 65}
                      onChange={(e) => setData({ ...data, weightKg: parseFloat(e.target.value) })}
                      className="range-slider"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="30"
                      max="300"
                      placeholder="Gợi ý: 65.0"
                      value={data.weightKg === undefined ? '' : data.weightKg}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseFloat(e.target.value)
                        setData({ ...data, weightKg: val })
                      }}
                      className="onboarding-input-field number-box"
                    />
                  </div>
                </div>
              </div>

              {metrics && (
                <div className="bmi-preview-chip" style={{ marginTop: '16px' }}>
                  <span>Chỉ số BMI hiện tại: <strong>{metrics.bmi.toFixed(1)}</strong></span>
                  <span className="bmi-status-tag" style={{ backgroundColor: metrics.bmiColor }}>
                    {metrics.bmiCategory}
                  </span>
                </div>
              )}

              <div className="onboarding-actions">
                <button type="button" className="secondary-button" onClick={handleBack}>
                  <ArrowLeft size={16} /> Quay lại
                </button>
                <button
                  type="button"
                  className="primary-button pink-orange-btn"
                  onClick={handleNext}
                  disabled={!data.age || !data.heightCm || !data.weightKg}
                >
                  Tiếp tục <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 4: Activity Level */}
          {step === 4 && (
            <motion.div
              key="step4"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="step-badge">
                <Activity size={14} />
                <span>BƯỚC 5 / 6 · MỨC ĐỘ VẬN ĐỘNG</span>
              </div>

              <div className="onboarding-icon-wrapper gradient-pod">
                <Activity size={36} />
              </div>
              <h1>Mức độ vận động hàng ngày</h1>
              <p>Mức độ hoạt động quyết định phần lớn tổng calo cơ thể tiêu thụ (TDEE).</p>

              <div className="onboarding-options">
                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.activityLevel === 'low' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'low', trainingSessions: 1 })}
                >
                  <div className="card-icon-pod blue-pod">
                    <Coffee size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Ít vận động (Hệ số 1.2)</strong>
                    <small>Ngồi nhiều, công việc văn phòng, không hoặc hiếm khi tập thể dục</small>
                  </div>
                  {data.activityLevel === 'low' && <Check className="card-check" size={20} />}
                </button>

                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.activityLevel === 'moderate' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'moderate', trainingSessions: 3 })}
                >
                  <div className="card-icon-pod orange-pod">
                    <Footprints size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Vận động vừa (Hệ số 1.55)</strong>
                    <small>Đi lại thường xuyên hoặc tập thể thao 3 - 4 buổi/tuần</small>
                  </div>
                  {data.activityLevel === 'moderate' && <Check className="card-check" size={20} />}
                </button>

                <button
                  type="button"
                  className={`onboarding-card feature-card ${data.activityLevel === 'high' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'high', trainingSessions: 5 })}
                >
                  <div className="card-icon-pod red-pod">
                    <Flame size={22} />
                  </div>
                  <div className="card-text">
                    <strong>Vận động cao (Hệ số 1.725)</strong>
                    <small>Lao động chân tay nặng hoặc tập thể thao cường độ cao 5 - 7 buổi/tuần</small>
                  </div>
                  {data.activityLevel === 'high' && <Check className="card-check" size={20} />}
                </button>
              </div>

              <div className="onboarding-actions">
                <button type="button" className="secondary-button" onClick={handleBack}>
                  <ArrowLeft size={16} /> Quay lại
                </button>
                <button
                  type="button"
                  className="primary-button pink-orange-btn"
                  onClick={handleNext}
                  disabled={!data.activityLevel}
                >
                  Xem kết quả <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 5: Final Summary & Save */}
          {step === 5 && metrics && (
            <motion.div
              key="step5"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step results-step"
            >
              <div className="step-badge">
                <Sparkles size={14} />
                <span>BƯỚC CHÓT · TỔNG QUAN HỒ SƠ</span>
              </div>

              <div className="results-header">
                <h1 style={{ color: metrics.bmiColor, margin: '8px 0 4px' }}>
                  BMI: {metrics.bmi.toFixed(1)} — {metrics.bmiCategory}
                </h1>
                <p className="subtext">Phân loại theo tiêu chuẩn Tổ chức Y tế Thế giới (WHO)</p>
              </div>

              {/* BMI Gauge Visualizer */}
              <div className="bmi-gauge">
                <div
                  className="bmi-tooltip"
                  style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}
                >
                  Bạn ({metrics.bmi.toFixed(1)})
                </div>
                <div className="bmi-labels">
                  <span>15</span>
                  <span style={{ left: '14%' }}>18.5</span>
                  <span style={{ left: '40%' }}>25</span>
                  <span style={{ left: '60%' }}>30</span>
                  <span style={{ right: 0 }}>40</span>
                </div>
                <div className="bmi-bar">
                  <div
                    className="bmi-marker"
                    style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}
                  />
                </div>
                <div className="bmi-categories">
                  <span>THIẾU CÂN</span>
                  <span>BÌNH THƯỜNG</span>
                  <span>THỪA CÂN</span>
                  <span>BÉO PHÌ</span>
                </div>
              </div>

              {/* TDEE & Target Calories Hero Banner */}
              <div className="hero-calorie-card">
                <div className="hero-calorie-top">
                  <div className="hero-icon-pod">
                    <Flame size={24} />
                  </div>
                  <div>
                    <span className="hero-label">MỤC TIÊU KHUYÊN DÙNG HÀNG NGÀY</span>
                    <strong className="hero-number">{metrics.targetCalories} kcal/ngày</strong>
                  </div>
                </div>
                <div className="hero-stats-row">
                  <div>
                    <small>TDEE (Tiêu hao tổng)</small>
                    <strong>{metrics.tdee} kcal</strong>
                  </div>
                  <div>
                    <small>Chế độ đề xuất</small>
                    <strong>{metrics.action}</strong>
                  </div>
                  <div>
                    <small>Cân nặng lý tưởng</small>
                    <strong>{metrics.idealWeightLow} - {metrics.idealWeightHigh} kg</strong>
                  </div>
                </div>
              </div>

              {/* Goal Breakdown Card */}
              <div className="summary-details-card">
                <h3><Target size={18} /> Lộ trình & Mục tiêu được cấu hình</h3>
                <ul className="details-list">
                  <li>
                    <span>Mục tiêu chính:</span>
                    <strong>
                      {data.goal === 'lose-fat'
                        ? 'Giảm mỡ & Giảm cân'
                        : data.goal === 'gain-muscle'
                        ? 'Tăng cơ & Tăng cân'
                        : 'Duy trì vóc dáng'}
                    </strong>
                  </li>
                  {data.goal !== 'maintain' && (
                    <>
                      <li>
                        <span>Thay đổi cân nặng:</span>
                        <strong>
                          {metrics.delta < 0 ? `Giảm ${Math.abs(metrics.delta)} kg` : `Tăng ${metrics.delta} kg`} (Từ {data.weightKg}kg → {metrics.targetWeight}kg)
                        </strong>
                      </li>
                      <li>
                        <span>Thời gian thực hiện:</span>
                        <strong>{metrics.timeframeMonths} tháng (Dự kiến xong: {metrics.formattedDate})</strong>
                      </li>
                      <li>
                        <span>Tốc độ dự tính:</span>
                        <strong>~{Math.abs(metrics.weeklyRateKg).toFixed(2)} kg/tuần</strong>
                      </li>
                    </>
                  )}
                  <li>
                    <span>Phân bổ Macronutrient:</span>
                    <strong>{metrics.macroRatio}</strong>
                  </li>
                </ul>
              </div>

              {/* Save Lock Info */}
              <div className="firebase-sync-badge">
                <CheckCircle2 size={16} />
                <span>Mọi thông tin sẽ được lưu trữ an toàn và có thể điều chỉnh bất kỳ lúc nào trong Cài đặt cá nhân.</span>
              </div>

              <div className="onboarding-actions" style={{ flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  className="primary-button pink-orange-btn full-btn"
                  onClick={handleComplete}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="spin" size={20} /> ĐANG LƯU HỒ SƠ...
                    </>
                  ) : (
                    <>
                      HOÀN TẤT & BẮT ĐẦU AURA <ArrowRight size={20} />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="text-button text-muted"
                  onClick={handleBack}
                  disabled={isSubmitting}
                >
                  Quay lại chỉnh sửa các thông số
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step Progress Bar */}
        {step < 5 && (
          <div className="onboarding-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${((step + 1) / 5) * 100}%` }} />
            </div>
            <div className="progress-step-text">Bước {step + 1} trên 5</div>
          </div>
        )}
      </div>
    </div>
  )
}
