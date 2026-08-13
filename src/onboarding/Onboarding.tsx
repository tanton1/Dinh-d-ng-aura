import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useOnboarding } from './store';
import { Header, WelcomeScreen, SexScreen, BirthYearScreen, HeightScreen, WeightScreen, PrimaryGoalScreen, TargetWeightScreen, SecondaryGoalsScreen } from './screens/OnboardingScreens';
import { GoalPaceScreen, ActivityScreen, SleepScreen, StressScreen } from './screens/OnboardingScreens2';
import { DietScreen, RestrictionsScreen, NutritionTrackingScreen, HealthScreen } from './screens/OnboardingScreens3';
import { HealthDetailsScreen, NotificationsScreen, AnalyzingScreen, ResultScreen } from './screens/OnboardingScreens4';
import { AnimatePresence } from 'motion/react';
import '../styles-onboarding.css';
import { GeneratedPlan, type OnboardingProfile } from './types';
import { normalizeOnboardingProfile } from './defaults';

interface OnboardingProps {
  onComplete: (profile: any, plan: any) => Promise<void>;
  onSkip?: (profile: OnboardingProfile) => Promise<void> | void;
  initialProfile?: any;
}

export default function Onboarding({ onComplete, onSkip, initialProfile }: OnboardingProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const store = useOnboarding();
  const { currentStep, profile, updateProfile, goNext, goBack, generatedPlan, setGeneratedPlan } = store;
  
  useEffect(() => {
    if (initialProfile) {
      updateProfile(normalizeOnboardingProfile(initialProfile));
    }
  }, [initialProfile, updateProfile]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.scrollTo({ top: 0, left: 0 });
    content.querySelectorAll<HTMLElement>('[data-onboarding-scroll-region]').forEach((region) => {
      region.scrollTo({ top: 0, left: 0 });
    });
  }, [currentStep]);

  const handleComplete = async (plan: GeneratedPlan) => {
    try {
      await onComplete(normalizeOnboardingProfile(profile), plan);
    } catch (e) {
      alert("Lỗi khi lưu thông tin: " + String(e));
    }
  };

  const handleSkip = onSkip ? async () => {
    try {
      await onSkip(normalizeOnboardingProfile(profile));
    } catch (e) {
      alert("Lỗi khi lưu thông tin mặc định: " + String(e));
    }
  } : undefined;

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome': return <WelcomeScreen onNext={goNext} onSkip={handleSkip} />;
      case 'sex': return <SexScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'birth-year': return <BirthYearScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'height': return <HeightScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'weight': return <WeightScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'primary-goal': return <PrimaryGoalScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'target-weight': return <TargetWeightScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'secondary-goals': return <SecondaryGoalsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'goal-pace': return <GoalPaceScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'activity': return <ActivityScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'sleep': return <SleepScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'stress': return <StressScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'diet': return <DietScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'restrictions': return <RestrictionsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'nutrition-tracking': return <NutritionTrackingScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'health': return <HealthScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'health-details': return <HealthDetailsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'notifications': return <NotificationsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;
      case 'analyzing': return <AnalyzingScreen profile={profile} setGeneratedPlan={setGeneratedPlan} onNext={goNext} />;
      case 'result': return <ResultScreen profile={profile} generatedPlan={generatedPlan} onComplete={handleComplete} onBack={() => store.jumpTo('welcome')} />;
      default: return null;
    }
  };

  return (
    <div className="onboarding-container" data-onboarding-step={currentStep}>
      <div ref={contentRef} className={`onboarding-content onboarding-content--${currentStep} ${currentStep === 'welcome' ? 'no-padding' : ''}`}>
        <Header currentStep={currentStep} profile={profile} onBack={goBack} onSkip={handleSkip} />
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>
    </div>
  );
}
