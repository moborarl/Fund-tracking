# 🚀 Fund Tracking Dashboard — Project Handoff

**Project:** Multi-AMC Portfolio Monitor (v2.x)
**Last Updated:** 2026-07-08
**Live:** https://fundtracking.yourpower.today/
**Repo:** https://github.com/moborarl/Fund-tracking (branch `main`, auto-deploys via Cloudflare Pages)

---

## What this is

A single-file (`index.html`) dark-theme portfolio dashboard for Thai mutual funds
across multiple AMCs, backed by Supabase and a Cloudflare Worker that syncs data
from the Finnomena public API.

---

## Architecture (current)

```
Finnomena API ──► Cloudflare Worker "fund-nav-sync" (cron every 15 min)
                        │  rotating slices of 8 funds
                        ▼
                  Supabase (Postgres)
                   ├─ nav_history   (code, date, nav)      ← NAV prices
                   ├─ fund_details  (code, data JSONB)     ← returns/fees/holdings/strategy
                   └─ portfolios    (user_id, holdings, transactions)
                        ▲                    ▲
                        │ read on load       │ auth (email/password + Google OAuth)
                        ▼                    ▼
                  index.html  ← Cloudflare Pages ← GitHub push (auto-deploy)
```

- Browser reads everything from Supabase on load (~1–2 s).
- Client only fetches Finnomena directly if server data is >3 days old, via
  proxy chain: private Worker proxy → public CORS proxies → direct.
- Worker also exposes `/fn/<path>` (private Finnomena proxy) and `/sync?slice=N`.

## Domains

| Domain | Points to |
|---|---|
| `fundtracking.yourpower.today` | Cloudflare Pages (dashboard, GitHub-connected) |
| `fund-nav-sync.nupark.workers.dev` | Worker `fund-nav-sync` — **canonical URL; dashboard proxy uses this** |
| `api.yourpower.today` | was attached to Pages by mistake; no longer needed (workers.dev URL used instead) |
| `fund.yourpower.today` | legacy — old Worker `yourpower-fund` (old dashboard); safe to retire |

## Features (v2.x)

- TH/EN language switch (persisted), ~120 translated strings
- Historical comparison chart: Value / %Change / NAV modes,
  timeframes 1W · 1M · 3M · 6M · 1Y · YTD · MAX + custom date range
- Benchmark overlay: any Finnomena fund as dashed reference line
- Risk & Performance: period return, annualized volatility, max drawdown,
  return/risk, best/worst day — portfolio, benchmark, and per fund
- Fund switch (⇌): sell one fund / buy another with independent dates,
  prices auto-resolved from NAV on each date, new funds auto-fetched & synced,
  realized P/L recorded; legs marked ⇌ in transaction history
- Fund detail modal: served instantly from `fund_details`;
  fees show ONLY actual collected (เก็บจริง): management fee + TER
- CSV export (filter/sort aware, BOM for Thai Excel) + print stylesheet
- Sticky AMC/Tax filter bar; Enter submits sign-in form
- Auth: email/password + **Google OAuth** (Supabase provider)

## Auth / accounts

- Google provider enabled in Supabase (Google Cloud OAuth client).
- Supabase Auth URL Configuration: Site URL + Redirect URLs must be
  `https://fundtracking.yourpower.today/**` (localhost default causes
  ERR_CONNECTION_REFUSED after Google login).
- Portfolio moved from old email account `a848c932-…` (nupark.jr@gmail.com)
  to Google account `f073cdc7-…` (nuparkjr@gmail.com) via SQL upsert on
  `portfolios`. Old account can be deleted once verified.

## Worker: `worker/nav-sync/`

- Free-plan friendly: 8 funds per invocation (≈44 subrequests < 50 limit),
  cron `*/15 * * * *`, stateless time-based slice rotation → full refresh ~2 h.
- Syncs NAV (range 1M) + full details incl. actual fees (mgmtA/terA parsed
  from the Thai `/fee` endpoint descriptions).
- Details stored only when the main info endpoint succeeds (no partial cache).
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role — Worker
  secret only, NEVER in index.html).
- Deploy: `cd worker/nav-sync && npx wrangler deploy`

## Deploy flows

- **Dashboard:** edit `index.html` → `git push` → Cloudflare Pages auto-deploys.
- **Worker:** `npx wrangler deploy` from `worker/nav-sync/` (git push does NOT deploy the worker).

## Data & client caches

- localStorage keys: `kkp_navdb_v2` (NAV), `kkp_funddet_v2` (details),
  `kkp_txns_v1` (ledger), `kkp_holdings`, `kkp_lang`, `kkp_histtf`,
  `kkp_bench`, `kkp_proxy` (override proxy URL), `kkp_lastNavFetch`.
- Client refetches a fund's details if cached entry is incomplete
  (missing category / mgmtA) — fixes stuck “—” fields.
- Risk level falls back to parsing `risk_spectrum` when `risk_level` is null
  (e.g. SCBGOLDHRMF).

## Known issues / gotchas

1. Dashboard proxy default is `https://fund-nav-sync.nupark.workers.dev`
   (override via localStorage `kkp_proxy`). `api.yourpower.today` ended up
   attached to the Pages project — if any URL returns HTML where JSON is
   expected, you're hitting the dashboard, not the worker.
2. Old Worker `yourpower-fund` + domain `fund.yourpower.today` still exist;
   delete when convenient.
3. `KKP_Portfolio_Dashboard.html` and `template3.html` were removed from the
   repo (old dashboards, confusing + exposed stale data). They remain in git
   history only.
4. Workers free plan: 50 subrequests/invocation — don't raise SLICE_SIZE
   above ~9 without a paid plan.
5. Buy/Sell + Switch ledger lives in `portfolios.transactions`; deleting a
   ledger row recomputes holdings/realized P/L from scratch (buildHoldings).

## File map

```
index.html                 dashboard (single file: CSS + HTML + JS, ~2,620 lines)
worker/nav-sync/           Cloudflare Worker (sync + proxy) + README + wrangler.toml
supabase_*.sql             historical schema/setup scripts
holdings.json / *.json     sample & seed data (dashboard no longer depends on them)
HANDOFF.md                 this file
```

## History of major commits

- `bd6b4f3` v2.0: TH/EN, adjustable timeframe chart, benchmark, risk metrics, CSV, sticky filters
- `757d907` / `83a2b1b` remove legacy HTML dashboards
- `d0c555a` fees: actual collected (เก็บจริง) only
- `9f5dac1` server-side sync worker + client speedups (delta upsert, parallel modal)
- `87edcec` worker: fund-details sync, free-plan slice rotation
- `dcc7a6e`