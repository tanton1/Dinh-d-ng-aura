# Aura production rollout

## Required configuration

- Create a reCAPTCHA Enterprise App Check provider for the Firebase web app and set `VITE_FIREBASE_APP_CHECK_SITE_KEY` in the hosting build environment.
- Create a Web Push certificate and set `VITE_FIREBASE_VAPID_KEY` in the hosting build environment.
- Set `ENFORCE_APP_CHECK=true` in the Cloud Functions runtime only after the App Check key has been deployed and verified. Keep it `false` during the compatibility rollout.
- Keep `VITE_ENABLE_DEMO_OTP=false` and never enable it in a production build.
- Enable `VITE_ENABLE_OFFLINE_CACHE=true` only after the privacy review confirms that persistent health data on shared devices is acceptable.

## Deployment gate

1. Run `npm ci` and `npm --prefix functions ci`.
2. Run `npm run ci`.
3. Run `npm run test:rules` on a machine with Java 21.
4. Run `npm run test:e2e -- --project=chromium`.
5. Deploy Functions first, then Firestore/Storage rules, then Hosting.
6. Verify sign-in for student, coach, editor, admin, and super admin accounts.
7. Verify Gemini analysis, recipe save, course revision, notification inbox, and one FCM test device.

## Security follow-up

- Rotate the credential that was previously committed in `deleteRecreate.mjs` and `import-client.mjs`.
- If the repository has ever been public or broadly shared, purge the credential from Git history after rotation.
- Review the six moderate npm advisories before the next dependency-upgrade release; do not apply `npm audit fix --force` without regression testing.
