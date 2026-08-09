const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const before = `    // Recalculate targets based on new values
    const mergedProfileData = {
      ...(profile?.nutritionProfile || {}),
      ...(localNutritionProfile || {}),
      ...values,
      goal: values.goals ? values.goals[0] : (profile?.nutritionProfile?.goal || 'maintain')
    }
    const newTargets = calculateNutritionTargets(mergedProfileData)
    
    const nextNutritionProfile = {
      ...mergedProfileData,
      targetCalories: newTargets.targetCaloriesKcal,
      protein: newTargets.proteinG,
      carbs: newTargets.carbsG,
      fat: newTargets.fatG,
      waterLiters: newTargets.waterLiters,
      steps: newTargets.stepsPerDay
    };`;

const after = `    // Recalculate targets based on new values
    const rawGoal = values.goals ? values.goals[0] : (profile?.nutritionProfile?.goal || 'maintain');
    const safeGoal = rawGoal === 'fat_loss' ? 'lose-fat' : rawGoal === 'muscle_gain' ? 'gain-muscle' : 'maintain';
    
    const mergedProfileData = {
      ...(profile?.nutritionProfile || {}),
      ...(localNutritionProfile || {}),
      ...values,
      heightCm: values.heightCm ?? profile?.nutritionProfile?.heightCm ?? 165,
      weightKg: values.weightKg ?? profile?.nutritionProfile?.weightKg ?? 60,
      targetWeightDeltaKg: values.targetWeightDeltaKg ?? profile?.nutritionProfile?.targetWeightDeltaKg ?? 0,
      targetTimeframeMonths: values.targetTimeframeMonths ?? profile?.nutritionProfile?.targetTimeframeMonths ?? 3,
      goal: safeGoal
    }
    const newTargets = calculateNutritionTargets(mergedProfileData as any)
    
    const nextNutritionProfile = {
      ...mergedProfileData,
      goal: safeGoal as "lose-fat" | "gain-muscle" | "maintain",
      targetCalories: newTargets.targetCaloriesKcal,
      protein: newTargets.proteinG,
      carbs: newTargets.carbsG,
      fat: newTargets.fatG,
      waterLiters: newTargets.waterLiters,
      steps: newTargets.stepsPerDay
    };`;

code = code.replace(before, after);
fs.writeFileSync('src/App.tsx', code);
