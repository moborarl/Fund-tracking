# 🚀 Fund Tracking Dashboard — Project Handoff

**Project:** Multi-AMC Portfolio Monitor (v2.x)
**Last Updated:** 2026-07-14

> ⚠️ **RULE FOR ANY EDIT TO index.html:** the page ships a CSP that pins a
> sha256 hash of the inline script. After ANY change run
> `node scripts/update-csp.mjs` then `node scripts/check.mjs` before
> committing — otherwise the browser blocks ALL JavaScript on the live site
> (buttons dead, no data). CI (`.github/workflows/check.yml`) fails the build
> if the hash is stale or i18n keys are missing in either language.
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

- Browser reads NAV/details only for held, transacted, and benchmark funds;
  market-data writes remain Worker-owned.
- Client only fetches Finnomena directly if server data is >3 days old, via
  proxy chain: private Worker proxy → public CORS proxies → direct.
- Worker exposes `/fn/<path>` (origin-restricted Finnomena proxy). Manual
  `/sync?slice=N` and `/backfill?slice=N` are authenticated `POST` endpoints.

## Domains

| Domain | Points to |
|---|---|
| `fundtracking.yourpower.today` | Cloudflare Pages (dashboard, GitHub-connected) |
| `api.yourpower.today` | Worker `fund-nav-sync` custom domain — **canonical URL; dashboard proxy uses this** |
| `fund-nav-sync.nupark.workers.dev` | Disabled; Wrangler serves the Worker only through the custom domain |
| `fund.yourpower.today` | legacy — old Worker `yourpower-fund` (old dashboard); safe to retire |

## Features (v2.x)

- TH/EN language switch (persisted), including dynamic modals/status/error copy
- Historical comparison chart: ledger-adjusted Value / TWR / NAV modes,
  timeframes 1W · 1M · 3M · 6M · 1Y · YTD · MAX + custom date range
- Benchmark overlay: any Finnomena fund as dashed reference line
- Risk & Performance: ledger-adjusted TWR, estimated XIRR, annualized
  volatility, max drawdown, return/volatility, best/worst day
- Fund switch (⇌): sell one fund / buy another with independent dates;
  incoming units derive from net sale proceeds after an optional switching fee
- Append-only transaction corrections: the UI appends `void` records and never
  deletes or mutates prior buy/sell/switch entries
- Fund detail modal: served instantly from `fund_details`;
  fees show ONLY actual collected (เก็บจริง): management fee + TER
- CSV export (filter/sort aware, BOM for Thai Excel) + print stylesheet
- Per-fund NAV freshness, valuation coverage, stale-data badges, and proper
  zero-portfolio empty state
- Responsive mobile action menu; keyboard-operable fund rows, focus-trapped
  dialogs, accessible labels, and escaped external/imported strings
- Auth: email/password + **Google OAuth** (Supabase provider)
- Dividend ledger entries (amount in THB) → realized P/L and TWR/XIRR flows
- Tax-Fund Unlock Schedule: SSF 10y, ThaiESG/X 5y, RMF (age 55 & 5y; birth
  date stored locally as `kkp_birth`); views By lot / By fund / By year
  (Thai UI shows Buddhist years); every dated lot has a ✎ edit button
- Look-Through Holdings: aggregates each fund's top-5 into real security
  exposure; click a row to expand contributing funds (% in fund, ฿)
- TWR vs Benchmark (alpha) card in Risk section when a benchmark is set
- Valuation-coverage chip is clickable → lists funds that have no NAV yet
- Mobile: holdings table collapses to labeled cards under 680 px; loading
  skeleton shimmer replaces blank hero values

## Portfolio import (holdings.json)

Per-fund schema (all fields except `units`/`avg` optional):

```json
"FUND CODE": { "units": 1234.5678, "avg": 10.5, "realized": 0,
               "tax": "ThaiESGX",
               "lots": [ { "date": "2022-12-31", "units": 500, "cost": 5000 } ] }
```

- Fund code must match Finnomena's short code exactly. `tax`/`amc`/`name`
  auto-fill from `fund_details` when omitted (explicit values win).
- **Merge dialog:** OK = update/add only funds in the file · Cancel = replace all.
- **`"units": 0` deletes the fund** from the portfolio (both modes).
- Import stamps `asof` (import date) per fund; **ledger transactions dated on
  or before `asof` are "absorbed"** — not re-applied to units/cost/TWR/unlock
  (prevents double counting with statement balances). They stay visible in
  history, dimmed, labeled "included in imported balance".
- Import registers all codes in `fund_universe` so the Worker starts syncing
  new funds (full coverage within ~2 h).
- "📋 Copy AI import prompt" button (page footer) produces an OCR prompt that
  converts statement screenshots into this schema, incl. per-year lots.
- `holdings_update.json` in the repo = the user's verified full portfolio
  (2026-07-14, cross-checked 59/59 units against AMC statements).

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
- Fund-code sources (`allCodes`): `fund_details` ∪ latest `nav_history` page
  ∪ `fund_universe` (registered by the dashboard on buy/switch/import) —
  without the last one, newly imported funds never enter the sync loop.
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (dedicated `sb_secret_...`
  key named `fund_nav_sync_v2`), and
  `SYNC_TOKEN` (manual endpoint bearer token) — Worker secrets only.
- Manual sync/backfill require `POST` + `Authorization: Bearer <SYNC_TOKEN>`;
  scheduled sync does not require the token.
- Structured Workers logs and Wrangler observability are enabled.
- Deploy: `cd worker/nav-sync && npx wrangler deploy`

## Deploy flows

- **Dashboard:** edit `index.html` → `git push` → Cloudflare Pages auto-deploys.
- **Worker:** `npx wrangler deploy` from `worker/nav-sync/` (git push does NOT deploy the worker).

## Data & client caches

- localStorage keys: `kkp_navdb_v2` (NAV), `kkp_funddet_v2` (details),
  `kkp_txns_v1` (ledger), `kkp_holdings`, `kkp_lang`, `kkp_histtf`,
  `kkp_bench`, `kkp_proxy` (override proxy URL), `kkp_lastNavFetch`,
  `kkp_birth` (RMF unlock), `kkp_unlockmode` (lot/fund/year view).
- Cloud persistence: `portfolios.holdings` keeps `lots`, `firstBuy`, `asof`
  per fund — purchase dates follow the account across devices.
- Client refetches a fund's details if cached entry is incomplete
  (missing category / mgmtA) — fixes stuck “—” fields.
- Risk level falls back to parsing `risk_spectrum` when `risk_level` is null
  (e.g. SCBGOLDHRMF).

## Known issues / gotchas

1. Production Worker is live at `https://api.yourpower.today`; `/health`
   returns JSON and authenticated slice syncs passed 8/8 for NAV and details.
   The Pages association and stale `api` CNAME were removed before attaching
   the Worker custom domain. `workers.dev` is disabled.
2. Legacy Worker `yourpower-fund` and `fund.yourpower.today` are already gone.
3. The old email auth user `a848c932-…` has not been deleted: the 2026-07-13
   REST audit could not see private `portfolios` rows in that API context, so
   portfolio parity with Google user `f073cdc7-…` remains unverified.
4. `KKP_Portfolio_Dashboard.html` and `template3.html` were removed from the
   repo (old dashboards, confusing + exposed stale data). They remain in git
   history only.
5. Workers free plan: 50 subrequests/invocation — don't raise SLICE_SIZE
   above ~9 without a paid plan.
6. Buy/Sell + Switch ledger lives in `portfolios.transactions`; corrections
   append `action: "void"` rows. `buildHoldings()` ignores voided originals and
   recomputes holdings/average cost/realized P/L from the effective ledger.
6. Ledger-adjusted history treats imported `HOLDINGS_BASE` as the opening
   position before the first recorded transaction. XIRR treats the opening
   market value as the initial cash flow for the selected window.

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
- `dcc7a6e` fix incomplete detail caching + risk_spectrum fallback
- `675b0e4` Google sign-in (Supabase OAuth)
- `769548e`/`c158002` (Codex) ledger-adjusted TWR/XIRR, void corrections,
  switch fee, Worker auth token + CSP + origin allow-list, api.yourpower.today
- `c7c62a7` dividend txns, unlock schedule, look-through, alpha card,
  mobile cards, skeleton, CI (scripts/check.mjs + GitHub Action)
- `8e9872f` fix CSP hash blocking all JS + scripts/update-csp.mjs
- `dbc80e3` unlock views (lot/fund/year), look-through drill-down
- `327a05b`/`39ebadd` import merge option, per-year lots schema
- `3076046` AMC auto-fill from fund details, per-lot date editing
- `d068ead` fund_universe as Worker code source (new imports sync)
- `435906b`/`0f36a42` units:0 deletes fund; asof absorbs pre-import ledger
  txns (double-counting fix)
