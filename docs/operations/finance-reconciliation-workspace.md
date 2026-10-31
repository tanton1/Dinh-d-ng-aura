# Finance reconciliation workspace

The period report opens with a shared date/branch/source filter, four financial totals, and three reconciliation groups: needs action, matched, and excluded. The cash-flow analysis and source table expand on demand. Informational integrations are separate from actionable exceptions.

The report optionally returns attendance IDs grouped by the same classifier that computes its totals. This adds no Firestore query. Opening a group loads at most 25 evidence rows and their display names; opening one case loads its current contract, original revenue owner, linked ledger entries across periods, and last 20 decisions. There is no polling timer. Scope changes, explicit refresh, and successful decisions refresh the appropriate data. Read-only regional aliases share authorization and the named database with the primary handlers; writes use the primary endpoint only.

## Decisions

- **Acknowledge** records who reviewed the case and why. It does not close a financial exception or change attendance, credits, cash, or revenue. Changed source evidence invalidates the earlier acknowledgement.
- **Recognize** uses the existing charged-session revenue planner, including original carried-credit value, balanced journal, duplicate/ordinal checks, and finance-period protections.
- **Confirm zero value** explicitly validates one already-consumed entitlement against the financial owner's zero net value. It retains the deduction and original attendance, records approval against the exact allocation, and creates no fictitious positive or zero journal. Later attendance confirmation preserves this outcome only while its evidence key still matches. A valid return restores the credit once without creating a cash refund.
- **Exempt** is available only for a reviewed, unconsumed session with no billing receipt, ledger entry, ordinal, or contract usage-array membership. No second refund is issued. Finalized payroll and locked financial periods block the change.
- **Assign contract** offers only the learner's eligible, untransferred contracts that cover the original session date and have remaining quota. Confirmation rechecks daily duplicates and free service ordinals, atomically consumes one credit, posts revenue, and resolves the old issue. It never changes the original attendance or cash.
- Attendance corrections and charged-session returns link to the existing training-history workflow. Contract evidence links to Student 360. Price corrections still require the established contract/accounting controls; this screen does not allow arbitrary repricing of consumed entitlements.

Mutation requires a current finance-admin role, a reason, a preview token covering source document versions, and a request ID. The server re-reads evidence transactionally; concurrent or stale decisions fail without partial changes. Same-request retries return the existing receipt. Audit receipts live under `financeReconciliationCases/{attendanceId}/actions/{requestId}` and remain server-controlled. Draft payroll is marked for rebuild when evidence affecting it changes.

## Verification and rollout

- `functions/finance-reconciliation.integration.cjs`: concurrency, stale evidence, authorization, quota reassignment, free-value confirmation, returns, immutable periods and payroll.
- `functions/pt-charged-revenue.integration.cjs`: original deduction/recognition/return regression suite.
- `tests/finance-reconciliation-ui`: bounded reads, idle network behavior, mobile/desktop layout, preview and reason requirements.
- `tests/finance-history-ui/performance-reads.spec.ts`: report races, partial-data handling, signed values and historical analytics.

Deploy the new read/write endpoints, reporting endpoints and existing entry points that call the shared charged-revenue/return planner before the web release. Verify the actual ready revision, immutable image, and serving traffic. Deployment alone does not approve the outstanding real zero-value contracts or quota exceptions; an administrator must review their evidence and choose a decision.
