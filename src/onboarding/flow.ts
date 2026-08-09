import { OnboardingProfile, OnboardingStepId } from './types';

export function getSteps(profile: OnboardingProfile): OnboardingStepId[] {
  const steps: OnboardingStepId[] = [
    'welcome',
    'sex',
    'birth-year',
    'height',
    'weight',
    'primary-goal'
  ];

  if (profile.primaryGoal === 'fat_loss' || profile.primaryGoal === 'muscle_gain') {
    steps.push('target-weight');
  }

  steps.push('secondary-goals');

  if (profile.primaryGoal === 'fat_loss' || profile.primaryGoal === 'muscle_gain') {
    steps.push('goal-pace');
  }

  steps.push(
    'activity',
    'sleep',
    'stress',
    'diet',
    'restrictions',
    'nutrition-tracking',
    'health'
  );

  if (profile.healthConditions?.includes('Tiểu đường') || profile.healthConditions?.includes('Huyết áp cao')) {
    steps.push('health-details');
  }

  steps.push('notifications', 'analyzing', 'result');

  return steps;
}
