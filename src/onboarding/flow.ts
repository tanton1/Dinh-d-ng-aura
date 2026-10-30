import { OnboardingProfile, OnboardingStepId } from './types';

export function getSteps(profile: OnboardingProfile, includePreferences = false): OnboardingStepId[] {
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

  if (profile.primaryGoal === 'fat_loss' || profile.primaryGoal === 'muscle_gain') {
    steps.push('goal-pace');
  }

  steps.push(
    'activity',
    'restrictions',
    'health'
  );

  if (profile.healthConditions?.includes('Tiểu đường') || profile.healthConditions?.includes('Huyết áp cao')) {
    steps.push('health-details');
  }

  steps.push('preferences-choice');
  if (includePreferences) {
    steps.push('secondary-goals', 'sleep', 'stress', 'diet', 'nutrition-tracking', 'notifications');
  }
  steps.push('analyzing', 'result');

  return steps;
}
