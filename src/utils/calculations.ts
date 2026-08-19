import { UserProfile } from '../types';

export const calculateMacros = (
  age: number,
  height: number,
  weight: number,
  workouts_per_week: number,
  goal: 'fat_loss' | 'muscle_gain' | 'tone'
) => {
  // BMR for women: 10 * weight + 6.25 * height - 5 * age - 161
  const bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  
  // Activity multiplier
  let multiplier = 1.2; // Sedentary
  if (workouts_per_week > 0 && workouts_per_week <= 2) multiplier = 1.375;
  else if (workouts_per_week > 2 && workouts_per_week <= 4) multiplier = 1.55;
  else if (workouts_per_week > 4) multiplier = 1.725;

  const tdee = Math.round(bmr * multiplier);
  
  const floorKcal = 1200; // Minimum safe calories for women
  
  const calcMacrosForMode = (calorieAdjustment: number, proteinPerKg: number) => {
    let kcal = tdee + calorieAdjustment;
    if (kcal < floorKcal) kcal = floorKcal;
    
    const protein = Math.round(weight * proteinPerKg);
    const proteinKcal = protein * 4;
    
    // Fat is 25% of total kcal
    const fat = Math.round((kcal * 0.25) / 9);
    const fatKcal = fat * 9;
    
    const carbKcal = kcal - proteinKcal - fatKcal;
    const carb = Math.max(0, Math.round(carbKcal / 4));
    
    return { kcal, protein, carb, fat };
  };

  let target_macros;

  if (goal === 'fat_loss') {
    target_macros = {
      easy: calcMacrosForMode(-200, 1.6),
      standard: calcMacrosForMode(-400, 1.8),
      lean: calcMacrosForMode(-600, 2.2)
    };
  } else if (goal === 'tone') {
    // Body Recomposition: Maintenance or slight deficit, high protein
    target_macros = {
      easy: calcMacrosForMode(0, 1.8),
      standard: calcMacrosForMode(-100, 2.0),
      lean: calcMacrosForMode(-200, 2.2)
    };
  } else if (goal === 'muscle_gain') {
    // Bulking: Caloric surplus
    target_macros = {
      easy: calcMacrosForMode(100, 1.6),
      standard: calcMacrosForMode(250, 1.8),
      lean: calcMacrosForMode(500, 2.0)
    };
  } else {
    // Fallback
    target_macros = {
      easy: calcMacrosForMode(-200, 1.6),
      standard: calcMacrosForMode(-400, 1.8),
      lean: calcMacrosForMode(-600, 2.2)
    };
  }

  return { tdee, target_macros };
};
