import { useState, useCallback } from 'react';
import { OnboardingProfile, OnboardingStepId, GeneratedPlan } from './types';
import { getSteps } from './flow';

export function useOnboarding() {
  const [profile, setProfile] = useState<OnboardingProfile>({
    biologicalSex: null,
    birthYear: null,
    heightCm: null,
    weightKg: null,
    primaryGoal: null,
    targetWeightKg: null,
    secondaryGoals: [],
    pace: null,
    activityLevel: null,
    sleepHours: null,
    sleepQuality: null,
    stressLevel: null,
    dietType: null,
    dietaryRestrictions: [],
    allergies: [],
    nutritionTracking: null,
    healthConditions: [],
  });

  const [currentStep, setCurrentStep] = useState<OnboardingStepId>('welcome');
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);

  const updateProfile = useCallback((updates: Partial<OnboardingProfile>) => {
    setProfile(prev => ({ ...prev, ...updates }));
  }, []);

  const goNext = useCallback(() => {
    const steps = getSteps(profile);
    const index = steps.indexOf(currentStep);
    if (index >= 0 && index < steps.length - 1) {
      setCurrentStep(steps[index + 1]);
    }
  }, [currentStep, profile]);

  const goBack = useCallback(() => {
    const steps = getSteps(profile);
    const index = steps.indexOf(currentStep);
    if (index > 0) {
      setCurrentStep(steps[index - 1]);
    }
  }, [currentStep, profile]);
  
  const jumpTo = useCallback((step: OnboardingStepId) => {
    setCurrentStep(step);
  }, []);

  return {
    profile,
    updateProfile,
    currentStep,
    goNext,
    goBack,
    jumpTo,
    generatedPlan,
    setGeneratedPlan,
  };
}
