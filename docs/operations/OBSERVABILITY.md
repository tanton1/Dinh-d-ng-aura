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

Collector schema v2 separates cohorts by serving revision, region/service, metric schema, authentication/App Check and outcome/error category. Top-level latency still includes all outcomes; use matching cohorts and success-only latency for comparisons. Queue wait and processing measurements include weighted p50/p95, with absent measurements left null. Processing time includes retry/backoff after the first claim, not just provider time. A complete paginated log window does not prove representative traffic. In the 24-hour observation ending 2026-10-30T09:05:54.623Z, eight reporting observations were anonymous auth rejections and two AI Coach observations were legacy successful metrics; none contained numeric read/cache/queue measurements. These observations do not establish user-facing reporting speed or savings.

Repeat an exact historical window without widening it as pagination runs:

```sh
npm run operations:baseline -- --project=gen-lang-client-0815966909 --start=2026-10-29T09:05:54.623Z --end=2026-10-30T09:05:54.623Z --max-pages=20 --out=.migration-private/operation-baseline.json
```

Both timestamps are required together; windows must be in the past and no longer than seven days. Cohort metadata never substitutes authentication for a role, labels a request as a deployment probe, or derives business scope from an identifier. Client diagnostic batches have session/batch/tail censoring and are not included in this function-metric estimator.

Deploy the four additive reporting endpoints in `asia-east1` before the frontend: `getAcademyAnalyticsSummary`, `listAcademyEnrollmentsPage`, `listFinanceReceivables`, `listFinanceStudentLabels`. Verify the actual serving revision, auth/App Check and branch boundaries, then deploy frontend. These APIs require existing admin permissions; no rules/index migration or raw-list fallback is introduced. Financial pages explicitly use contract-ID order; a future global due-date ordering needs a canonical projected sort field. Summary totals refer to the branch and selected contract category, while text search filters the paginated list.

The concurrent finance changes from PR #79, #81 and #82 are retained. Installments and preservation use server-side categories included in cursor and cache scope; compatibility categories and filters remain available to earlier clients. Preservation includes only preserved contracts with positive debt and excludes cancelled/inactive/archived/draft contracts. Following PR #82, cancelled contracts are excluded from every receivables category, while their cash history and settlement remain available in the student profile. Finance cache and cursor namespaces are version 4 to prevent mixing earlier eligibility rules. Weekly due totals cover Monday through Sunday and all pending installments in the week. Financial receivables use contract price minus discount and net cash paid; service recognition attribution does not change that balance. Emulator tests cover payment, refund, reversal and replay alongside recognized revenue, plus settlement/cancellation/reopening category transitions.

Ledger pages return explicit `canReverse` metadata for posted payments. The server deduplicates contract metadata reads within the selected page and reads canonical settlement status only when needed. It does not scan a directory or infer eligibility from the incomplete receivables page. Missing metadata keeps cash history visible and routes staff to the student profile for review; financial commands retain their authoritative settlement and revision checks.

The extraction of contract and loyalty core modules preserves public exports and needs no data migration. Deploy affected function source through the existing release pipeline in small groups. Do not retire any endpoint from static graph evidence alone. Existing lifecycle registry/evaluator and readiness/traffic checks remain authoritative.

The initial optimization release targets eight exports: the four reporting APIs above, `trackProductEventOverflow`, `trackProductEvent`, `enqueueNutritionScan` and `processNutritionScanQueue`. Deploy these backend dependencies and verify serving revisions before merging the web changes. Keep existing AI App Check enforcement; this release does not enable the compatibility override. Other contract/loyalty consumers preserve business behavior and can adopt the extracted cores with their next domain release. Existing dashboard cache callers do not enable the new coalescing option. Avoid redeploying unrelated endpoints solely to distribute sampled telemetry or behavior-preserving module extraction.

The initial eight targets passed the production serving gates on 2026-10-30. PR #82 landed while that release was running; its financial semantics were integrated with a scoped follow-up of `listFinanceReceivables`, `listFinanceLedgerRegional` (primary web read) and `listFinanceLedger` (fallback/older clients). Regional aliases package their own handler and must be included when that handler changes. All ten distinct release targets passed strict serving gates before the final web merge `200dcbf`; both production domains and authenticated finance checks passed. See [release evidence](../../ops/app-optimization-release-20261030.json). The named Firestore Rules were restored to PR #82 and verified against its source hash; browser writes to contracts and payments remain denied. Dispatch the existing release workflow from `main` with an immutable candidate SHA, because the production workload identity restricts the workflow ref. Recheck current main and live Rules immediately before any Rules publication so a concurrent release cannot be overwritten by an older candidate. Use the same revision/image/traffic gates for a scoped recovery deployment and retain its evidence.

The next runtime increment isolates the four reporting exports behind an exact `FUNCTION_TARGET` allowlist. Deployment discovery still registers all 571 exports; control API and scoped discovery flags always keep their existing paths. Runtime and discovery share the reporting factory, preserving authorization, App Check, named database, region and resource options. The local [runtime benchmark](../../ops/reporting-runtime-benchmark-20261030.json) records 917→668 loaded modules and three fresh-process samples per target. These measurements do not establish production cold-start latency or billed savings. Release only the four reporting targets for this change and verify the actual image/revision receiving traffic; do not republish global Rules or unrelated functions for initialization-only changes.

Offline nutrition quality evaluation accepts private, human-reviewed references and saved predictions:

```sh
node scripts/evaluate-nutrition-quality.cjs PRIVATE_REFERENCES.json PRIVATE_PREDICTIONS.json
```

Each reference needs an anonymous `caseId`, `reviewed: true`, `reviewedAt`, `reviewer`, `calories` and `grams`. Each prediction has the same `caseId`, `status`, and successful `calories`/`grams`; duration/cost/review flag are optional. The output contains only aggregate error, completion, review and measured cost/latency. Never treat synthetic tests or client corrections as reviewed ground truth. No provider call, image upload or extra API key is involved.

Production follow-up still requires a representative observation window, a reviewed photo benchmark, a budgeted live-provider load test, real iOS verification, and backup/restore evidence in an isolated recovery environment. These are not inferred from passing local tests; do not restore over production or mark an unknown backup state as healthy.

CI investigation on 2026-10-30, before merging PR #79: `pt-schedule-off-confirmation.integration.cjs` can intermittently receive `3 INVALID_ARGUMENT: Transaction is invalid or closed` from the Firestore emulator during the second of two simultaneous charges. Baseline `af311e9` reproduced this in two of three isolated probes; the optimized source passed three of three. Emulator logs show its transaction manager attempting to reactivate a closed transaction. At that comparison point the billing/admin-edit code and fixture were unchanged, and the extracted pure helper bodies matched baseline. Keep the simultaneous calls and one-charge/one-ledger assertions intact; this evidence does not justify adding blanket retries to production writes. Investigate recurring failures separately from functional assertion failures.

