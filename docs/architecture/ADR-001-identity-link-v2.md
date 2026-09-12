# ADR-001: Keep studentId and add a canonical account link

## Decision

Keep the existing CRM `studentId` as the business identifier. Add `students.accountUid` and the reverse `accountIdentityLinks/{accountUid}` index with uniqueness, status and audit fields. Do not introduce `AuraPersonId` in this migration.

## Rationale

This removes unsafe per-module identity guesses while preserving existing routes, contract references and production documents. A new global person key would require a larger migration without solving the immediate missing-link problem.

## Compatibility

Student 360 retains a read-only fallback through `roleAssignments.crmProfileId` until the dry-run/apply/verify migration proves all safe links canonical.

