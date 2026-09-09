# Aura production observability

Aura uses Google Cloud native telemetry. Every new callable should use the fields below in structured logs:

```json
{
  "schemaVersion": 1,
  "correlationId": "request-scoped-id",
  "domain": "schedule|student360|contract|action|identity",
  "operation": "callable-or-trigger-name",
  "outcome": "success|error",
  "errorCode": "BUSINESS_RULE|PERMISSION|INTERNAL",
  "retryable": false,
  "durationMs": 0
}
```

Recommended Cloud Monitoring views:

- callable p95 latency and error rate by `domain`/`operation`;
- Student 360 and Action Center route failures;
- projection freshness for `studentOperationalViews`, `contractUsageViews` and `operationalActions`;
- contract usage mismatch count;
- schedule optimizer completion, search-limit and unassigned-reason counts;
- client incident rate by normalized code.

Roll back a surface or read-model switch when a route fails above 0.5%, JavaScript errors exceed 1% of sessions, financial/contract values diverge, or a projection exposes data outside the actor scope.

