'use strict'
// Offline evaluation only. References must be reviewed outside the model;
// corrected user entries alone are not ground truth. Never uploads images.
const fs = require('node:fs')
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
function evaluate(reference, predictions) {
  if (!Array.isArray(reference) || !Array.isArray(predictions)) throw new Error('Reference and predictions must be arrays.')
  const byId = new Map()
  for (const row of reference) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(row.caseId || '') || byId.has(row.caseId)) throw new Error('Reference case IDs must be unique and anonymous.')
    if (row.reviewed !== true || !row.reviewedAt || !row.reviewer || !finite(row.calories) || !finite(row.grams)) throw new Error('Every reference requires an attributed human review, calories and grams.')
    byId.set(row.caseId, row)
  }
  const seen = new Set(), kcalErrors = [], gramErrors = [], durations = [], costs = []
  let completed = 0, needsReview = 0, matched = 0
  for (const row of predictions) {
    if (!byId.has(row.caseId) || seen.has(row.caseId)) throw new Error('Prediction cases must match reference IDs without duplicates.')
    seen.add(row.caseId)
    matched++
    if (finite(row.durationMs)) durations.push(row.durationMs)
    if (finite(row.costUsd)) costs.push(row.costUsd)
    if (row.status !== 'completed') continue
    if (!finite(row.calories) || !finite(row.grams)) throw new Error('Completed predictions require finite nonnegative calories and grams.')
    completed++
    if (row.needsReview === true) needsReview++
    kcalErrors.push(Math.abs(row.calories - byId.get(row.caseId).calories))
    gramErrors.push(Math.abs(row.grams - byId.get(row.caseId).grams))
  }
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const p95 = values => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null
  const costComplete = matched > 0 && costs.length === matched
  return {
    schemaVersion: 1, mode: 'offline-human-reviewed-reference', referenceCount: reference.length, attempted: matched,
    missingPredictions: reference.length - matched, completed, failed: matched - completed,
    completionRate: matched ? completed / matched : null, needsReviewRate: completed ? needsReview / completed : null,
    meanAbsoluteError: { calories: mean(kcalErrors), grams: mean(gramErrors) },
    durationMs: { measuredCount: durations.length, p95: p95(durations) },
    costUsd: { measuredCount: costs.length, complete: costComplete, perSuccessfulResult: costComplete && completed ? costs.reduce((sum, value) => sum + value, 0) / completed : null },
    interpretation: 'Accuracy covers completed cases only. Missing/failed cases and unmeasured costs remain explicit; no names, images or review text are exported.',
  }
}
if (require.main === module) {
  try {
    const [, , referencesPath, predictionsPath] = process.argv
    if (!referencesPath || !predictionsPath) throw new Error('Usage: node scripts/evaluate-nutrition-quality.cjs PRIVATE_REFERENCES.json PRIVATE_PREDICTIONS.json')
    console.log(JSON.stringify(evaluate(JSON.parse(fs.readFileSync(referencesPath, 'utf8')), JSON.parse(fs.readFileSync(predictionsPath, 'utf8'))), null, 2))
  } catch (error) { console.error(error.code ? 'Could not read evaluation input files.' : error.message); process.exitCode = 1 }
}
module.exports = { evaluate }
