# Vào Bếp cùng Aura

Member cookbook at `#/cooking`, reached through Học & dịch vụ in the sidebar and mobile More menu. Recipe links use `?recipe=B01`; `&mode=cook` opens step-by-step cooking. Staff personal mode uses the same route. No backend writes or nutrition-diary mutations.

## Source contract

- 60 recipes from the six supplied Aura PDF chapters. IDs and chapter order are stable: B01–B10, M01–M14, V01–V08, R01–R10, S01–S08, C01–C10.
- Preserve ingredient quantities and raw/cooked qualifiers, original instructions, substitutions and tips. Chapters 1–5 make two portions; chapter 6 makes four sauce/marinade portions.
- Kcal are source estimates rounded to 5 kcal. Batch and serving kcal can round independently. Do not derive macros or scale servings.
- Preparation/cooking and overnight/marinating/freezing times remain separate. Photos are AI illustrations extracted from the PDFs; recipes have not been kitchen-tested.
- `data/cookbook.json` loads only when entering this feature. Images have WebP thumbnail/full variants. Unchanged PDFs in `public/cooking/sources` are fetched only after the member opens one, with loading, retry and close states.

## State

Bookmarks use `aura:cooking:saved:v1:<encoded user ID>` in localStorage, on the current device. Changing the actor remounts all personal state. Blocked storage falls back to session memory with a visible notice. Ingredient checks and cooking progress last only while this page is mounted. Returning from a recipe preserves the current list filters and position.

## Reimport and verify

Python requires `pypdf` and `Pillow`. Source filenames are defined in `scripts/import-aura-cookbook.py`.

```text
python scripts/import-aura-cookbook.py <directory-containing-six-PDFs>
python scripts/import-aura-cookbook.py <directory-containing-six-PDFs> --data-only
python tests/cooking-source-audit.py
npm run test:cooking
npm run test:cooking-ui
npm run build
npm run performance:check
```

The independent PDF audit compares every ingredient list, full instruction block, name/page mapping, kcal, serving count, time and note against the copied source. It verifies PDF hashes and compares all 120 delivered images with the corresponding recipe-page photo, allowing only resizing/compression differences.

Browser tests cover discovery, per-member bookmarks, blocked storage, cooking progress, direct links, deferred PDF loading/recovery, photo/catalog failures, keyboard navigation, restored list position and 320–1440 px layouts. The UI fixture uses the real shell and feature with member services disconnected. The additional application suite builds the real entry point in the existing demo mode into `.tools/cooking-app-e2e` and verifies both shell/nutrition UI versions on desktop/mobile. It does not sign in or touch production data, and leaves the production `dist` intact.

CI includes `test:cooking`. The release E2E suite also discovers `tests/e2e/cooking.spec.ts`. Performance checks count this page and its immediately loaded recipe catalog together (45,000-byte gzip budget) and reject loading the catalog in the shared startup shell. Startup assets use the existing Vite manifest entry helper.

Local preview: `npx vite --config tests/cooking-ui/vite.config.ts --host 127.0.0.1 --port 4201`, then `/tests/cooking-ui/index.html#/cooking`.

## Standalone food library

`#/food-library` appears beside the cookbook under Học & dịch vụ. `?saved=1` opens saved foods and `?foodId=<id>` opens a food detail. Legacy `food-database` and `dish-collection` links resolve here. Nutrition retains its contextual catalog picker for diary/weekly-plan actions, while its general catalog tab is removed.

The library reuses the existing catalog service, owner-scoped saved foods, meal confirmation sheet and diary write path. Browsing does not enable day/weight/plan reads. A completed nutrition profile is required before logging; browsing is available without one. No API, permissions or database schema changes are required.

Cards show kcal and macros with unknown values preserved, a collapsed portion editor and a compact 44 px touch target for logging. Selected multipliers are retained in diary metadata. List filters stay mounted while a food detail is open. Search also filters saved results locally because ID lookups omit the text query.

UI coverage includes 320/390/768/1440 px widths, missing-nutrient guards, saved/search combinations, portion scaling, real app diary persistence, both UI versions and recipe/detail deep links. The source PDF audit remains independent of frontend tests.
