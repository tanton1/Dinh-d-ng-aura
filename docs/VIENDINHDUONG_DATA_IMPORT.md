# Viện Dinh dưỡng data import

`scripts/scrape-viendinhduong.mjs` imports the public lookup data behind:

- <https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-mon-an>
- <https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-thuc-pham>

It uses the JSON endpoints called by those pages, not DOM scraping. Every run:

1. downloads and checks `https://viendinhduong.vn/robots.txt`;
2. waits at least 1.25 seconds (plus jitter) between requests;
3. retries only network errors, HTTP 429, and HTTP 5xx responses;
4. validates pagination totals and duplicate source IDs;
5. writes normalized JSON, flat CSV, checksums, and a provenance manifest.

## Run

Use a truthful User-Agent containing a monitored contact for scheduled runs:

```powershell
$env:NIN_SCRAPER_USER_AGENT = "AuraNutritionBot/1.0 (+mailto:data@example.com)"
node scripts/scrape-viendinhduong.mjs
```

Quick one-page validation:

```powershell
node scripts/scrape-viendinhduong.mjs --max-pages 1 --out-dir data/nutrition-sample
```

Run `node scripts/scrape-viendinhduong.mjs --help` for all options.

## Outputs

- `data/nutrition/viendinhduong.records.json`: application-ready normalized records.
- `data/nutrition/viendinhduong.records.csv`: one row per food/dish with common macro columns and full nutrient JSON.
- `data/nutrition/viendinhduong.manifest.json`: source URLs, request settings, robots decisions, counts, caveats, and SHA-256 checksums.
- Optional `*.raw.json`: only when `--write-raw` is provided.
- `nutritionCatalog` trong Firestore: bản sao vận hành phía server, chỉ được đọc
  qua Callable Function sau khi xác thực tài khoản Aura.

Stable IDs have the form `nin:food:<sourceId>` and `nin:dish:<sourceId>`.
Missing nutrient amounts remain `null`; they must never be interpreted as zero.

The source labels food composition values as applying to 100 g of edible,
raw/fresh food. The dish lookup does not state a standard serving mass in its
visible interface, so normalized dish records use
`basis.qualifier = "not_specified_by_source"`.

## Reuse and attribution

At the time this importer was prepared, `robots.txt` allowed the page and API
paths. No machine-readable data licence or explicit terms-of-use link was found
on the two source pages. Their footer states that copyright belongs to the
National Institute of Nutrition.

`robots.txt` permission is a crawl directive, not a content licence. Before
commercial use or redistribution, obtain written permission or a confirmed
reuse licence from the publisher. Keep the publisher, page URL, API URL,
source record ID, retrieval time, source update time, and checksum from each
record's `source` object. Do not copy the source images into another system
unless image reuse is separately permitted.

The database is reference material. Values, especially AI-matched portions,
must be presented as estimates and not as medical advice.

## Truy cập trong ứng dụng

Catalog không được phát hành dưới dạng file tĩnh trong `public/`. Frontend gọi
`listInternalNutritionCatalog` và `getInternalNutritionCatalogItem`; backend
kiểm tra tài khoản đăng nhập trước khi trả dữ liệu. Mọi học viên và nhân viên
đều thấy tab Catalog trong trang Dinh dưỡng.

File normalized đầy đủ vẫn là nguồn import/đối soát phía server. Không tạo lại
client index trong `public/` vì thao tác đó sẽ bỏ qua lớp phân quyền.

## Optional Firestore seed

The Firestore importer is dry-run by default and never deletes documents:

```powershell
node functions/scripts/import-nutrition-catalog.cjs
```

After reviewing the printed project, database and counts, authenticate with
Application Default Credentials and explicitly enable writes:

```powershell
node functions/scripts/import-nutrition-catalog.cjs `
  --project YOUR_PROJECT_ID `
  --database-id YOUR_DATABASE_ID `
  --commit
```

It upserts deterministic documents into `nutritionCatalog` in batches of 400
and adds normalized `nameAscii`, bounded `nameTokens`, and a compact `macros`
object for lookup. It does not remove stale documents; removal requires a
separate, explicitly reviewed maintenance operation.
