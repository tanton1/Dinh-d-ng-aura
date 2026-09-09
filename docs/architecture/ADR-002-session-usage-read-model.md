# ADR-002: One contract usage read model, no second ledger

`contract-usage.js` and the existing contract/session evidence remain canonical. A bounded `contractUsageViews/{contractId}` projection will serve Student 360, renew, KPI and schedule warnings. Legacy adjustments remain explicit and auditable.

