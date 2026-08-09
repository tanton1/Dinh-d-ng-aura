import { NutritionProfileDraft } from '../pages/student/NutritionPage';

export interface UserProfileData {
  age?: number;
  biologicalSex?: 'female' | 'male' | 'other' | null;
  heightCm?: number | null;
  weightKg?: number | null;
  targetWeightKg?: number | null;
  targetWeightDeltaKg?: number | null;
  targetTimeframeMonths?: number | null;
  pace?: 'fast' | 'balanced' | 'comfortable' | null;
  activityLevel?: 'sedentary' | 'light' | 'low' | 'moderate' | 'high' | null;
  primaryGoal?: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'health' | null;
  goal?: 'lose-fat' | 'gain-muscle' | 'maintain' | null;
}

export function calculateNutritionTargets(data: UserProfileData) {
  const weight = data.weightKg || 60;
  const height = data.heightCm || 165;
  const age = data.age || 30;
  
  // Mifflin-St Jeor Equation
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  bmr += (data.biologicalSex === 'male' ? 5 : -161);

  const activityMultipliers: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    low: 1.375,
    moderate: 1.55,
    high: 1.725,
  };
  
  const rawActivity = data.activityLevel || 'low';
  const mappedActivity = activityMultipliers[rawActivity] ? rawActivity : 'low';
  
  const tdee = bmr * activityMultipliers[mappedActivity];

  const goalStr = data.primaryGoal || data.goal || 'maintain';
  
  // Determine delta
  let targetDelta = 0;
  if (data.targetWeightDeltaKg !== undefined && data.targetWeightDeltaKg !== null && data.targetWeightDeltaKg !== 0) {
    targetDelta = data.targetWeightDeltaKg;
  } else if (data.targetWeightKg) {
    targetDelta = data.targetWeightKg - weight;
  } else {
    // If goal implies loss or gain but no target provided, use reasonable defaults
    if (goalStr.includes('fat')) targetDelta = -4;
    else if (goalStr.includes('muscle')) targetDelta = 3;
  }

  // Determine timeframe
  let timeframeMonths = 3;
  if (data.targetTimeframeMonths) {
    timeframeMonths = data.targetTimeframeMonths;
  } else if (data.pace) {
    const weeklyRate = data.pace === 'fast' ? 0.6 : data.pace === 'comfortable' ? 0.3 : 0.4;
    const totalWeeks = Math.max(1, Math.abs(targetDelta) / weeklyRate);
    timeframeMonths = Math.max(1, Math.round(totalWeeks / 4.33));
  }
  
  const totalWeeks = timeframeMonths * 4.33;
  
  // Calorie deficit/surplus estimation: 1kg fat/muscle ~ 7700 kcal
  const dailyCalorieAdjustment = totalWeeks > 0 ? (targetDelta * 7700) / (totalWeeks * 7) : 0;
  let targetCalories = Math.round(tdee + dailyCalorieAdjustment);

  // Bounds safety
  const floorCalories = Math.max(1200, Math.round(bmr * 0.95));
  if (targetCalories < floorCalories) targetCalories = floorCalories;
  if (targetCalories > 4500) targetCalories = 4500;
  
  const proteinPerKg = goalStr.includes('muscle') ? 2.2 : goalStr.includes('fat') ? 2.0 : 1.6;
  const proteinGoal = Math.round(weight * proteinPerKg);
  const fatGoal = Math.max(45, Math.round(weight * 0.8));
  const carbGoal = Math.max(80, Math.round((targetCalories - proteinGoal * 4 - fatGoal * 9) / 4));
  const waterGoal = Math.min(4000, Math.max(1500, Math.round((weight * 35) / 100) * 100));
  const stepsGoal = mappedActivity === 'high' ? 10000 : mappedActivity === 'moderate' ? 8000 : 5000;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCaloriesKcal: targetCalories,
    proteinG: proteinGoal,
    carbsG: carbGoal,
    fatG: fatGoal,
    waterLiters: waterGoal / 1000,
    stepsPerDay: stepsGoal,
    targetDelta,
    timeframeMonths
  };
}
