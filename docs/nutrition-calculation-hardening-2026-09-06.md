# Nutrition calculation hardening — 2026-09-06

## Release scope

- One pure `functions/nutrition-core.mjs` module imported by browser and Node 22 Functions; formula version `aura-nutrition-v2`.
- Same Mifflin, activity aliases, calorie/macronutrient reconciliation in profile editor, Home, Nutrition, Progress and AI Coach.
- Legacy relative targets converted against stored baseline weight, not recent mean. Explicit pace mode and duration mode are separate. Opposite-sign goals and unsupported/clinical profiles explain why automatic targets are unavailable.
- Deficit/surplus is a bounded starting estimate, not a medical prescription or a promised weight-loss rate. No automatic clinical prescription. A clinician-reviewed goal workflow remains future work.
- Recent weight subscriptions update Home and Nutrition without requiring a visit to Progress.
- Planner reads saved profile and recent weights on server. Client kcal/macro/profile overrides are not authoritative.
- Automatic planning requires known serving basis and no >20% energy/macro discrepancy. Allergies require reviewed metadata; diets require appropriate tags. Neither Gemini nor a small candidate pool can bypass this filter.
- Daily kcal ±15%, protein ±25%, carbohydrate/fat ±30% are **product validation tolerances**, not clinical thresholds. Draft may retain actionable issues; activation checks totals and rereads sources/profile in transaction. Prior active plan is unaffected by failed validation.
- All portion entry paths scale once, retain null micronutrients, and preserve planned serving multiplier in diary.
- Progress compares only days with all configured meal occasions, labels incompleteness, separates water-log averaging, and uses the configured workout target. This heuristic indicates coverage, not proof that every food was logged.
- TDEE is counted once (no separate exercise/TEF addition). New same-day meal logs carry target version snapshots; older days explicitly use a current-profile estimate. No historical data rewrite.
- Fiber is 25g consistently, sodium reference 2000mg. Total sugar is not scored as free sugar. Water stays a 35ml/kg starting estimate, not a universal requirement.

## Data limitation / rollout impact

The repository import has 1,250 dishes with `basis.amount/unit` unset. Such dishes remain searchable as reference data, existing diaries and assigned/active menus remain readable, but they are not eligible for automatic generation or reconfirmation until their **real source portion** is verified. Do not invent weights or silently alter imported macros to satisfy validation.

Catalog review must establish `basis`, correct kcal/macros from source, optional `dietaryTags`, and independently verified `allergens` / `allergensVerified`. No production catalog, user profile, or diary migration is included in this release.

## Follow-up work

- Source-based serving/ingredient curation; cannot be solved by assigning arbitrary grams.
- Clinician review/approval for special populations and goals.
- Explicit “finished logging this day” marker (rather than meal-occasion coverage).
- Adaptive 2–4-week TDEE calibration from adequately logged intake and weight trend. Not enabled automatically in this release.
- Server-owned daily target ledger for all entry points; current new meal snapshots are display evidence, not a billing/medical authority.

## Verification and rollback

Target, planner, transaction, allergy, serving and progress regression tests plus existing suites. Mobile smoke at 360/390/430px. Release only changed Functions: getMyNutritionPlanWorkspace, generateMyNutritionPlanDraft, mutateMyNutritionPlanMeal, confirmMyNutritionPlan, getAiCoachOverview, askAiCoach. No Rules, Auth or old Firebase project mutation.

Rollback: redeploy the previous reviewed frontend/Functions revision; never delete diary records or confirmed menus. The v2 snapshot fields are additive and older clients ignore them.
