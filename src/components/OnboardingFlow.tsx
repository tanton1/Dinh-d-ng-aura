import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Activity, Target, User, Info, Scale, HeartPulse, ShieldCheck } from 'lucide-react'
import type { UserProfile } from '../types'

export interface OnboardingData {
  goal: 'lose-fat' | 'gain-muscle' | 'maintain'
  age: number
  biologicalSex: 'female' | 'male'
  heightCm: number
  weightKg: number
  activityLevel: 'low' | 'moderate' | 'high'
  trainingSessions: number
}

interface OnboardingFlowProps {
  initialName?: string
  onComplete: (data: OnboardingData) => void
}

export default function OnboardingFlow({ initialName, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<Partial<OnboardingData>>({
    trainingSessions: 3 // Default
  })

  const handleNext = () => setStep((s) => s + 1)
  const handleBack = () => setStep((s) => Math.max(0, s - 1))

  const handleComplete = () => {
    if (
      data.goal &&
      data.age &&
      data.biologicalSex &&
      data.heightCm &&
      data.weightKg &&
      data.activityLevel &&
      data.trainingSessions !== undefined
    ) {
      onComplete(data as OnboardingData)
    }
  }

  const stepVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  }

  // Calculate BMI and TDEE for Step 5
  const metrics = useMemo(() => {
    if (!data.heightCm || !data.weightKg || !data.age || !data.biologicalSex || !data.activityLevel || !data.goal) return null;
    
    const heightM = data.heightCm / 100;
    const bmi = data.weightKg / (heightM * heightM);
    
    let bmiCategory = '';
    let bmiColor = '';
    if (bmi < 18.5) { bmiCategory = 'Thiếu cân'; bmiColor = '#3b82f6'; }
    else if (bmi < 25) { bmiCategory = 'Bình thường'; bmiColor = '#22c55e'; }
    else if (bmi < 30) { bmiCategory = 'Thừa cân'; bmiColor = '#f59e0b'; }
    else { bmiCategory = 'Béo phì'; bmiColor = '#ef4444'; }

    // Mifflin-St Jeor Equation
    let bmr = 10 * data.weightKg + 6.25 * data.heightCm - 5 * data.age;
    bmr += (data.biologicalSex === 'male' ? 5 : -161);

    const activityMultipliers = {
      'low': 1.2,
      'moderate': 1.55,
      'high': 1.725
    };
    const tdee = bmr * activityMultipliers[data.activityLevel];

    // Goal adjustments
    let targetCalories = tdee;
    let expectation = 'Ổn định cân nặng';
    let macroRatio = 'Protein (15-25%) - Lipid (20-30%) - Glucid (45-65%)';
    let action = 'Duy trì mức năng lượng';

    if (data.goal === 'lose-fat') {
      targetCalories = tdee - 500;
      expectation = 'Giảm khoảng 0.5kg/tuần';
      macroRatio = 'Protein (25-35%) - Lipid (20-30%) - Glucid (35-50%)';
      action = 'Thâm hụt calo';
    } else if (data.goal === 'gain-muscle') {
      targetCalories = tdee + 300;
      expectation = 'Tăng cơ, hỗ trợ tập luyện';
      macroRatio = 'Protein (25-30%) - Lipid (20-30%) - Glucid (45-55%)';
      action = 'Dư thừa calo hợp lý';
    }

    // Ideal weight (BMI 18.5 - 24.9)
    const idealWeightLow = 18.5 * (heightM * heightM);
    const idealWeightHigh = 24.9 * (heightM * heightM);

    return { bmi, bmiCategory, bmiColor, tdee, targetCalories, expectation, macroRatio, action, idealWeightLow, idealWeightHigh };
  }, [data]);

  return (
    <div className="onboarding-container">
      <div className="onboarding-content">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step0"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="onboarding-icon-wrapper">
                <User size={48} />
              </div>
              <h1>Chào {initialName || 'bạn'}!</h1>
              <p>Hãy để Aura tìm hiểu một chút về bạn để xây dựng lộ trình luyện tập và dinh dưỡng cá nhân hóa nhé.</p>
              
              <div className="onboarding-options">
                <h3>Giới tính sinh học</h3>
                <button
                  className={`onboarding-card ${data.biologicalSex === 'male' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, biologicalSex: 'male' })
                    handleNext()
                  }}
                >
                  <strong>Nam</strong>
                </button>
                <button
                  className={`onboarding-card ${data.biologicalSex === 'female' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, biologicalSex: 'female' })
                    handleNext()
                  }}
                >
                  <strong>Nữ</strong>
                </button>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step1"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="onboarding-icon-wrapper">
                <Target size={48} />
              </div>
              <h1>Mục tiêu chính của bạn?</h1>
              <p>Mục tiêu này sẽ là cơ sở để Aura thiết lập lượng calo mục tiêu hàng ngày.</p>
              
              <div className="onboarding-options">
                <button
                  className={`onboarding-card ${data.goal === 'lose-fat' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, goal: 'lose-fat' })
                    setTimeout(handleNext, 150)
                  }}
                >
                  <strong>Giảm mỡ</strong>
                  <small>Tạo thâm hụt calo, duy trì cơ bắp</small>
                </button>
                <button
                  className={`onboarding-card ${data.goal === 'gain-muscle' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, goal: 'gain-muscle' })
                    setTimeout(handleNext, 150)
                  }}
                >
                  <strong>Tăng cơ</strong>
                  <small>Dư thừa calo hợp lý, hỗ trợ tập luyện</small>
                </button>
                <button
                  className={`onboarding-card ${data.goal === 'maintain' ? 'active' : ''}`}
                  onClick={() => {
                    setData({ ...data, goal: 'maintain' })
                    setTimeout(handleNext, 150)
                  }}
                >
                  <strong>Duy trì vóc dáng</strong>
                  <small>Cân bằng calo, tối ưu hóa sức khỏe</small>
                </button>
              </div>
              <div className="onboarding-actions">
                <button className="secondary-button" onClick={handleBack}>Quay lại</button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <h1>Bạn bao nhiêu tuổi?</h1>
              <p>Chỉ số trao đổi chất cơ bản (BMR) thay đổi theo độ tuổi.</p>
              
              <div className="onboarding-input-group">
                <input
                  type="number"
                  min="10"
                  max="100"
                  placeholder="Tuổi của bạn (ví dụ: 25)"
                  value={data.age || ''}
                  onChange={(e) => setData({ ...data, age: parseInt(e.target.value) || 0 })}
                  className="onboarding-input"
                  autoFocus
                />
              </div>

              <div className="onboarding-actions">
                <button className="secondary-button" onClick={handleBack}>Quay lại</button>
                <button 
                  className="primary-button" 
                  onClick={handleNext}
                  disabled={!data.age || data.age < 10 || data.age > 100}
                >
                  Tiếp tục
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <h1>Chỉ số cơ thể</h1>
              <p>Chiều cao và cân nặng để đánh giá BMI và lượng calo đốt cháy.</p>
              
              <div className="onboarding-input-group">
                <label>Chiều cao (cm)</label>
                <input
                  type="number"
                  placeholder="Ví dụ: 170"
                  value={data.heightCm || ''}
                  onChange={(e) => setData({ ...data, heightCm: parseInt(e.target.value) || 0 })}
                  className="onboarding-input"
                />
                
                <label style={{ marginTop: '20px' }}>Cân nặng (kg)</label>
                <input
                  type="number"
                  placeholder="Ví dụ: 65"
                  value={data.weightKg || ''}
                  onChange={(e) => setData({ ...data, weightKg: parseFloat(e.target.value) || 0 })}
                  className="onboarding-input"
                />
              </div>

              <div className="onboarding-actions">
                <button className="secondary-button" onClick={handleBack}>Quay lại</button>
                <button 
                  className="primary-button" 
                  onClick={handleNext}
                  disabled={!data.heightCm || !data.weightKg}
                >
                  Tiếp tục
                </button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step"
            >
              <div className="onboarding-icon-wrapper">
                <Activity size={48} />
              </div>
              <h1>Mức độ vận động (TDEE)</h1>
              <p>Mức độ vận động quyết định phần lớn tổng lượng calo bạn đốt cháy trong ngày.</p>
              
              <div className="onboarding-options">
                <button
                  className={`onboarding-card ${data.activityLevel === 'low' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'low', trainingSessions: 1 })}
                >
                  <strong>Ít vận động (Hệ số 1.2)</strong>
                  <small>Công việc văn phòng, ngồi nhiều, hầu như không tập thể dục hoặc tập rất nhẹ 1 buổi/tuần.</small>
                </button>
                <button
                  className={`onboarding-card ${data.activityLevel === 'moderate' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'moderate', trainingSessions: 3 })}
                >
                  <strong>Vận động vừa (Hệ số 1.55)</strong>
                  <small>Công việc đi lại nhiều hoặc có tập thể dục thể thao đều đặn từ 3 - 4 buổi/tuần.</small>
                </button>
                <button
                  className={`onboarding-card ${data.activityLevel === 'high' ? 'active' : ''}`}
                  onClick={() => setData({ ...data, activityLevel: 'high', trainingSessions: 5 })}
                >
                  <strong>Vận động cao (Hệ số 1.725)</strong>
                  <small>Công việc tay chân nặng nhọc hoặc tập thể thao cường độ cao 5 - 7 buổi/tuần.</small>
                </button>
              </div>

              <div className="onboarding-actions">
                <button className="secondary-button" onClick={handleBack}>Quay lại</button>
                <button 
                  className="primary-button" 
                  onClick={handleNext}
                  disabled={!data.activityLevel}
                >
                  Tiếp tục
                </button>
              </div>
            </motion.div>
          )}

          {step === 5 && metrics && (
            <motion.div
              key="step5"
              variants={stepVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="onboarding-step results-step"
            >
              <h1 style={{ color: metrics.bmiColor }}>
                {metrics.bmiCategory} theo đánh giá của WHO
              </h1>
              
              <div className="bmi-gauge">
                <div className="bmi-tooltip" style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}>
                  You - {metrics.bmi.toFixed(2)}
                </div>
                <div className="bmi-labels">
                  <span>15</span>
                  <span style={{ left: '14%' }}>18.5</span>
                  <span style={{ left: '40%' }}>25</span>
                  <span style={{ left: '60%' }}>30</span>
                  <span style={{ right: 0 }}>40</span>
                </div>
                <div className="bmi-bar">
                  <div className="bmi-marker" style={{ left: `${Math.min(100, Math.max(0, ((metrics.bmi - 15) / 25) * 100))}%` }}></div>
                </div>
                <div className="bmi-categories">
                  <span>THIẾU CÂN</span>
                  <span>BÌNH THƯỜNG</span>
                  <span>THỪA CÂN</span>
                  <span>BÉO PHÌ</span>
                </div>
              </div>

              <div className="tdee-card" style={{ backgroundColor: metrics.bmi > 25 ? '#fee2e2' : metrics.bmi < 18.5 ? '#dbeafe' : '#dcfce3' }}>
                <div className="tdee-header">
                  <Info size={20} color={metrics.bmi > 25 ? '#ef4444' : metrics.bmi < 18.5 ? '#3b82f6' : '#22c55e'} />
                  <strong>Cơ thể bạn cần khoảng {metrics.targetCalories.toFixed(0)} kcal/ngày (TDEE: {metrics.tdee.toFixed(0)}).</strong>
                </div>
                <ul className="tdee-details">
                  <li>
                    <strong>Mục tiêu:</strong> {metrics.action}
                  </li>
                  <li>
                    <strong>Dự kiến:</strong> {metrics.expectation}
                  </li>
                  <li>
                    <strong>Tỷ lệ chất dinh dưỡng (Gợi ý):</strong> {metrics.macroRatio}
                  </li>
                </ul>
              </div>

              <div className="info-card">
                <div className="info-icon">
                  <Scale size={24} />
                </div>
                <div className="info-content">
                  <span>Cân nặng chuẩn của bạn:</span>
                  <strong>{metrics.idealWeightLow.toFixed(1)} - {metrics.idealWeightHigh.toFixed(1)} kg</strong>
                </div>
              </div>

              <div className="info-card suggestion">
                <div className="info-content">
                  Làm thế nào bạn có thể đạt được mục tiêu này? Hãy để Aura giúp bạn xây dựng kế hoạch!
                </div>
              </div>

              <div className="onboarding-actions" style={{ flexDirection: 'column' }}>
                <button 
                  className="primary-button" 
                  onClick={handleComplete}
                  style={{ width: '100%', padding: '16px', fontSize: '18px' }}
                >
                  HOÀN TẤT & BẮT ĐẦU
                </button>
                <button className="text-button" onClick={handleBack} style={{ color: '#888', background: 'transparent' }}>
                  Quay lại chỉnh sửa
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {step < 5 && (
          <div className="onboarding-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${(step / 4) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
