// ============================================================
//  Supabase Edge Function: refresh NAV + fund details daily
//  Server-side fetch -> NO CORS problem (unlike the browser).
//
//  Deploy:
//    supabase functions deploy nav-refresh --no-verify-jwt
//  Schedule (Supabase Dashboard -> Edge Functions -> Cron, or pg_cron):
//    run daily, e.g. "0 13 * * *" (after Thai market close)
//
//  Env (set as function secrets):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINN = "https://www.finnomena.com/fn3/api/fund/v2/public/funds";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // fund codes to refresh
  const { data: uni } = await supabase.from("fund_universe").select("code").eq("active", true);
  const codes: string[] = (uni ?? []).map((r: any) => r.code);
  if (!codes.length) return new Response("no fund codes in fund_universe", { status: 200 });

  let navRows = 0, detailCount = 0;
  for (const code of codes) {
    const B = `${FINN}/${encodeURIComponent(code)}`;
    try {
      // --- NAV (1M) ---
      const navRes = await fetch(`${B}/nav/q?range=1M`);
      const navJson = await navRes.json();
      const navs = navJson?.data?.navs ?? [];
      if (navs.length) {
        const rows = navs.map((n: any) => ({ code, date: n.date.slice(0, 10), nav: n.value }));
        await supabase.from("nav_history").upsert(rows, { onConflict: "code,date" });
        navRows += rows.length;
      }
      // --- details (detail + performance + portfolio) ---
      const [d, p, o] = await Promise.all([
        fetch(B).then((r) => r.json()).then((j) => j.data).catch(() => null),
        fetch(`${B}/performance`).then((r) => r.json()).then((j) => j.data).catch(() => null),
        fetch(`${B}/portfolio`).then((r) => r.json()).then((j) => j.data).catch(() => null),
      ]);
      if (d || p) {
        const detail = {
          amc: d?.amc_name_en, cat: d?.aimc_category_name_en, catTh: d?.aimc_category_name_th,
          risk: d?.risk_level, div: d?.dividend_policy, mgmt: d?.real_management_fee,
          exp: d?.net_expense_ratio, front: d?.real_front_end_fee, back: d?.real_back_end_fee,
          inc: (d?.inception_date ?? "").slice(0, 10), feeder: d?.main_feeder_fund ?? "",
          strat: d?.fund_short_desc || d?.investment_strategy || "",
          r3m: p?.total_return_3m, r6m: p?.total_return_6m, r1y: p?.total_return_1y,
          r3y: p?.total_return_3y, na: p?.net_assets,
          top: (o?.top_holdings?.elements ?? []).slice(0, 5).map((h: any) => [h.name, h.percent]),
        };
        await supabase.from("fund_details").upsert({ code, data: detail, updated_at: new Date().toISOString() });
        detailCount++;
      }
    } catch (_e) { /* skip this fund, continue */ }
  }
  return new Response(JSON.stringify({ funds: codes.length, navRows, detailCount }), {
    headers: { "content-type": "application/json" },
  });
});
