# Deploying Chowdex on Cloudflare (chowdex.boston)

The site is static files, so Cloudflare hosts it for free. A small **Worker** serves it and holds the secret keys for two endpoints:

| Path | File | What it does | Secret it uses |
|---|---|---|---|
| `/api/place-photo` | `server/handlers.js` (via `worker/index.js`) | one live Google photo for a place card, with the photographer's credit | `GOOGLE_PLACES_KEY` |
| `/mbta/*` | `server/handlers.js` (via `worker/index.js`) | forwards read-only MBTA requests (live trains, arrival times) and adds our key | `MBTA_API_KEY` |

Everything else (places, ratings, accounts, dex, photos you upload) stays in Supabase exactly as now. The app uses hash
routes (`/#/home`), so no redirect rules are needed.

Never paste secrets into chat or commit them. They go only into Cloudflare's settings.

## 1. Create the project (the "Set up your application" screen)

Cloudflare's current flow creates a **Worker** that serves the built site plus our two endpoints. It is configured by
`wrangler.jsonc` and `worker/index.js` in this repo (so push them to GitHub first).

1. Cloudflare dashboard: **Workers & Pages -> Create -> Import a repository (GitHub)** and choose `blu360/bostonhacks`.
2. On the setup screen:
   - **Project name:** `bostonhacks` (it must match the `name` in `wrangler.jsonc`)
   - **Build command:** `npm run build`
   - **Deploy command:** leave `npx wrangler deploy`
   - **Preview command:** leave as is
   - **Root directory / path:** leave empty
3. **Add the build variables before the first deploy** (Advanced settings on that screen, or *Settings -> Build ->
   Variables and secrets* afterwards). If they are missing, the first build has no Supabase connection and the site
   runs in demo mode (the default). If that happens, add them and use **Retry build**.

   | Build variable | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_USE_MOCK` | `false` |
   | `VITE_SUPABASE_URL` | `https://iliqszacyfpiqbofaczu.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon key from your `.env` (it is meant to be public) |
   | `VITE_MAPTILER_KEY` | your MapTiler key (restrict it to your domain, step 5) |

   `VITE_...` values are baked into the site when it is built, so changing one needs a new build.
4. **Runtime secrets** (the running Worker reads these; *Settings -> Variables and Secrets -> Add*, type **Secret**):

   | Secret | Value |
   |---|---|
   | `MBTA_API_KEY` | your MBTA key |
   | `GOOGLE_PLACES_KEY` | your Google key |
   | `PHOTO_DAILY_CAP` | optional, e.g. `300` (Google requests per day, per worker instance) |

5. **Production branch:** by default Cloudflare builds the repo's default branch (`main`), which is older than `dev`. Either
   merge `dev` into `main`, or set the branch under *Settings -> Build -> Branch control* to `dev`.
6. Deploy. You get a `https://bostonhacks.<your-account>.workers.dev` address. **Test there first** (step 6) before DNS.

(If you ever use the older **Pages** product instead, the `functions/` folder works there unchanged: build command
`npm run build`, output directory `dist`, same variables and secrets.)

## 2. Point chowdex.boston at it

Cloudflare usually needs the bare domain (`chowdex.boston`, no `www`) to use Cloudflare's DNS. Confirm on Cloudflare's current
docs, then:

1. In the Worker project: **Settings -> Domains & Routes -> Add -> Custom domain** -> `chowdex.boston`. Cloudflare will tell you what
   it needs.
2. If it asks you to add the domain to Cloudflare DNS: **Add a site** (free plan), enter `chowdex.boston`, and Cloudflare
   gives you **two nameservers**.
3. At **GoDaddy -> My Products -> chowdex.boston -> DNS -> Nameservers -> Change** to "I'll use my own nameservers" and
   paste the two Cloudflare nameservers. The domain stays registered at GoDaddy; only DNS moves.
4. Wait (minutes to a few hours). Cloudflare then issues the HTTPS certificate on its own.
5. Optional: add `www.chowdex.boston` as a second custom domain so both addresses work.

If you would rather not move nameservers, use only `www.chowdex.boston` with a CNAME from GoDaddy to the `pages.dev`
address, and forward the bare domain to `www` in GoDaddy.

## 3. Google sign-in

Google Cloud console -> **APIs & Services -> Credentials** -> your OAuth client:
- **Authorized JavaScript origins:** add `https://chowdex.boston` (and `https://www.chowdex.boston`, and the
  `https://<project>.pages.dev` address while testing).
- **Authorized redirect URIs:** leave it as the Supabase callback
  (`https://iliqszacyfpiqbofaczu.supabase.co/auth/v1/callback`). It does not change.

## 4. Supabase

**Authentication -> URL Configuration:**
- **Site URL:** `https://chowdex.boston`
- **Redirect URLs:** add `https://chowdex.boston/**`, `https://www.chowdex.boston/**`, and
  `https://<project>.pages.dev/**` (plus `http://localhost:5173/**` for local work).

Also make sure your Supabase project is **awake** before a demo: free projects pause after about a week of no activity.

## 5. Keys

- **MapTiler:** restrict the key to HTTP referrers `chowdex.boston`, `*.chowdex.boston`, and your `pages.dev` address.
- **Google (Places API):** restrict the key to the **Places API (New)** only. Cloudflare's outgoing IP addresses change, so an IP
  restriction will not work here. Instead set a low daily **quota** for the Places API and a **budget alert** in Billing.
  The quota is the real spending limit; `PHOTO_DAILY_CAP` is only a best-effort guard.
- The keys that were pasted into chat during development should be rotated before the site is public.

## 6. Test checklist (on the pages.dev address, then on chowdex.boston, on a phone too)

- [ ] The site loads and the map shows restaurants (about 1,584 local places, no chains).
- [ ] A place card shows stars (`★ 4.6 ... Google`) and, for most places, a photo with "Photo by ...".
- [ ] Live trains move on the map (the `/mbta/` function works). Station cards show arrival times.
- [ ] **Sign in with Google** returns you to the site, signed in.
- [ ] Logging a meal shows the reward pop-up and the dex, pets and stamps update.
- [ ] Directions: it asks for your location, shows live times and an ETA.
- [ ] Night mode toggles and the map follows.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank or old site | `VITE_*` variables missing at build time: set them, then **Retry deployment**. |
| Sign-in loops back signed out | The address is missing from Supabase **Redirect URLs**, or Site URL is wrong. |
| `redirect_uri_mismatch` | The Supabase callback is not the only redirect URI in the Google client, or has a typo. |
| No photos | `GOOGLE_PLACES_KEY` not set as a secret, the Places API (New) is off, or the daily cap was reached. |
| Trains do not move | `MBTA_API_KEY` missing (the app then falls back to the public feed at a lower rate limit). |
| Map is blank / gray | MapTiler key missing, or restricted to a different domain. |
| Everything is empty | The Supabase project is paused, or `VITE_SUPABASE_URL` / the anon key are wrong. |

Rollback: in the project, **Deployments** -> pick an earlier one -> **Rollback to this deployment**.
