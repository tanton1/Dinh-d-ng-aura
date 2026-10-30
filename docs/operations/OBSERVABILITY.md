# Aura production observability

Aura uses Google Cloud native telemetry. Every new callable should use the fields below in structured logs:

```json
{
  "schemaVersion": 1,
  "correlationId": "request-scoped-id",
  "domain": "schedule|student360|contract|action|identity",
  "operation": "callable-or-trigger-name",
  "outcome": "success|error",
  "errorCode": "BUSINESS_RULE|PERMISSION|INTERNAL",
  "retryable": false,
  "durationMs": 0
}
```

Recommended Cloud Monitoring views:

- callable p95 latency and error rate by `domain`/`operation`;
- Student 360 and Action Center route failures;
- projection freshness for `studentOperationalViews`, `contractUsageViews` and `operationalActions`;
- contract usage mismatch count;
- schedule optimizer completion, search-limit and unassigned-reason counts;
- client incident rate by normalized code.

Roll back a surface or read-model switch when a route fails above 0.5%, JavaScript errors exceed 1% of sessions, financial/contract values diverge, or a projection exposes data outside the actor scope.

## Operation baseline and reporting rollout (2026-10-30)

Production metadata checked read-only on 2026-10-30: the named production database in `asia-southeast1` has PITR enabled with seven-day version retention and delete protection enabled. The database has no native backup schedules; the regional native backup listing was empty. This does not determine whether manual/GCS exports exist. No restore was exercised and no cloud settings were changed. Before a data migration, verify a separate backup and rehearse restoration into an isolated database; PITR metadata alone is not restore evidence.

`withFunctionTelemetry` emits schema version 2. Successful requests are deterministically sampled at 10%; failures remain at 100%. `AURA_SUCCESS_METRIC_SAMPLE_RATE` can set a value from 0 to 1. Every metric includes its sample rate and serving revision. New metric logs exclude actor/source IDs and payloads; existing failure audit records remain separate. Response bytes are measured only for sampled successful requests, excluding the Firebase transport envelope.

`recordOperationMetrics` accepts only numeric observations in an async request context: logical queries, returned documents, cache hits/misses, response bytes and projection age. Missing observations remain unknown. Counts currently cover explicitly instrumented source reads; they do not include every authorization/cache read and are not Firestore billing units. Reporting runs canonical scans in a single read-only transaction, pages 500 records at a time, and caches the result for three minutes using a shared build lease. Above 25,000 records per source it reports incomplete/null totals instead of truncating a complete total. Manual refresh waits for an active builder and reuses its result only if the source snapshot is at least as recent as the refresh's first authoritative cache read. Both timestamps come from Firestore read times, independent of instance clocks; publication time and a newer lease never make retained old data fresh. Otherwise the refresh acquires the next lease and rebuilds, or returns a bounded busy response. Cursor detail scans at most 200 candidate contracts per request and exposes continuation even when a sparse page has no matches.

The scan queue logs one anonymous terminal observation after the Firestore transaction commits. `queueWaitMs` is creation to first worker claim. `processingMs` is elapsed wall time after the first claim, including retry/backoff; it is not provider processing latency or billable duration. A terminal redelivery emits no duplicate observation. Client read diagnostics batch 20 calls per operation in 10% of sessions, cap at 12 batches/session, start no polling timer and use the existing non-durable product event transport. The backend accepts only fixed numeric fields and operation names for these batches.

Collect a bounded read-only baseline with:

```sh
npm run operations:baseline -- --project=gen-lang-client-0815966909 --hours=24 --max-pages=20 --out=.migration-private/operation-baseline.json
```

The collector uses the existing signed-in Firebase CLI, never saves raw logs, weights sampled observations, deduplicates log entries and marks a capped window partial. Missing operations are unknown, never zero traffic. Compare the same roles, branch, data volume and action sequence before/after rollout; reconcile billed usage separately. The pre-change artifact `ops/app-operation-baseline-20261030.json` has insufficient observations to calculate production savings.

Deploy the four additive reporting endpoints in `asia-east1` before the frontend: `getAcademyAnalyticsSummary`, `listAcademyEnrollmentsPage`, `listFinanceReceivables`, `listFinanceStudentLabels`. Verify the actual serving revision, auth/App Check and branch boundaries, then deploy frontend. These APIs require existing admin permissions; no rules/index migration or raw-list fallback is introduced. Financial pages explicitly use contract-ID order; a future global due-date ordering needs a canonical projected sort field. Summary totals refer to the branch, while text search filters the paginated list.

The extraction of contract and loyalty core modules preserves public exports and needs no data migration. Deploy affected function source through the existing release pipeline in small groups. Do not retire any endpoint from static graph evidence alone. Existing lifecycle registry/evaluator and readiness/traffic checks remain authoritative.

Offline nutrition quality evaluation accepts private, human-reviewed references and saved predictions:

```sh
node scripts/evaluate-nutrition-quality.cjs PRIVATE_REFERENCES.json PRIVATE_PREDICTIONS.json
```

Each reference needs an anonymous `caseId`, `reviewed: true`, `reviewedAt`, `reviewer`, `calories` and `grams`. Each prediction has the same `caseId`, `status`, and successful `calories`/`grams`; duration/cost/review flag are optional. The output contains only aggregate error, completion, review and measured cost/latency. Never treat synthetic tests or client corrections as reviewed ground truth. No provider call, image upload or extra API key is involved.

Production follow-up still requires a representative observation window, a reviewed photo benchmark, a budgeted live-provider load test, real iOS verification, and backup/restore evidence in an isolated recovery environment. These are not inferred from passing local tests; do not restore over production or mark an unknown backup state as healthy.

CI investigation on 2026-10-30: `pt-schedule-off-confirmation.integration.cjs` can intermittently receive `3 INVALID_ARGUMENT: Transaction is invalid or closed` from the Firestore emulator during the second of two simultaneous charges. The unchanged main baseline reproduced this in two of three isolated probes; the optimized source passed three of three. Emulator logs show its transaction manager attempting to reactivate a closed transaction. The billing/admin-edit code and fixture were unchanged, and the extracted pure helper bodies matched main. Keep the simultaneous calls and one-charge/one-ledger assertions intact; this evidence does not justify adding blanket retries to production writes. Investigate recurring failures separately from functional assertion failures.

