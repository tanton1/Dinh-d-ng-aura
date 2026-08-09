const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');

const importStr = `import { calculateNutritionTargets } from '../../services/nutritionSyncService';\n`;
if (!code.includes('calculateNutritionTargets')) {
  code = importStr + code;
}

const before = `        if (res.ok) {
          const plan = await res.json();
          setGeneratedPlan(plan);
        } else {
          // Fallback mock
          setGeneratedPlan({
            age: 30, bmi: 23, bmiLabel: 'Bình thường', bmrKcal: 1400, tdeeKcal: 1900,
            targetCaloriesKcal: 1650, proteinG: 110, carbsG: 175, fatG: 55, waterLiters: 2.2,
            stepsPerDay: 8000, workoutsPerWeek: 3, estimatedWeeks: 12
          });
        }
      } catch (e) {
        setGeneratedPlan({
          age: 30, bmi: 23, bmiLabel: 'Bình thường', bmrKcal: 1400, tdeeKcal: 1900,
          targetCaloriesKcal: 1650, proteinG: 110, carbsG: 175, fatG: 55, waterLiters: 2.2,
          stepsPerDay: 8000, workoutsPerWeek: 3, estimatedWeeks: 12
        });
      }`;

const after = `        if (res.ok) {
          const plan = await res.json();
          setGeneratedPlan(plan);
        } else {
          throw new Error('API failed');
        }
      } catch (e) {
        // Fallback to client-side calc
        const age = profile.birthYear ? new Date().getFullYear() - profile.birthYear : 30;
        const heightM = (profile.heightCm || 165) / 100;
        const bmi = (profile.weightKg || 60) / (heightM * heightM);
        let bmiLabel = 'Bình thường';
        if (bmi < 18.5) bmiLabel = 'Thiếu cân';
        else if (bmi >= 25) bmiLabel = 'Thừa cân';
        
        const targets = calculateNutritionTargets({ ...profile, age });
        setGeneratedPlan({
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
          workoutsPerWeek: profile.activityLevel === 'sedentary' ? 1 : profile.activityLevel === 'light' ? 3 : 5,
          estimatedWeeks: Math.round((targets.timeframeMonths || 3) * 4.33),
          targetWeightDeltaKg: targets.targetDelta,
          targetTimeframeMonths: targets.timeframeMonths
        });
      }`;

code = code.replace(before, after);
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', code);
