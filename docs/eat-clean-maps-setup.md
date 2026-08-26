# Eat Clean Maps setup

The Eat Clean checkout uses two separate Google Maps Platform credentials.
Do not reuse the same key for the browser and Firebase Functions.

## Browser key

Create a website-restricted key with these APIs enabled:

- Maps JavaScript API
- Places API (New)
- Geocoding API

Allow every domain that builds or serves the frontend, including the exact
production domain and local development origins. Typical local referrers are:

- `http://localhost:4173/*`
- `http://127.0.0.1:4173/*`
- `http://localhost:5173/*`
- `http://127.0.0.1:5173/*`

Set the key locally without committing it:

```env
VITE_GOOGLE_MAPS_API_KEY=your_browser_key
```

For Vercel, add `VITE_GOOGLE_MAPS_API_KEY` to every environment that builds
the app and redeploy. Vite embeds `VITE_*` variables into the generated bundle,
so changing the variable without rebuilding does not update the application.

## Server key

The Eat Clean Functions use Geocoding API and Routes API. Store the server key
as the Firebase secret `GOOGLE_MAPS_API_KEY`; never put it in a frontend `.env`
file or expose it through a `VITE_*` variable.

## Verification

Open **Admin → Eat Clean → Dispatch Center** after deployment. The readiness
cards report the browser Maps/Places status separately from the backend Routes
status. A red browser card usually means a missing build variable, billing,
HTTP-referrer restriction, or an API that has not been enabled.

In checkout, Maps failures must not hide the manual address fields. Customers
can still enter the address and, where needed, use GPS to attach coordinates.
