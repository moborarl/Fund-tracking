/**
 * fund-nav-sync — Cloudflare Worker
 * 1) Cron (every 6h): fetch NAV for all funds from Finnomena, upsert into Supabase nav_history.
 * 2) /fn/<path>   : private CORS proxy to finnomena.com (fast, no public-proxy rate limits).
 * 3) /sync        : trigger a sync manually, returns JSON summary.
 *
 * Secrets (set with `npx wrangler secret put <NAME>`):
 *   SUPABASE_URL          e.g. https://pmfqjnheavnbqpsdnffm.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key (Supabase → Settings → API). Never put this in the HTML.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncNAV(env));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Private Finnomena proxy: /fn/fn3/api/fund/v2/public/funds/...
    if (url.pathname.startsWith('/fn/')) {
      const target = 'https://www.finnomena.com/' + url.pathname.slice(4) + url.search;
      const r = await fetch(target, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (fund-dashboard)' },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      return new Response(r.body, {
        status: r.status,
        headers: { ...CORS, 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'public, max-age=300' },
      });
    }

    if (url.pathname === '/sync') {
      const out = await syncNAV(env);
      return new Response(JSON.stringify(out, null, 2), { headers: { ...CORS, 'content-type': 'application/json' } });
    }

    return new Response('fund-nav-sync · endpoints: /fn/<finnomena-path> (proxy), /sync (manual sync)', { headers: CORS });
  },
};

async function syncNAV(env) {
  const sb = (path, init = {}) =>
    fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
      ...init,
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });

  // 1) All known fund codes (from existing NAV history)
  const res = await sb('nav_history?select=code');
  if (!res.ok) return { error: 'cannot read nav_history: ' + res.status };
  const codes = [...new Set((await res.json()).map(r => r.code))];

  // 2) Fetch latest NAVs from Finnomena (batches of 10 to be polite)
  let ok = 0, fail = 0;
  const records = [];
  for (let i = 0; i < codes.length; i += 10) {
    await Promise.all(
      codes.slice(i, i + 10).map(async code => {
        try {
          const r = await fetch(
            'https://www.finnomena.com/fn3/api/fund/v2/public/funds/' + encodeURIComponent(code) + '/nav/q?range=1M',
            { headers: { accept: 'application/json' } }
          );
          const j = await r.json();
          if (j && j.data && j.data.navs) {
            ok++;
            j.data.navs.forEach(n => records.push({ code, date: n.date.slice(0, 10), nav: n.value }));
          } else fail++;
        } catch (e) { fail++; }
      })
    );
  }

  // 3) Upsert in batches of 500
  let upserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const r = await sb('nav_history?on_conflict=code,date', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
    if (r.ok) upserted += batch.length;
  }

  return { funds: codes.length, ok, fail, upserted, at: new Date().toISOString() };
}
