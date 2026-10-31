# Finance reconciliation workspace

The period report opens with a shared date/branch/source filter, four financial totals, and three reconciliation groups: needs action, matched, and excluded. The cash-flow analysis and source table expand on demand. Informational integrations are separate from actionable exceptions.

The report optionally returns attendance IDs grouped by the same classifier that computes its totals. This adds no Firestore query. Opening a group loads at most 25 evidence rows and their display names; opening one case loads its current contract, original revenue owner, linked ledger entries across periods, and last 20 decisions. There is no polling timer. Scope changes, explicit refresh, and successful decisions refresh the appropriate data. Read-only regional aliases share authorization and the named database with the primary handlers; writes use the primary endpoint only.

## Loading and read budget

The finance tabs are ordered **Trả góp → Sổ quỹ → Báo cáo kỳ**. Installments open by default. Only the active panel mounts, and each panel's code is loaded dynamically. Keyboard arrows move focus; Enter, Space or a click activates the tab. Focusing or preloading the finance route does not request the period report. Changing account or authorization remounts the workspace and discards the previous data and outstanding responses.

The period report initially covers the last **7 calendar days in Vietnam, including today**. Its first request starts only when the report tab opens. Custom dates are drafts until **Áp dụng khoảng ngày** is pressed, so editing two fields produces one scope change. StrictMode's discarded effect does not start a report request. Cash-flow charts are a separate dynamic module that loads and mounts only when their section expands; charts use the report already loaded and make no additional data request. Reopening the report reads fresh data, as do filter changes, explicit refresh and successful reconciliation decisions. There is no interval refresh or completed-result browser cache that could hide a new financial transaction.

The default installment panel requests a bounded window of 20 matching profiles, with at most three source pages per foreground fill. Subsequent pages omit summary rebuilding. Its branch/day summary is shared on the server, with rebuild coalescing and invalidation after financial changes. Contract ledger history loads only when expanded, and payment accounts only when opening payment. The cashbook reads only its selected inner tab in 25-row pages; transaction catalogs wait until a transaction dialog opens. The global finance route listens to branches, not the complete student, contract or attendance collections.

Read-only source counts measured on 2026-10-31 (all branches, all sources) illustrate the report's remaining cost:

| Source | 7 days (25–31 Oct) | 30 days (2–31 Oct) |
| --- | ---: | ---: |
| Ledger entries | 382 | 1,585 |
| Cash transactions | 18 | 35 |
| Attendance evidence | 366 | 1,600 |
| Paid payroll runs | 0 | 0 |
| Contract metadata | 415 | 415 |
| Cash accounts | 2 | 2 |
| Total source documents | **1,183** | **3,637** |

These aggregate counts imply about 67.5% fewer source documents for this seven-day report, not a measured reduction in billed reads or money. Billing export is unavailable. Authorization reads, indexes, empty queries, concurrent changes, cache hits and display-name reads are outside this comparison. Opening installments now causes zero **period-report** calls; installments still have their own bounded reads.

The report's ledger, cash, attendance and payroll queries are date-bounded. The follow-up [contract sales range rollout](contract-sales-range.md) adds canonical date metadata, indexed period reads and explicit exceptional-contract diagnostics. Until its coverage and serving-revision checks pass, contract sales retain the original bounded branch-wide scan. This optimization does not change financial amounts or the cancellation baseline policy.

## Decisions

- **Acknowledge** records who reviewed the case and why. It does not close a financial exception or change attendance, credits, cash, or revenue. Changed source evidence invalidates the earlier acknowledgement.
- **Recognize** uses the existing charged-session revenue planner, including original carried-credit value, balanced journal, duplicate/ordinal checks, and finance-period protections.
- **Confirm zero value** explicitly validates one already-consumed entitlement against the financial owner's zero net value. It retains the deduction and original attendance, records approval against the exact allocation, and creates no fictitious positive or zero journal. Later attendance confirmation preserves this outcome only while its evidence key still matches. A valid return restores the credit once without creating a cash refund.
- **Exempt** is available only for a reviewed, unconsumed session with no billing receipt, ledger entry, or contract usage-array membership. A retained historical ordinal requires a complete canonical usage comparison against the contract counter; the audit records this proof. No second refund is issued. Finalized payroll and locked financial periods block the change.
- **Assign contract** offers only the learner's eligible, untransferred contracts that cover the original session date and have remaining quota. Confirmation rechecks daily duplicates and free service ordinals, atomically consumes one credit, posts revenue, and resolves the old issue. It never changes the original attendance or cash.
- Attendance corrections and charged-session returns link to the existing training-history workflow. Contract evidence links to Student 360. Price corrections still require the established contract/accounting controls; this screen does not allow arbitrary repricing of consumed entitlements.

Mutation requires a current finance-admin role, a reason, a preview token covering source document versions, and a request ID. The server re-reads evidence transactionally; concurrent or stale decisions fail without partial changes. Same-request retries return the existing receipt. Audit receipts live under `financeReconciliationCases/{attendanceId}/actions/{requestId}` and remain server-controlled. Draft payroll is marked for rebuild when evidence affecting it changes.

## Verification and rollout

- `functions/finance-reconciliation.integration.cjs`: concurrency, stale evidence, authorization, quota reassignment, free-value confirmation, returns, immutable periods and payroll.
- `functions/pt-charged-revenue.integration.cjs`: original deduction/recognition/return regression suite.
- `tests/finance-reconciliation-ui`: bounded reads, idle network behavior, mobile/desktop layout, preview and reason requirements.
- `tests/finance-history-ui/performance-reads.spec.ts`: report races, partial-data handling, signed values and historical analytics.
- `tests/finance-history-ui/demand-tabs.spec.ts`: tab order/defaults, manual activation, seven-day scope, idle read counts, deferred chart loading, staged date changes and account isolation.

Deploy the new read/write endpoints, reporting endpoints and existing entry points that call the shared charged-revenue/return planner before the web release. Verify the actual ready revision, immutable image, and serving traffic. Deployment alone does not approve the outstanding real zero-value contracts or quota exceptions; an administrator must review their evidence and choose a decision.
