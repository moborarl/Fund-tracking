# fund-nav-sync Worker

Server-side NAV sync: Finnomena → Supabase every 6 hours, plus a private CORS
proxy so the dashboard never depends on slow public proxies.

## Deploy (one time, ~3 minutes)

```
cd worker/nav-sync
npx wrangler login                          # once, opens browser
npx wrangler secret put SUPABASE_URL        # paste: https://pmfqjnheavnbqpsdnffm.supabase.co
npx wrangler secret put SUPABASE_SERVICE_KEY# paste service_role key (Supabase → Settings → API)
npx wrangler deploy
```

Then in Cloudflare dashboard → Workers & Pages → fund-nav-sync →
Settings → Domains & Routes → **Add custom domain: `api.yourpower.today`**
(the dashboard is pre-configured to use this URL as its fast proxy).

## Test

- Open `https://api.yourpower.today/sync` → should return JSON like
  `{"funds":65,"ok":65,"fail":0,"upserted":1400,...}`
- Dashboard page loads will now be ~1–2 s with fresh data; the client only
  fetches from Finnomena itself if server data is older than 3 days.

## Notes

- The service_role key bypasses RLS — it lives only as a Worker secret,
  never in the HTML.
- New funds added via Buy/Switch write their history from the browser once;
  the cron picks them up automatically afterwards.
