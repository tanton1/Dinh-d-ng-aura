const fs = require('fs');
let code = fs.readFileSync('src/services/nutritionService.ts', 'utf8');

const target = `function isFoodAnalysis(value: unknown): value is FoodAnalysis {
  if (!isRecord(value) || typeof value.isFood !== 'boolean') return false
  if (
    typeof value.dishNameVi !== 'string'
    || typeof value.dishNameEn !== 'string'
    || typeof value.portionSummary !== 'string'
    || !isNumberInRange(value.confidence, 0, 1)
    || !hasNumericRange(value.calorieRange, 10000)
    || !hasNutritionTotals(value.totals)
    || !isCatalogMatch(value.catalogMatch)
    || !Array.isArray(value.catalogCandidates)
    || value.catalogCandidates.length > 5
    || !value.catalogCandidates.every((candidate) => candidate !== null && isCatalogMatch(candidate))
    || !Array.isArray(value.items)
    || value.items.length > 12
    || !Array.isArray(value.questions)
    || value.questions.length > 3
    || !Array.isArray(value.warnings)
    || value.warnings.length > 8
    || value.questions.some((question) => typeof question !== 'string')
    || value.warnings.some((warning) => typeof warning !== 'string')
  ) return false`;

const replacement = `function isFoodAnalysis(value: unknown): value is FoodAnalysis {
  if (!isRecord(value) || typeof value.isFood !== 'boolean') return false
  if (
    typeof value.dishNameVi !== 'string'
    || typeof value.dishNameEn !== 'string'
    || typeof value.portionSummary !== 'string'
    || !isNumberInRange(value.confidence, 0, 1)
    || !hasNumericRange(value.calorieRange, 10000)
    || !hasNutritionTotals(value.totals)
    || !isCatalogMatch(value.catalogMatch)
    || !Array.isArray(value.catalogCandidates)
    || value.catalogCandidates.length > 5
    || !value.catalogCandidates.every((candidate) => candidate !== null && isCatalogMatch(candidate))
    || !Array.isArray(value.items)
    || !Array.isArray(value.questions)
    || value.questions.length > 3
    || !Array.isArray(value.warnings)
    || value.warnings.length > 8
    || value.questions.some((question) => typeof question !== 'string')
    || value.warnings.some((warning) => typeof warning !== 'string')
  ) return false`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/services/nutritionService.ts', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
