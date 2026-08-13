import { Check } from 'lucide-react';
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ChoiceCard } from './OnboardingScreens';

export const DietScreen = ({ profile, updateProfile, onNext }: any) => {
  const diets = [
    { id: 'balanced', icon: '🍽️', label: 'Cân bằng', desc: 'Đa dạng thực phẩm' },
    { id: 'low_carb', icon: '🍚', label: 'Ít tinh bột', desc: 'Giảm thiểu carb' },
    { id: 'high_protein', icon: '💪', label: 'Giàu protein', desc: 'Phát triển cơ bắp' },
    { id: 'vegetarian', icon: '🥗', label: 'Ăn chay', desc: 'Không thịt/cá' },
    { id: 'keto', icon: '🥑', label: 'Keto', desc: 'Nhiều béo, rất ít carb' },
    { id: 'none', icon: '✨', label: 'Không theo chế độ', desc: 'Ăn uống linh hoạt' },
  ];
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content step-content--diet">
      <div className="diet-step-heading">
        <h2>Chế độ ăn uống?</h2>
        <p>
          Giúp Aura lên thực đơn phù hợp với sở thích của bạn.
        </p>
      </div>
      <div className="diet-step-options" data-onboarding-scroll-region>
        {diets.map(d => (
          <ChoiceCard key={d.id} icon={d.icon} title={d.label} subtitle={d.desc} selected={profile.dietType === d.id} onClick={() => updateProfile({ dietType: d.id })} />
        ))}
      </div>
      <div className="bottom-cta diet-step-cta">
        <button className="primary-button" disabled={!profile.dietType} onClick={onNext}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const RestrictionsScreen = ({ profile, updateProfile, onNext }: any) => {
  const toggleItem = (list: string[], item: string, key: string) => {
    if (list.includes(item)) updateProfile({ [key]: list.filter((i: string) => i !== item) });
    else updateProfile({ [key]: [...list, item] });
  };
  
  const renderGrid = (items: string[], currentList: string[], key: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {items.map(item => {
        const selected = currentList.includes(item);
        return (
          <div key={item} 
            onClick={() => toggleItem(currentList, item, key)}
            style={{ padding: '12px 8px', textAlign: 'center', fontSize: 13, fontWeight: 600, border: '1px solid var(--aura-border)', borderRadius: 12, cursor: 'pointer',
              ...(selected ? { border: '1px solid #ff5a79', background: 'linear-gradient(135deg, #fff4f7, #fff8f2)', color: '#ff3f7d' } : {})
            }}>
            {item}
          </div>
        )
      })}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2 className="step-title" style={{ fontSize: 20 }}>Có thực phẩm nào Aura cần tránh cho bạn không?</h2>
      
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Bạn chủ động kiêng</h3>
        {renderGrid(['Thịt bò', 'Thịt heo', 'Hải sản', 'Sữa', 'Khác'], profile.dietaryRestrictions || [], 'dietaryRestrictions')}
      </div>
      
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Dị ứng hoặc không dung nạp</h3>
        {renderGrid(['Đậu phộng', 'Sữa', 'Trứng', 'Gluten', 'Đậu nành', 'Hải sản', 'Khác'], profile.allergies || [], 'allergies')}
      </div>

      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const NutritionTrackingScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Hiện tại bạn theo dõi dinh dưỡng ở mức nào?</h2></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
      <ChoiceCard title="Chưa theo dõi" selected={profile.nutritionTracking === 'none'} onClick={() => updateProfile({ nutritionTracking: 'none' })} />
      <ChoiceCard title="Thỉnh thoảng ghi lại bữa ăn" selected={profile.nutritionTracking === 'occasionally'} onClick={() => updateProfile({ nutritionTracking: 'occasionally' })} />
      <ChoiceCard title="Có theo dõi calo" selected={profile.nutritionTracking === 'calories'} onClick={() => updateProfile({ nutritionTracking: 'calories' })} />
      <ChoiceCard title="Theo dõi calo và dinh dưỡng" selected={profile.nutritionTracking === 'full_macros'} onClick={() => updateProfile({ nutritionTracking: 'full_macros' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.nutritionTracking} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);

export const HealthScreen = ({ profile, updateProfile, onNext }: any) => {
  const toggleItem = (item: string) => {
    let list = profile.healthConditions || [];
    if (item === 'none') {
      updateProfile({ healthConditions: [] });
      return;
    }
    if (list.includes(item)) {
      updateProfile({ healthConditions: list.filter((i: string) => i !== item) });
    } else {
      updateProfile({ healthConditions: [...list, item] });
    }
  };

  const conditions = [
    { id: 'none', label: 'Không có' },
    { id: 'Tiểu đường', label: 'Tiểu đường' },
    { id: 'Huyết áp cao', label: 'Huyết áp cao' },
    { id: 'Cholesterol cao', label: 'Cholesterol cao' },
    { id: 'Tim mạch', label: 'Tim mạch' },
    { id: 'Khác', label: 'Khác' },
  ];
  
  const isNone = profile.healthConditions?.length === 0;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Có vấn đề sức khỏe nào Aura cần lưu ý không?</h2></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
        {conditions.map(c => {
          const selected = c.id === 'none' ? isNone && profile.healthConditions !== undefined : profile.healthConditions?.includes(c.id as never);
          return (
             <div key={c.id} 
              onClick={() => toggleItem(c.id)}
              style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--aura-border)', borderRadius: 16, cursor: 'pointer',
                ...(selected ? { border: '1px solid #ff5a79', background: 'linear-gradient(135deg, #fff4f7, #fff8f2)' } : {})
              }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid ' + (selected ? '#ff3f7d' : '#cbd5e1'), display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? '#ff3f7d' : 'white' }}>
                {selected && <Check size={14} color="white" />}
              </div>
              <div style={{ fontWeight: 600 }}>{c.label}</div>
            </div>
          )
        })}
      </div>
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" disabled={profile.healthConditions === undefined} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};
