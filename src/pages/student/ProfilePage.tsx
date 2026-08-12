import React, { useState } from 'react';
import { Bell, 
  UserRound, Ruler, Scale, Calendar, Target, Activity, 
  Moon, Coffee, Heart, AlertCircle, Pencil, LogOut, ShieldCheck, Zap
} from 'lucide-react';
import { PageHeader } from '../../components/ui';
import AccountConnectionsCard from '../../components/account/AccountConnectionsCard';


export interface ProfileNotificationSettings {
  enabled?: boolean
  workoutReminders?: boolean
  mealReminders?: boolean
  learningUpdates?: boolean
  coachMessages?: boolean
  [key: string]: boolean | undefined
}

export interface ProfileUpdateInput {
  displayName?: string
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  targetWeightDeltaKg?: number | null
  targetTimeframeMonths?: number | null
  targetSpeedPace?: 'slow' | 'standard' | 'fast' | null
  notificationSettings?: ProfileNotificationSettings
  mealReminderTime?: string
}

export interface ProfilePageProps {
  goals?: any;
  heightCm?: any;
  weightKg?: any;
  targetWeightDeltaKg?: any;
  targetTimeframeMonths?: any;
  targetSpeedPace?: any;
  notificationSettings?: any;
  mealReminderTime?: any;
  fullProfile?: any;
  displayName?: string;
  email?: string;
  membership?: string;
  onSave?: (values: any) => Promise<void>;
  onSignOut?: () => void | Promise<void>;
  onEditProfile?: () => void;
}

export default function ProfilePage({ fullProfile, displayName, email, membership, onSignOut, onEditProfile }: ProfilePageProps) {
  const data = { ...(fullProfile || {}), ...(fullProfile?.onboardingData || {}) };
  const nutrition = fullProfile?.nutritionProfile || {};
  
  const currentYear = new Date().getFullYear();
  const age = data.birthYear ? currentYear - data.birthYear : '--';
  
  const goalMap: any = {
    fat_loss: 'Giảm mỡ',
    muscle_gain: 'Tăng cơ',
    maintenance: 'Duy trì',
    health: 'Sống khỏe'
  };

  const activityMap: any = {
    sedentary: 'Ít vận động',
    light: 'Nhẹ (1-2 buổi/tuần)',
    moderate: 'Vừa (3-4 buổi/tuần)',
    high: 'Nhiều (5+ buổi/tuần)'
  };
  
  const dietMap: any = {
    balanced: 'Cân bằng',
    vegetarian: 'Ăn chay',
    vegan: 'Thuần chay',
    keto: 'Keto',
    paleo: 'Paleo',
    low_carb: 'Ít tinh bột',
    high_protein: 'Giàu protein',
    none: 'Không cụ thể'
  };

  return (
    <div className="page profile-page">
      <PageHeader title="Hồ sơ cá nhân" description="Thông tin và chỉ số cơ thể của bạn" />
            
      
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '0 20px 40px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        
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
        </div>
        <AccountConnectionsCard />
        {/* Basic Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: 'white', padding: '20px', borderRadius: '22px', border: '1px solid var(--aura-border)', textAlign: 'center' }}>
            <Ruler size={24} color="#a855f7" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{data.heightCm || '--'}<small style={{ fontSize: '14px', color: 'var(--aura-muted)', fontWeight: 600, marginLeft: '4px' }}>cm</small></div>
            <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '4px' }}>Chiều cao</div>
          </div>
          <div style={{ background: 'white', padding: '20px', borderRadius: '22px', border: '1px solid var(--aura-border)', textAlign: 'center' }}>
            <Scale size={24} color="#ff8a38" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{data.weightKg ? data.weightKg.toFixed(1) : '--'}<small style={{ fontSize: '14px', color: 'var(--aura-muted)', fontWeight: 600, marginLeft: '4px' }}>kg</small></div>
            <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '4px' }}>Cân nặng</div>
          </div>
          <div style={{ background: 'white', padding: '20px', borderRadius: '22px', border: '1px solid var(--aura-border)', textAlign: 'center' }}>
            <Calendar size={24} color="#3b82f6" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{age}</div>
            <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '4px' }}>Tuổi</div>
          </div>
        </div>

        {/* Goal */}
        <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#fff4f7', padding: '8px', borderRadius: '12px' }}><Target size={20} color="#ff3f7d" /></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Mục tiêu chính</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '4px' }}>Hướng tới</div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>{goalMap[data.primaryGoal] || 'Chưa chọn'}</div>
            </div>
            {data.targetWeightKg && (
              <div>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '4px' }}>Mức cân</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#ff3f7d' }}>{data.targetWeightKg.toFixed(1)} kg</div>
              </div>
            )}
          </div>

          {data.secondaryGoals && data.secondaryGoals.length > 0 && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--aura-border)' }}>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '8px' }}>Mục tiêu phụ</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {data.secondaryGoals.map((g: string) => (
                  <span key={g} style={{ padding: '4px 12px', background: '#f8fafc', borderRadius: '999px', fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                    {g === 'fat_loss' ? 'Giảm mỡ' : g === 'muscle' ? 'Tăng cơ' : g === 'stamina' ? 'Sức bền' : g === 'toning' ? 'Săn chắc' : g === 'energy' ? 'Năng lượng' : g === 'health' ? 'Sức khỏe' : g === 'sleep' ? 'Ngủ tốt' : g === 'digestion' ? 'Tiêu hóa' : g === 'focus' ? 'Tập trung' : g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Starting Plan */}
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

        {/* Lifestyle */}
        <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#fff7ed', padding: '8px', borderRadius: '12px' }}><Activity size={20} color="#ff8a38" /></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Cơ thể & Lối sống</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Zap size={18} color="var(--aura-muted)" /> <span style={{ fontWeight: 600 }}>Vận động</span></div>
              <span style={{ fontWeight: 700 }}>{activityMap[data.activityLevel] || '--'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Moon size={18} color="var(--aura-muted)" /> <span style={{ fontWeight: 600 }}>Giấc ngủ</span></div>
              <span style={{ fontWeight: 700 }}>{data.sleepHours || '--'} giờ ({data.sleepQuality === 'poor' ? 'Kém' : data.sleepQuality === 'average' ? 'Trung bình' : 'Tốt'})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Coffee size={18} color="var(--aura-muted)" /> <span style={{ fontWeight: 600 }}>Stress</span></div>
              <span style={{ fontWeight: 700 }}>{data.stressLevel === 'low' ? 'Ít' : data.stressLevel === 'medium' ? 'Vừa' : data.stressLevel === 'high' ? 'Nhiều' : data.stressLevel === 'very_high' ? 'Rất nhiều' : '--'}</span>
            </div>
          </div>
        </div>

        {/* Nutrition & Health */}
        <div style={{ background: 'white', padding: '24px', borderRadius: '22px', border: '1px solid var(--aura-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '12px' }}><Heart size={20} color="#10b981" /></div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Dinh dưỡng & Sức khỏe</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '4px' }}>Chế độ ăn</div>
              <div style={{ fontWeight: 700 }}>{dietMap[data.dietType] || '--'}</div>
            </div>
            
            {(data.dietaryRestrictions?.length > 0 || data.allergies?.length > 0) && (
              <div>
                <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '8px' }}>Kiêng / Dị ứng</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {data.dietaryRestrictions?.map((i: string) => <span key={i} style={{ padding: '4px 10px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>Kiêng {i}</span>)}
                  {data.allergies?.map((i: string) => <span key={i} style={{ padding: '4px 10px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>Dị ứng {i}</span>)}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginBottom: '4px' }}>Vấn đề sức khỏe</div>
              <div style={{ fontWeight: 700 }}>
                {data.healthConditions?.length > 0 ? data.healthConditions.join(', ') : 'Không có'}
              </div>
              {data.diabetesType && <div style={{ fontSize: '13px', marginTop: '4px' }}>Loại tiểu đường: {data.diabetesType === 'type_1' ? 'Type 1' : data.diabetesType === 'type_2' ? 'Type 2' : data.diabetesType === 'pre' ? 'Tiền tiểu đường' : 'Không rõ'}</div>}
              {data.bpStatus && <div style={{ fontSize: '13px', marginTop: '4px' }}>Huyết áp: {data.bpStatus === 'medicated' ? 'Đang dùng thuốc' : data.bpStatus === 'unmedicated' ? 'Không dùng thuốc' : 'Không rõ'}</div>}
            </div>
          </div>
        </div>

        
        
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
        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button style={{ width: '100%', padding: '16px', background: 'white', border: '1px solid var(--aura-border)', borderRadius: '16px', color: '#ef4444', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }} onClick={onSignOut}>
            <LogOut size={18} /> Đăng xuất
          </button>
        </div>

      </div>
    </div>
  );
}
