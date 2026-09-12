# Aura Operating System — Current State

Last reviewed: 2026-09-12

## Navigation information architecture — 2026-09-12

- Shared navigation no longer advertises unfinished Admin Academy and online
  coaching areas: course catalogue/editor, Academy enrollment, online clients
  and online gym programmes. Their route implementations and data stay intact
  for compatibility and a later controlled rollout.
- Admin navigation now follows the operational sequence: Overview; Student &
  Care; Schedule & Training; Team & Performance; Finance & Services; Settings.
- Staff navigation now follows the daily workflow and remains filtered by the
  active staff position. Branch managers receive Renewals and Performance in
  their four-item mobile dock; lower-frequency tools stay in More.
- Member navigation separates health, schedule/training, and learning/services.
- Admin and Staff global search now opens the scoped canonical student
  directory instead of hidden Academy/online-coaching pages.

## Performance and surface audit — 2026-09-12

- The first measured cleanup moved Progress CSS, charts, photos, badges and AI
  behind route/interaction boundaries; the authenticated shell is 4.3 KiB gzip
  smaller and the Progress route JS is 12.8 KiB gzip smaller.
- Scheduler draft warnings are now a lightweight module. The demo/fallback
  optimizer is a separate 3.39 KiB gzip chunk and is no longer parsed just to
  open the schedule editor.
- Progress nutrition listeners now request the selected 7/30/90-day period
  instead of always opening a 90-day query on first load.
- Production prefetch now targets the canonical Eat Clean, Admin Finance and V2
  Schedule entries. Redirect-only routes no longer preload retired surfaces.
- Full findings and deletion gates are recorded in
  `APP_PERFORMANCE_AND_DUPLICATION_AUDIT_2026-09-12.md`.

## Safe source cleanup (local; not deployed)

- Removed 41 unreachable legacy TS/TSX modules and 161 one-off root patch scripts. Immutable Git blob/commit recovery references are recorded in `scripts/legacy-surfaces-manifest.json` and `scripts/archive-manifest.json`.
- Contract, finance and request UI contract tests now cover the live Student 360, Admin Dashboard and Operations Request Center instead of retired components.
- Kept all compatibility redirects, shared CSS, public export barrels, canonical business APIs and legacy production data fallbacks. No Firestore/Storage/Auth data, deployed Function, or migration was changed by this cleanup.
- Progress photo cache accepts empty snapshots and resets private component state by owner; old cache keys remain compatible with the photo studio.
- See `docs/operations/SAFE_CLEANUP.md` for recovery and remaining cleanup gates.

## Canonical capabilities

| Domain | Current source of truth | Read models / adapters |
| --- | --- | --- |
| Learner identity | `students/{studentId}`, `users/{accountUid}`, `roleAssignments/{uid}` | Identity Link V2 migration is ready; canonical reverse index is `accountIdentityLinks/{accountUid}`; legacy role-assignment fallback remains enabled |
| Contract usage | sessions/attendance plus `functions/contract-usage.js` | `contractUsageViews/{contractId}` dual-read rollout; bounded rebuild cursor; `legacyProjectionAdjustment` remains explicit |
| Finance | `ledgerEntries` | operations daily aggregates and finance dashboards |
| Student 360 | `studentOperationalViews/{studentId}` | overview, timeline, contract workspace; overview can consume durable actions when the Action Center flag is enabled |
| Timeline | `studentTimelineEvents` | append-only, role-redacted callable |
| Operations | dashboard `actionSummary` plus source domain records | `operationalActions/{actionId}` with claim/resolve/snooze lifecycle; UI rollout flag defaults to `off` |
| Scheduling | optimizer-v12 and schedule/session collections | bounded repair/rescue passes plus quality metadata; 8 sessions is a soft target |

## Rollout status

- **Release 0:** domain documentation, ADRs and repository hygiene checks are implemented.
- **Release 1:** the target-only Identity Link V2 migration supports dry-run, digest-gated apply/repair, verify and quarantine rollback. It has **not** been applied to production.
- **Release 2:** contract usage projection and callable adapters are implemented. Consumers keep a bounded fallback while dual-read reconciliation is observed.
- Renewal list/detail reads now overlay canonical usage. Carry-over sales rebuild and re-read `contractUsageViews` inside the renewal transaction; an unavailable or truncated canonical view fails closed instead of transferring a legacy count.
- **Release 3:** durable Action Center APIs, source triggers, audit trail and role-redacted Admin/Staff UI are implemented behind `action-center`. Schedule drafts create deterministic per-student tasks and classify contract/availability blockers before capacity or optimizer gaps. The UI now consumes cursor pagination and exposes claim, resolve and one-day snooze lifecycle actions. The flag remains `off` until pilot approval.
- **Release 4:** optimizer-v12 behavior is unchanged; quality output now includes bounded-search and unassigned-reason metadata.
- **Release 5:** strangler module split remains incremental. Existing exports and production adapters are retained.
- **Release 6:** request correlation and structured Cloud Logging fields are implemented; Monitoring dashboards and alert policies still require environment rollout.
- **P0 mutation hardening:** training packages now use `upsertTrainingPackage` and `archiveTrainingPackage` callable commands with capability checks, branch scope, optimistic revision, idempotency receipts and audit records. Browser package writes are denied; legacy package reads remain temporarily available to the Admin list.

## Remaining controlled debt

- Production identity linking requires an approved dry-run report and batch rollout; ambiguous matches remain quarantined.
- Contract usage fallback cannot be disabled until projection verification reaches the agreed safe coverage.
- Dashboard `actionSummary` remains for compatibility while Action Center pilot metrics are collected.
- Large domain modules and legacy root scripts need gradual strangler/archive work after reference verification.
- Admin quote generation, schedule settings, student edits and branch management use callable commands. Remaining work is paginated reads and production revision verification, not a new browser-write migration.
- Production release tooling resolves each deployed Function's actual Firebase region/service before promote, health-check and rollback; it no longer assumes every Function is in `asia-southeast1`.
- The route, capability, data-source and deprecation contract is tracked in `APP_SURFACE_INVENTORY.md`.

## Compatibility rules

- Existing callable names and route hashes remain supported during migration.
- Legacy identity fallback remains read-only until identity-link verification is complete.
- No source collection is deleted by a projection or migration.
- Feature flags default to the existing UI when configuration is unavailable.
- No production migration is run merely by deploying this code.
