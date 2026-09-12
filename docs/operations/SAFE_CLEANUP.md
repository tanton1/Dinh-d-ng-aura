# Safe source cleanup — 2026-09-09

## Scope and recovery

This cleanup removes 41 unreachable frontend modules (559,469 source bytes) and 161 one-off root patch scripts. No live page, production collection, Cloud Function, Storage object, Auth account, user cache or unsaved draft is bulk-deleted.

Recovery baseline: `cbf1146c99459e073b76ee3931998bbc1fa58a64`.

- `scripts/legacy-surfaces-manifest.json`: source path, exact Git blob, size and baseline commit.
- `scripts/archive-manifest.json`: original script path, SHA-256, last-change commit and exact recovery blob.
- Inspect a retired file using `git show <sourceCommit>:<path>` or `git show <archiveBlob>`. Restore only the reviewed file into an isolated worktree; do not run historical patch scripts against the current app. Do not reset the workspace or restore all archived files.

## Verification basis

Source reachability was checked from `src/main.tsx`, following static imports, exports, lazy imports and `new URL` worker references. Exclusive orphan subtrees were reviewed together. Canonical route components, shared styles, public barrel exports and the active scheduler worker are retained.

Root patch scripts have no references from retained runtime code, package scripts, CI or deployment configuration. Cross-references within the retired group and historical documentation do not make them runtime dependencies. The dependency graph is evidence for this specific deletion set, not a blanket rule to delete every module with no imports.

Tests formerly coupled to dead files now protect Student 360 contract commands, the live dashboard, Training History and Operations Request Center. Cleanup guards reject reintroduced retired paths without manifest review and require immutable recovery metadata. Route tests retain old bookmarks.

## Runtime change

Progress photo cache handling now accepts a server-confirmed `[]` as the authoritative result, updates both compatible keys, tolerates restricted storage, ignores late callbacks after unmount and remounts private photo/form state when the owner changes. Empty offline/pending-write/error snapshots cannot overwrite confirmed caches. The old keys are retained because the photo studio still uses them. This is not a migration or purge of unsaved photo drafts.

## Deliberately deferred

- Identity migration/apply, payment-to-ledger reconciliation, legacy photos, schedules, workout logs and contract-usage coverage.
- Removal of Regional/fallback endpoints: verify the actual Cloud Run traffic revision first. `ACTIVE` alone is insufficient.
- Broad collection listeners, Student 360 rebuild fan-out, duplicate nutrition-history loading and CSS coverage: separate measured performance changes.
- `classic-diary` and Nutrition Plan renderer consolidation: these still have live route/behavior contracts.
- No release rollout, push, deployment, feature flag change or production migration is included in this source-cleanup operation.

Unused source modules were already excluded from the browser build. Source bytes removed are not an equivalent reduction in network payload. Keep bundle/performance budgets and responsive route tests as the acceptance gate.
