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
npx wrangler secret put SUPABASE_SERVICE_KEY  # dedicated sb_secret key (Supabase → Settings → API Keys)
npx wrangler secret put SYNC_TOKEN             # long random bearer token for manual syncs
```

## Domain

`wrangler.toml` declares `api.yourpower.today` as this Worker's custom domain.
If the domain is attached to the Pages dashboard project, remove it there
before deploying the Worker. The dashboard continues to use the workers.dev
URL until the custom domain returns the Worker health JSON.

## Test

Health check (no authentication required):

```
GET https://api.yourpower.today/health
```

Manual syncs are authenticated `POST` requests:

```
curl -X POST "https://api.yourpower.today/sync?slice=0" \
  -H "Authorization: Bearer $SYNC_TOKEN"
```

Successful response:

```
{ "slice":3, "of":9, "funds":[...8 codes...],
  "nav":{"ok":8,"fail":0,"upserted":176},
  "details":{"ok":8,"fail":0,"upserted":8}, ... }
```

Each manual call or cron run does one slice. `/sync?slice=0` … `?slice=N`
forces a specific slice. After ~2 hours of cron runs, all funds are covered.

## Security

The dedicated `sb_secret_...` key bypasses Supabase RLS. It lives only as an
encrypted Worker secret — never put it in index.html (public page source). `/sync` and
`/backfill` require `SYNC_TOKEN`; the scheduled handler does not.
