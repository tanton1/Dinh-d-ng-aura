const ONBOARDING_DEFAULTS = Object.freeze({
  birthYear: 1995,
  heightCm: 165,
  weightKg: 60,
})

function validNumber(value, minimum, maximum) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

function firstValid(values, minimum, maximum, fallback) {
  for (const value of values) {
    const parsed = validNumber(value, minimum, maximum)
    if (parsed !== null) return parsed
  }
  return fallback
}

function sameNumber(value, expected, minimum, maximum) {
  return validNumber(value, minimum, maximum) === expected
}

/**
 * Returns the smallest safe patch needed to make a completed onboarding
 * profile internally consistent. This is deliberately pure so both the
 * Firestore trigger and contract tests use the same rules.
 */
function buildCompletedOnboardingDefaultsPatch(data, currentYear = new Date().getUTCFullYear()) {
  if (!data || data.onboardingCompleted !== true) return null

  const onboarding = data.onboardingData && typeof data.onboardingData === 'object'
    ? data.onboardingData
    : {}
  const nutrition = data.nutritionProfile && typeof data.nutritionProfile === 'object'
    ? data.nutritionProfile
    : null
  const birthFromAge = nutrition
    ? currentYear - (validNumber(nutrition.age, 10, 100) ?? Number.NaN)
    : Number.NaN

  const birthYear = firstValid(
    [data.birthYear, onboarding.birthYear, birthFromAge],
    1940,
    currentYear - 10,
    ONBOARDING_DEFAULTS.birthYear,
  )
  const heightCm = firstValid(
    [data.heightCm, nutrition?.heightCm, onboarding.heightCm],
    100,
    220,
    ONBOARDING_DEFAULTS.heightCm,
  )
  const weightKg = firstValid(
    [data.weightKg, nutrition?.weightKg, onboarding.weightKg],
    30,
    150,
    ONBOARDING_DEFAULTS.weightKg,
  )

  const patch = {}
  if (!sameNumber(data.birthYear, birthYear, 1940, currentYear - 10)) patch.birthYear = birthYear
  if (!sameNumber(data.heightCm, heightCm, 100, 220)) patch.heightCm = heightCm
  if (!sameNumber(data.weightKg, weightKg, 30, 150)) patch.weightKg = weightKg

  if (
    !sameNumber(onboarding.birthYear, birthYear, 1940, currentYear - 10)
    || !sameNumber(onboarding.heightCm, heightCm, 100, 220)
    || !sameNumber(onboarding.weightKg, weightKg, 30, 150)
  ) {
    patch.onboardingData = { ...onboarding, birthYear, heightCm, weightKg }
  }

  if (nutrition && (
    !sameNumber(nutrition.heightCm, heightCm, 100, 220)
    || !sameNumber(nutrition.weightKg, weightKg, 30, 150)
    || validNumber(nutrition.age, 10, 100) === null
  )) {
    patch.nutritionProfile = {
      ...nutrition,
      age: currentYear - birthYear,
      heightCm,
      weightKg,
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}

module.exports = {
  ONBOARDING_DEFAULTS,
  buildCompletedOnboardingDefaultsPatch,
}
