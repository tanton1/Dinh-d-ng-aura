# ADR-004: Contract actions stay in the Student 360 workspace

Renew, extension, freeze, payment and refund commands continue to use existing server policies. Student 360 may lazy-load the contract workspace, but must not duplicate contract mutation logic in the UI or Action Center.

The create-contract action suggests a linked renewal when the learner already has a contract. A bounded, authorized `prepareContractRenewal` call refreshes the selected source case without waiting for the nightly sales queue. Quote, approval, collection and idempotency checks still apply when selling the renewal.

Renewals have two activation modes: `automatic` (default, source quota exhausted or source term ended) and `fixed_date` (no early activation). The source end date is inclusive, so an automatic continuation normally starts the next calendar day. Store the sale date, planned activation date, original sold dates and actual activation date separately. Opening early preserves the sold end date. Preservation blocks handover; extending/reopening the source updates a waiting automatic renewal's planned dates without silently moving payment instalments.

Pending carry-over is a quoted maximum, not spendable entitlement. At handover, read canonical session evidence in the transaction and transfer at most the actual unused source quota and the quoted maximum. Record the transfer on both contracts and exclude the transferred quota from source availability. The source stays terminal after handover, with an explicit completion reason.

`contract-renewal-handover.js` owns the shared handover plan used by billing, chargeable cancellation and the daily recovery worker. The last actual source charge and the first renewal charge perform handover in the same transaction. Reservation alone never activates a renewal. If cancellation frees a source entitlement, resolve the next actual charge back to the source and record any contract reassignment. Free cancellation/rescheduling may validate a pending renewal reservation without activating it.

Validation: `node --test functions/contract-renewal-handover.test.js`, `npx tsx --test tests/student-eligibility.test.ts`, and `npx playwright test --config playwright.renewal.config.ts`. The browser fixture mocks the service boundary and never writes production contracts or payments.

