# Academy and Finance read-budget fixture

The paired Firestore-emulator measurement on 2026-10-30 passed the proposed target of reducing documents returned to the client by at least 80% against a **synthetic, complete full-list reference on the same fixture**. It does not measure the old UI, production traffic, billed reads or invoice savings. Runtime behavior is unchanged by this test-only increment; the production-source base is `0b553397f8f185f226817b2eb345839c48ade940`.

## Fixture and scope

- 5,501 active enrollments, 5,501 canonical progress records at 50% completion, and one course.
- 5,501 positive-debt contracts in branch A, each owing 800,000; one branch-B sentinel excluded from the report. Each domain has 5,501 distinct labels.
- First page of 20, no search, Finance category/filter `all`, fixed date `2026-10-30`.
- Cold means an empty shared summary cache; warm repeats the same requests immediately within the three-minute TTL. Neither phase changes data or forces refresh. Page and label reads execute in both phases.
- Academy opens summary plus enrollment page; Finance opens its page with summary. Full references run afterward, read all source records without a 5,000-row cap, and use current canonical summary formulas. Label transport is chunked without truncating the population.
- Seed writes, full-reference reads and authorization probes are outside the cold/warm counters. The full-reference learner counts, completion, finance totals and filter counts match the bounded APIs.

## Observed SDK boundaries

| Measurement | Academy cold | Academy warm | Finance cold | Finance warm |
| --- | ---: | ---: | ---: | ---: |
| Source query attempts/completions | 25 / 25 | 1 / 1 | 13 / 13 | 1 / 1 |
| Source document snapshots | 11,023 | 21 | 5,521 | 20 |
| Label point-read attempts/existing snapshots | 20 / 20 | 20 / 20 | 20 / 20 | 20 / 20 |
| Authorization point-read attempts/existing snapshots | 3 / 3 | 2 / 2 | 1 / 1 | 1 / 1 |
| Cache point-read attempts | 4 | 1 | 4 | 1 |
| Cache existing / missing snapshots | 2 / 2 | 1 / 0 | 2 / 2 | 1 / 0 |
| Cache write attempts / committed writes | 2 / 2 | 0 / 0 | 2 / 2 | 0 / 0 |
| Read-only transaction calls / callback attempts | 1 / 1 | 0 / 0 | 1 / 1 | 0 / 0 |
| Read-write transaction calls / callback attempts | 3 / 3 | 0 / 0 | 3 / 3 | 0 / 0 |

The source counts include the Academy page's extra sentinel document. Each label group above uses one `getAll` call. The profile is checked live on every handler invocation; the normal five-second assignment cache is shared across this sequential run, so Finance's authorization assignment was already warm. Authorization counts may change if that cache expires on a slower machine.

Native references and queries are unwrapped before invoking the SDK. A document's internal `getAll` implementation is therefore not counted twice. Transaction callbacks count every observed attempt; committed writes count only the final callback after successful `runTransaction` completion. SDK transport retries, index entries and Firestore's internal work are outside the observer.

`sourceDocumentsAtBuild` remains 11,002 for Academy and 5,501 for Finance on a cache hit. Those values describe the cached summary's source population, **not reads performed by the warm request**. Cold summary generation still scans its complete source population.

## Client payload comparison

| Payload | Full reference source + label rows | Cold source + label rows | Aggregates returned | Reference JSON bytes | Cold JSON bytes | Warm JSON bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Academy | 11,002 + 5,501 | 20 + 20 | 1 course aggregate | 1,786,755 | 6,368 | 6,454 |
| Finance | 5,501 + 5,501 | 20 + 20 | 1 summary | 1,671,222 | 6,921 | 7,007 |

Returned source-and-label rows decrease by **99.758% for Academy** and **99.636% for Finance**. Aggregates are reported separately from source documents. JSON sizes use `Buffer.byteLength(JSON.stringify(handlerResponse), 'utf8')`; they exclude callable envelopes, compression and wire traffic. Warm responses contain additional cache metadata. The reference is correctness-equivalent full-list fixture data, not a historical UI benchmark; an old truncated 5,000-row list would not be a valid baseline.

## Reproduce

Use installed project and Functions dependencies, Node 22 or later, Java 21, Firebase CLI **15.9.1**, and the cached Firestore emulator. From the repository root, this PowerShell command uses the installed CLI rather than downloading it with `npx`:

```powershell
$firebaseCli = Join-Path (npm root --global) 'firebase-tools/lib/bin/firebase.js'
node $firebaseCli --version
node $firebaseCli emulators:exec --only firestore --project demo-aura-fitness "node --test --test-reporter=tap --test-concurrency=1 functions/reporting-read-budget-observer.test.js functions/scoped-reporting-read-budget.integration.cjs functions/scoped-reporting-reads.integration.cjs functions/scoped-reporting-reads.test.js" 2>&1 | Tee-Object -FilePath reporting-read-budget.local.log
if ($LASTEXITCODE -ne 0) { throw 'Read-budget verification failed' }
Get-FileHash -Algorithm SHA256 reporting-read-budget.local.log
```

Ensure `java -version` resolves to Java 21 before running. No private runner or credentials are required. The fixture itself requires a loopback `FIRESTORE_EMULATOR_HOST`, uses only the `demo-aura-fitness` project, blocks non-loopback sockets/HTTP/fetch, and sets `METADATA_SERVER_DETECTION=none` **before loading Google SDKs**. Missing emulator configuration fails closed. It writes a new ignored `.migration-private/reporting-read-budget-*.json` with the exact HEAD, dirty-source fingerprint, fixture scope, counters and limitations; the command above retains the test log and prints its hash. Source fingerprinting includes tracked and unignored untracked files, excluding ignored evidence.

The observer's unit tests are registered in `npm run test:app-optimization`. The fixture is registered in `npm run test:app-optimization-transaction`, already run by the existing `Rules (firestore)` CI job with Java 21, Functions dependencies and the local demo emulator. There is no new CI job or runtime export. The initial focused run passed 24/24 tests.

## Interpretation limits

The handlers exercise the production profile/role-assignment authorization path with deterministic fixture `request.auth` claims. They do **not** exercise Firebase token verification, callable transport, App Check, Firestore Rules or browser loading behavior. Missing auth and a disabled profile are separately checked to reject before reading source, labels or cache.

The measurement covers one dense, unsearched first page and its immediate repeat. It does not represent sparse pages, other categories, concurrent callers, process cold starts, production latency or cost. Local elapsed times are retained as observations, without performance assertions. Reduced client payload and avoided warm scans are separate outcomes; neither establishes an 80% billing reduction.
