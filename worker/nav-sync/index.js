/**
 * fund-nav-sync — Cloudflare Worker
 *
 * Syncs BOTH NAV prices AND fund details (returns, actual fees, top holdings,
 * strategy) from Finnomena into Supabase, so the dashboard reads everything
 * from the database instantly.
 *
 * Designed for the Workers FREE plan (50 subrequests/invocation):
 * funds are processed in rotating slices of 8, cron runs every 15 minutes,
 * so every fund is fully refreshed roughly every 2 hours.
 *
 * Endpoints:
 *   /fn/<path>     private CORS proxy to finnomena.com (fast client calls)
 *   /sync          sync the current time-based slice (JSON summary)
 *   /sync?slice=N  sync a specific slice manually
 *
 * Secrets (npx wrangler secret put <NAME>):
 *   SUPABASE_URL          e.g. https://pmfqjnheavnbqpsdnffm.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key — Worker secret only, never in HTML
 */

const SLICE_SIZE = 8;
const FN = 'https://www.finnomena.com/fn3/api/fund/v2/public/funds/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncSlice(env, null));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

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
      const sliceParam = url.searchParams.get('slice');
      const out = await syncSlice(env, sliceParam === null ? null : parseInt(sliceParam, 10));
      return new Response(JSON.stringify(out, null, 2), { headers: { ...CORS, 'content-type': 'application/json' } });
    }

    return new Response('fund-nav-sync · /fn/<finnomena-path> proxy · /sync[?slice=N]', { headers: CORS });
  },
};

function sbFetch(env, path, init = {}) {
  return fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function syncSlice(env, sliceIdx) {
  // 1) All known fund codes
  const res = await sbFetch(env, 'nav_history?select=code');
  if (!res.ok) return { error: 'cannot read nav_history: ' + res.status };
  const codes = [...new Set((await res.json()).map(r => r.code))].sort();
  const nSlices = Math.max(1, Math.ceil(codes.length / SLICE_SIZE));
  // Stateless rotation: slice advances every 15 minutes
  if (sliceIdx === null || isNaN(sliceIdx)) sliceIdx = Math.floor(Date.now() / 900000) % nSlices;
  const slice = codes.slice(sliceIdx * SLICE_SIZE, (sliceIdx + 1) * SLICE_SIZE);

  let navOk = 0, navFail = 0, detOk = 0, detFail = 0;
  const navRecords = [];
  const detRecords = [];

  await Promise.all(slice.map(async code => {
    const base = FN + encodeURIComponent(code);
    const g = async u => {
      try { const r = await fetch(u, { headers: { accept: 'application/json' } }); const j = await r.json(); return (j && j.data) || null; }
      catch (e) { return null; }
    };
    // NAV + all 4 detail endpoints in parallel (5 subrequests per fund)
    const [nav, a, b, c, fe] = await Promise.all([
      g(base + '/nav/q?range=1M'), g(base), g(base + '/performance'), g(base + '/portfolio'), g(base + '/fee'),
    ]);

    if (nav && nav.navs) { navOk++; nav.navs.forEach(n => navRecords.push({ code, date: n.date.slice(0, 10), nav: n.value })); }
    else navFail++;

    if (a) { // only store complete records; partial failures retry next cycle
      const feeArr = (fe && fe.fees) || [];
      const feeOf = kw => {
        const x = feeArr.find(f => (f.description || '').includes(kw));
        if (!x || x.actual_value === '' || x.actual_value == null) return null;
        const v = parseFloat(x.actual_value); return isNaN(v) ? null : v;
      };
      detOk++;
      detRecords.push({ code, data: {
        mgmtA: feeOf('ค่าธรรมเนียมการจัดการ'), terA: feeOf('รวมทั้งหมด'),
        taxType: (a && (a.fund_tax_type || a.tax_saving_fund)) || '',
        amc: a && a.amc_name_en, cat: a && a.aimc_category_name_en, catTh: a && a.aimc_category_name_th,
        risk: a && (a.risk_level || parseInt(a.risk_spectrum) || null), div: a && a.dividend_policy,
        mgmt: a && a.real_management_fee, exp: a && a.net_expense_ratio,
        front: a && a.real_front_end_fee, back: a && a.real_back_end_fee,
        inc: ((a && a.inception_date) || '').slice(0, 10),
        feeder: (a && a.main_feeder_fund) || '', hedge: (a && a.exchange_rate_risk_spectrum) || '',
        strat: (a && (a.fund_short_desc || a.investment_strategy)) || '',
        r3m: b && b.total_return_3m, r6m: b && b.total_return_6m, r1y: b && b.total_return_1y, r3y: b && b.total_return_3y,
        na: b && b.net_assets,
        top: ((c && c.top_holdings && c.top_holdings.elements) || []).slice(0, 5).map(h => [h.name, h.percent]),
      }});
    } else detFail++;
  }));

  // 2) Upserts
  let navUpserted = 0, detUpserted = 0;
  if (navRecords.length) {
    const r = await sbFetch(env, 'nav_history?on_conflict=code,date', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(navRecords),
    });
    if (r.ok) navUpserted = navRecords.length;
  }
  if (detRecords.length) {
    const r = await sbFetch(env, 'fund_details?on_conflict=code', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(detRecords),
    });
    if (r.ok) detUpserted = detRecords.length;
  }

  return {
    slice: sliceIdx, of: nSlices, funds: slice,
    nav: { ok: navOk, fail: navFail, upserted: navUpserted },
    details: { ok: detOk, fail: detFail, upserted: detUpserted },
    at: new Date().toISOString(),
  };
}
