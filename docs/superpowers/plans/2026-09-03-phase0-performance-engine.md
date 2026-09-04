# Phase 0 — Performance Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's portfolio performance figures correct and provable, and make every displayed and exported price reconcile with the market value it produced.

**Architecture:** The pure calculation functions currently scattered through the inline `<script>` in `index.html` are relocated into one contiguous sentinel-delimited block. A new `scripts/check-perf.mjs` slices that block out, evaluates it in a `node:vm` sandbox with injected portfolio state, and asserts against JSON fixtures. Every behavioural change afterwards is driven by a failing fixture.

**Tech Stack:** Plain ES2020 in a single `index.html` inline script. Node 24 for the check scripts (`node:vm`, `node:crypto`, `node:fs`). No test framework, no dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-09-03-dashboard-redesign-design.md` §5, §2, §3, §7.1.

## Global Constraints

- The dashboard ships as a **single file**, `index.html`. No bundler, no external JS module, no new runtime dependency.
- The page pins a sha256 hash of its inline script in a CSP meta tag. **After ANY edit to `index.html`, run `node scripts/update-csp.mjs` then `node scripts/check.mjs` before committing.** A stale hash disables all JavaScript on the live site.
- Every user-visible string must exist in **both** `I18N.en` and `I18N.th`. `scripts/check.mjs` fails the build on a missing key or an `en` key with no `th` translation.
- Never write a synthetic price into `NAVDB`. `NAVDB` is persisted to `localStorage` under `LS_NAV` and represents published market data only.
- The ledger is append-only. Never delete or mutate a `TXNS` entry.
- Existing behaviour that must not regress: `txAbsorbed()` suppression of pre-`asof` entries, the `void` correction mechanism, TH/EN switching, and Supabase load/save.
- Work on branch `redesign/dashboard-ia-visual`.
- Numbers compare with tolerance `Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))`.

---

## File structure

| File | Responsibility |
|---|---|
| `index.html` | Everything shipped. Gains a sentinel-delimited perf-engine block; `renderTable`, `exportCSV`, `computeAll`, `applyFilter` and the `I18N` tables are modified. |
| `scripts/check-perf.mjs` | Create. Slices the engine block, evaluates it per fixture in `node:vm`, asserts expectations, prints one line per fixture. |
| `scripts/check.mjs` | Modify. Invokes `check-perf.mjs`'s exported `runFixtures()` so CI covers it. |
| `test/fixtures/*.json` | Create. One file per scenario, each holding input state and expected output. |

`check-perf.mjs` owns fixture running only; it exports `runFixtures()` and also runs standalone via `node scripts/check-perf.mjs`. Fixtures stay data-only so a new scenario never requires new harness code.

---

## Task 1: Engine block and fixture harness

Relocates the pure calculation functions into one block and proves the harness can execute them. No behaviour changes.

**Files:**
- Modify: `index.html` — move `txAbsorbed`/`effectiveTxns` (currently 2084-2088), `daysBefore`/`refLE` (2226-2227), `navAt` (2807), `seriesMeta`/`seriesIncluded` (2392-2397), `portfolioSeries` (2398-2413), `xirr` (2418-2425), `tfWindow` (2426-2440), `riskStats` (2497-2508) into a new contiguous block
- Create: `scripts/check-perf.mjs`
- Create: `test/fixtures/01-static-single-fund.json`
- Modify: `scripts/check.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Sentinels `/* ==== PERF ENGINE START ==== */` and `/* ==== PERF ENGINE END ==== */` in `index.html`.
  - `scripts/check-perf.mjs` exporting `export async function runFixtures(): Promise<{passed: number, failed: string[]}>`.
  - Fixture schema: `{ name: string, state: {HOLDINGS_BASE, TXNS, NAVDB, histTF, histFrom?, histTo?, filterAMC?, filterTax?}, expect: {series?: Array<{date, value}>, twrPct?: number, risk?: {ret, vol, maxDD}, error?: string} }`.
  - Sandbox globals available to the engine: `HOLDINGS_BASE`, `HOLDINGS`, `TXNS`, `NAVDB`, `filterAMC`, `filterTax`, `histTF`, `histFrom`, `histTo`.

- [ ] **Step 1: Create the first fixture**

Create `test/fixtures/01-static-single-fund.json`. One fund, no transactions, priced every day. TWR must equal the fund's own NAV return exactly: 10 → 11 is +10%.

```json
{
  "name": "static single fund, no transactions: TWR equals NAV return",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 9, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 10.5, "2026-01-07": 11 } } },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 1050 },
      { "date": "2026-01-07", "value": 1100 }
    ],
    "twrPct": 10
  }
}
```

- [ ] **Step 2: Write the harness**

Create `scripts/check-perf.mjs`:

```js
// Runs the index.html performance engine against JSON fixtures in a vm sandbox.
// Run standalone: node scripts/check-perf.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

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

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const { passed, failed } = await runFixtures();
  failed.forEach(f => console.error('✗ ' + f));
  console.log(`${passed} fixture(s) passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
```

- [ ] **Step 3: Run the harness to verify it fails**

Run: `node scripts/check-perf.mjs`
Expected: FAIL with `perf engine sentinels not found in index.html`

- [ ] **Step 4: Create the engine block in index.html**

Delete these functions from their current locations and paste them, unchanged, between sentinels placed immediately before `function portfolioSeries()`'s current position (around line 2396):

- `txAbsorbed`, `effectiveTxns` (from ~2084)
- `daysBefore`, `refLE` (from ~2226 — they are `const` arrow functions; keep them `const` and keep them **above** the functions that call them inside the block)
- `seriesMeta`, `seriesIncluded` (from ~2392)
- `portfolioSeries` (from ~2398)
- `xirr` (from ~2418)
- `tfWindow` (from ~2426)
- `riskStats` (from ~2497)
- `navAt` (from ~2807)

The block looks like this — the bodies are copied verbatim, nothing is rewritten in this task:

```js
/* ==== PERF ENGINE START ==== */
const daysBefore=(iso,n)=>{const d=new Date(iso);d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);};
const refLE=(ds,vs,t)=>{let v=vs[0];for(let i=0;i<ds.length;i++){if(ds[i]<=t)v=vs[i];else break;}return v;};
function navAt(code,date){const nv=(NAVDB[code]||{}).navs||{};const ds=Object.keys(nv).sort();let v=null;for(const d of ds){if(d<=date)v=nv[d];else break;}return v;}
function txAbsorbed(x){const h=HOLDINGS_BASE[x.code];return !!(h&&h.asof&&(x.date||'')<=h.asof);}
function effectiveTxns(){
 const voided=new Set(TXNS.filter(x=>x&&x.action==='void'&&x.voids!=null).map(x=>String(x.voids)));
 return TXNS.filter(x=>x&&x.action!=='void'&&!voided.has(String(x.ts))&&!txAbsorbed(x)).sort((a,b)=>((a.date||'').localeCompare(b.date||''))||((a.ts||0)-(b.ts||0)));
}
/* ...seriesMeta, seriesIncluded, portfolioSeries, xirr, tfWindow, riskStats pasted verbatim... */
/* ==== PERF ENGINE END ==== */
```

Function declarations hoist, so moving `navAt` above its former position changes nothing. `daysBefore` and `refLE` are `const` and do **not** hoist — they must sit at the top of the block, and the block must appear before any top-level call that uses them. The block's new home at ~2396 is inside the function-declaration region, well before `renderAll()` runs, so this holds.

- [ ] **Step 5: Run the harness to verify the fixture passes**

Run: `node scripts/check-perf.mjs`
Expected: `1 fixture(s) passed, 0 failed`

If `portfolioSeries is not defined`, the sentinels are wrapping the wrong region. If `refLE is not defined`, the two `const` arrows are below their callers inside the block.

- [ ] **Step 6: Wire into check.mjs**

In `scripts/check.mjs`, immediately before the final `process.exit(failed);`, add:

```js
// ---- performance engine fixtures ----
try {
  const { runFixtures } = await import('./check-perf.mjs');
  const { passed, failed: bad } = await runFixtures();
  if (bad.length) bad.forEach(b => fail('perf fixture: ' + b));
  else ok(`perf engine: ${passed} fixtures pass`);
} catch (e) { fail('perf fixture error: ' + e.message); }
```

- [ ] **Step 7: Refresh the CSP hash and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 1 fixtures pass`, exit 0

- [ ] **Step 8: Verify the page still works in a browser**

Run: `python -m http.server 8899 --bind 127.0.0.1`
Load `http://127.0.0.1:8899/index.html`, import `holdings.json` via **Import portfolio**, confirm the hero total renders and the holdings table lists funds. Console must show no `ReferenceError`.

- [ ] **Step 9: Commit**

```bash
git add index.html scripts/check-perf.mjs scripts/check.mjs test/fixtures/01-static-single-fund.json
git commit -m "Add perf engine block and fixture harness"
```

---

## Task 2: effectivePrice with date-ordered selection

**Files:**
- Modify: `index.html` — inside the perf engine block
- Create: `test/fixtures/02-stale-nav-then-purchase.json`, `03-sell-only-establishes-price.json`, `04-dividend-does-not-shadow.json`, `05-same-date-nav-wins.json`, `06-same-date-executions-average.json`

**Interfaces:**
- Consumes: `navAt(code, date)`, `effectiveTxns()` from Task 1.
- Produces:
  - `execObsAt(code, date) -> {date: string, price: number} | null` — latest price-bearing execution observation on or before `date`, price being the unit-weighted average across that date's price-bearing entries.
  - `priceObsAt(code, date) -> {date: string, price: number, src: 'nav'|'exec'} | null`
  - `effectivePrice(code, date) -> number | null`

- [ ] **Step 1: Write the failing fixtures**

`test/fixtures/02-stale-nav-then-purchase.json` — Friday NAV ฿10, Monday buy 100 @ ฿11, no Monday NAV. The Monday position must value at ฿11, so the buy produces no return. Fund B holds the portfolio value non-zero on the first date so the TWR chain runs.

```json
{
  "name": "purchase after a stale NAV values at the execution price",
  "state": {
    "HOLDINGS_BASE": { "FUND-B": { "units": 10, "avg": 100, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" } },
    "TXNS": [
      { "ts": 1, "date": "2026-01-05", "code": "FUND-A", "action": "buy", "units": 100, "price": 11, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "name": "FUND-A" }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-02": 10 } },
      "FUND-B": { "navs": { "2026-01-02": 100, "2026-01-05": 100 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-02", "value": 1000 },
      { "date": "2026-01-05", "value": 2100 }
    ],
    "twrPct": 0
  }
}
```

`test/fixtures/03-sell-only-establishes-price.json` — a sell price establishes coverage exactly as a buy would.

```json
{
  "name": "a sell price establishes coverage like a buy",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 9, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" },
      "FUND-B": { "units": 10, "avg": 100, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" }
    },
    "TXNS": [
      { "ts": 1, "date": "2026-01-05", "code": "FUND-A", "action": "sell", "units": 40, "price": 12 }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-02": 10 } },
      "FUND-B": { "navs": { "2026-01-02": 100, "2026-01-05": 100 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-02", "value": 2000 },
      { "date": "2026-01-05", "value": 1720 }
    ]
  }
}
```

60 units left at the ฿12 sell price is ฿720, plus FUND-B's ฿1,000 = ฿1,720.

`test/fixtures/04-dividend-does-not-shadow.json` — a dividend dated after the buy must not erase the carried ฿11.

```json
{
  "name": "a later dividend does not shadow the carried execution price",
  "state": {
    "HOLDINGS_BASE": { "FUND-B": { "units": 10, "avg": 100, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" } },
    "TXNS": [
      { "ts": 1, "date": "2026-01-05", "code": "FUND-A", "action": "buy", "units": 100, "price": 11, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "name": "FUND-A" },
      { "ts": 2, "date": "2026-01-06", "code": "FUND-A", "action": "dividend", "amount": 50 }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-02": 10 } },
      "FUND-B": { "navs": { "2026-01-02": 100, "2026-01-05": 100, "2026-01-06": 100 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-02", "value": 1000 },
      { "date": "2026-01-05", "value": 2100 },
      { "date": "2026-01-06", "value": 2100 }
    ]
  }
}
```

`test/fixtures/05-same-date-nav-wins.json` — NAV and execution on the same date; the NAV wins.

```json
{
  "name": "a real NAV wins a same-date tie against an execution",
  "state": {
    "HOLDINGS_BASE": { "FUND-B": { "units": 10, "avg": 100, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" } },
    "TXNS": [
      { "ts": 1, "date": "2026-01-05", "code": "FUND-A", "action": "buy", "units": 100, "price": 11, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "name": "FUND-A" }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 12 } },
      "FUND-B": { "navs": { "2026-01-02": 100, "2026-01-05": 100 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-02", "value": 1000 },
      { "date": "2026-01-05", "value": 2200 }
    ]
  }
}
```

`test/fixtures/06-same-date-executions-average.json` — two buys the same day, 100 @ ฿10 and 100 @ ฿12, average ฿11, listed newest-first to prove order independence.

```json
{
  "name": "same-date executions average by units regardless of ledger order",
  "state": {
    "HOLDINGS_BASE": { "FUND-B": { "units": 10, "avg": 100, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-02" } },
    "TXNS": [
      { "ts": 2, "date": "2026-01-05", "code": "FUND-A", "action": "buy", "units": 100, "price": 12, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "name": "FUND-A" },
      { "ts": 1, "date": "2026-01-05", "code": "FUND-A", "action": "buy", "units": 100, "price": 10, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "name": "FUND-A" }
    ],
    "NAVDB": {
      "FUND-A": {},
      "FUND-B": { "navs": { "2026-01-02": 100, "2026-01-05": 100 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-02", "value": 1000 },
      { "date": "2026-01-05", "value": 3200 }
    ]
  }
}
```

200 units at the ฿11 average is ฿2,200, plus FUND-B's ฿1,000.

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/check-perf.mjs`
Expected: FAIL. `02` reports `series[1].value 2000, expected 2100` (the Monday buy valued at the stale ฿10). `06` reports a missing date, since `FUND-A` has no NAV dates and nothing yet puts the transaction date on the axis.

Fixtures `02`–`05` fail on value; `06` may fail on series length. Both are the expected starting state — Task 3 puts transaction dates on the axis, and this task only has to make the **pricing** right where the date already exists.

- [ ] **Step 3: Add the pricing functions**

Insert into the perf engine block, immediately after `navAt`:

```js
function navObsAt(code,date){const nv=(NAVDB[code]||{}).navs||{};const ds=Object.keys(nv).sort();let o=null;for(const d of ds){if(d<=date)o={date:d,price:nv[d]};else break;}return o;}
function execObsAt(code,date){
 const tx=effectiveTxns().filter(x=>x.code===code&&(x.action==='buy'||x.action==='sell')&&+x.price>0&&(x.date||'')<=date);
 if(!tx.length)return null;
 const last=tx[tx.length-1].date;
 let u=0,uv=0;
 for(const x of tx){if(x.date!==last)continue;const n=Math.abs(+x.units||0);if(!n)continue;u+=n;uv+=n*(+x.price||0);}
 return u>0?{date:last,price:uv/u}:null;
}
function priceObsAt(code,date){
 const n=navObsAt(code,date),e=execObsAt(code,date);
 if(!n&&!e)return null;
 if(!e)return{date:n.date,price:n.price,src:'nav'};
 if(!n)return{date:e.date,price:e.price,src:'exec'};
 return n.date>=e.date?{date:n.date,price:n.price,src:'nav'}:{date:e.date,price:e.price,src:'exec'};
}
function effectivePrice(code,date){const o=priceObsAt(code,date);return o?o.price:null;}
```

`effectiveTxns()` already excludes voids and absorbed entries and is sorted by date then `ts`, so `tx[tx.length-1].date` is the latest execution date and the averaging loop is order-independent. Dividends are excluded by the `action` test, so a later dividend cannot shadow an earlier execution. Switch legs are recorded with `action` `buy` or `sell` plus an `sw` marker, so they are included.

- [ ] **Step 4: Switch valuation to effectivePrice**

In `portfolioSeries()`, replace the valuation line:

```js
  let value=cash;for(const code of codes)value+=(units[code]||0)*(navAt(code,date)||0);
```

with:

```js
  let value=cash;for(const code of codes)value+=(units[code]||0)*(effectivePrice(code,date)||0);
```

- [ ] **Step 5: Run to verify 02–05 pass**

Run: `node scripts/check-perf.mjs`
Expected: fixtures `01` through `05` pass. `06` still fails on series length — its transaction date is not yet on the axis, which Task 3 fixes.

- [ ] **Step 6: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: `perf fixture: 06-same-date-executions-average.json ...`, exit 1. That single expected failure is carried into Task 3.

- [ ] **Step 7: Commit**

```bash
git add index.html test/fixtures
git commit -m "Value positions through date-ordered effectivePrice"
```

---

## Task 3: Transaction dates on the valuation axis, and asOf

**Files:**
- Modify: `index.html` — perf engine block, plus `computeAll` (~2229) and `applyFilter` (~2248) outside it
- Create: `test/fixtures/07-midperiod-contribution.json`, `08-purchase-after-last-nav.json`

**Interfaces:**
- Consumes: `effectivePrice`, `priceObsAt` from Task 2.
- Produces:
  - `pageAsOf() -> string` — the later of the latest published NAV date and the latest price-bearing execution date, across included funds; `''` when neither exists.
  - `portfolioSeries()` axis bounded to `date <= pageAsOf()`.
  - `f.price`, `f.price_src` (`'nav'|'exec'`), `f.price_date` on every object in `ALL`, alongside the existing `f.nav` and `f.nav_date`.

- [ ] **Step 1: Write the failing fixtures**

`test/fixtures/07-midperiod-contribution.json` — a contribution dated between two NAV observations must land on its own date and leave TWR untouched. NAV is flat at ฿10 throughout, so any TWR other than 0 is a timing error.

```json
{
  "name": "a contribution between NAV dates books on its own date and does not move TWR",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [
      { "ts": 1, "date": "2026-01-06", "code": "FUND-A", "action": "buy", "units": 900, "price": 10 }
    ],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-08": 10 } } },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 10000 },
      { "date": "2026-01-08", "value": 10000 }
    ],
    "twrPct": 0
  }
}
```

`test/fixtures/08-purchase-after-last-nav.json` — a buy dated after the last stored NAV becomes the series terminal point.

```json
{
  "name": "a purchase after the last NAV sets the terminal date",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-09-02" } },
    "TXNS": [
      { "ts": 1, "date": "2026-09-03", "code": "FUND-A", "action": "buy", "units": 100, "price": 11 }
    ],
    "NAVDB": { "FUND-A": { "navs": { "2026-09-01": 10, "2026-09-02": 10 } } },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-09-01", "value": 1000 },
      { "date": "2026-09-02", "value": 1000 },
      { "date": "2026-09-03", "value": 2200 }
    ]
  }
}
```

On 3 September the execution observation (฿11) is later than the NAV observation (฿10), so all 200 units value at ฿11.

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/check-perf.mjs`
Expected: `06`, `07` and `08` fail with a series length or date mismatch, because transaction dates are not on the axis.

- [ ] **Step 3: Add pageAsOf and extend the axis**

In the perf engine block, add after `priceObsAt`:

```js
function pageAsOf(){
 const codes=[...new Set([...Object.keys(HOLDINGS_BASE),...effectiveTxns().map(x=>x.code)])].filter(c=>c&&seriesIncluded(c));
 let m='';
 for(const c of codes){
  const nv=(NAVDB[c]||{}).navs||{};for(const d in nv)if(d>m)m=d;
 }
 for(const x of effectiveTxns()){
  if(!codes.includes(x.code))continue;
  if((x.action==='buy'||x.action==='sell')&&+x.price>0&&(x.date||'')>m)m=x.date;
 }
 return m;
}
```

In `portfolioSeries()`, replace the axis line:

```js
 const dates=[...new Set(codes.flatMap(c=>Object.keys((NAVDB[c]||{}).navs||{})))].sort();
```

with:

```js
 const asOf=pageAsOf();
 const txDates=effectiveTxns().filter(x=>codes.includes(x.code)&&(x.date||'')).map(x=>x.date);
 const dates=[...new Set([...codes.flatMap(c=>Object.keys((NAVDB[c]||{}).navs||{})),...txDates])].sort().filter(d=>!asOf||d<=asOf);
```

- [ ] **Step 4: Run to verify 06–08 pass**

Run: `node scripts/check-perf.mjs`
Expected: `8 fixture(s) passed, 0 failed`

- [ ] **Step 5: Point the displayed values at the same prices**

In `computeAll()` (~2240), replace:

```js
  const last=vs[vs.length-1],prev=vs[vs.length-2]||last,ld=ds[ds.length-1];
```

with:

```js
  const _as=pageAsOf()||ds[ds.length-1];
  const _po=priceObsAt(code,_as)||{date:ds[ds.length-1],price:vs[vs.length-1],src:'nav'};
  const last=_po.price,prev=vs[vs.length-2]||vs[vs.length-1],ld=ds[ds.length-1];
```

and in the object literal on the next lines replace:

```js
   value,cost,unreal:value-cost,unreal_pct:cost?(value-cost)/cost*100:0,realized:h.realized,dates:ds,vvals:vs,chg:{},pct:{}};
```

with:

```js
   price:_po.price,price_src:_po.src,price_date:_po.date,
   value,cost,unreal:value-cost,unreal_pct:cost?(value-cost)/cost*100:0,realized:h.realized,dates:ds,vvals:vs,chg:{},pct:{}};
```

`f.nav` and `f.nav_date` keep their existing meaning — the latest **published** NAV and its date — so the staleness badge and the `confRange` / `confStale` chips are untouched. `f.value` now equals `f.units * f.price`, which is the reconciliation §3 requires.

Then in `applyFilter()` (~2263) replace:

```js
 T.as_of=ALL.reduce((m,f)=>f.nav_date>m?f.nav_date:m,'');
```

with:

```js
 T.as_of=ALL.reduce((m,f)=>f.price_date>m?f.price_date:m,'');
 T.as_of_src=(ALL.find(f=>f.price_date===T.as_of)||{}).price_src||'nav';
 T.nav_as_of=ALL.reduce((m,f)=>f.nav_date>m?f.nav_date:m,'');
```

- [ ] **Step 5b: Mark the header date when an execution set it**

`T.as_of` can now come from a ledger entry, so the header must say which. Add the i18n key to `I18N.en` (~2129, beside `asOf`):

```js
 fromExec:'from execution',
```

and to `I18N.th` (~2170):

```js
 fromExec:'ราคาจากรายการ',
```

Then in the `#asof` render (~2282), replace:

```js
 document.getElementById('asof').textContent=T.as_of?new Date(T.as_of+'T00:00:00').toLocaleDateString(LANG==='th'?'th-TH':'en-GB',{day:'numeric',month:'short',year:'numeric'}):t('noAsOf');
```

with:

```js
 document.getElementById('asof').innerHTML=T.as_of?escHTML(new Date(T.as_of+'T00:00:00').toLocaleDateString(LANG==='th'?'th-TH':'en-GB',{day:'numeric',month:'short',year:'numeric'}))+(T.as_of_src==='exec'?` <span class="src-badge">${escHTML(t('fromExec'))}</span>`:''):escHTML(t('noAsOf'));
```

Add the badge style beside the existing `.stale-badge` rule:

```css
.src-badge{font-size:10px;color:var(--muted2);white-space:nowrap}
```

The `confRange` and `confStale` chips are untouched — they read `f.nav_date` and keep describing published NAVs only.

- [ ] **Step 6: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 8 fixtures pass`, exit 0

- [ ] **Step 7: Verify in the browser**

With the server from Task 1 running, reload, import `holdings.json`, and check that the hero total and the "As of" date still render and that the console is clean. The total may shift slightly — `f.price` now resolves through `priceObsAt` at the page-wide `asOf` rather than each fund's own last NAV. Note the before/after totals in the commit message.

- [ ] **Step 8: Commit**

```bash
git add index.html test/fixtures
git commit -m "Put transaction dates on the valuation axis and derive asOf from both sources"
```

---

## Task 4: Reliable-history anchor and the missing-asof state

**Files:**
- Modify: `index.html` — perf engine block, `renderRisk` (~2515), `renderTL` (~2305), `I18N.en` and `I18N.th` (~2129 and ~2170)
- Create: `test/fixtures/09-anchor-clamps-history.json`, `10-no-anchor.json`

**Interfaces:**
- Consumes: `pageAsOf`, `effectiveTxns`, `seriesIncluded`.
- Produces:
  - `portfolioAnchor() -> string | null` — `null` means at least one included snapshot fund with units > 0 has no `asof`.
  - `portfolioSeries()` returns `[]` when `portfolioAnchor()` is `null`.
  - i18n keys `noAnchor`, `setStartDate`, `setStartPrompt` in both languages.

- [ ] **Step 1: Write the failing fixtures**

`test/fixtures/09-anchor-clamps-history.json` — NAV exists from 1 January but the snapshot is anchored at 5 January, so the series starts at 5 January.

```json
{
  "name": "series starts at the snapshot anchor, not the first stored NAV",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-01": 8, "2026-01-02": 9, "2026-01-05": 10, "2026-01-06": 11 } } },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 1100 }
    ],
    "twrPct": 10
  }
}
```

`test/fixtures/10-no-anchor.json` — a snapshot fund with units but no `asof` yields no series at all.

```json
{
  "name": "a snapshot fund with no asof yields no reliable series",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity" } },
    "TXNS": [],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 11 } } },
    "histTF": "MAX"
  },
  "expect": { "series": [] }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/check-perf.mjs`
Expected: `09` reports `series length 4, expected 2`; `10` reports `series length 2, expected 0`.

- [ ] **Step 3: Add the anchor**

In the perf engine block, after `pageAsOf`:

```js
function portfolioAnchor(){
 let m='';
 for(const c in HOLDINGS_BASE){
  const h=HOLDINGS_BASE[c];
  if(!h||!(+h.units>0)||!seriesIncluded(c))continue;
  if(!h.asof)return null;
  if(h.asof>m)m=h.asof;
 }
 return m||'';
}
```

Funds with no `HOLDINGS_BASE` entry hold zero units before their first buy, so they never constrain the anchor.

In `portfolioSeries()`, replace the axis filter added in Task 3:

```js
 const dates=[...new Set([...codes.flatMap(c=>Object.keys((NAVDB[c]||{}).navs||{})),...txDates])].sort().filter(d=>!asOf||d<=asOf);
```

with:

```js
 const anchor=portfolioAnchor();
 if(anchor===null)return [];
 const dates=[...new Set([...codes.flatMap(c=>Object.keys((NAVDB[c]||{}).navs||{})),...txDates])].sort().filter(d=>(!anchor||d>=anchor)&&(!asOf||d<=asOf));
```

- [ ] **Step 4: Run to verify all fixtures pass**

Run: `node scripts/check-perf.mjs`
Expected: `10 fixture(s) passed, 0 failed`

- [ ] **Step 5: Add the i18n strings**

In `I18N.en` (~2139, beside `noData`):

```js
 noAnchor:'Set a portfolio start date to measure performance',setStartDate:'Set portfolio start date',setStartPrompt:'Enter the date your imported balances were accurate (YYYY-MM-DD):',
```

In `I18N.th` (~2180, beside its `noData`):

```js
 noAnchor:'ตั้งวันเริ่มพอร์ตก่อน จึงจะวัดผลตอบแทนได้',setStartDate:'ตั้งวันเริ่มพอร์ต',setStartPrompt:'กรอกวันที่ยอดที่นำเข้าถูกต้อง (ปปปป-ดด-วว):',
```

- [ ] **Step 6: Surface the state in the UI**

At the top of `renderRisk()` (~2517), after the `const ps=portfolioSeries()...` line, the existing `if(!P)` branch already prints `noData`. Change that branch to distinguish the two cases:

```js
 if(!P){kp.innerHTML=`<div class="skel" style="grid-column:1/-1">${t(portfolioAnchor()===null?'noAnchor':'noData')}</div>`;tb.innerHTML='';return;}
```

In `renderTL()` (~2305), replace the body's first two lines:

```js
 const b=T.chg[RANGE],p=T.pct[RANGE];
 document.getElementById('tl-baht').textContent='฿'+sign(b);document.getElementById('tl-baht').className='big mono '+cls(b);
```

with:

```js
 const noAnchor=portfolioAnchor()===null;
 const b=T.chg[RANGE],p=T.pct[RANGE];
 const tlb=document.getElementById('tl-baht');
 if(noAnchor){tlb.textContent='—';tlb.className='big mono';
  const pe0=document.getElementById('tl-pct');pe0.textContent='';pe0.className='pct mono';
  document.getElementById('tl-label').innerHTML=`${escHTML(t('noAnchor'))} <button type="button" class="btn ghost" id="setStartBtn">${escHTML(t('setStartDate'))}</button>`;
  const sb=document.getElementById('setStartBtn');if(sb)sb.onclick=setStartDate;
  return;}
 tlb.textContent='฿'+sign(b);tlb.className='big mono '+cls(b);
```

Add `setStartDate` next to `setBirth` (~2554):

```js
function setStartDate(){
 const v=prompt(t('setStartPrompt'),new Date().toISOString().slice(0,10));
 if(!v||!/^\d{4}-\d{2}-\d{2}$/.test(v))return;
 for(const c in HOLDINGS_BASE){const h=HOLDINGS_BASE[c];if(h&&+h.units>0&&!h.asof)h.asof=v;}
 persist();renderAll();
}
```

- [ ] **Step 6b: Suppress every other period-derived value**

The spec requires the Change column, the totals footer, and the movers lists to go blank too — not just the hero and the risk tab. Without an anchor `portfolioSeries()` returns `[]`, so `T.chg[RANGE]` is `undefined` and those cells would render `NaN`.

In `renderTable()` (~2354), replace the row's Change cell:

```js
   <td data-l="${escAttr(t('thChange'))}" class="${cls(chg)}">฿${sign(chg)}<br><span style="font-size:10.5px">${sign(cp)}%</span></td>
```

with:

```js
   <td data-l="${escAttr(t('thChange'))}" class="${noAnchor?'':cls(chg)}">${noAnchor?'<span style="color:var(--muted2)">—</span>':`฿${sign(chg)}<br><span style="font-size:10.5px">${sign(cp)}%</span>`}</td>
```

and define `noAnchor` once at the top of `renderTable()`, immediately after its `const rows=...` line:

```js
 const noAnchor=portfolioAnchor()===null;
```

In the same function's footer template, replace:

```js
   <td class="${cls(T.chg[RANGE])}">฿${sign(T.chg[RANGE])}<br><span style="font-size:10.5px">${sign(T.pct[RANGE])}%</span></td>
```

with:

```js
   <td class="${noAnchor?'':cls(T.chg[RANGE])}">${noAnchor?'<span style="color:var(--muted2)">—</span>':`฿${sign(T.chg[RANGE])}<br><span style="font-size:10.5px">${sign(T.pct[RANGE])}%</span>`}</td>
```

In `renderMovers()` — the function filling `#gainers` and `#losers`, found with `grep -n "getElementById('gainers')" index.html` — add as its first statement:

```js
 if(portfolioAnchor()===null){document.getElementById('gainers').innerHTML=`<div class="skel">${t('noAnchor')}</div>`;document.getElementById('losers').innerHTML=`<div class="skel">${t('noAnchor')}</div>`;return;}
```

Point-in-time values — market value, cost basis, unrealized and realized P/L, weights, the three donuts, look-through, and the tax unlock schedule — all stay live. They need no period.

- [ ] **Step 7: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 10 fixtures pass`, exit 0. If i18n fails, a key is missing from one language.

- [ ] **Step 8: Verify both states in the browser**

Reload and import `holdings.json`, which has no `asof` on any fund. The hero headline must read `—` with the "Set portfolio start date" button, and the risk section must show the `noAnchor` message. Click the button, enter `2026-07-14`, and confirm numbers return. Switch to Thai and confirm both strings are translated.

- [ ] **Step 9: Commit**

```bash
git add index.html test/fixtures
git commit -m "Anchor reliable history at the snapshot asof and handle its absence"
```

---

## Task 5: Coverage entry as an external flow

**Files:**
- Modify: `index.html` — perf engine block
- Create: `test/fixtures/11-coverage-entry-plain.json`, `12-coverage-entry-intervening-buy.json`, `13-coverage-entry-same-day-sell.json`

**Interfaces:**
- Consumes: `effectivePrice`, `priceObsAt`, `portfolioAnchor`.
- Produces: `portfolioSeries()` rows whose `flow` includes coverage entries. No new exported name.

- [ ] **Step 1: Write the failing fixtures**

`test/fixtures/11-coverage-entry-plain.json` — FUND-C is held from the anchor but only gains a NAV later. Its arrival must not read as return.

```json
{
  "name": "a fund entering price coverage contributes no return",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-C": { "units": 50, "avg": 20, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 10 } },
      "FUND-C": { "navs": { "2026-01-06": 20 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 2000 }
    ],
    "twrPct": 0
  }
}
```

`test/fixtures/12-coverage-entry-intervening-buy.json` — a buy dated 6 January falls between NAV dates and settles in the same batch as the 7 January NAV. Keying on "transactions dated exactly D" would double count it.

```json
{
  "name": "coverage entry with a buy dated between NAV observations",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-C": { "units": 50, "avg": 20, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [
      { "ts": 1, "date": "2026-01-06", "code": "FUND-C", "action": "buy", "units": 10, "price": 20 }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-07": 10 } },
      "FUND-C": { "navs": { "2026-01-07": 20 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 2200 },
      { "date": "2026-01-07", "value": 2200 }
    ],
    "twrPct": 0
  }
}
```

On 6 January the ฿20 execution prices all 60 FUND-C units, so coverage begins there, not on 7 January.

`test/fixtures/13-coverage-entry-same-day-sell.json` — a sale on the coverage date leaves once, through the ledger branch.

```json
{
  "name": "coverage entry with a same-day sale",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-C": { "units": 50, "avg": 20, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [
      { "ts": 1, "date": "2026-01-06", "code": "FUND-C", "action": "sell", "units": 20, "price": 20 }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 10 } },
      "FUND-C": { "navs": { "2026-01-06": 20 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 1600 }
    ],
    "twrPct": 0
  }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/check-perf.mjs`
Expected: all three fail on TWR. `11` reports roughly `TWR 100%, expected 0%` — FUND-C's ฿1,000 arriving with `flow = 0` reads as a doubling.

- [ ] **Step 3: Add coverage-entry accounting**

In `portfolioSeries()`, replace the loop body's opening line:

```js
 for(const date of dates){let flow=0;
```

with:

```js
 let prevDate=null;
 for(const date of dates){let flow=0;
  const openingUnits={};for(const c of codes)openingUnits[c]=units[c]||0;
  const wasPriced={};for(const c of codes)wasPriced[c]=prevDate!=null&&effectivePrice(c,prevDate)!=null;
```

and immediately after the `while(...)` transaction loop closes, before `let value=cash;`, insert:

```js
  for(const c of codes){if(!wasPriced[c]&&effectivePrice(c,date)!=null)flow+=(openingUnits[c]||0)*effectivePrice(c,date);}
```

and replace the loop's closing line:

```js
  rows.push({date,value,twr,flow});prev=value;
 }
```

with:

```js
  rows.push({date,value,twr,flow});prev=value;prevDate=date;
 }
```

`openingUnits` is captured before the batch drains, so units bought in the batch — whatever date they carry — entered `flow` through the ledger branch and are not added twice. Units sold in the batch left through it as well. For a fund first bought today, `openingUnits` is zero and the coverage term vanishes.

No coverage-exit branch exists: `navObsAt` and `execObsAt` both carry forward, so a priced fund never becomes unpriced.

- [ ] **Step 4: Run to verify all fixtures pass**

Run: `node scripts/check-perf.mjs`
Expected: `13 fixture(s) passed, 0 failed`

- [ ] **Step 5: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 13 fixtures pass`, exit 0

- [ ] **Step 6: Verify against the real portfolio**

Reload, import `holdings.json`, click **Set portfolio start date** and enter `2026-07-14`. Open the Risk section with timeframe `MAX`. TWR, annualized volatility, max drawdown and XIRR must all be plausible for a two-month window on a Thai mutual-fund portfolio — single digits to low double digits, not thousands of percent. Record the four values in the commit message.

- [ ] **Step 7: Commit**

```bash
git add index.html test/fixtures
git commit -m "Book capital entering price coverage as an external flow"
```

---

## Task 6: XIRR cash flows and the corrected footnote

**Files:**
- Modify: `index.html` — `renderRisk` (~2520), `I18N.en` (~2139), `I18N.th` (~2180)
- Create: `test/fixtures/14-xirr-cashflows.json`
- Modify: `scripts/check-perf.mjs` — add `expect.cashflows` support

**Interfaces:**
- Consumes: `portfolioSeries()` rows carrying `date`, `value`, `flow`.
- Produces:
  - `windowCashflows(windowRows) -> Array<{date: string, amount: number}>` in the perf engine block, called by `renderRisk`.
  - i18n key `xirrEst` reworded in both languages, taking a `{d}` placeholder for the window's first date.

- [ ] **Step 1: Teach the harness to assert cash flows**

In `scripts/check-perf.mjs`, inside `runOne`, immediately before `return out;`:

```js
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
```

- [ ] **Step 2: Write the failing fixture**

`test/fixtures/14-xirr-cashflows.json` — opening balance ฿1,000, a ฿500 buy, a ฿300 sell, closing ฿1,200.

```json
{
  "name": "XIRR cash flows are opening value, ledger flows, then closing value",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [
      { "ts": 1, "date": "2026-01-06", "code": "FUND-A", "action": "buy", "units": 50, "price": 10 },
      { "ts": 2, "date": "2026-01-07", "code": "FUND-A", "action": "sell", "units": 30, "price": 10 }
    ],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 10, "2026-01-07": 10, "2026-01-08": 10 } } },
    "histTF": "MAX"
  },
  "expect": {
    "cashflows": [
      { "date": "2026-01-05", "amount": -1000 },
      { "date": "2026-01-06", "amount": -500 },
      { "date": "2026-01-07", "amount": 300 },
      { "date": "2026-01-08", "amount": 1200 }
    ]
  }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `node scripts/check-perf.mjs`
Expected: FAIL with `windowCashflows is not defined`

- [ ] **Step 4: Extract windowCashflows into the engine block**

Add to the perf engine block, after `xirr`:

```js
function windowCashflows(windowRows){
 const cf=windowRows.map((x,i)=>({date:x.date,amount:i===0?-x.value:-x.flow}));
 if(cf.length)cf[cf.length-1].amount+=windowRows[windowRows.length-1].value;
 return cf;
}
```

In `renderRisk()` (~2520), replace:

```js
 const cashflows=windowRows.map((x,i)=>({date:x.date,amount:i===0?-x.value:-x.flow}));if(cashflows.length)cashflows[cashflows.length-1].amount+=windowRows[windowRows.length-1].value;const irr=xirr(cashflows);
```

with:

```js
 const irr=xirr(windowCashflows(windowRows));
```

Behaviour is unchanged — this only gives the fixture a name to call. The fixture then locks in that the first flow is **opening market value**, which is what the footnote must now say.

- [ ] **Step 5: Run to verify it passes**

Run: `node scripts/check-perf.mjs`
Expected: `14 fixture(s) passed, 0 failed`

- [ ] **Step 6: Correct the footnote in both languages**

In `I18N.en` (~2139) replace:

```js
xirrEst:'Baseline cost is treated as an opening cash flow',
```

with:

```js
xirrEst:'Opening market value on {d} is the initial cash flow; later ledger and coverage flows are included',
```

In `I18N.th` (~2180) replace:

```js
xirrEst:'ใช้ต้นทุนพอร์ตตั้งต้นเป็นกระแสเงินสดวันแรก',
```

with:

```js
xirrEst:'ใช้มูลค่าตลาดต้นงวด ณ {d} เป็นกระแสเงินสดแรก รวมรายการซื้อขายและเงินที่เพิ่งเข้ามาในความคุ้มครองราคาที่ตามมา',
```

In `renderRisk()`, the XIRR KPI currently passes `t('xirrEst')` as its meta. Replace that argument:

```js
  kpi(t('rkXirr'),irr==null?'—':sign(irr)+'%',irr==null?'':cls(irr),t('xirrEst'))+
```

with:

```js
  kpi(t('rkXirr'),irr==null?'—':sign(irr)+'%',irr==null?'':cls(irr),t('xirrEst').replace('{d}',escHTML(fmtD(dates[0]))))+
```

- [ ] **Step 7: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 14 fixtures pass`, exit 0

- [ ] **Step 8: Verify in the browser**

Reload, import, set the start date, and read the XIRR card's footnote in both languages. It must name a date and must no longer say "cost" / "ต้นทุน".

- [ ] **Step 9: Commit**

```bash
git add index.html scripts/check-perf.mjs test/fixtures
git commit -m "Name the XIRR cash flows and correct the footnote in both languages"
```

---

## Task 7: Year-aware dates, non-finite guard, and the coverage guard

**Files:**
- Modify: `index.html` — `fmtD` (~2514), `riskStats` (in the engine block), `renderRisk` (~2517)
- Create: `test/fixtures/15-nonfinite-return-dropped.json`, `16-window-coverage-ratio.json`

**Interfaces:**
- Consumes: `portfolioSeries`, `priceObsAt`, `pageAsOf`.
- Produces:
  - `fmtD(d, withYear)` — second parameter, default `false`.
  - `windowCoverage(windowStartDate) -> number` in the engine block, returning 0–1.

- [ ] **Step 1: Write the failing fixtures**

`test/fixtures/15-nonfinite-return-dropped.json` — a zero NAV would make a return non-finite; it must be dropped rather than poisoning the chain.

```json
{
  "name": "a non-finite daily return is dropped from the chain",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 0, "2026-01-07": 10 } } },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 0 },
      { "date": "2026-01-07", "value": 1000 }
    ],
    "twrPct": -100
  }
}
```

The 6 January step is a real −100%; the 7 January step divides by a zero `prev` and is skipped by the existing `prev>0` guard, so the chain ends at −100% rather than `NaN`.

`test/fixtures/16-window-coverage-ratio.json` — two funds of equal `asOf` value, only one priced at the window start, so coverage is 0.5.

```json
{
  "name": "window coverage is measured in asOf money",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-C": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-08": 10 } },
      "FUND-C": { "navs": { "2026-01-08": 10 } }
    },
    "histTF": "MAX"
  },
  "expect": { "coverageAt": { "date": "2026-01-05", "ratio": 0.5 } }
}
```

Add to `runOne` in `scripts/check-perf.mjs`, before `return out;`:

```js
  if (fx.expect.coverageAt) {
    const got = vm.runInContext(`windowCoverage(${JSON.stringify(fx.expect.coverageAt.date)})`, ctx);
    if (!near(got, fx.expect.coverageAt.ratio)) out.errors.push(`coverage ${got}, expected ${fx.expect.coverageAt.ratio}`);
  }
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/check-perf.mjs`
Expected: `16` fails with `windowCoverage is not defined`. `15` may already pass — the existing `prev>0` and `Number.isFinite` guards cover it. If it passes, keep it as a regression test and say so in the commit message.

- [ ] **Step 3: Add windowCoverage**

In the perf engine block, after `pageAsOf`:

```js
function windowCoverage(start){
 const asOf=pageAsOf();if(!asOf)return 0;
 const codes=[...new Set([...Object.keys(HOLDINGS_BASE),...effectiveTxns().map(x=>x.code)])].filter(c=>c&&seriesIncluded(c));
 let num=0,den=0;
 for(const c of codes){
  const u=+(HOLDINGS_BASE[c]&&HOLDINGS_BASE[c].units)||0;if(!(u>0))continue;
  const p=effectivePrice(c,asOf);if(p==null)continue;
  const v=u*p;den+=v;
  if(effectivePrice(c,start)!=null)num+=v;
 }
 return den>0?num/den:0;
}
```

Both sides are measured in `asOf` money, and funds never priced at all are excluded from both — they keep their separate report in the `confCoverage` chip.

- [ ] **Step 4: Run to verify both pass**

Run: `node scripts/check-perf.mjs`
Expected: `16 fixture(s) passed, 0 failed`

- [ ] **Step 5: Apply the coverage guard in renderRisk**

In `renderRisk()`, replace the `if(!P)` line written in Task 4:

```js
 if(!P){kp.innerHTML=`<div class="skel" style="grid-column:1/-1">${t(portfolioAnchor()===null?'noAnchor':'noData')}</div>`;tb.innerHTML='';return;}
```

with:

```js
 const thin=dates.length&&windowCoverage(dates[0])<0.6;
 if(!P||thin){kp.innerHTML=`<div class="skel" style="grid-column:1/-1">${t(portfolioAnchor()===null?'noAnchor':'noData')}</div>`;tb.innerHTML='';return;}
```

- [ ] **Step 6: Make date labels carry the year across a year boundary**

Replace `fmtD` (~2514):

```js
function fmtD(d){return d?new Date(d+'T00:00:00').toLocaleDateString(LANG==='th'?'th-TH':'en-GB',{day:'numeric',month:'short'}):'—';}
```

with:

```js
function fmtD(d,withYear){return d?new Date(d+'T00:00:00').toLocaleDateString(LANG==='th'?'th-TH':'en-GB',withYear?{day:'numeric',month:'short',year:'numeric'}:{day:'numeric',month:'short'}):'—';}
```

In `renderRisk()`, the TWR KPI's meta builds the window label. Replace:

```js
  kpi(t('rkRet'),sign(P.ret)+'%',cls(P.ret),dates[0]?fmtD(dates[0])+' → '+fmtD(dates[dates.length-1]):'')+
```

with:

```js
  kpi(t('rkRet'),sign(P.ret)+'%',cls(P.ret),dates[0]?(()=>{const y=dates[0].slice(0,4)!==dates[dates.length-1].slice(0,4);return fmtD(dates[0],y)+' → '+fmtD(dates[dates.length-1],y);})():'')+
```

The Thai locale renders Buddhist years automatically, matching the rest of the Thai UI. All other `fmtD` callers keep the one-argument form and are unaffected.

- [ ] **Step 7: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 16 fixtures pass`, exit 0

- [ ] **Step 8: Verify in the browser**

Reload, import, set the start date to `2020-01-01` so the window spans years, and confirm the TWR card's range reads e.g. `1 Jan 2020 → 2 Sept 2026`. Switch to Thai and confirm Buddhist years appear. Set the start date back to `2026-07-14` and confirm the label drops the year again.

- [ ] **Step 9: Add the remaining spec scenarios as fixtures**

§7.1 lists four scenarios not yet covered. Add them now, while the engine is complete and their expected values are easy to reason about.

`test/fixtures/17-stale-fund-carried-forward.json` — FUND-C's last NAV is older than `asOf`; it carries forward and generates no synthetic return.

```json
{
  "name": "a stale fund carries forward without inventing a return",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-C": { "units": 50, "avg": 20, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 11 } },
      "FUND-C": { "navs": { "2026-01-05": 20 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 2000 },
      { "date": "2026-01-06", "value": 2100 }
    ],
    "twrPct": 5
  }
}
```

`test/fixtures/18-fund-with-no-nav.json` — FUND-D has no price from either source and simply contributes nothing.

```json
{
  "name": "a fund with no price from either source contributes nothing",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-D": { "units": 999, "avg": 1, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 11 } },
      "FUND-D": { "navs": {} }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 1100 }
    ],
    "twrPct": 10
  }
}
```

`test/fixtures/19-single-day-custom-window.json` — a one-day custom window must return a short window, never `NaN`.

```json
{
  "name": "a single-day custom window yields no return rather than NaN",
  "state": {
    "HOLDINGS_BASE": { "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" } },
    "TXNS": [],
    "NAVDB": { "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 11 } } },
    "histTF": "CUSTOM",
    "histFrom": "2026-01-06",
    "histTo": "2026-01-06"
  },
  "expect": { "twrPct": 0 }
}
```

`test/fixtures/20-buy-sell-dividend-switch.json` — all four ledger actions in one window, reconciling together. NAV is flat at ฿10 so only the dividend moves TWR.

```json
{
  "name": "buy, sell, dividend and switch reconcile in one window",
  "state": {
    "HOLDINGS_BASE": {
      "FUND-A": { "units": 100, "avg": 10, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" },
      "FUND-B": { "units": 0, "avg": 0, "realized": 0, "amc": "KKP", "tax": "SSF", "asset": "Foreign Equity", "asof": "2026-01-05" }
    },
    "TXNS": [
      { "ts": 1, "date": "2026-01-06", "code": "FUND-A", "action": "buy", "units": 50, "price": 10 },
      { "ts": 2, "date": "2026-01-07", "code": "FUND-A", "action": "sell", "units": 20, "price": 10 },
      { "ts": 3, "date": "2026-01-08", "code": "FUND-A", "action": "dividend", "amount": 130 },
      { "ts": 4, "date": "2026-01-09", "code": "FUND-A", "action": "sell", "units": 30, "price": 10, "sw": 1 },
      { "ts": 5, "date": "2026-01-09", "code": "FUND-B", "action": "buy", "units": 30, "price": 10, "sw": 1 }
    ],
    "NAVDB": {
      "FUND-A": { "navs": { "2026-01-05": 10, "2026-01-06": 10, "2026-01-07": 10, "2026-01-08": 10, "2026-01-09": 10 } },
      "FUND-B": { "navs": { "2026-01-09": 10 } }
    },
    "histTF": "MAX"
  },
  "expect": {
    "series": [
      { "date": "2026-01-05", "value": 1000 },
      { "date": "2026-01-06", "value": 1500 },
      { "date": "2026-01-07", "value": 1300 },
      { "date": "2026-01-08", "value": 1300 },
      { "date": "2026-01-09", "value": 1300 }
    ],
    "twrPct": 10
  }
}
```

A switch nets to zero — the sell proceeds sit in `cash` and the buy draws them down — so 9 January's value is unchanged. The ฿130 dividend on a ฿1,300 base is the window's only return: +10%.

- [ ] **Step 10: Run to verify all twenty fixtures pass**

Run: `node scripts/check-perf.mjs`
Expected: `20 fixture(s) passed, 0 failed`

Fixture `19` will fail if `tfWindow`'s `CUSTOM` branch is fed dates outside the window. Fixture `20` will fail if the switch legs are double-counted in `flow` — the `x.sw` branch must route them to `cash`, not `flow`.

- [ ] **Step 11: Commit**

```bash
git add index.html scripts/check-perf.mjs test/fixtures
git commit -m "Guard thin windows, show the year across a boundary, cover remaining scenarios"
```

---

## Task 8: Valuation-price cell and CSV reconciliation

**Files:**
- Modify: `index.html` — `renderTable` (~2352), `exportCSV` (~2656), the table header at ~459, `I18N.en` (~2141), `I18N.th` (~2182), `buildHoldings` (~2096)
- No new fixtures — this is display and export; §7.2 covers it as a browser check

**Interfaces:**
- Consumes: `f.price`, `f.price_src`, `f.price_date`, `f.nav`, `f.nav_date` from Task 3.
- Produces: the `thPrice`, `srcNav`, `srcExec` i18n keys; five CSV price columns replacing two.

- [ ] **Step 1: Add the i18n strings**

In `I18N.en` (~2141, beside `thUnits`):

```js
 thPrice:'Valuation price',srcNav:'NAV',srcExec:'Execution',
```

In `I18N.th` (~2182):

```js
 thPrice:'ราคาที่ใช้ตีมูลค่า',srcNav:'NAV',srcExec:'ราคาจากรายการ',
```

- [ ] **Step 2: Rename the column header**

At ~459 the second `<th>` reads `NAV`. Replace it with `<th data-i18n="thPrice">Valuation price</th>`, keeping any existing sort attributes on that element intact.

- [ ] **Step 3: Render the valuation-price cell**

In `renderTable()` (~2357), replace:

```js
   <td data-l="NAV">${fmt(f.nav,4)}</td>
```

with:

```js
   <td data-l="${escAttr(t('thPrice'))}">${fmt(f.price,4)} <span class="src-badge">${escHTML(t(f.price_src==='exec'?'srcExec':'srcNav'))} ${escHTML(fmtD(f.price_date))}</span>${f.price_src==='exec'?`<br><span style="font-size:10.5px;color:var(--muted2)">NAV ${fmt(f.nav,4)} · ${escHTML(fmtD(f.nav_date))}</span>`:''}</td>
```

The `.src-badge` rule was already added in Task 3 Step 5b; do not add it twice.

The secondary published-NAV line renders only when the two sources differ, so the common case gains nothing but the date it already showed. `f.value` is `f.units * f.price` from Task 3, so `valuation price × units = market value` now holds on every row.

- [ ] **Step 4: Replace two CSV columns with five**

In `exportCSV()` (~2658), replace the header array's `'NAV','NAV Date'` entries:

```js
 const head=[t('thFund'),'Name','AMC','Tax','Asset','NAV','NAV Date','Units','Avg Cost',t('thValue'),...
```

with:

```js
 const head=[t('thFund'),'Name','AMC','Tax','Asset','Valuation Price','Price Source','Price Date','Published NAV','Published NAV Date','Units','Avg Cost',t('thValue'),...
```

and in the row mapper replace `f.nav,f.nav_date`:

```js
  .map(f=>[f.code,f.name,f.amc,f.tax,f.asset,f.nav,f.nav_date,f.units,f.avg,...
```

with:

```js
  .map(f=>[f.code,f.name,f.amc,f.tax,f.asset,f.price,f.price_src==='exec'?'Execution':'NAV',f.price_date,f.nav,f.nav_date,f.units,f.avg,...
```

The totals row pushes empty strings for the leading columns; add three more so the columns still line up:

```js
 rows.push([t('totalWord'),'','','','','','','','','','','',T.value.toFixed(2),...
```

Count the leading empty strings against the header before running — there must be twelve before `T.value.toFixed(2)`.

- [ ] **Step 5: Confine the existing synthetic NAVDB seeding**

`buildHoldings()` (~2096) writes a transaction price into `NAVDB` for funds with no stored NAV, and `NAVDB` is persisted to `LS_NAV`. Now that the engine derives execution prices itself, that write is redundant and leaks a synthetic price into the market-data cache. Delete it:

```js
   if(!NAVDB[t.code]||!Object.keys(NAVDB[t.code].navs||{}).length)NAVDB[t.code]={navs:{[t.date||new Date().toISOString().slice(0,10)]:t.price}};
```

Deleting it alone would be a regression: `computeAll`'s `if(!ds.length)continue;` guard excludes any fund with no `NAVDB` entry, and that seed was what made a freshly bought fund visible at all. Widen the guard so an execution price is enough. In `computeAll` (~2238), replace:

```js
  const ds=Object.keys(nav).sort();if(!ds.length)continue;const vs=ds.map(d=>nav[d]);
  const _as=pageAsOf()||ds[ds.length-1];
  const _po=priceObsAt(code,_as)||{date:ds[ds.length-1],price:vs[vs.length-1],src:'nav'};
  const last=_po.price,prev=vs[vs.length-2]||vs[vs.length-1],ld=ds[ds.length-1];
```

— the two-line form left by Task 3 Step 5 — with:

```js
  const ds=Object.keys(nav).sort();const vs=ds.map(d=>nav[d]);
  const _as=pageAsOf()||new Date().toISOString().slice(0,10);
  const _po=priceObsAt(code,_as);
  if(!_po)continue;
  const last=_po.price,prev=vs.length>1?vs[vs.length-2]:_po.price,ld=ds.length?ds[ds.length-1]:'';
```

The `if(!ds.length)continue;` guard is gone and `const vs=ds.map(d=>nav[d]);` keeps its place on the first line.

The `vs` array is derived from `ds` on the preceding line and is now empty for such a fund, so `prev` falls back to the valuation price and `ld` to `''`. `f.nav_date` being empty makes `isoDayDiff(T.as_of, f.nav_date)` non-numeric, so guard the staleness flag in `renderTable()` — change:

```js
stale=T.as_of&&isoDayDiff(T.as_of,f.nav_date)>3
```

to:

```js
stale=T.as_of&&f.nav_date&&isoDayDiff(T.as_of,f.nav_date)>3
```

and in the same row template the published-NAV secondary line must not print an empty NAV — it already renders only when `f.price_src==='exec'`, so extend that condition to `f.price_src==='exec'&&f.nav_date`.

A fund priced only by an execution therefore appears in the table with the `Execution` badge and no published-NAV line, is counted in the totals, and contributes no synthetic price to `NAVDB` or the `LS_NAV` cache. The `confCoverage` chip keeps reporting funds with no price from either source.

- [ ] **Step 6: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 20 fixtures pass`, exit 0

- [ ] **Step 7: Verify reconciliation in the browser**

Reload, import `holdings.json`, set the start date. Then:

1. Pick any row and confirm `valuation price × units` equals the market value shown, to the rounding in the cell.
2. Record a buy dated tomorrow via **Buy / Sell** on a fund you hold. That row must switch to the `Execution` badge with tomorrow's date and show the published NAV beneath, and must still reconcile.
3. Export CSV, open it in Excel, and confirm Thai fund names render correctly and that `Valuation Price × Units = Market Value` in the affected row.
4. Confirm the `NAV date range` chip still shows the older published-NAV date, not tomorrow's.
5. Record a buy on a fund code you do **not** hold and that has no NAV — e.g. `TESTFUND-X`, 10 units at ฿5. It must appear in the table with the `Execution` badge, no published-NAV line, `฿50` market value, and no staleness badge. Then run `localStorage.getItem('kkp_navdb_v2')` in the console and confirm `TESTFUND-X` does **not** appear in it. Void the transaction afterwards to leave the portfolio as it was.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Show the valuation price with its source and reconcile the CSV export"
```

---

## Task 9: Phase 0 acceptance against the real portfolio

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-phase0-performance-engine.md` — record results
- No code changes unless a check fails

- [ ] **Step 1: Full check**

Run: `node scripts/check.mjs`
Expected: exit 0, `perf engine: 20 fixtures pass`

- [ ] **Step 2: Single-fund reconciliation against its own NAV**

With the real portfolio loaded and the start date set, apply an AMC filter that leaves exactly one fund, set the timeframe to `MAX`, and compare the risk table's `Portfolio` TWR against that fund's own row. They must match, because a one-fund portfolio's time-weighted return is that fund's NAV return.

- [ ] **Step 3: Record the headline numbers**

Note total market value, TWR, annualized volatility, max drawdown and XIRR at `MAX`. Compare against the pre-Phase-0 values recorded in the spec — TWR `+12,073.62%`, XIRR `+6,345.59%`, volatility `595.5%`, best day `+608.41%`. All four must now be plausible.

- [ ] **Step 4: Language parity**

Switch to Thai and back. Every string touched in this phase — `noAnchor`, `setStartDate`, `setStartPrompt`, `xirrEst`, `thPrice`, `srcNav`, `srcExec` — must be translated, and the TWR window label must show Buddhist years when it carries a year.

- [ ] **Step 5: Append the results to this plan**

Add a `## Phase 0 results` section recording the five numbers from Step 3 and the Step 2 comparison.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-09-03-phase0-performance-engine.md
git commit -m "Record Phase 0 acceptance results"
```

---

## Not in this plan

Phases 1–3 of the spec — the tabbed shell and command bar, the holdings table rework, and the Ink & brass v2 visual language — get their own plans, written once Phase 0 is reviewed. Their step detail depends on how the shell actually lands, and writing it now would produce guesses that need rewriting.

Phase 0 leaves the dashboard working with its existing layout, correct numbers, and a reconciled price column and export.

---

## Phase 0 results

Recorded 2026-09-04 against the real portfolio (66 funds imported, 62 priced,
`asof` stamped `2026-07-14`), timeframe `MAX`, window `2026-07-14 → 2026-09-04`,
43 valuation points, `windowCoverage` = 1.000.

### Headline figures

| Figure | Before Phase 0 | After |
|---|---|---|
| TWR | `+12,073.62%` | `-0.81%` |
| Estimated XIRR | `+6,345.59%` | `-5.55%` |
| Volatility (annualized) | `595.5%` | `7.6%` |
| Max drawdown | `-23.0%` | `-2.6%` |
| Best day | `+608.41%` | `+1.31%` |
| Worst day | `-9.52%` | `-1.00%` |
| Total market value | — | `฿2,074,775.57` |

All six are now plausible for a seven-week window on a diversified Thai
mutual-fund portfolio.

### Single-fund reconciliation

Filtered to the one `ONE-THAIESGX-L` holding, the portfolio row and that fund's
own row agree to four decimal places on both return (`0.4056%`) and annualized
volatility (`7.884%`) over the same 43-point window.

This check initially failed — portfolio `+0.41%` against fund `+7.12%` — and
caught a defect all eight prior tasks missed: `windowSeries` filtered only by
`tfWindow`, which for `MAX` returns every stored date, so per-fund and benchmark
risk rows measured from each series' first stored NAV including the pre-anchor
backtest span. Fixed in commit `06e9f23`.

### Language parity

Every string this phase touched resolves in both languages: `noAnchor`,
`setStartDate`, `setStartPrompt`, `xirrEst`, `fromExec`, `thPrice`, `srcNav`,
`srcExec`. `scripts/check.mjs` reports 263 used keys resolving in both. The
Thai date labels render Buddhist years (`4 ก.ย. 2569`).

One pre-existing gap, not introduced here: the max-drawdown meta line is the
hardcoded literal `peak-to-trough` rather than a `t()` key, so it stays English
in Thai and `check.mjs`'s i18n gate cannot see it.

### Automated checks

`node scripts/check.mjs` → 5/5, including `perf engine: 20 fixtures pass`, exit 0.
