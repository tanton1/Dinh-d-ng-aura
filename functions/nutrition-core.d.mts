export interface NutritionTargetInput {
  age?: number | null; biologicalSex?: string | null; heightCm?: number | null; weightKg?: number | null;
  targetWeightKg?: number | null; targetWeightDeltaKg?: number | null; targetTimeframeMonths?: number | null;
  targetTimeframeMode?: 'duration' | 'pace'; targetSpeedPace?: string | null; pace?: string | null;
  activityLevel?: string | null; goal?: string | null; primaryGoal?: string | null;
  healthConditions?: string[]; medicalConditions?: string; pregnant?: boolean; breastfeeding?: boolean;
}
export interface NutritionTargets {
  configured: boolean; formulaVersion: string; issues: string[]; bmr: number; tdee: number;
  targetCaloriesKcal: number; proteinG: number; carbsG: number; fatG: number; waterLiters: number;
  stepsPerDay: number; targetDelta: number; targetWeightKg: number | null; timeframeMonths: number;
  macroCaloriesKcal: number; targetAdjustmentReason: string | null;
}
export const NUTRITION_FORMULA_VERSION: string;
export const ACTIVITY_MULTIPLIERS: Readonly<Record<string, number>>;
export function normalizeActivity(value: unknown): 'sedentary' | 'light' | 'moderate' | 'high' | null;
export function canonicalNutritionProfile(user?: any): any;
export function calculateNutritionTargets(data: NutritionTargetInput, effectiveWeight?: number): NutritionTargets;
export function nutritionQuality(item: any, options?: { requireBasis?: boolean }): string[];
