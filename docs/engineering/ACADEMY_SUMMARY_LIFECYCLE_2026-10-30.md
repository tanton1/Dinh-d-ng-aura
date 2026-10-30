# Academy summary read lifecycle

This increment implements the Academy client lifecycle portion of the app optimization plan. It changes the client summary read boundary, not the summary callable, backend cache, published catalog transport, provider keys, or authorization policy.

## Why

The previous application effect both cleared analytics and depended on `useCourses().courses`. A disabled catalog returned a new empty array on every render, so the effect's empty-array state update could render indefinitely. Admin Firestore metadata snapshots also produced fresh arrays and restarted summary reads, including while the browser was hidden. Restarting a forced refresh could consume its refresh marker and replace it with a cached request.

`useCourses` now returns one stable empty array, passes a distinct admin authority key, and ignores callbacks after disposal/session replacement. `useAcademyAnalyticsSummary` owns the summary request lifecycle. Its dependencies contain the access scope and route activation, not the catalog array or catalog loading state. Mapping a complete summary onto the latest catalog is a memoized presentation operation.

## Read and invalidation policy

| Event | Summary behavior |
| --- | --- |
| First visible entry / ordinary reopen of admin course overview | One `refresh:false` read, eligible for the existing server cache; an already running same-scope read can satisfy the reopen. |
| Fresh array containing the same courses; metadata-only snapshot; title/coach/publication edit | Remap locally, no summary request. |
| Explicit “Làm mới số liệu” | Mark fresh data required; one `refresh:true` request when the overview is visible. |
| Successful enrollment assignment/cancellation, learner enrollment, or lesson completion through the root handlers | Mark the same scope dirty with `refresh:true`. Outside the overview or while hidden, defer until visible overview entry. Multiple invalidations coalesce. Failed writes do not invalidate. |
| Invalidation while a read is pending | Ignore its older summary and start at most one subsequent forced read. |
| Browser becomes hidden | Start no new summary request. An already dispatched read may finish; it does not schedule another hidden request. |
| Visible/online event without dirty work | No read. No polling or elapsed-time refresh. |
| Incomplete response / error | Show unknown metrics. Retain forced intent for explicit retry or route reopening; do not loop on errors or ordinary visibility events. |
| Firebase user object/session, UID, role, authz version, disabled flag, or backend mode changes | Clear exposed old-scope data, reject old success/failure/mutation callbacks, and read only if the new scope is permitted and visible. |

Catalog fields do not contribute enrollment/progress source documents to the summary. Creating, renaming, publishing or deleting a course therefore changes the presentation mapping, not summary freshness. A course absent from a **complete** summary has zero learners at that summary's `asOf`; incomplete/failed summaries cannot infer zero. New enrollment/progress source writes invalidate explicitly. Writes by another browser/session are reflected by the existing server cache policy on reopening, or immediately after a manual refresh; this increment does not introduce a new source listener or cross-session invalidation bus.

The admin catalog's existing realtime listener remains scoped to its Academy route. This increment does **not** detach that listener in background tabs or alter the learner catalog's existing foreground refresh policy. The visible-only dispatch guarantee above concerns the summary callable; its existing bounded transport retries are unchanged.

## Completeness and isolation

The hook returns `complete` separately from the array length. `AdminCoursesPage` receives it explicitly, displays “—” for unavailable totals and unknown row progress, and omits a numeric progressbar for unknown progress. A complete summary with a successfully loaded empty catalog can legitimately show total learners `0`. A partial array cannot masquerade as a complete aggregate. `asOf` is shown only with a complete response.

The lifecycle retains only state owned by the mounted application hook. There is no new persistent/shared summary cache, polling timer, or per-read write. StrictMode setup/cleanup is coalesced before dispatch; pending requests are fenced by the actual Firebase owner object and access scope, in addition to a mutation revision.

## Verification

`npm run test:academy-summary-ui` mounts the real `useCourses`, summary hook, and `AdminCoursesPage` in React StrictMode, with transport/auth boundaries mocked. It runs desktop Chrome and mobile WebKit, makes no live Firebase reads/writes, and covers:

- Disabled empty-array identity and bounded rendering.
- Same-content and metadata-only catalog snapshots, actual row/KPI mapping, complete empty versus unknown summaries.
- Initial hidden entry, ordinary resume, deferred manual/mutation reads, pending invalidation coalescing.
- Explicit forced refresh, errors/incomplete results, retained force intent and no automatic retry loop.
- Late success/failure and stale mutation/catalog callbacks across account, same-UID session, and authority changes.
- Role/backend/logout gates and ordinary versus invalidated route reopening.

`npm run test:academy-summary` checks application wiring plus existing Academy session/cache/chapter/media/read-only transport invariants. Both scripts are included in `test:data-cost-ui`, which is already run by CI and the release workflow. Vite fixture cache and browser artifacts live under ignored `test-results/`, not the shared `node_modules` junction.
