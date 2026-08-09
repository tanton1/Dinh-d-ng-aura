const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace(
  "import { calculateNutritionTargets } from '../../services/nutritionSyncService'",
  ""
);

code = code.replace(
  "import CapturedMealDetail from './CapturedMealDetail'",
  "import CapturedMealDetail from './CapturedMealDetail'\nimport { calculateNutritionTargets } from '../../services/nutritionSyncService'"
);

const before = `function getNutritionTargets(profile: NutritionProfileDraft, overrideWeight?: number) {
  const weight = overrideWeight ?? profile.weightKg
  const sexOffset = profile.biologicalSex === 'male' ? 5 : -161
  const restingCalories = 10 * weight + 6.25 * profile.heightCm - 5 * profile.age + sexOffset
  const maintenanceCalories = restingCalories * ACTIVITY_FACTORS[profile.activityLevel]
  
  const targetDelta = profile.targetWeightDeltaKg ?? (profile.goal === 'lose-fat' ? -4 : profile.goal === 'gain-muscle' ? 3 : 0)
  const timeframeMonths = profile.targetTimeframeMonths ?? 3
  
  let dailyAdjustment = 0
  if (profile.goal === 'lose-fat') {
    const totalDeficit = Math.abs(targetDelta) * 7700
    dailyAdjustment = -Math.min(800, Math.max(250, Math.round(totalDeficit / (timeframeMonths * 30))))
  } else if (profile.goal === 'gain-muscle') {
    const totalSurplus = Math.abs(targetDelta) * 5500
    dailyAdjustment = Math.min(600, Math.max(200, Math.round(totalSurplus / (timeframeMonths * 30))))
  }

  // Limit deficit to not go below BMR * 0.9 or 1200
  const floorCalories = Math.max(1200, Math.round(restingCalories * 0.95));
  const calorieGoal = Math.min(4500, Math.max(floorCalories, Math.round((maintenanceCalories + dailyAdjustment) / 50) * 50))
  const proteinPerKg = profile.goal === 'gain-muscle' ? 2 : profile.goal === 'lose-fat' ? 1.8 : 1.6
  const proteinGoal = Math.round(weight * proteinPerKg)
  const fatGoal = Math.max(45, Math.round(weight * 0.8))
  const carbGoal = Math.max(80, Math.round((calorieGoal - proteinGoal * 4 - fatGoal * 9) / 4))
  const waterGoal = Math.min(4000, Math.max(1500, Math.round((weight * 35) / 100) * 100))
  return { calorieGoal, proteinGoal, carbGoal, fatGoal, waterGoal, maintenanceCalories, dailyAdjustment, targetDelta, timeframeMonths }
}`;

const after = `function getNutritionTargets(profile: NutritionProfileDraft, overrideWeight?: number) {
  const targets = calculateNutritionTargets({
    ...profile,
    weightKg: overrideWeight ?? profile.weightKg
  });
  
  return {
    calorieGoal: targets.targetCaloriesKcal,
    proteinGoal: targets.proteinG,
    carbGoal: targets.carbsG,
    fatGoal: targets.fatG,
    waterGoal: targets.waterLiters * 1000,
    maintenanceCalories: targets.tdee,
    dailyAdjustment: targets.targetCaloriesKcal - targets.tdee,
    targetDelta: profile.targetWeightDeltaKg ?? 0,
    timeframeMonths: profile.targetTimeframeMonths ?? 3
  }
}`;

code = code.replace(before, after);
fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
