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
firebase functions:secrets:set APIKEY_FUN_API_KEY
firebase functions:secrets:set OPENROUTER_API_KEY
firebase deploy --only "functions:analyzeFoodImage,functions:generateMealReview,functions:askAiCoach,functions:generateAuraContent,storage" `
  --project gen-lang-client-0815966909
```

`analyzeFoodImage`, `generateMealReview`, and `askAiCoach` use the OpenAI-compatible
apikey.fun endpoint at `https://api.apikey.fun/v1/chat/completions` as their primary
provider. They call OpenRouter only when apikey.fun is missing or returns a retryable
provider failure. Aura Academy content continues to use OpenRouter directly. Both
keys remain server-side Firebase secrets; neither belongs in Vercel or in a `VITE_*`
variable.

Production uses the Vercel web app plus regional Firebase callable Functions. The
browser calls these functions through the Firebase SDK; `/api/*` belongs only to
the optional local Express server. Deploying only Vercel does not update the AI
Functions.

To deploy the production-shaped demo without an apikey.fun key, set the secret value
to `disabled` when prompted. The endpoint will use the explicit no-fabrication
fallback until a real key is stored and the function is redeployed.

For the local emulator, create an ignored `functions/.secret.local` file:

```text
APIKEY_FUN_API_KEY=replace_with_your_key
OPENROUTER_API_KEY=replace_with_your_key
```

The optional `APIKEY_FUN_VISION_MODEL` environment variable defaults to
`gemini-3.7-flash`, a multimodal model enabled for the production key. If it is temporarily
unavailable, the function falls back to `APIKEY_FUN_VISION_FALLBACK_MODEL`, which
defaults to `gemini-3.6-flash`. Confirm the enabled model IDs in the apikey.fun dashboard or
authenticated `/v1/models` response before overriding them. Meal reviews and AI
Coach use `APIKEY_FUN_TEXT_MODEL` and `APIKEY_FUN_TEXT_FALLBACK_MODEL`. Their
OpenRouter fallback uses the corresponding `OPENROUTER_VISION_*` or
`OPENROUTER_TEXT_*` configuration.

## AI Coach image advice

The student Nutrition assistant and the Progress-page Aura Coach both expose an
`Thêm ảnh` action with two explicit modes: `Ảnh vóc dáng` and `Ảnh món ăn`. The
browser sends only the selected type and an owner-scoped temporary Storage path to
`askAiCoach`; the callable re-validates the path, MIME type, size and metadata
purpose before passing the image as multimodal input to the configured model.

Coach images use the same private path shape as food scans with one of these
metadata purposes: `ai-coach-body` or `ai-coach-meal`. They are deleted in the
callable `finally` block (and retried by the client when a callable request fails),
and conversations persist only a human-readable label such as “Ảnh vóc dáng trong
tin nhắn hiện tại (không lưu)”. A lifecycle rule on `nutrition-scans/` remains the
fallback for uploads abandoned before the callable starts.

Body-photo advice is intentionally limited to cautious observations relevant to
training goals. The model must not identify a person, infer health conditions,
estimate exact body-fat or weight, score attractiveness/body quality, compare the
user to beauty standards, or promise spot reduction. Meal-photo advice must call
out uncertainty from hidden oil, sauce and portions, and remain an estimate until
the user confirms ingredients and serving size.

Verify deployment metadata without printing the secret value:

```powershell
firebase functions:secrets:get APIKEY_FUN_API_KEY --project gen-lang-client-0815966909
firebase functions:secrets:get OPENROUTER_API_KEY --project gen-lang-client-0815966909
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
- The burst guard is 10 scans per 10-minute counter window. The product quota is
  10 scans per rolling 24 hours for regular/editor accounts and 50 for trusted
  Coach/Admin/Super Admin accounts. Elevated quota requires the Auth custom claim
  and server-owned Firestore role to match.
- Food photos are resized to a maximum 1,280-pixel long edge before upload. The
  provider returns the complete structured nutrition and personalized advisory
  fields, Aura caches exact owner-scoped retries for 24 hours, and only calls the
  fallback model for materially low-confidence results. Server validation and local
  repair remain a safety net when a provider field is malformed; they are not the
  primary source of the student-facing advice.
- Function concurrency is capped at 4 per instance (maximum 3 instances) to bound
  image-buffer memory and provider fan-out.
- Provider output uses strict JSON Schema and is validated again on the server.
- The normal flow requests image deletion unless the caller explicitly sends
  `retainImage: true`; deletion is best-effort and the response reports whether the
  object may still remain.
- Configure a Cloud Storage lifecycle rule for the `nutrition-scans/` prefix before
  production use (for example, delete objects older than 24 hours). This is the
  fallback for interrupted cleanup and uploads abandoned before the callable starts.
- After App Check is initialized and production telemetry reports valid tokens,
  keep `ENFORCE_APP_CHECK=false`, set `ENFORCE_AI_APP_CHECK=true` in the Functions
  environment, and redeploy only `analyzeFoodImage`, `generateMealReview`,
  `askAiCoach`, and `generateAuraContent`. This protects the paid AI boundary
  without unexpectedly blocking Auth-adjacent, Push, Academy, PT, or Eat Clean
  callables. Leave both flags false during the local/demo compatibility flow.

Food-photo nutrition values remain estimates. The product should always let the user
correct ingredients and portions before saving a meal log.
