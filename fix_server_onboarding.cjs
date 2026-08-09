const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "app.post('/api/onboarding/preview', (req, res) => {",
  "import { calculateNutritionTargets } from './src/services/nutritionSyncService';\n\n  app.post('/api/onboarding/preview', (req, res) => {"
);

const beforePreviewLogic = `const profile = req.body;
    let bmr = 1500;
    
    if (profile.biologicalSex === 'female') {
      bmr = 10 * (profile.weightKg || 60) + 6.25 * (profile.heightCm || 165) - 5 * (30) - 161;
    } else {
      bmr = 10 * (profile.weightKg || 60) + 6.25 * (profile.heightCm || 165) - 5 * (30) + 5;
    }

    const activityFactors = {
      sedentary: 1.3,
      light: 1.375,
      moderate: 1.55,
      high: 1.725
    };
    
    const factor = activityFactors[profile.activityLevel] || 1.3;
    const tdee = bmr * factor;
    
    let targetCals = tdee;
    if (profile.primaryGoal === 'fat_loss') targetCals -= 500;
    targetCals = Math.max(1200, Math.round(bmr * 0.95), targetCals);
    if (profile.primaryGoal === 'muscle_gain') targetCals += 300;
    
    const weightDiff = Math.abs((profile.weightKg || 60) - (profile.targetWeightKg || 60));
    const targetDelta = profile.primaryGoal === 'fat_loss' ? -weightDiff : profile.primaryGoal === 'muscle_gain' ? weightDiff : 0;
    
    res.json({
      age: 30,
      bmi: 22,
      bmiLabel: 'Bình thường',
      bmrKcal: Math.round(bmr),
      tdeeKcal: Math.round(tdee),
      targetCaloriesKcal: Math.round(targetCals),
      proteinG: Math.round((profile.weightKg || 60) * 1.8),
      carbsG: Math.round((targetCals * 0.45) / 4),
      fatG: Math.round((targetCals * 0.25) / 9),
      waterLiters: 2.5,
      stepsPerDay: 8000,
      workoutsPerWeek: 3,
      estimatedWeeks: Math.max(4, Math.round((weightDiff * 7700) / (Math.abs(tdee - targetCals) * 7))),
      targetWeightDeltaKg: targetDelta,
      targetTimeframeMonths: Math.max(1, Math.round((weightDiff * 7700) / (Math.abs(tdee - targetCals) * 7) / 4.33))
    });`;

const newPreviewLogic = `const profile = req.body;
    const currentYear = new Date().getFullYear();
    const age = profile.birthYear ? currentYear - profile.birthYear : 30;
    
    const heightM = (profile.heightCm || 165) / 100;
    const bmi = (profile.weightKg || 60) / (heightM * heightM);
    let bmiLabel = 'Bình thường';
    if (bmi < 18.5) bmiLabel = 'Thiếu cân';
    else if (bmi >= 25) bmiLabel = 'Thừa cân';

    const targetDelta = profile.targetWeightKg ? (profile.targetWeightKg - (profile.weightKg || 60)) : 0;
    
    // We determine timeframe based on speed pace if available, or default to some weeks based on delta
    const pace = profile.targetSpeedPace || 'standard';
    const weeklyRate = pace === 'fast' ? 0.8 : pace === 'slow' ? 0.3 : 0.5;
    const totalWeeks = Math.max(1, Math.abs(targetDelta) / weeklyRate);
    const targetTimeframeMonths = Math.max(1, Math.round(totalWeeks / 4.33));

    const targets = calculateNutritionTargets({
      ...profile,
      age,
      targetWeightDeltaKg: targetDelta,
      targetTimeframeMonths
    });
    
    res.json({
      age,
      bmi: Math.round(bmi * 10) / 10,
      bmiLabel,
      bmrKcal: targets.bmr,
      tdeeKcal: targets.tdee,
      targetCaloriesKcal: targets.targetCaloriesKcal,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      waterLiters: targets.waterLiters,
      stepsPerDay: targets.stepsPerDay,
      workoutsPerWeek: 3,
      estimatedWeeks: Math.round(totalWeeks),
      targetWeightDeltaKg: targetDelta,
      targetTimeframeMonths
    });`;

code = code.replace(beforePreviewLogic, newPreviewLogic);
fs.writeFileSync('server.ts', code);
