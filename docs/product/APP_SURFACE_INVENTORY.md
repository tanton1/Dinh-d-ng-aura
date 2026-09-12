# Aura application surface inventory

Last reviewed: 2026-09-09

This inventory is the routing contract for Aura. `Canonical` means the route is
the preferred entry point. `Transitional` means it is still live while its
read/write path is migrated. `Compatibility` is a redirect kept for deep
links. A route being absent from this document is not permission to delete its
component; reference and production-traffic verification are required first.

## Access contract

- Firebase callables and Firestore Rules are the enforcement boundary.
- Navigation must use the same capability that admits the destination route.
- `rolePermissions` is a compatibility adapter only; new routes use
  `routeCapabilities` and the server-issued access context.
- A visible navigation item must never lead to a second, stronger client-only
  permission gate.
- Immersive routes own their local navigation and do not render the global
  bottom dock.

## Member surfaces

| Route | Surface and state | Primary read path | Primary write path | Mobile / loading contract |
| --- | --- | --- | --- | --- |
| `home` | Member Today · Canonical | shared nutrition target/journal selectors, schedule summary | existing bounded member commands | Global member dock; V4 behind `member-home` |
| `aura-club` | Loyalty wallet and benefits · Canonical | loyalty callables/projections | loyalty callables | Lazy route; not part of Student 360 critical load |
| `courses` | Course directory · Canonical | academy course/enrolment queries | enrolment callable | Global dock; simple single-course presentation supported |
| `course-detail` | Reader, outline and PDF · Canonical immersive | course runtime and lazy PDF assets | lesson progress and notes | No global dock; retains dirty-note guard and reader position |
| `schedule` | Schedule, requests, history · Canonical | member schedule callables/adapters | session request callables | V4 behind `member-schedule`; old tab hashes redirect |
| `student-availability` | Weekly availability · Canonical | availability query | revisioned availability command | Sticky safe-area CTA; V4 behind `member-availability` |
| `pt-workout` | Assigned PT workout workspace · Transitional | workout assignment/history | workout log command/adapters | Must converge with the `workout` information architecture |
| `workout` | Member workout execution · Canonical immersive | assigned program/runtime | workout log commands | No global dock while executing a workout |
| `nutrition` | Today, Diary, Plan, Explore · Canonical | nutrition profile/journal/targets | nutrition callables and compatible journal writes | Scan/catalog/detail lazy-load; V4 behind `member-nutrition` |
| `eat-clean` | Meal commerce and delivery tracking · Canonical | Eat Clean callables | idempotent checkout/order callables | Task routes retain return destination |
| `progress` | Body and learning progress · Transitional | profile, measurements, academy progress | measurement/profile adapters | Split hierarchy into Body, Photos and Journey |
| `progress-photo-studio` | Progress photo capture · Canonical task route | protected photo metadata | protected upload command | Lazy, permission scoped, return to Progress |
| `profile` | Member identity and preferences · Canonical | `users/{uid}` plus profile adapter | canonical profile sync | Global dock; body-field duplicates are migration debt |
| `delivery` | Shipper workspace · Canonical immersive | delivery callables | delivery milestone/location callables | Never uses the shared dock |

## Staff surfaces

| Route | Required capability / audience | State | Data and mutation contract |
| --- | --- | --- | --- |
| `staff-dashboard` | `dashboard.view` | Canonical | Bounded staff summary plus redacted Action Center behind `action-center` |
| `staff-students` | `coach.workspace.view` | Canonical directory | Directory must migrate from broad listeners to cursor API; opens Student 360 |
| `staff-schedule` | `coach.workspace.view` | Canonical | Shared branch schedule workspace; optimizer-v12 remains server canonical |
| `staff-workouts` | `pt.workout.manage` | Canonical | Assigned workout plans and logs only |
| `staff-availability` | `pt.availability.self.manage` | Canonical | Revisioned personal PT availability |
| `staff-requests` | `coach.workspace.view` | Canonical | Session change/cancel request callables |
| `staff-nutrition-reviews` | `coach.workspace.view` plus server assignment scope | Canonical | Shared nutrition review workspace with SLA and server redaction |
| `staff-quotes` | `sales.quotes.self.manage` | Transitional | Staff sales callables remain; consolidate wire contracts only after scope/parity verification |
| `staff-renewals` | `renewals.workspace.view` | Canonical | Renewal queue overlays `contractUsageViews`; mutations remain sales scoped |
| `staff-payroll` | `payroll.self.view` | Canonical | Self-only payroll callable; never grants admin payroll access |
| `staff-performance` | `performance.self.view` or `performance.evidence.review` | Canonical | Navigation and route admission must use this union, not `dashboard.view` |
| `student-360` | internal actor plus student scope | Canonical immersive | Overview first; timeline, photos and contract workspace lazy-load |

## Admin surfaces

| Route | Capability / state | Primary data path | Controlled debt |
| --- | --- | --- | --- |
| `admin-dashboard` | `pt.operations.manage` · Canonical | Operations Dashboard and Action Center | Additional chunk is close to its budget |
| `admin-loyalty` | `loyalty.dashboard.read` · Canonical | loyalty projections/callables | Keep independent from Student 360 critical load |
| `admin-today-sessions` | `pt.operations.manage` · Canonical drill-down | bounded session/attendance query | Retain only while dashboard drill-down traffic exists |
| `admin-courses` | academy permission adapter · Canonical | academy course queries | Complete capability migration |
| `admin-course-editor` | academy edit/publish permission · Canonical | academy repositories/callables | Large editor and legacy small-text CSS |
| `admin-academy-students` | academy student permission · Canonical | academy enrolment directory | Complete capability migration |
| `admin-programs` | program view/edit permission · Canonical | training program repository | Split editor from catalogue |
| `admin-students` | student administration permission · Transitional | academy/student adapters | Clarify overlap with `admin-pt-students` |
| `admin-pt-students` | `pt.operations.manage` · Canonical PT directory | legacy bounded listeners | Replace 2,500-row listeners with cursor projection API |
| `admin-pt-schedule` | `pt.schedule.branch.publish` · Canonical | Branch Schedule workspace/optimizer-v12 | Split matrix, pool, inspector, warnings and history |
| `admin-training-history` | `pt.operations.manage` · Canonical | bounded callable/cursor history | Remove remaining directory listeners |
| `admin-pt-workouts` | `pt.workout.manage` · Canonical | shared workout workspace | Keep taxonomy distinct from Performance |
| `admin-trainer-quality` | `pt.operations.manage` · Canonical | trainer quality evidence | Define as compliance/coaching quality, not 100-point performance |
| `admin-performance` | `pt.operations.manage` plus review capability · Canonical | performance score/evidence callables | Align navigation capability with actual reviewer access |
| `admin-renewals` | `renewals.workspace.view` · Canonical | renewal projection and canonical contract usage | Carry-over now fails closed without canonical usage |
| `admin-finance` | `finance.operations.manage` · Canonical | `ledgerEntries` and finance aggregates | Preserve accounting definitions |
| `admin-hr` | `identity.staff_position.manage` · Canonical | users, assignments, branch scope | Replace legacy multi-collection listeners gradually |
| `admin-payroll` | `payroll.operations.manage` · Canonical | payroll v2 callables | Never merge Performance into Payroll |
| `admin-packages` | `pt.operations.manage` · Transitional read | package collection plus revisioned package commands | Browser writes are blocked; replace the remaining collection listener with a bounded query after quote/settings migration |
| `admin-quotes` | `sales.operations.manage` · Transitional | scoped quote-management callables | Verify production revisions and consolidate Staff/Admin read contracts |
| `admin-schedule-settings` | `pt.operations.manage` · Transitional | schedule config and revisioned save callable | Retain settings read adapter until scoped read migration |
| `admin-nutrition-reviews` | `nutrition.meals.all.review` · Canonical | shared review workspace | Keep meal detail redacted by scope |
| `admin-eat-clean` | `eat_clean.operations.manage` · Canonical | Eat Clean operations callables | Verify finance/order capability separation |
| `admin-notifications` | `identity.staff_position.manage`; rollout requires Super Admin · Canonical | notification and UI rollout config | Audit every rollout mutation |

## Compatibility redirects

| Old route | Canonical destination |
| --- | --- |
| `trainer-portal` | `staff-students` |
| `sales-portal` | `staff-quotes` |
| `schedule-pt` | `schedule` |
| `food-database`, `dish-collection` | `nutrition` Explore |
| `meal-plan` | `nutrition?section=plan` |
| `admin-report` | `admin-dashboard` |
| `admin-roles` | `admin-hr` |
| `admin-workout-plans` | `admin-programs` |
| `admin-meal-plans` | `admin-eat-clean` |

Compatibility routes are not duplicate products. They remain until route
telemetry demonstrates that saved links and old clients no longer use them.

## Orphan and duplicate-code candidates

The following unreachable source trees were removed in the safe local cleanup on 2026-09-09. Their recovery references are in `scripts/legacy-surfaces-manifest.json`. Canonical routes and compatibility redirects remain. This is source cleanup, not confirmation of production rollout or permission to delete backing data.

| Retired source | Reason | Replacement / retained contract |
| --- | --- | --- |
| `src/pages/student/MealPlanPage.tsx` | Replaced by the connected Nutrition Plan section | Removed; connected renderer and its shared CSS remain |
| `src/components/admin/pt/StudentDetail.tsx` | Replaced by Student 360 | Removed with exclusive modal/helper tree; tests transferred to canonical workspace |
| legacy `AdminDashboard` / `AdminReportDashboard` tree | Replaced by `admin-dashboard` | Removed; finance safety checks transferred to live dashboard |
| `PersonalDashboard` | No canonical route | Removed with exclusive food/check-in helpers |
| `AdminTeamHub` | HR is canonical | Removed; `AdminRolesPage` and current payroll panels remain |
| `MigrationTool` | Operational scripts are canonical | Removed; production migration/verification tools remain |

Still live and deliberately retained: `classic-diary`, `ConnectedMealPlanPage`, the demo scheduler/worker, `TrainerPortalV2`, Student 360 Regional/fallback endpoints, and both old/new data schemas. Their retirement needs separate business/data verification.

## Migration order

1. Make route admission and navigation consume one capability contract.
2. Move package, quote and contract mutations behind callable commands.
3. Move schedule config/override mutations behind revisioned commands.
4. Replace Admin PT directory listeners with cursor APIs.
5. Add route/surface telemetry and archive verified orphan trees.
6. Disable compatibility redirects only after an observed deprecation window.
