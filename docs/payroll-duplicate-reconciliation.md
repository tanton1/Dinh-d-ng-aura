# Payroll duplicate reconciliation

Payroll creation, live validation and attendance-based teaching slots use the same exclusions: cancelled schedules, explicitly ineligible/makeup teaching, and reconciled duplicates with a retained-session link, exempt/void billing and no entitlement deduction. Complimentary teaching without duplicate proof remains eligible. Unresolved learner-day conflicts still block creation.

An overdue charged session that the system confirms as present after 48 hours counts as a completed PT teaching slot. Any separate revenue-recognition review remains visible to Finance, but it no longer removes that session from PT pay. Manually confirmed sessions with unresolved recognition evidence continue to wait for review.

Session projections include every eligibility field in both creation and validation; the validation fingerprint includes those fields. Reviewed/paid payroll is not rewritten by this change.

The payroll remediation dialog passes `focusSessionId` to training history. Only operations administrators may request this raw record. Owner/date filters remain enforced, cursor scope includes the selected session, and normal history retains its existing canonical grouping. Saving a correction clears the obsolete creation error; the administrator explicitly retries creation against fresh data.

## Production reconciliation, 4 November 2026

The October audit found 36 learner-day conflicts: 21 duplicate charges already voided by finance, 14 legacy records alongside a newer charged session, and one pair of legacy records without sufficient evidence to choose a trainer/time. The user confirmed retaining the newer charged sessions for the 14-row cohort.

Thirty-five duplicate session records were cancelled atomically, marked ineligible for teaching pay and linked to their retained session. Corresponding attendance evidence was marked ineligible without changing attendance confirmations. Each change has a `payrollReconciliationRepairs` receipt and a private before-state backup. Preconditions checked the unchanged source/winner, void billing or absence of legacy financial evidence, unlocked period, and identical canonical charged-session IDs before/after.

The user subsequently selected the afternoon session for the remaining legacy pair. A separate audited transaction cancelled the morning copy, verified both rows had no attendance/billing/ledger entries, and preserved the contract's 13 used sessions. No cash, revenue amounts or posted payroll were changed. A fresh October read of 2,016 source documents found **zero duplicate learner-day violations**, including when using the previously deployed creation projection.

Regression coverage: cancelled/void duplicates versus genuine complimentary teaching; real Firestore projections for creation/validation; selected raw history access and ownership; browser correction flow without additional contract-usage reads.
