import React, { useEffect, useState } from 'react';
import { useOnboarding } from './store';
import { Header, WelcomeScreen, SexScreen, BirthYearScreen, HeightScreen, WeightScreen, PrimaryGoalScreen, TargetWeightScreen, SecondaryGoalsScreen } from './screens/OnboardingScreens';
import { GoalPaceScreen, ActivityScreen, SleepScreen, StressScreen } from './screens/OnboardingScreens2';
import { DietScreen, RestrictionsScreen, NutritionTrackingScreen, HealthScreen } from './screens/OnboardingScreens3';
import { HealthDetailsScreen, NotificationsScreen, AnalyzingScreen, ResultScreen } from './screens/OnboardingScreens4';
import { AnimatePresence } from 'motion/react';
import '../styles-onboarding.css';
import { GeneratedPlan } from './types';

interface OnboardingProps {
  onComplete: (profile: any, plan: any) => Promise<void>;
  initialProfile?: any;
}

export default function Onboarding({ onComplete, initialProfile }: OnboardingProps) {
  const store = useOnboarding();
  const { currentStep, profile, updateProfile, goNext, goBack, generatedPlan, setGeneratedPlan } = store;
  
  useEffect(() => {
    if (initialProfile) {
      updateProfile(initialProfile);
    }
  }, [initialProfile, updateProfile]);

  const handleComplete = async (plan: GeneratedPlan) => {
    try {
      await onComplete(profile, plan);
    } catch (e) {
      alert("Lỗi khi lưu thông tin: " + String(e));
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome': return <WelcomeScreen onNext={goNext} />;
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
    <div className="onboarding-container">
      <div className={`onboarding-content ${currentStep === 'welcome' ? 'no-padding' : ''}`}>
        <Header currentStep={currentStep} profile={profile} onBack={goBack} />
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>
    </div>
  );
}
