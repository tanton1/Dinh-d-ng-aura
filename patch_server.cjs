const fs = require('fs');
const file = 'server.ts';
let code = fs.readFileSync(file, 'utf8');

const newRoutes = `
  app.post('/api/onboarding/preview', (req, res) => {
    const profile = req.body;
    let bmr = 1500;
    
    if (profile.biologicalSex === 'female') {
      bmr = 10 * (profile.weightKg || 60) + 6.25 * (profile.heightCm || 165) - 5 * (30) - 161;
    } else {
      bmr = 10 * (profile.weightKg || 60) + 6.25 * (profile.heightCm || 165) - 5 * (30) + 5;
    }

    const activityFactors = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      high: 1.725
    };
    
    const factor = activityFactors[profile.activityLevel] || 1.2;
    const tdee = bmr * factor;
    
    let targetCals = tdee;
    if (profile.primaryGoal === 'fat_loss') targetCals -= 500;
    if (profile.primaryGoal === 'muscle_gain') targetCals += 300;
    
    const weightDiff = Math.abs((profile.weightKg || 60) - (profile.targetWeightKg || 60));
    const rate = { fast: 0.6, balanced: 0.4, comfortable: 0.3 }[profile.pace] || 0.4;
    let weeks = Math.ceil(weightDiff / rate);
    if (weeks === 0) weeks = 12;

    const plan = {
      age: 30, // fallback
      bmi: (profile.weightKg || 60) / Math.pow((profile.heightCm || 165)/100, 2),
      bmiLabel: "Bình thường",
      bmrKcal: Math.round(bmr),
      tdeeKcal: Math.round(tdee),
      targetCaloriesKcal: Math.round(targetCals),
      proteinG: Math.round((profile.weightKg || 60) * 1.8),
      carbsG: Math.round((targetCals * 0.4) / 4),
      fatG: Math.round((targetCals * 0.25) / 9),
      waterLiters: 2.2,
      stepsPerDay: profile.activityLevel === 'sedentary' ? 5000 : profile.activityLevel === 'light' ? 8000 : 10000,
      workoutsPerWeek: profile.activityLevel === 'sedentary' ? 1 : profile.activityLevel === 'light' ? 3 : 5,
      estimatedWeeks: weeks
    };
    
    res.json(plan);
  });
`;

code = code.replace('  app.use("/api/ai", aiRouter);', newRoutes + '\n  app.use("/api/ai", aiRouter);');
fs.writeFileSync(file, code);
