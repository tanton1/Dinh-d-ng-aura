const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "import { hasPermission, type Permission } from './config/permissions'",
  "import { hasPermission, type Permission } from './config/permissions'\nimport { calculateNutritionTargets } from './services/nutritionSyncService'"
);

const beforeSaveProfile = `  const saveProfile = async (values: ProfileUpdateInput) => {
    if (user?.uid) {
      try {
        window.localStorage.setItem(\`aura:onboarding-completed:\${user.uid}\`, 'true')
        window.localStorage.setItem(\`aura:profile:\${user.uid}\`, JSON.stringify(values))
        window.localStorage.setItem(\`aura:user-profile:\${user.uid}\`, JSON.stringify(values))
      } catch {
        // Storage unavailable
      }
    }
    setLocalProfile((current: any) => {
      const next: ProfileUpdateInput = {
        ...current,
        ...values,
        notificationSettings: values.notificationSettings
          ? { ...current?.notificationSettings, ...values.notificationSettings }
          : current?.notificationSettings,
      }
      try {
        window.localStorage.setItem(\`aura:profile:\${user?.uid ?? 'demo'}\`, JSON.stringify(next))
        window.localStorage.setItem(\`aura:user-profile:\${user?.uid ?? 'demo'}\`, JSON.stringify(next))
      } catch {
        // The in-memory profile remains editable when storage is unavailable.
      }
      return next
    })

    if (backendMode === 'firebase' && user) {
      try {
        await updateUserProfile(user.uid, {
          ...values,
          onboardingCompleted: true,
        })
      } catch (err) {
        console.warn("Could not save profile to Firebase (network or quota limit):", err)
      }
      return
    }
  }`;

const newSaveProfile = `  const saveProfile = async (values: ProfileUpdateInput) => {
    // Recalculate targets based on new values
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
    };

    if (user?.uid) {
      try {
        window.localStorage.setItem(\`aura:onboarding-completed:\${user.uid}\`, 'true')
        window.localStorage.setItem(\`aura:profile:\${user.uid}\`, JSON.stringify(values))
        window.localStorage.setItem(\`aura:user-profile:\${user.uid}\`, JSON.stringify(values))
        window.localStorage.setItem(\`aura:nutrition-profile:\${user.uid}\`, JSON.stringify(nextNutritionProfile))
      } catch {
        // Storage unavailable
      }
    }
    
    setLocalProfile((current: any) => {
      const next: ProfileUpdateInput = {
        ...current,
        ...values,
        notificationSettings: values.notificationSettings
          ? { ...current?.notificationSettings, ...values.notificationSettings }
          : current?.notificationSettings,
      }
      try {
        window.localStorage.setItem(\`aura:profile:\${user?.uid ?? 'demo'}\`, JSON.stringify(next))
        window.localStorage.setItem(\`aura:user-profile:\${user?.uid ?? 'demo'}\`, JSON.stringify(next))
      } catch {
        // The in-memory profile remains editable when storage is unavailable.
      }
      return next
    })

    setLocalNutritionProfile(nextNutritionProfile as any)

    if (backendMode === 'firebase' && user) {
      try {
        await updateUserProfile(user.uid, {
          ...values,
          nutritionProfile: nextNutritionProfile,
          onboardingCompleted: true,
        })
      } catch (err) {
        console.warn("Could not save profile to Firebase (network or quota limit):", err)
      }
      return
    }
  }`;

code = code.replace(beforeSaveProfile, newSaveProfile);
fs.writeFileSync('src/App.tsx', code);
