import { useState, useCallback } from 'react';
import { OnboardingProfile, OnboardingStepId, GeneratedPlan } from './types';
import { getSteps } from './flow';
import { normalizeOnboardingProfile } from './defaults';

export function useOnboarding() {
  const [profile, setProfile] = useState<OnboardingProfile>(() => normalizeOnboardingProfile({
    biologicalSex: null,
    primaryGoal: null,
    targetWeightKg: null,
    pace: null,
    activityLevel: null,
    sleepHours: null,
    sleepQuality: null,
    stressLevel: null,
    dietType: null,
    nutritionTracking: null,
  }));

  const [currentStep, setCurrentStep] = useState<OnboardingStepId>('welcome');
  const [includePreferences, setIncludePreferences] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);

  const updateProfile = useCallback((updates: Partial<OnboardingProfile>) => {
    setProfile(prev => normalizeOnboardingProfile({ ...prev, ...updates }));
  }, []);

  const goNext = useCallback(() => {
    const steps = getSteps(profile, includePreferences);
    const index = steps.indexOf(currentStep);
    if (index >= 0 && index < steps.length - 1) {
      setCurrentStep(steps[index + 1]);
    }
  }, [currentStep, profile, includePreferences]);

  const goBack = useCallback(() => {
    const steps = getSteps(profile, includePreferences);
    const index = steps.indexOf(currentStep);
    if (index > 0) {
      setCurrentStep(steps[index - 1]);
    }
  }, [currentStep, profile, includePreferences]);
  
  const jumpTo = useCallback((step: OnboardingStepId) => {
    setCurrentStep(step);
  }, []);

  return {
    profile,
    updateProfile,
    currentStep,
    includePreferences,
    choosePreferences: (include: boolean) => {
      setIncludePreferences(include);
      setCurrentStep(include ? 'secondary-goals' : 'analyzing');
    },
    goNext,
    goBack,
    jumpTo,
    generatedPlan,
    setGeneratedPlan,
  };
}
