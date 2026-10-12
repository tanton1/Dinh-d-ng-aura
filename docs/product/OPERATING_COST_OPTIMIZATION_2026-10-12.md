# Operating-cost optimization — 2026-10-12

Status: implemented locally; not deployed.

## Included in this batch

- `generateMealReview` now validates and bounds the prompt inputs before they
  reach a paid provider.
- Meal reviews are cached per authenticated owner and normalized meal/profile
  fingerprint for seven days. A cache hit does not consume the AI quota.
- The endpoint has a separate transactional quota of 20 requests per 10
  minutes and 100 requests per 24-hour window. Failed provider calls are not
  written to the result cache, so a later retry remains possible.
- Concurrent identical review requests in one Functions instance share one
  provider request. The browser Academy/content-AI service also coalesces
  identical in-flight callable requests; changed payloads remain independent.
- Scheduled reminders skip the push-template collection read when meal
  automation is disabled or no eligible user document exists. Legacy profiles
  without explicit notification fields remain opted in, so the full user scan
  is intentionally retained for correctness.

## Release and measurement

1. Run the local typecheck/build and Functions tests listed in the repository
   root and `functions/package.json`.
2. Deploy only the affected surface, for example:
   `firebase deploy --only "functions:generateMealReview,firestore:rules,firestore:indexes"`.
   The new
   `aiMealReviewCache.expiresAt` TTL is cleanup-only; the endpoint remains
   correct if TTL activation is delayed.
3. Exercise one cache miss, a repeated request, a changed meal, a quota
   rejection and the no-provider response with the authenticated production
   smoke account. Do not use real learner health data in a test payload.
4. Compare Cloud Logging counts for `generateMealReview`, provider request
   IDs, `cacheHit`, and `resource-exhausted` responses before and after the
   release. Exported Billing/Usage data is required before claiming a currency
   saving; this change only reduces eligible provider calls and reads.

## Deliberately deferred

The reminder worker still scans legacy `users` profiles because missing
notification fields mean “enabled” today. Replacing that scan with a
`nextReminderAt` queue needs a backfill, preference-change writer and parity
rollout. It is not safe to enable by configuration alone. Firestore named
database billing, Storage lifecycle policy verification, provider pricing and
production rollout flags also remain operational tasks; this patch does not
change Billing, production data or cloud configuration.
