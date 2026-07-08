# fund-nav-sync Worker

Syncs **NAV prices + fund details** (returns, actual fees, top holdings,
strategy) from Finnomena into Supabase automatically, and provides a private
CORS proxy. The dashboard then reads everything from Supabase instantly —
no waiting for Finnomena when opening the page or clicking a fund.

Free-plan friendly: funds are processed in rotating slices of 8, cron runs
every 15 minutes → every fund fully refreshed about every 2 hours.

## Deploy / update

```
cd worker/nav-sync
npx wrangler deploy
```

First time only, also set secrets:

```
npx wrangler login
npx wrangler secret put SUPABASE_URL          # https://pmfqjnheavnbqpsdnffm.supabase.co
npx wrangler secret put SUPABASE_SERVICE_KEY  # service_role key (Supabase → Settings → API)
```

## Domain

Attach `api.yourpower.today` to THIS worker (optional — dashboard already uses the workers.dev URL) (Cloudflare → fund-nav-sync →
Settings → Domains & Routes → Add custom domain). If that domain is attached
to the dashboard project, remove it there first. The dashboard uses
`https://api.yourpower.today/fn/...` as its fast proxy.

## Test

Open `https://fund-nav-sync.nupark.workers.dev/sync` (or the worker's .workers.dev URL + /sync):

```
{ "slice":3, "of":9, "funds":[...8 codes...],
  "nav":{"ok":8,"fail":0,"upserted":176},
  "details":{"ok":8,"fail":0,"upserted":8}, ... }
```

Each call/cron run does one slice. `/sync?slice=0` … `?slice=N` to force a
specific slice. After ~2 hours of cron runs, all funds are covered.

## Security

The service_role key bypasses Supabase RLS. It lives only as an encrypted
Worker secret — never put it in index.html (public page source).
