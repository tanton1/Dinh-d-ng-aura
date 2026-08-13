import type { OnboardingProfile } from './types'

/**
 * Values shown by the onboarding controls when a member has not changed the
 * control yet. Keeping these defaults in one place prevents the UI from
 * displaying a value while the submitted profile still contains null.
 */
export const ONBOARDING_DEFAULTS = {
  birthYear: 1995,
  heightCm: 165,
  weightKg: 60,
} as const

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

/**
 * Hydrates an onboarding draft with the same values rendered by the numeric
 * controls. We intentionally do not invent choices such as sex, goal, or diet;
 * only safe numeric defaults and empty collections are normalized here.
 */
export function normalizeOnboardingProfile(
  profile?: Partial<OnboardingProfile> | null,
): OnboardingProfile {
  const source = profile ?? {}
  return {
    ...source,
    birthYear: numberInRange(source.birthYear, ONBOARDING_DEFAULTS.birthYear, 1940, new Date().getFullYear() - 10),
    heightCm: numberInRange(source.heightCm, ONBOARDING_DEFAULTS.heightCm, 100, 220),
    weightKg: numberInRange(source.weightKg, ONBOARDING_DEFAULTS.weightKg, 30, 150),
    secondaryGoals: Array.isArray(source.secondaryGoals) ? source.secondaryGoals : [],
    dietaryRestrictions: Array.isArray(source.dietaryRestrictions) ? source.dietaryRestrictions : [],
    allergies: Array.isArray(source.allergies) ? source.allergies : [],
    healthConditions: Array.isArray(source.healthConditions) ? source.healthConditions : [],
  } as OnboardingProfile
}
