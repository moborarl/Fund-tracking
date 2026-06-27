// Cloudflare Worker — daily NAV + fund-details refresh into Supabase.
// Deploy on Cloudflare dashboard, add 2 env vars (Settings -> Variables):
//   SUPABASE_URL        = https://pmfqjnheavnbqpsdnffm.supabase.co
//   SUPABASE_SERVICE_KEY= <your Supabase SECRET key>  (mark as "Encrypt/Secret")
// Add a Cron Trigger (e.g. "0 13 * * *" = 13:00 UTC = 20:00 Thai).
// Test by visiting the worker URL in a browser (runs once, shows JSON result).

const FINN = "https://www.finnomena.com/fn3/api/fund/v2/public/funds";

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(refresh(env)); },
  async fetch(req, env) {
    const out = await refresh(env);
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  },
};

function sb(env, path, opts = {}) {
  return fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
}
const J = (u) => fetch(u).then((r) => r.json()).then((j) => j.data).catch(() => null);

async function refresh(env) {
  const uni = await (await sb(env, "fund_universe?select=code&active=eq.true")).json();
  const codes = (uni || []).map((r) => r.code);
  navRows = 0; details = 0; fails = 0;
  for (const code of codes) {
    try {
      const navData = await J(`${FINN}/${encodeURIComponent(code)}/nav/q?range=1M`);
      const navs = navData && navData.navs ? navData.navs : [];
      if (navs.length) {
        const rows = navs.map((n) => ({ code, date: n.date.slice(0, 10), nav: n.value }));
        await sb(env, "nav_history?on_conflict=code,date", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
        navRows += rows.length;
      }
      const [d, p, o] = await Promise.all([
        J(`${FINN}/${encodeURIComponent(code)}`),
        J(`${FINN}/${encodeURIComponent(code)}/performance`),
        J(`${FINN}/${encodeURIComponent(code)}/portfolio`),
      ]);
      if (d || p) {
        const data = {
          amc: d && d.amc_name_en, cat: d && d.aimc_category_name_en, catTh: d && d.aimc_category_name_th,
          risk: d && d.risk_level, div: d && d.dividend_policy, mgmt: d && d.real_management_fee,
          exp: d && d.net_expense_ratio, front: d && d.real_front_end_fee, back: d && d.real_back_end_fee,
          inc: ((d && d.inception_date) || "").slice(0, 10), feeder: (d && d.main_feeder_fund) || "",
          strat: (d && (d.fund_short_desc || d.investment_strategy)) || "",
          r3m: p && p.total_return_3m, r6m: p && p.total_return_6m, r1y: p && p.total_return_1y,
          r3y: p && p.total_return_3y, na: p && p.net_assets,
          top: ((o && o.top_holdings && o.top_holdings.elements) || []).slice(0, 5).map((h) => [h.name, h.percent]),
        };
        await sb(env, "fund_details?on_conflict=code", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ code, data, updated_at: new Date().toISOString() }),
        });
        details++;
      }
    } catch (_) { fails++; }
  }
  return { funds: codes.length, navRows, details, fails, at: new Date().toISOString() };
}
