# Aura Nutrition AI setup

The client uploads an authenticated user's JPEG, PNG, or WebP image to a private
`nutrition-scans/{uid}/{scanId}/original.{ext}` object. The `analyzeFoodImage`
callable validates ownership, MIME type and the 8 MB limit before sending the image
to the configured vision provider. The server and client automatically attempt to
delete temporary images after analysis. If cleanup is interrupted or fails, an
object can remain until the bucket lifecycle policy removes it.

## Catalog prerequisite

Run the nutrition catalog importer before enabling production food analysis. It must
seed the `nutritionCatalog` Firestore collection from
`data/nutrition/viendinhduong.records.json`. Runtime matching expects these fields:

- `id`, `kind`, `nameVi`, `nameAscii`, `nameTokens`
- `energyKcal`, `basis`, `source.publisher`, `source.pageUrl`

The callable uses the named database configured in `functions/index.js`, so pass the
same ID explicitly. The importer is dry-run unless `--commit` is supplied:

```powershell
node functions/scripts/import-nutrition-catalog.cjs `
  --project YOUR_PROJECT_ID `
  --database-id ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7 `
  --commit
```

If Application Default Credentials are unavailable on a workstation that is
already signed in with `firebase login`, add `--firebase-cli-auth`. The access
token is reused in memory and is never written to the dataset or command output.

AI estimates are never overwritten by a catalog record whose serving basis is
unclear. A unique high-similarity result is returned as `catalogMatch`. Duplicate
names are not collapsed into an arbitrary calorie value: `catalogMatch` stays null
and up to five deterministic `catalogCandidates` are returned so the UI can ask the
user to choose the correct region/record.

## Provider configuration

Keep the API key in Firebase Secret Manager:

```powershell
firebase functions:secrets:set GEMINI_API_KEY
firebase deploy --only "functions:analyzeFoodImage,functions:generateMealReview,functions:askAiCoach,functions:generateAuraContent,storage" `
  --project gen-lang-client-0815966909
```

Production is Firebase Hosting plus regional callable Functions. The browser must
call these functions through the Firebase SDK; `/api/*` belongs to the optional
local Express server and is not served by the Hosting SPA rewrite. Deploying only
Hosting leaves newly added callable functions unavailable.

To deploy the production-shaped demo without a Gemini key, set the secret value
to `disabled` when prompted. The endpoint will use the explicit no-fabrication
fallback until a real key is stored and the function is redeployed.

For the local emulator, create an ignored `functions/.secret.local` file:

```text
GEMINI_API_KEY=replace_with_your_key
```

The optional `GEMINI_VISION_MODEL` environment variable defaults to
`gemini-3.6-flash`. If that stable model is temporarily unavailable, the
function falls back to `GEMINI_VISION_FALLBACK_MODEL`, which defaults to
`gemini-3.5-flash`. Do not expose any provider configuration value through
a `VITE_*` variable.

Verify deployment metadata without printing the secret value:

```powershell
firebase functions:secrets:get GEMINI_API_KEY --project gen-lang-client-0815966909
firebase functions:list --project gen-lang-client-0815966909
```

The list must include `analyzeFoodImage`, `generateMealReview`, `askAiCoach`,
and `generateAuraContent` in `asia-southeast1`. Never use
`functions:secrets:access` in logs or CI output.

When no server-side key is available, the callable returns
`status: "provider_not_configured"`, `mode: "demo"`, and `analysis: null`. It does
not fabricate nutrition values from a sample meal.

## Operational safeguards

- Authentication is required and the image path must belong to the caller.
- Limits are 10 scans per 10-minute counter window and 50 scans per 24-hour
  counter window.
- Function concurrency is capped at 4 per instance (maximum 3 instances) to bound
  image-buffer memory and provider fan-out.
- Provider output uses strict JSON Schema and is validated again on the server.
- The normal flow requests image deletion unless the caller explicitly sends
  `retainImage: true`; deletion is best-effort and the response reports whether the
  object may still remain.
- Configure a Cloud Storage lifecycle rule for the `nutrition-scans/` prefix before
  production use (for example, delete objects older than 24 hours). This is the
  fallback for interrupted cleanup and uploads abandoned before the callable starts.
- After App Check is initialized in every production client, set
  `ENFORCE_APP_CHECK=true` in the Functions environment and redeploy. Leave it false
  during the current local/demo flow or callable requests will be rejected.

Food-photo nutrition values remain estimates. The product should always let the user
correct ingredients and portions before saving a meal log.
