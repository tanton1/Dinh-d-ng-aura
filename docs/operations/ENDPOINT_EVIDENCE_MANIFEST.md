# Offline endpoint evidence manifest

`scripts/build-endpoint-manifest.cjs` joins existing evidence; it does not query cloud APIs, import business handlers, deploy, change traffic, or determine retirement eligibility. Every result has `deletionAllowed: false`.

Run from a stable checkout:

```sh
node scripts/build-endpoint-manifest.cjs --project=gen-lang-client-0815966909 --out=.migration-private/endpoints.json --sdk=.migration-private/sdk.json --inventory=.migration-private/inventory.json --health=.migration-private/health.json
```

Evidence options may repeat (maximum 30 inputs, 20 MiB each). Optional `--activity`, `--telemetry`, `--review` and `--historical` accept existing request-window, operation-baseline, dependency-review and old routing-review JSON artifacts. Output is restricted to ignored `tmp/` or `.migration-private/` JSON files and cannot overwrite an input. Do not commit private inventories or generated live evidence.

The CLI uses the existing TypeScript static auditor and lifecycle `sourceSnapshot` helper. It binds the fresh audit to both commit and content digest, checks the source again after analysis, and aborts if it changed. Tests inject a fixture snapshot only; normal CLI operation always reads the actual checkout. It does not execute application or backend modules.

## Inputs and provenance

- SDK: accepts the existing `{ exportName: { endpoint, trigger, ... } }` discovery map, `{ endpoints: map, project, observedAt, complete, source: { commit, digest } }`, or parity `matrix[].selectedEndpoints`. Only region and trigger kind are imported. Unbound raw maps remain unknown; selected parity entries do not establish complete export coverage. Exact current source binding is required for confirmed source regions.
- Inventory: existing audit schema `{ project, observedAt, complete?, warnings?, scope?: { regions }, functions: [{ name, region, service, kind, state, latestCreatedRevision, latestReadyRevision, traffic, servingHealth }] }`. Cloud mapping must be explicit. Missing project or another project is rejected. A successful listing is not a serving-container health check.
- Health: existing `cloud-run-functions-health` JSON. Join requires an unambiguous function-to-service mapping in inventory; never infer service identity by lowercasing a function name. An unhealthy latest release does not mark an older serving revision unhealthy.
- Activity: existing `{ windows: { key: { start, end, status, groups: [{ key: 'region/service', requests }] } } }`. Only explicit observations are retained. Windows are not added together, and absence of a series does not create a zero.
- Telemetry: schema v2 operation-baseline cohorts retain window, operation, service/region mapping, release, authentication, outcome and sample count. Sampled errors, including anonymous deployment probes, do not prove representative business use. Missing cohorts remain unknown.
- Review: the existing dependency-review shape must have matching `source`, `reviewed: true`, a reviewer and an explicit owner. Neither Git authors nor filenames assign ownership. Canonical mappings are accepted only as review/registry declarations.
- Historical: the prior routing review's `summary.latestNotServing` is retained only with its date and source commit in `historical[]`. The historical count of 252 is never treated as a current outage or inactivity count.

Each imported artifact records a content hash, observation time, source binding and completeness. Time evidence older than 24 hours is stale; missing/future timestamps are unknown. Partial inputs remain partial. Contradictory fresh values remain conflicting, with the evidence retained. Older observations are not silently upgraded by a new report timestamp.

Invalid or duplicate inventory identities, rows outside declared regions, malformed traffic, and cross-project/region/service resource references mark that entire inventory partial with `complete: false` and an invalid-row count. `cloudCoverage` reports each input's scope separately. Dropping an invalid row cannot create a claim of complete cloud coverage or confirmed endpoint absence.

Only whitelisted identity, location, status and numeric fields are emitted. Environment variables, tokens, business/request payloads, free-form errors, source expressions and arbitrary notes are never copied. SDK discovery must happen separately using the existing network-blocked capture workflow; this join never loads Firebase runtime modules.

## Interpretation

Rows are keyed by project, region and exact exported name. Regional, Overflow and V2 aliases remain distinct. `source-only`, `cloud-only` and `source-and-cloud` describe supplied evidence, not verified current deployment existence. Old SDK exports absent from both current static source and inventory are `sdk-only`. Source exports whose region is unresolved have a null region and are counted explicitly. A stale inventory cannot establish that an endpoint is currently absent.

Static handler modules and registration locations are candidates requiring review. Consumer references include conditional and fallback routes; dynamic sites and unresolved imports remain visible. SDK metadata distinguishes task queues from ordinary event triggers. No consumer edge, matching name, old lifecycle deadline or empty telemetry window authorizes deletion. Use the existing lifecycle evaluator and an attributed dependency review for that separate decision.

Validation: `node --test scripts/build-endpoint-manifest.test.cjs` (also included in `test:function-lifecycle`).
