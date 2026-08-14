# Aura production rollout

## Required configuration

- Create a reCAPTCHA Enterprise App Check provider for the Firebase web app and set `VITE_FIREBASE_APP_CHECK_SITE_KEY` in the hosting build environment.
- Web Push can start with Firebase's default VAPID key. For the widest production browser compatibility, create a Web Push certificate and set its **public** key through `VITE_FIREBASE_VAPID_KEY` or Admin → Thông báo → Nhắc tự động → Cấu hình nâng cao. Never store the private key in the app or Firestore.
- For the first enforcement phase, keep `ENFORCE_APP_CHECK=false` and set `ENFORCE_AI_APP_CHECK=true` in the Cloud Functions runtime only after the production App Check key has been deployed and verified. This phase protects `analyzeFoodImage`, `generateMealReview`, `askAiCoach`, and `generateAuraContent` without changing enforcement for Auth-adjacent, Push, Academy, PT, or Eat Clean callables.
- Keep `VITE_ENABLE_DEMO_OTP=false` and never enable it in a production build.
- Enable `VITE_ENABLE_OFFLINE_CACHE=true` only after the privacy review confirms that persistent health data on shared devices is acceptable.

## Deployment gate

1. Run `npm ci` and `npm --prefix functions ci`.
2. Run `npm run ci`.
3. Run `npm run test:rules` on a machine with Java 21.
4. Run `npm run test:e2e -- --project=chromium`.
5. Deploy Functions first, then Firestore/Storage rules, then the Vercel web app.
6. Verify sign-in for student, coach, editor, admin, and super admin accounts.
7. Verify OpenRouter Gemini 3.7 analysis, recipe save, course revision, notification inbox, and one FCM test device.

## Security follow-up

- Rotate the credential that was previously committed in `deleteRecreate.mjs` and `import-client.mjs`.
- If the repository has ever been public or broadly shared, purge the credential from Git history after rotation.
- Review the six moderate npm advisories before the next dependency-upgrade release; do not apply `npm audit fix --force` without regression testing.

## P0 observability and release safety

The web client now reports uncaught browser errors and App Check initialization
state through the bounded `reportClientIssue` callable. OpenRouter, nutrition vision,
meal review and AI Coach callables emit structured `Aura function failure` and
`Aura function metric` logs with duration, outcome, model/function name, release
and App Check verification state. No image, prompt, password, OTP or health
payload is written to these logs.

Create the two Cloud Monitoring policies from the repository after authenticating
`gcloud` (choose an email/FCM notification channel for production):

```powershell
./scripts/configure-cloud-alerts.ps1 -NotificationChannel projects/gen-lang-client-0815966909/notificationChannels/CHANNEL_ID
```

Before an enforcement deploy, run the production gate. It reads `.env` locally
or CI/Vercel environment variables and fails closed when the App Check key or
Firebase identifiers are missing:

```powershell
node scripts/production-gate.mjs
node scripts/production-smoke.mjs
```

Use `--allow-pending-app-check` only during the short compatibility rollout;
never combine it with `ENFORCE_AI_APP_CHECK=true` or
`ENFORCE_APP_CHECK=true`. During the AI-only cutover, the gate requires
`ENFORCE_AI_APP_CHECK=true` and rejects broad enforcement.

Store the ignored Functions runtime values in
`functions/.env.gen-lang-client-0815966909`:

```dotenv
ENFORCE_APP_CHECK=false
ENFORCE_AI_APP_CHECK=true
PUBLIC_APP_URL=https://dinh-duong-aura.vercel.app
```

Then deploy only the paid AI boundary:

```powershell
firebase.cmd deploy --only "functions:analyzeFoodImage,functions:generateMealReview,functions:askAiCoach,functions:generateAuraContent" `
  --project gen-lang-client-0815966909
```

Run scan, meal-review, AI Coach and Academy AI smoke tests on the canonical
production domain. Random Vercel preview domains are not covered by the
production reCAPTCHA key; use a fixed staging domain/project instead of adding a
broad `vercel.app` allowance or publishing a debug token.

## Production account smoke test

Run the following flows against the Vercel production URL with test accounts
from each role (student, coach, editor, admin and super admin): Google sign-in,
phone OTP send/verify, email sign-in, one nutrition scan, one course lesson and
one PT schedule event. Confirm the Cloud Monitoring dashboard shows the matching
`Aura function metric` entries and no `Aura function failure` entry. Never place
OTP codes, passwords or OpenRouter keys in CI variables or screenshots.

## Push notification operation

1. Admin enables the system channel and scheduler in **Nhắc tự động**.
2. The customer opens Profile → **Nhắc nhở của bạn**, chooses categories and meal times, then taps **Bật Push và lưu** once on each device.
3. The scheduled function checks every 15 minutes, skips completed meal logs, respects quiet hours and daily limits, and writes an automation log.
4. Admin uses **Gửi thông báo** only for real events such as PT schedules, Academy updates, or coach messages; use **Kiểm tra thiết bị** for a single admin-device smoke test.
5. Admin reviews **Lịch sử** after each broadcast and the latest scheduler result before changing automation settings.

## Rollback

Keep the last known-good Vercel deployment URL in the release ticket. If a gate
fails, promote that immutable deployment without changing source history:

```powershell
./scripts/rollback-production.ps1 -VercelDeploymentUrl https://<known-good>.vercel.app
node scripts/production-smoke.mjs
```

Only redeploy Functions from a reviewed, tagged commit (`-RedeployFunctions`);
do not mix a web rollback with unreviewed backend code. After rollback, inspect
the error and App Check policies before promoting a new release.
