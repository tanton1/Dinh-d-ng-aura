# Shared Finance category summary

Finance now builds the `all`, `installments`, `frozen`, and `debt` summaries from one source scan for a branch and report date. Switching categories reuses that snapshot within the existing three-minute cache TTL. Contract pages and student labels still run their existing bounded queries; this change does not eliminate those reads.

## Runtime and compatibility

`functions/scoped-reporting-reads.js` uses the internal cache key `receivables-v5-<sha256([branch,today])>`. Its stored value contains `categorySummaries`, `source`, `sourceDocuments`, and `asOf`. The callable returns only the selected category's existing flat `complete`, optional `reason`, `totals`, and `counts`, followed by the existing source/time/cache metadata. No category map or new response field reaches the client.

- `summarizeReceivables` remains the canonical calculation used for equality tests. The new single-pass builder computes each eligible row's debt state once, then updates the combined and applicable category totals.
- A malformed eligible row makes every category explicitly unknown. An arithmetic overflow affects only the categories whose totals overflow; a finite category remains usable even if the combined total overflows. Valid empty categories remain complete with zero totals/counts.
- The 25,000-document summary limit, 500-document summary pages, cancelled-contract exclusion, preservation dates, cash-balance formulas and unassigned-branch behavior remain unchanged. The limit is checked before filtering unassigned rows, as before.
- Current authorization still runs before page/cache reads. Only the existing admin/super-admin Finance audience can use this callable. No access policy, admission wrapper, callable export or region changes.
- Page cursors retain the `finance-receivables-v4` scope, including actor, authorization revision, branch, date, category, filter and search. A cursor cannot cross categories even though the summary cache can. `includeSummary:false` still bypasses the summary cache entirely.
- Summary generation still runs inside one read-only transaction. The existing shared cache owns the lease, refresh read-time fence, publication and release. A refresh in any category rebuilds all categories. A refresh after a payment cannot reuse a source snapshot taken before its authoritative refresh read, even if that older builder publishes afterward.

## Migration and freshness

The v5 key namespace is the payload-schema migration. Shared-cache envelope schema 3 stays unchanged. Old v4 category documents are neither read nor rewritten by the new runtime; existing generic `expiresAt` retention/TTL cleanup handles them. No backfill, index, cache purge or new scheduled function is required.

Manual refresh and the existing post-transaction refresh flow continue sending `refresh:true`. Other writers do not trigger automatic invalidation; cached summaries may remain stale for up to the existing three-minute TTL. Page rows are read separately from the summary and can therefore be newer than `summary.asOf`. A first visit to another category now intentionally retains the same summary snapshot until refresh/expiry, rather than triggering a separate scan.

During mixed-revision rollout, v4 and v5 caches can coexist and build independently. Rolling back to v4 uses its own cache again; manual refresh remains available and old values are subject to their original TTL. Preserve the existing source-time publication fence and selected-category response contract in any rollback or subsequent optimization.

## Measured category-switch fixture

The same local fixture contains 5,501 positive-debt contracts in branch A, one excluded branch-B sentinel, distinct student labels and page size 20. It opens `all` cold, repeats `all` warm, then switches to `installments`, `frozen`, and `debt`, with no mutation or explicit refresh between those calls. The installment/frozen categories are empty in this fixture, so their unchanged page queries inspect the 200-document cap.

The negative control used the unchanged production runtime from `5e5337036207d48016fdadeceef29ed0a88b726c` plus the category measurement test. It saved its counters and then failed the expected assertion that the first category switch should be a shared-cache hit. The candidate passed that same assertion and the semantic/boundedness gates. These are actual SDK observations from the two local runs, not a modeled historical baseline.

| Phase | Previous source document snapshots | Shared-summary source document snapshots | Previous / new read-only summary transactions |
| --- | ---: | ---: | ---: |
| All, cold | 5,521 | 5,521 | 1 / 1 |
| All, warm | 20 | 20 | 0 / 0 |
| Switch to installments | 5,701 | 200 | 1 / 0 |
| Switch to frozen | 5,701 | 200 | 1 / 0 |
| Switch to debt | 5,521 | 20 | 1 / 0 |

The three switches avoid three 5,501-document summary scans: 16,503 fewer returned source snapshots for this sequence. Each switch also changes from two committed cache writes to zero. Label reads are unchanged: zero on each empty category and 20 on debt. Cold summary work remains one full scan; this is not an improvement to the cold source-read count.

The extended `functions/scoped-reporting-read-budget.integration.cjs` records every phase, authorization/cache/source/label counters, source binding and limitations in an ignored JSON artifact. See [the read-budget fixture](REPORTING_READ_BUDGET_2026-10-30.md) for the observer definitions and existing cold/warm payload comparison. Counts do not measure billed reads, index entries, network retries, production latency or invoice savings. This distribution does not establish results for arbitrary search, category populations, traffic or concurrency.

## Verification

- 32 focused unit/runtime/observer/cache tests passed. Equality cases cover branches, date boundaries, limit handling, excluded malformed records, unknown rows, valid zeros and per-category overflow. The real entry point is checked in both discovery and targeted runtime modes with a v5 cached payload.
- 18 emulator tests passed. They include concurrent different-category cold misses and forced refreshes sharing one build, post-payment refresh rejecting a late older snapshot, multi-page snapshot consistency, old v4 coexistence, unknown-to-zero recovery, category cursor fences, cash mutation flows and the measured read-budget fixture.
- Existing test groups already include these files; no package script or CI change is required. Frontend type checking and Functions syntax checks are also run before handoff.

To reproduce with installed dependencies, Java 21 and the installed Firebase CLI 15.9.1:

```powershell
node --test functions/scoped-reporting-reads.test.js functions/reporting-read-runtime.test.js functions/operations-dashboard-cache.test.js functions/reporting-read-budget-observer.test.js
$env:METADATA_SERVER_DETECTION = 'none'
$financeFirebaseCli = Join-Path (npm root --global) 'firebase-tools/lib/bin/firebase.js'
node $financeFirebaseCli emulators:exec --only firestore --project demo-aura-fitness "node --test --test-concurrency=1 functions/scoped-reporting-reads.integration.cjs functions/operations-dashboard-cache.integration.cjs functions/scoped-reporting-read-budget.integration.cjs"
```

Only the local demo emulator is used; no production data, cloud deployment or billing query is part of this evidence.
