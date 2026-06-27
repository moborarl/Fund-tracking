# Fund Portfolio Monitor — Web App Deployment Guide

Turning the single-file dashboard into a shared web app with **real accounts + cross-device sync**.

---

## 1. Architecture

```
                 ┌────────────────────────────────────────────┐
   Browser  ◄───►│  Static frontend (index.html + Supabase JS) │
 (any device)    │  hosted on Netlify / Vercel / CF Pages      │
                 └───────────────┬────────────────────────────┘
                                 │  (Supabase anon key — safe to expose)
                 ┌───────────────▼────────────────────────────┐
                 │                 SUPABASE                     │
                 │  Auth (email/password, Google, …)            │
                 │  portfolios   → PRIVATE per user (RLS)       │
                 │  nav_history  → SHARED market data (read all)│
                 │  fund_details → SHARED market data           │
                 │  fund_universe→ list of codes to refresh     │
                 └───────────────▲────────────────────────────┘
                                 │ (service role key — secret)
                 ┌───────────────┴────────────────────────────┐
                 │  Edge Function "nav-refresh" (daily cron)    │
                 │  fetches Finnomena server-side (no CORS)      │
                 └─────────────────────────────────────────────┘
```

**Two kinds of data, stored separately:**

| Data | Scope | Where | Who writes |
|---|---|---|---|
| NAV history, fund details | Shared (same for everyone) | `nav_history`, `fund_details` | daily Edge Function |
| Holdings, transactions | Private per user | `portfolios` (one row/user, RLS) | the logged-in user |

This means: anyone can use the tool, each person logs in and sees only **their own** portfolio, and nobody re-fetches market data — the server refreshes it once a day for all.

---

## 2. Set up Supabase (free tier is enough to start)

1. Create an account at supabase.com → **New project**. Note the **Project URL** and **anon public key** (Settings → API). Keep the **service_role key** secret.
2. SQL Editor → paste **`supabase_schema.sql`** → Run. (Creates tables + Row Level Security.)
3. Enable **Auth** → Email (and/or Google) under Authentication → Providers.

## 3. Seed market data

- Seed the fund list:
  ```sql
  insert into fund_universe(code)
  select jsonb_object_keys(:holdings::jsonb);  -- or paste codes manually
  ```
  (Or just insert the 65 codes from `holdings.json`.)
- Import the market data you already have so the app isn't empty on day one:
  - `nav_history.json` → rows into `nav_history`
  - `fund_details.json` → rows into `fund_details`
  - (I can generate a ready-to-run `seed.sql` from your current files — just ask.)

## 4. Deploy the daily NAV refresh

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-ref>
supabase functions deploy nav-refresh --no-verify-jwt   # file: supabase_nav_refresh.ts
```
Set secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Edge Functions → Secrets).
Schedule it daily (Dashboard → Edge Functions → Cron, e.g. `0 13 * * *`). This runs **on the server**, so the Finnomena CORS problem disappears — no public proxy needed.

## 5. Frontend changes (the part I'll build next)

The current `index.html` becomes account-aware:
- Add Supabase JS + a **login / sign-up** screen.
- On login: load the user's `portfolios` row (holdings + transactions) and the shared `nav_history` + `fund_details`.
- Buy/Sell, profile name, etc. **save back** to the user's row (debounced).
- **Remove embedded personal holdings** — new users start empty and add their own (or import a JSON). Market data is no longer embedded; it comes from Supabase.
- Keep export/import as offline backup.

Only ~120 lines change; the dashboard rendering stays the same.

## 6. Deploy the frontend

Pick one (all have generous free tiers):
- **Netlify Drop** — drag the folder onto app.netlify.com/drop → instant URL.
- **Vercel** / **Cloudflare Pages** — connect a GitHub repo, auto-deploy on push.
- **GitHub Pages** — commit `index.html`, enable Pages.

Put the Supabase **URL + anon key** in the frontend (these are safe to be public — RLS protects the data). Add your deployed domain to Supabase → Auth → URL configuration.

---

## Security & privacy notes

- ✅ The **anon key is public-safe** — Row Level Security ensures each user only reads/writes their own portfolio.
- ❌ **Never** put the **service_role key** in the frontend (it bypasses RLS). It lives only in the Edge Function.
- ⚠️ Do **not** deploy the *current* `index.html` as-is — it has *your* real holdings embedded. The refactored version stores holdings per logged-in user instead.
- Financial data: enable email confirmation, consider 2FA, and review Supabase's data region for your compliance needs.

## Rough cost

Supabase + Netlify/Vercel/CF Pages all have free tiers that comfortably cover a personal tool and early sharing. Heavy usage (many users / lots of storage) moves you to paid tiers — check each provider's current pricing before scaling.

---

### Next step
Say the word and I'll: (a) generate `seed.sql` from your current `nav_history.json` + `fund_details.json`, and (b) build the Supabase-integrated `index.html` (login + per-user sync).
