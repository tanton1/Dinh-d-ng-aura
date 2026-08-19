# Eat Clean Delivery

The delivery extension is deliberately fail-safe: existing district-based COD checkout remains available until the store location, Google Maps server key and distance-pricing switch are all valid. New route pricing is calculated only by Cloud Functions; browser distance and price values are never trusted.

When distance pricing is enabled, the quote callable resolves a submitted Place ID through Google Places Details, or geocodes the full Da Nang address when no Place ID exists. The submitted pin must be within 250 metres of Google's canonical result. The quote stores that canonical customer destination and both the original-request and verified-request hashes; order creation reuses the verified snapshot and never recalculates delivery from client coordinates. Quote calls are limited to 20 per authenticated user per five minutes before paid Maps requests.

## Google Maps

Enable Maps JavaScript API, Places API (New), Geocoding API and Routes API in the Firebase project's Google Cloud billing account.

- Add `VITE_GOOGLE_MAPS_API_KEY` to Vercel. Restrict this browser key to the production and preview HTTP referrers, and restrict it to Maps JavaScript API and Places API (New). The checkout uses the current `PlaceAutocompleteElement`, not the legacy Autocomplete widget.
- Store the server key as the Firebase secret `GOOGLE_MAPS_API_KEY`. Restrict it to the Routes and Geocoding APIs and to the production project.
- Store a random value of at least 32 characters as the Firebase secret `DELIVERY_OTP_SECRET`. Only the OTP hash is persisted; the customer retrieves the derived code through the owner-scoped tracking callable.
- Keep `BIND_EAT_CLEAN_SECRETS=false` for the compatibility deployment. After both secrets exist, set it to `true` in the Functions deployment environment and redeploy; only then enable route pricing/dispatch. This avoids making legacy district checkout depend on secrets that have not been provisioned yet.
- Set the kitchen pin and service boundary in Admin > Eat Clean > Operations before enabling route pricing.

## Realtime tracking

Create a Firebase Realtime Database in the same Firebase project, make sure its `databaseURL` is present in the Cloud Functions `FIREBASE_CONFIG`, and deploy `database.rules.json`. The browser never connects to Realtime Database directly: driver GPS is authenticated and throttled by a callable Function. Current driver position is ephemeral; durable status events stay in the canonical Firestore database.

The driver PWA sends a point only while an assigned delivery is active and the page is in the foreground. A native driver application is required for reliable locked-screen background tracking on iOS.

## Rollout checklist

1. Compatibility deploy: keep `BIND_EAT_CLEAN_SECRETS=false`, `distancePricing.enabled=false` and `asapEnabled=false`. Deploy Functions and Firestore rules; legacy district checkout remains available. Do not deploy Database rules until the RTDB instance exists.
2. Create the production RTDB in the same project/region, configure its URL, then deploy `database.rules.json`.
3. Provision secrets with `firebase functions:secrets:set GOOGLE_MAPS_API_KEY` and `firebase functions:secrets:set DELIVERY_OTP_SECRET` (32+ random characters).
4. Set `BIND_EAT_CLEAN_SECRETS=true` in `functions/.env.<project-id>` and redeploy the Eat Clean delivery callables: `quoteEatCleanOrder`, `createEatCleanOrder`, `saveEatCleanConfig`, `saveEatCleanDeliveryConfig`, `listEatCleanDispatchData`, `assignEatCleanShipper`, `completeEatCleanDelivery`, `listMyShipperJobs`, and `getEatCleanOrderTracking`. This second deployment attaches Secret Manager access only after both secrets exist. The admin and shipper operations responses expose readiness booleans, never secret values, so distance pricing cannot be enabled before the kitchen pin and Maps key are ready.
5. Validate the kitchen pin and 2 km, 5 km and 10 km fee boundaries with test addresses. Only then enable `distancePricing` and, after stocking today's inventory, `asapEnabled`.
6. Assign two test accounts the `shipper` role and complete an end-to-end COD order. Verify customer, assigned shipper and admin callable access; Firestore delivery documents and RTDB GPS paths must remain unreadable directly from clients.
7. Enable the internal pilot, then widen rollout after Maps, failed OTP, SLA and stale-GPS telemetry remain healthy.

Enable Firestore TTL on `expiresAt` for `eatCleanQuotes`, `eatCleanIdempotency` and `eatCleanQuoteRateLimits`; expiry is enforced synchronously by Functions, while TTL keeps old operational documents from accumulating.

Existing district orders remain readable and use their stored delivery fee. Delivery records created before `deliveryOtpHashVersion: hmac-v1` can still complete through the legacy hash verifier after rules are locked down; reassigning the shipper rotates them to HMAC automatically. Any address captured by a pre-fix build with one-decimal coordinates must be reselected on the map before enabling distance pricing.
