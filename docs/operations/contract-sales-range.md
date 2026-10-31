# Contract sales range reads

The period report reads contract sales from a canonical Vietnam date index rather than loading every historical contract in the selected branch. It preserves the financial calculation in `contractSalesContribution`: `signedAt`, then `createdAt`, `contractDate`, or `startDate`; cancelled contracts require the original verified sales snapshot. Activation is not the signing date of a new renewal.

`financeSalesIndex = { schemaVersion: 1, key }` stores only query metadata. A dated contribution uses `YYYY-MM-DD`. `!missing_date` retains the incomplete-sales warning. `!cancelled_unverified` retains the cancellation diagnostic and contributes zero, consistent with the accepted historical policy. Draft, inactive and archived contracts use `!excluded`.

The report reads the period range plus exceptional contracts. Its 2,000-document cap is shared by both queries, and overflow is explicit. Branch filtering occurs before caps. The two coverage counts and selected documents share one read-only snapshot; an unindexed legacy create cannot race between the completeness check and range selection. A disabled gate, incomplete coverage, a stale selected index or a missing query index uses the original bounded scan. Transport and permission failures remain errors.

## Writes and downstream reads

Student 360 create/edit/cancel and renewal creation write the index in the same transaction as the contract. New contracts pin a server-generated signing instant, independent of future activation. Early handover and linked date changes caused by extensions/OFF/preservation also update the index atomically, including legacy contracts whose sale date falls back to activation.

The existing `syncContractUsageView` subscription repairs legacy/manual writes using the latest document in a transaction. It never replays an older event's date. Canonical events need no repair reads; metadata-only events skip contract usage, Student 360, workspace signals, weekly schedules, Action Center and aggregate rebuilds. No new function, subscription or polling loop is added.

The count guard detects unindexed documents, not every possible stale out-of-range date after an arbitrary Admin SDK edit. Such writes are outside the normal command path and converge through the repair trigger. Disable the gate before a bulk import, preserve the index atomically in import writers where possible, and verify full coverage/parity before re-enabling. Do not present the index as a guarantee against uncontrolled manual writes.

## Rollout and rollback

1. Run `node scripts/firebase-contract-sales-index.cjs plan`. The private, hashed plan contains IDs, prior query metadata and hashes of all non-index fields. No production records are written.
2. Create only the four reviewed indexes with `scripts/firebase-firestore-index-deploy.cjs` scope `contract-sales-range`; wait for READY. Keep `reportingIndexes/contract-sales-v1` absent/disabled.
3. Deploy every target in `ROLLOUT_TARGETS` in the migration script: readers, contract commands, shared handover callers, repair and metadata guards. Verify the immutable image, ready revision and 100% serving traffic of each target. Preserve the private proof with the exact release SHA.
4. Re-plan if live source evidence changed, then `node scripts/firebase-contract-sales-index.cjs apply <private-plan>`. Each bounded batch changes only `financeSalesIndex`, with update-time preconditions. Existing canonical entries are skipped. No price, payment, date, status, revision or cancellation baseline is altered.
5. `node scripts/firebase-contract-sales-index.cjs verify` compares the new query against the full source for every branch, rolling 7/30/90 days and all historical sale months in one read-only snapshot. It checks sales, counts, daily series and both exception diagnostics. Results stay in `.migration-private`.
6. `node scripts/firebase-contract-sales-index.cjs enable <private-deployment-proof> <release-sha>` requires all serving proofs and repeats parity verification before publishing the gate. Verify both callable aliases and observe a live report.

Rollback is `node scripts/firebase-contract-sales-index.cjs disable`. Reports immediately use the old bounded scan; harmless index metadata can remain. Disable before rolling command writers back, and do not remove the guards while backfilling.

## Read audit

Read-only planning on 31 October 2026 found 415 contracts: 407 dated and 8 cancelled without a verified original baseline, with no missing dates. Expected selected documents were 17 for 25–31 October, 43 for 2–31 October and 130 for 3 August–31 October, including the eight cancellation exceptions in every system report. The seven-day contract selection is about 95.9% smaller than the historical scan. There are also a gate read, two aggregate count queries, index/query charges and existing authorization/other report-source reads. Billing export is unavailable; this is not measured currency savings.

Tests cover exact Vietnam boundaries and legacy date precedence, zero-read metadata deliveries, latest-source repair, branch isolation, period caps, legacy and indexed callable parity, concurrent legacy creation, protected migration fields, retry safety, cancellation and future renewal creation. The indexed emulator suite is included in `test:data-cost-transaction`; unit guards run in Functions check/test.
