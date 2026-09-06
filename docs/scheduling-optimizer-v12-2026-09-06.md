# Scheduling v12 — 2026-09-06

## Scope and policy

Learner coverage and requested sessions first, then complete weekly targets, pairing, assigned PT/employment policy, consecutive PT blocks and soft load balance. Eight distinct trainer/day/time slots is a target, not a limit or a confirmation gate. Capacity, contract dates/quota, approved leave and one learner session/day remain hard safety checks. Spacing three consecutive learner days remains a soft assignment preference; compaction does not introduce a new three-day run.

Modes: `optimize` rebuilds mutable automatic draft entries, retaining manual entries/confirmed exceptions, locks, OFF and published workload. `supplement` keeps all entries and only adds. `continue` starts from the current schedule, attempts pairing/coverage/relocation with a 36,000-node budget per deep pass (12,000 for normal optimize) and rotated search order. The search is bounded and does not claim a global optimum or guarantee all requests can be satisfied.

## Fixed defects

- Slot candidates retain the authenticated actor, avoiding `ReferenceError` and internal failures.
- Manual loader applies the week's target override; scoped add/move never discards other learners' overrides.
- Move validates a unique source, supports changing PT in the same cell, commits source removal and destination insertion together, and replays receipts before revalidation. Failed moves leave the source unchanged.
- Locked/past/published sessions are not destructively changed through draft commands; published sessions require the audited session-adjustment workflow.
- Contract reservations match session identities (contract, learner, slot, physical branch) instead of source strings, preventing double-counting a published session also mirrored in a locked/manual draft.
- Current-week generation excludes elapsed slots. Mutation and generation compare loaded draft revision and commit revision.
- Workspace reads return the same published+draft workload used by coverage metrics.
- UI scope guards, account/version-scoped caches, full-input fingerprints, branch/week disabling during writes and removal of `TRAINER_NOT_ASSIGNED` as a false missing-student fallback.

## Optimizer changes

- Repair can free branch capacity even when individual PT slots are not full, reserving the freed seat before relocating its occupant.
- Search selects the best bounded candidates across scanned slots, not simply the first chronological cells. A per-learner budget prevents one difficult learner consuming the entire pass.
- Compaction can move two mutable singles into a third shared empty slot.
- An incumbent valid draft is retained/continued when rebuilding would reduce the coverage/target/pairing score. Comparison reports before/after sessions, completed learners and paired classes.
- Reservation accounting is indexed per scheduling state; hypothetical schedules do not share stale quota-cache results.

## UI and tests

Toolbar: Xếp tối ưu; Tối ưu tiếp; extra menu → Bổ sung lịch thiếu. Inspector provides explicit transfer confirmation and keeps the form on failure. Publish validation includes named learner/PT/slot details and opens the corresponding inspector without navigation.

New callable/transaction regression suite and seeded continuation invariants; production `BranchScheduleWorkspace` UI fixture (not legacy demo) tests 360/390/430px, manual confirmation, transfer failure/retry and publish-error popup. Test adapters exist only in the standalone Vite test config. CI and release workflow run `test:schedule-ui`.

Synthetic local run: 40 students / 5 PT: 118 of 120 requested sessions, 58 paired classes, ~134ms. 100 students / 5 PT: 236 of 300 sessions, 118 paired classes, ~1284ms. These random fixtures are not live branch results and are not proof of optimality.

## Deployment / limitations

Deploy only changed schedule endpoints: getPtScheduleWorkspace, getPtScheduleSlotCandidates, applyPtScheduleDraftCommand, generatePtScheduleDraft, generatePtScheduleDraftV4 (asia-east1), validatePtScheduleDraft and publishPtSchedule. No production schedule generation, migration, historical rewrite, Auth/Rules change or old-project writes are part of release verification.

Still bounded by 440 learner entries, Firestore transaction write budget and source query limits. Background job/checkpoint architecture, global constraint solving, full source-version transactions and large-branch pagination are future work. Automatic retry may stop without improvement when input capacity is exhausted.

Rollback by redeploying the previous reviewed code revision, never by deleting draft/session history. Added response fields and mode inputs are backward compatible.
