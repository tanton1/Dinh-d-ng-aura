export interface OnboardingProfile {
  biologicalSex: 'female' | 'male' | 'other' | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  
  primaryGoal: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'health' | null;
  targetWeightKg: number | null;
  secondaryGoals: string[];
  pace: 'fast' | 'balanced' | 'comfortable' | null;
  
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'high' | null;
  sleepHours: number | null;
  sleepQuality: 'poor' | 'average' | 'good' | null;
  stressLevel: 'low' | 'medium' | 'high' | 'very_high' | null;
  
  dietType: 'balanced' | 'vegetarian' | 'vegan' | 'keto' | 'paleo' | 'low_carb' | 'high_protein' | 'none' | null;
  dietaryRestrictions: string[];
  allergies: string[];
  nutritionTracking: 'none' | 'occasionally' | 'calories' | 'full_macros' | null;
  
  healthConditions: string[];
  diabetesType?: 'type_1' | 'type_2' | 'pre' | 'unknown' | null;
  bpStatus?: 'medicated' | 'unmedicated' | 'unknown' | null;
  mealTimes?: string[];
  notificationsEnabled?: boolean;
}

export type OnboardingStepId =
  | 'welcome'
  | 'sex'
  | 'birth-year'
  | 'height'
  | 'weight'
  | 'primary-goal'
  | 'target-weight'
  | 'secondary-goals'
  | 'goal-pace'
  | 'activity'
  | 'sleep'
  | 'stress'
  | 'diet'
  | 'restrictions'
  | 'nutrition-tracking'
  | 'health'
  | 'health-details'
  | 'notifications'
  | 'analyzing'
  | 'result';

export interface GeneratedPlan {
  age: number;
  bmi: number;
  bmiLabel: string;
  bmrKcal: number;
  tdeeKcal: number;
  targetCaloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterLiters: number;
  stepsPerDay: number;
  workoutsPerWeek: number;
  estimatedWeeks: number;
  targetWeightDeltaKg?: number;
  targetTimeframeMonths?: number;
}
