# Aura Domain Map

Aura is organized around five cooperating operating systems:

1. **Customer OS** — lead, contract, Student 360, retention, renew and referral.
2. **Training OS** — assessment, program, workout, progress and nutrition.
3. **Scheduling OS** — availability, optimize, publish, check-in, change/cancel and attendance.
4. **PT OS** — schedule, student portfolio, tasks, quality, KPI and commission.
5. **Business OS** — revenue, cashbook, payroll, KPI, branch performance and forecast.

Shared infrastructure is identity, contract usage, audit, operational actions and analytics.

## Dependency direction

```text
identity/policy -> domain repositories -> projections -> callable APIs -> UI surfaces
```

UI modules must not read another domain's internal repository directly. Cross-domain data is exposed through a typed query/projection or an existing callable adapter.

## Current implementation anchors

- Schedule: `functions/pt-schedule-v2.js` and `docs/scheduling-optimizer-v12-2026-09-06.md`.
- Usage: `functions/contract-usage.js`.
- Student 360: `functions/student-360.js`, `src/features/student-360`.
- Operations: `functions/operations-dashboard.js`.
- Identity and capabilities: `functions/identity-access.js`, `shared/identity/identity-contract.json`.
- Client telemetry: `functions/observability.js`, `src/services/clientTelemetryService.ts`.

