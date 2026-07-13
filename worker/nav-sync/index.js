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
 *   SYNC_TOKEN            bearer token for manual /sync and /backfill requests
 */

const SLICE_SIZE = 8;
const FN = 'https://www.finnomena.com/fn3/api/fund/v2/public/funds/';
const ALLOWED_ORIGINS = new Set(['https://fundtracking.yourpower.today']);

function corsHeaders(req) {
  const origin = req.headers.get('origin');
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...headers, 'cache-control': 'no-store' } });
}

function log(level, event, data = {}) {
  const entry = JSON.stringify({ level, event, at: new Date().toISOString(), ...data });
  if (level === 'error') console.error(entry); else console.log(entry);
}

async function isAuthorized(req, env) {
  const supplied = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!supplied || !env.SYNC_TOKEN) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(supplied)),
    crypto.subtle.digest('SHA-256', enc.encode(env.SYNC_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function sliceParam(url) {
  const raw = url.searchParams.get('slice');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : NaN;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncSlice(env, null)
      .then(out => log('info', 'scheduled_sync_complete', out))
      .catch(error => log('error', 'scheduled_sync_failed', { error: error instanceof Error ? error.message : String(error) })));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return origin && !ALLOWED_ORIGINS.has(origin) ? json({ error: 'origin not allowed' }, 403, cors) : new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname.startsWith('/fn/')) {
        if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin not allowed' }, 403, cors);
        const target = 'https://www.finnomena.com/' + url.pathname.slice(4) + url.search;
        const r = await fetch(target, {
          headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (fund-dashboard)' },
          cf: { cacheTtl: 300, cacheEverything: true },
        });
        return new Response(r.body, {
          status: r.status,
          headers: { ...cors, 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'public, max-age=300' },
        });
      }

      if (url.pathname === '/backfill' || url.pathname === '/sync') {
        if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin not allowed' }, 403, cors);
        if (!await isAuthorized(req, env)) return json({ error: 'unauthorized' }, 401, cors);
        const slice = sliceParam(url);
        if (Number.isNaN(slice)) return json({ error: 'slice must be a non-negative integer' }, 400, cors);
        const out = url.pathname === '/backfill' ? await backfill(env, slice ?? 0) : await syncSlice(env, slice);
        const status = out.error ? 400 : 200;
        log(status === 200 ? 'info' : 'error', url.pathname === '/backfill' ? 'manual_backfill' : 'manual_sync', out);
        return json(out, status, cors);
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ service: 'fund-nav-sync', status: 'ok', manualSync: 'POST /sync?slice=N' }, 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (error) {
      log('error', 'request_failed', { path: url.pathname, error: error instanceof Error ? error.message : String(error) });
      return json({ error: 'internal error' }, 500, cors);
    }
  },
};

async function allCodes(env) {
  // fund_details has exactly one row per fund; nav_history latest page catches brand-new funds
  const [r1, r2] = await Promise.all([
    sbFetch(env, 'fund_details?select=code'),
    sbFetch(env, 'nav_history?select=code&order=date.desc&limit=1000'),
  ]);
  if (!r1.ok && !r2.ok) return { error: 'cannot read fund codes' };
  const set = new Set();
  if (r1.ok) (await r1.json()).forEach(r => set.add(r.code));
  if (r2.ok) (await r2.json()).forEach(r => set.add(r.code));
  return [...set].sort();
}

/**
 * One-time backfill: fetch 1 YEAR of NAV history (covers since Jan 1).
 * 25 funds per slice to stay under the free-plan subrequest limit.
 * Call /backfill?slice=0 then 1 then 2 (until "funds" list is empty).
 */
async function backfill(env, sliceIdx) {
  const BF = 25;
  const codes = await allCodes(env);
  if (codes.error) return codes;
  const nSlices = Math.max(1, Math.ceil(codes.length / BF));
  if (!Number.isInteger(sliceIdx) || sliceIdx < 0 || sliceIdx >= nSlices) return { error: 'slice out of range', slice: sliceIdx, of: nSlices };
  const slice = codes.slice(sliceIdx * BF, (sliceIdx + 1) * BF);
  let ok = 0, fail = 0;
  const records = [];
  await Promise.all(slice.map(async code => {
    try {
      const r = await fetch(FN + encodeURIComponent(code) + '/nav/q?range=1Y', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('Finnomena HTTP ' + r.status);
      const j = await r.json();
      if (j && j.data && j.data.navs) { ok++; j.data.navs.forEach(nn => records.push({ code, date: nn.date.slice(0, 10), nav: nn.value })); }
      else fail++;
    } catch (e) { fail++; }
  }));
  let upserted = 0;
  for (let i = 0; i < records.length; i += 800) {
    const b = records.slice(i, i + 800);
    const r = await sbFetch(env, 'nav_history?on_conflict=code,date', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(b),
    });
    if (r.ok) upserted += b.length;
  }
  return { backfill: '1Y', slice: sliceIdx, of: nSlices, funds: slice, ok, fail, upserted, at: new Date().toISOString() };
}

function sbFetch(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  const authHeaders = key.startsWith('sb_secret_') ? {} : { authorization: 'Bearer ' + key };
  return fetch(env.SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: key,
      ...authHeaders,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function syncSlice(env, sliceIdx) {
  const codes = await allCodes(env);
  if (codes.error) return codes;
  const nSlices = Math.max(1, Math.ceil(codes.length / SLICE_SIZE));
  // Stateless rotation: slice advances every 15 minutes
  if (sliceIdx === null || isNaN(sliceIdx)) sliceIdx = Math.floor(Date.now() / 900000) % nSlices;
  if (!Number.isInteger(sliceIdx) || sliceIdx < 0 || sliceIdx >= nSlices) return { error: 'slice out of range', slice: sliceIdx, of: nSlices };
  const slice = codes.slice(sliceIdx * SLICE_SIZE, (sliceIdx + 1) * SLICE_SIZE);

  let navOk = 0, navFail = 0, detOk = 0, detFail = 0;
  const navRecords = [];
  const detRecords = [];

  await Promise.all(slice.map(async code => {
    const base = FN + encodeURIComponent(code);
    const g = async u => {
      try { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) return null; const j = await r.json(); return (j && j.data) || null; }
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
