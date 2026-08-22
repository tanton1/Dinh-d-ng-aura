# Firebase migration staging report — 2026-08-19

## Scope and safety boundary

- Source project: `gen-lang-client-0246058381`
- Source Firestore database: `aura-fitness-db`
- Target project: `gen-lang-client-0815966909`
- Target production database: `ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7`
- Target staging database: `aura-migration-staging-20260819`
- Migration bucket: `aura-migration-607039870489-20260819`

No source document, Authentication account, Storage object, Rules, Function, Hosting release, App Check configuration, or notification configuration was written, updated, or deleted. The source operation was a PITR export at `2026-08-19T13:39:00Z` into a bucket owned by the target project.

No source data was merged into the target production database during this phase.

## Infrastructure checks

- Billing is enabled and a billing account is attached to both projects.
- Source and target Firestore databases are Enterprise/Native in `asia-southeast1`.
- Source PITR is enabled with a seven-day retention window.
- Staging was created with PITR and delete protection enabled.
- The migration bucket uses uniform bucket-level access and object versioning.
- The target production database was exported before staging work began.

## Firestore inventory

The source snapshot contains 10,966 documents across 17 root collections and 18 populated collection groups.

| Collection group | Documents |
| --- | ---: |
| `branches` | 2 |
| `contracts` | 311 |
| `dailyCheckins` | 10 |
| `healthyDishes` | 400 |
| `leaveRequests` | 3 |
| `mealPlans` | 2 |
| `packages` | 11 |
| `payments` | 436 |
| `progress_photos` | 2 |
| `schedules` | 27 |
| `sessionRequests` | 1 |
| `sessions` | 9,131 |
| `settings` | 1 |
| `staff` | 10 |
| `students` | 296 |
| `trainers` | 9 |
| `users` | 310 |
| `workoutLogs` | 4 |

### Import validation

- Source export completed: 10,966 documents.
- Staging import completed: 10,966 documents.
- Collection-group count differences: 0.
- Full content hash comparisons: 18/18 exact matches.
- Source document paths colliding with target production: 0.
- Project-bound source references or bucket URLs found in staging: 0.
- Current target indexes deployed to staging: 9.
- Firestore Rules compiled and released to staging successfully.

The target production backup captured 1,161 documents before the staging import.

## Authentication inventory

| Metric | Source | Target |
| --- | ---: | ---: |
| Accounts | 333 | 37 |
| Password accounts | 333 | — |
| Google-linked accounts | 0 | — |
| Phone accounts | 0 | — |
| Accounts with custom claims | 0 | — |

There is one email collision: `nhattank16.1@gmail.com`. The source and target accounts have different UIDs. There are no UID or phone-number collisions.

Authentication is project-wide and cannot be isolated by a named Firestore staging database. Therefore, source users were exported only for a hashed collision audit; they were not imported into target Authentication. The plaintext temporary Auth exports were deleted immediately after the audit.

Recommended production policy:

1. Preserve the existing target UID and admin/custom claims for `nhattank16.1@gmail.com`.
2. Map any source profile/history belonging to the old admin UID to the target admin UID through an explicit transform.
3. Import the remaining non-conflicting password accounts with their original UIDs and Firebase SCRYPT hash parameters.
4. Require a fresh login after cutover; existing source sessions are not portable.

## Storage and Realtime Database

The source project has no Firebase user-media bucket. Its only Cloud Storage object is an AI Studio compiled build artifact:

`services/aura-meal-plan/version-1/compiled/build_artifacts.tar.gz`

It is not referenced by application Firestore data and was not copied into the target app bucket. No avatars, nutrition scans, progress photos, course media, or recipe images exist in source Storage.

Neither project currently has a Realtime Database instance, so there is no live-delivery GPS data to stage.

## Verification results

- Production build: passed.
- Cloud Functions contract/unit tests: 107 passed, 0 failed.
- Firestore Rules server compilation: passed.
- Firestore Rules emulator test: not executed because Java is not installed on the workstation.
- Staging document count and hash verification: passed.
- Staging index deployment: passed.

## Remaining gate before production merge

1. Approve the admin UID mapping policy.
2. Decide whether all legacy operational collections should be merged unchanged or transformed into the newer PT model.
3. Create the production Auth import package using a fresh source export and protected SCRYPT parameters.
4. Take a new PITR snapshot immediately before the production merge because the old project remains live and changes after `2026-08-19T13:39:00Z` are not present in staging.
5. Run the production merge in idempotent batches and revalidate counts, Auth login, roles, schedules, payments, courses, nutrition, and notifications.

The source project should remain online and unchanged throughout the next phase.
