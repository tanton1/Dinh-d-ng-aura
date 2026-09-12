# Aura Canonical Data Model

## Identity link V2

`studentId` remains the CRM/business identity. A verified account link is explicit and bidirectional:

```text
students/{studentId}.accountUid
accountIdentityLinks/{accountUid}.studentId
```

The link is unique, auditable and can be `linked`, `unlinked` or `quarantined`. Names are never used as an identity key.

## Contract usage

The source is session/attendance evidence plus the contract projection maintained by `contract-usage.js`. `legacyProjectionAdjustment` is retained as a visible reconciliation field until old sessions are mapped; it is never silently discarded.

## Operational actions

`operationalActions/{actionId}` is a durable, redacted projection. Its deterministic source key prevents duplicate tasks when triggers retry. The source record remains authoritative.

## Projection rules

- Projections contain summaries, not photos, accounting evidence or full private journals.
- Rebuilds are idempotent and bounded.
- Every projection records schema/source version and `generatedAt`.
- Data-quality mismatches create an action instead of silently mutating source data.

