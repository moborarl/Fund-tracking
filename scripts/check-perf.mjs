// Runs the index.html performance engine against JSON fixtures in a vm sandbox.
// Run standalone: node scripts/check-perf.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const START = '/* ==== PERF ENGINE START ==== */';
const END = '/* ==== PERF ENGINE END ==== */';

export function engineSource(html = fs.readFileSync('index.html', 'utf8')) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error('perf engine sentinels not found in index.html');
  return html.slice(a + START.length, b);
}

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

function runOne(src, fx) {
  const s = fx.state;
  const ctx = {
    HOLDINGS_BASE: s.HOLDINGS_BASE || {},
    HOLDINGS: s.HOLDINGS || JSON.parse(JSON.stringify(s.HOLDINGS_BASE || {})),
    TXNS: s.TXNS || [],
    NAVDB: s.NAVDB || {},
    filterAMC: new Set(s.filterAMC || []),
    filterTax: new Set(s.filterTax || []),
    histTF: s.histTF || 'MAX',
    histFrom: s.histFrom || '',
    histTo: s.histTo || '',
    console
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'perf-engine.js' });
  const out = { errors: [] };

  let rows;
  try {
    rows = vm.runInContext('portfolioSeries()', ctx);
  } catch (e) {
    if (fx.expect.error) {
      if (!String(e.message).includes(fx.expect.error)) out.errors.push(`expected error containing "${fx.expect.error}", got "${e.message}"`);
      return out;
    }
    out.errors.push('portfolioSeries threw: ' + e.message);
    return out;
  }

  if (fx.expect.series) {
    const want = fx.expect.series;
    if (rows.length !== want.length) out.errors.push(`series length ${rows.length}, expected ${want.length}`);
    want.forEach((w, i) => {
      const r = rows[i];
      if (!r) { out.errors.push(`series[${i}] missing`); return; }
      if (r.date !== w.date) out.errors.push(`series[${i}].date ${r.date}, expected ${w.date}`);
      if (!near(r.value, w.value)) out.errors.push(`series[${i}].value ${r.value}, expected ${w.value}`);
    });
  }

  if (fx.expect.twrPct != null) {
    const w = vm.runInContext('tfWindow(' + JSON.stringify(rows.map(r => r.date)) + ')', ctx);
    const set = new Set(w);
    const twr = rows.filter(r => set.has(r.date)).map(r => r.twr);
    const got = twr.length >= 2 ? (twr[twr.length - 1] / twr[0] - 1) * 100 : NaN;
    if (!near(got, fx.expect.twrPct)) out.errors.push(`TWR ${got}%, expected ${fx.expect.twrPct}%`);
  }

  if (fx.expect.window) {
    const w = vm.runInContext('tfWindow(' + JSON.stringify(rows.map(r => r.date)) + ')', ctx);
    const want = fx.expect.window;
    if (w.length !== want.length) out.errors.push(`window length ${w.length}, expected ${want.length}`);
    want.forEach((d, i) => { if (w[i] !== d) out.errors.push(`window[${i}] ${w[i]}, expected ${d}`); });
  }

  if (fx.expect.cashflows) {
    const w = vm.runInContext('tfWindow(' + JSON.stringify(rows.map(r => r.date)) + ')', ctx);
    const set = new Set(w);
    const wr = rows.filter(r => set.has(r.date));
    const got = vm.runInContext('windowCashflows(' + JSON.stringify(wr) + ')', ctx);
    const want = fx.expect.cashflows;
    if (got.length !== want.length) out.errors.push(`cashflows length ${got.length}, expected ${want.length}`);
    want.forEach((w2, i) => {
      const g = got[i];
      if (!g) { out.errors.push(`cashflows[${i}] missing`); return; }
      if (g.date !== w2.date) out.errors.push(`cashflows[${i}].date ${g.date}, expected ${w2.date}`);
      if (!near(g.amount, w2.amount)) out.errors.push(`cashflows[${i}].amount ${g.amount}, expected ${w2.amount}`);
    });
  }

  if (fx.expect.coverageAt) {
    const got = vm.runInContext(`windowCoverage(${JSON.stringify(fx.expect.coverageAt.date)})`, ctx);
    if (!near(got, fx.expect.coverageAt.ratio)) out.errors.push(`coverage ${got}, expected ${fx.expect.coverageAt.ratio}`);
  }

  return out;
}

export async function runFixtures() {
  const src = engineSource();
  const dir = 'test/fixtures';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  let passed = 0;
  const failed = [];
  for (const f of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    let res;
    try { res = runOne(src, fx); }
    catch (e) { res = { errors: ['harness error: ' + e.message] }; }
    if (res.errors.length) failed.push(`${f} (${fx.name}): ${res.errors.join('; ')}`);
    else passed++;
  }
  return { passed, failed };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const { passed, failed } = await runFixtures();
  failed.forEach(f => console.error('✗ ' + f));
  console.log(`${passed} fixture(s) passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
