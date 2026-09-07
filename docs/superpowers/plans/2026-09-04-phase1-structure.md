# Phase 1 — Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 214px sidebar rail, the flat scrolling page, and the two competing time controls with the command bar / portfolio header / tab bar / tab body shell the spec defines, so the two things the owner actually does — check the total, browse holdings — both sit in the first screen.

**Architecture:** `index.html` stays a single file. The existing render pipeline (`computeAll` → `applyFilter` → the `safe(render*)` calls in `renderAll()`) is unchanged in shape; this phase changes what feeds it (one timeframe instead of two) and what contains its output (a CSS grid shell with five tab panels instead of a sidebar and a flat scroll). No visual restyling — Phase 3 owns that. Existing colors, `.btn`/`.card`/`.fchip` classes, and Chart.js usage carry over unchanged.

**Tech Stack:** Plain ES2020 in the single inline `<script>`. No build step, no new dependency. Node 24 for `scripts/check.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-dashboard-redesign-design.md` §1, §2. §3 (table) and §4 (visual language) are Phases 2–3 and out of scope here.

## Global Constraints

- The dashboard ships as a **single file**, `index.html`. No bundler, no external JS module, no new runtime dependency.
- `index.html` pins a sha256 hash of its inline script in a CSP meta tag. **After ANY edit to `index.html`, run `node scripts/update-csp.mjs` then `node scripts/check.mjs` before committing.** A stale hash disables all JavaScript on the live site.
- Every user-visible string must exist in both `I18N.en` and `I18N.th`. `scripts/check.mjs` fails the build on a missing key or an `en` key with no `th` translation. Dynamically-built keys (`t('r_'+k)`) are invisible to the scanner; `scripts/check.mjs`'s hardcoded list at the `r_d1/r_w1/r_d15/r_m1` line must be updated whenever that key set changes.
- Never write a synthetic price into `NAVDB`, persisted under `kkp_navdb_v2`.
- The ledger is append-only; never delete or mutate a `TXNS` entry.
- Do not touch the Phase 0 performance engine (`portfolioSeries`, `effectivePrice`, `portfolioAnchor`, `pageAsOf`, `windowCoverage`, `windowCashflows`, `riskStats`, `windowSeries`, `xirr`, `tfWindow`'s date-filtering role) beyond what each task explicitly specifies. Every fixture in `test/fixtures/` must keep passing after every task.
- Existing behaviour that must not regress: `txAbsorbed()` suppression of pre-`asof` entries, the `void` correction mechanism, the modal focus trap on `.modal-bg.show` (Buy/Sell, Switch, Sign in, fund detail), Supabase load/save, CSV export, print.
- Work on branch `redesign/phase1-structure`.
- There is no test framework. Verification is `node scripts/check.mjs` plus the browser checks each task specifies, using the static server at `http://127.0.0.1:8901/` (start it with `python -m http.server 8901 --bind 127.0.0.1` from the repo root if it isn't already running) and a portfolio loaded via `localStorage.setItem('kkp_holdings', await fetch('/holdings.json').then(r=>r.text()))` followed by stamping `asof` on every fund with units (the repo's `holdings.json` carries none) before reload.

---

## File structure

Everything is in `index.html`. No new files this phase.

| Region | Responsibility |
|---|---|
| `<style>` (head) | CSS. The sidebar rail rules and the narrow-screen overrides that dismantle it are replaced by a grid shell with its own breakpoints. |
| `<body>` markup | The command bar, portfolio header, tab bar and five tab panels replace `<header class="top">`, `.filterbar`, `.confidence`, `.hero`, and the six flat `<section>` blocks. |
| Inline `<script>` | `RANGE`/`RANGES` (dict-per-period) become one scalar timeframe. New: `periodStart`, tab and popover controllers. Unchanged: the Phase 0 engine, `computeAll`/`applyFilter`'s overall shape, every `render*` function's *body* (only their `[RANGE]` indexing changes). |

---

## Task 1: Unify the global timeframe

Replaces the two competing controls (hero pills `1D/1W/15D/1M` and chart timeframe `1W…MAX/CUSTOM`) with one scalar `histTF` that drives every period-dependent number. No new markup — the existing chart timeframe row (`#tfBtns`) becomes the sole control for this task; Task 2 relocates it into the command bar.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `daysBefore`, `refLE` (engine block, unchanged), `portfolioAnchor()`, `pageAsOf()` (Phase 0, unchanged).
- Produces:
  - `periodStart(tf, lastDateStr) -> string | null`, inside the perf engine sentinels.
  - `f.chg`, `f.pct` on every object in `ALL`: now **scalars**, not `RANGES`-keyed dicts.
  - `T.chg`, `T.pct`, `T.chgFrom`: scalars; `T.chgFrom` is the actual boundary date `refLE` resolved against, for Task 3's comparison-date label.
  - `noPeriod() -> boolean`, now `T.chg == null`.
  - `histTF` values: `'1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'MAX' | 'CUSTOM'`. `RANGE` and `RANGES` are deleted.

- [ ] **Step 1: Add `periodStart` and simplify `tfWindow`**

Find `tfWindow` inside the perf engine sentinels (`/* ==== PERF ENGINE START ==== */` … `END`):

```js
function tfWindow(dates){
 if(!dates.length)return dates;
 const last=dates[dates.length-1];
 if(histTF==='CUSTOM'){const from=histFrom||dates[0],to=histTo||last;return dates.filter(d=>d>=from&&d<=to);}
 const D={'1W':7,'1M':30,'3M':91,'6M':182,'1Y':365};
 let from;
 if(histTF==='YTD')from=last.slice(0,4)+'-01-01';
 else if(D[histTF])from=daysBefore(last,D[histTF]);
 else return dates; // MAX
 return dates.filter(d=>d>=from);
}
```

Replace it with:

```js
function periodStart(tf,lastDateStr){
 if(tf==='CUSTOM')return histFrom||null;
 const D={'1D':1,'1W':7,'1M':30,'3M':91,'6M':182,'1Y':365};
 if(tf==='YTD')return lastDateStr.slice(0,4)+'-01-01';
 if(D[tf])return daysBefore(lastDateStr,D[tf]);
 return null; // MAX, or CUSTOM with no bound set
}
function tfWindow(dates){
 if(!dates.length)return dates;
 const last=dates[dates.length-1];
 const from=periodStart(histTF,last)||dates[0];
 const to=histTF==='CUSTOM'&&histTo?histTo:last;
 return dates.filter(d=>d>=from&&d<=to);
}
```

This is behaviour-preserving for every `histTF` value `tfWindow` already handled, and adds `'1D'` (previously fell through to the `MAX` branch — a latent bug, since `1D` was never a valid chart timeframe before this task). `periodStart` calls only `daysBefore`, already in the block, so it stays sandbox-pure.

- [ ] **Step 2: Verify the fixtures still pass**

Run: `node scripts/check-perf.mjs`
Expected: `20 fixture(s) passed, 0 failed`. Fixture 19 exercises `tfWindow`'s `CUSTOM` branch directly and must be unaffected.

- [ ] **Step 3: Scalarize `computeAll`'s per-fund period figures**

Find, in `computeAll`:

```js
 const _pao=pageAsOf(),_noAnchor=portfolioAnchor()===null;
```

Replace with:

```js
 const _pao=pageAsOf(),_anchor=portfolioAnchor(),_noAnchor=_anchor===null;
```

Then find:

```js
  const rv=n=>ds.length?refLE(ds,vs,daysBefore(ld,n)):last;
  const value=h.units*last,cost=h.units*h.avg;
  const o={code,name:h.name,amc:h.amc,tax:h.tax,asset:h.asset,units:h.units,avg:h.avg,nav:vs[vs.length-1],nav_date:ld,
   price:_po.price,price_src:_po.src,price_date:_po.date,
   value,cost,unreal:value-cost,unreal_pct:cost?(value-cost)/cost*100:0,realized:h.realized,dates:ds,vvals:vs,chg:{},pct:{}};
  if(!_noAnchor&&ds.length)for(const k in RANGES){const r=rv(RANGES[k].d);o.chg[k]=h.units*(last-r);o.pct[k]=(last/r-1)*100;}
  ALL.push(o);}
```

Replace with:

```js
  const value=h.units*last,cost=h.units*h.avg;
  const o={code,name:h.name,amc:h.amc,tax:h.tax,asset:h.asset,units:h.units,avg:h.avg,nav:vs[vs.length-1],nav_date:ld,
   price:_po.price,price_src:_po.src,price_date:_po.date,
   value,cost,unreal:value-cost,unreal_pct:cost?(value-cost)/cost*100:0,realized:h.realized,dates:ds,vvals:vs,chg:null,pct:null};
  if(!_noAnchor&&ds.length){const from=periodStart(histTF,_as)||_anchor||ds[0];const r=refLE(ds,vs,from);o.chg=h.units*(last-r);o.pct=(last/r-1)*100;}
  ALL.push(o);}
```

`rv` is deleted — its one caller is now inlined, since there is only ever one active period. `_as` is the local already computed two lines above this block (`const _as=_pao||new Date().toISOString().slice(0,10);`) — leave that line as-is.

`periodStart` returning `null` for `MAX` and unset `CUSTOM` now falls through to `_anchor` (the reliable-history start), matching the spec's "`MAX` runs from the reliable-history start" — this replaces the old behaviour of walking back from `ld` (each fund's own last **NAV** date), which is also what the final Phase 0 review flagged as inconsistent with `_as` (`pageAsOf`, which can rest on an execution). This task closes that gap as a side effect of the unification: every period, including `MAX`, is now measured against `_as`, not `ld`.

- [ ] **Step 4: Scalarize `applyFilter`'s portfolio-level period figures**

Find:

```js
 T.unreal_pct=T.cost?T.unreal/T.cost*100:0;T.chg={};T.pct={};
 // Range changes use the same calendar basis as the history chart:
 // portfolio value on the latest valued date minus value n days earlier
 // (per-fund NAVs carried forward), so headline and chart always agree.
 const psH=portfolioSeries();
 if(psH.length>1){
  const dsP=psH.map(x=>x.date),vsP=psH.map(x=>x.value),lastD=dsP[dsP.length-1],lastV=vsP[vsP.length-1];
  for(const k in RANGES){const ref=refLE(dsP,vsP,daysBefore(lastD,RANGES[k].d));T.chg[k]=lastV-ref;T.pct[k]=ref?T.chg[k]/ref*100:0;}
 }
```

Replace with:

```js
 T.unreal_pct=T.cost?T.unreal/T.cost*100:0;T.chg=null;T.pct=null;T.chgFrom=null;
 // Period changes use the same calendar basis as the history chart: portfolio
 // value on the latest valued date minus value at the resolved boundary date
 // (per-fund prices carried forward), so headline and chart always agree.
 const psH=portfolioSeries();
 if(psH.length>1){
  const dsP=psH.map(x=>x.date),vsP=psH.map(x=>x.value),lastD=dsP[dsP.length-1],lastV=vsP[vsP.length-1];
  const from=periodStart(histTF,lastD)||portfolioAnchor()||dsP[0];
  const refDate=[...dsP].reverse().find(d=>d<=from)||dsP[0];
  const ref=refLE(dsP,vsP,from);T.chg=lastV-ref;T.pct=ref?T.chg/ref*100:0;T.chgFrom=refDate;
 }
```

`T.chgFrom` is unused until Task 3; compute it now so `applyFilter` stays the single place that resolves the boundary.

- [ ] **Step 5: Simplify `noPeriod`**

Find:

```js
function noPeriod(){for(const k in RANGES)if(T.chg[k]!=null)return false;return true;}
```

Replace with:

```js
function noPeriod(){return T.chg==null;}
```

- [ ] **Step 6: Drop the `[RANGE]`/`[histTF]` indexing everywhere else**

In `renderTL`, find:

```js
function renderTL(){
 const b=T.chg[RANGE],p=T.pct[RANGE];
 const tlb=document.getElementById('tl-baht');
 document.getElementById('g-tl').textContent='· '+rangeLabel(RANGE);document.getElementById('l-tl').textContent='· '+rangeLabel(RANGE);
 document.getElementById('th-tl').textContent='('+rangeLabel(RANGE)+')';
```

Replace with:

```js
function renderTL(){
 const b=T.chg,p=T.pct;
 const tlb=document.getElementById('tl-baht');
 document.getElementById('g-tl').textContent='· '+rangeLabel(histTF);document.getElementById('l-tl').textContent='· '+rangeLabel(histTF);
 document.getElementById('th-tl').textContent='('+rangeLabel(histTF)+')';
```

Leave the rest of `renderTL` (the `noPeriod()` branch, the `tl-label` line) unchanged — it already reads `b`/`p` as locals, and its `rangeLabel(RANGE)` call further down also becomes `rangeLabel(histTF)`:

```js
 document.getElementById('tl-label').textContent=t('tlLabel').replace('{p}',LANG==='en'?rangeLabel(RANGE).toLowerCase():rangeLabel(RANGE));
```
→
```js
 document.getElementById('tl-label').textContent=t('tlLabel').replace('{p}',LANG==='en'?rangeLabel(histTF).toLowerCase():rangeLabel(histTF));
```

In `renderMovers`, find:

```js
 const s=F.filter(f=>Number.isFinite(f.pct[RANGE])).sort((a,b)=>b.pct[RANGE]-a.pct[RANGE]);
 const row=(f,i)=>`<div class="mover" role="button" tabindex="0" data-fund="${escAttr(f.code)}"><div class="rank">${i+1}</div>
  <div class="nm"><div class="c">${escHTML(f.code)}</div><div class="t">${escHTML(f.amc)} · ${escHTML(f.name)}</div></div>
  <div style="text-align:right"><div class="pct ${cls(f.pct[RANGE])}">${sign(f.pct[RANGE])}%</div><div class="baht">฿${sign(f.chg[RANGE])}</div></div></div>`;
```

Replace with:

```js
 const s=F.filter(f=>Number.isFinite(f.pct)).sort((a,b)=>b.pct-a.pct);
 const row=(f,i)=>`<div class="mover" role="button" tabindex="0" data-fund="${escAttr(f.code)}"><div class="rank">${i+1}</div>
  <div class="nm"><div class="c">${escHTML(f.code)}</div><div class="t">${escHTML(f.amc)} · ${escHTML(f.name)}</div></div>
  <div style="text-align:right"><div class="pct ${cls(f.pct)}">${sign(f.pct)}%</div><div class="baht">฿${sign(f.chg)}</div></div></div>`;
```

In `valOf`, find:

```js
function valOf(f,k){if(k==='weight')return f.value;if(k==='chg'){const v=f.pct[RANGE];return Number.isFinite(v)?v:0;}if(k==='code')return f.code;return f[k];}
```

Replace with:

```js
function valOf(f,k){if(k==='weight')return f.value;if(k==='chg'){const v=f.pct;return Number.isFinite(v)?v:0;}if(k==='code')return f.code;return f[k];}
```

In `renderTable`, find:

```js
 document.getElementById('tbody').innerHTML=rows.map(f=>{const w=T.value?f.value/T.value*100:0,chg=f.chg[RANGE],cp=f.pct[RANGE],stale=T.nav_as_of&&f.nav_date&&isoDayDiff(T.nav_as_of,f.nav_date)>3,noFund=noAnchor||chg==null;
```

Replace with:

```js
 document.getElementById('tbody').innerHTML=rows.map(f=>{const w=T.value?f.value/T.value*100:0,chg=f.chg,cp=f.pct,stale=T.nav_as_of&&f.nav_date&&isoDayDiff(T.nav_as_of,f.nav_date)>3,noFund=noAnchor||chg==null;
```

and, in the same function's totals row, find:

```js
   <td class="${noAnchor?'':cls(T.chg[RANGE])}">${noAnchor?'<span style="color:var(--muted2)">—</span>':`฿${sign(T.chg[RANGE])}<br><span style="font-size:10.5px">${sign(T.pct[RANGE])}%</span>`}</td>
```

Replace with:

```js
   <td class="${noAnchor?'':cls(T.chg)}">${noAnchor?'<span style="color:var(--muted2)">—</span>':`฿${sign(T.chg)}<br><span style="font-size:10.5px">${sign(T.pct)}%</span>`}</td>
```

In `exportCSV`, find:

```js
  .map(f=>{const noFund=noAnchor||f.chg[RANGE]==null;return[f.code,f.name,f.amc,f.tax,f.asset,f.price,f.price_src==='exec'?'Execution':'NAV',f.price_date,f.nav,f.nav_date,f.units,f.avg,f.value.toFixed(2),(f.value/T.value*100).toFixed(2),noFund?'':f.chg[RANGE].toFixed(2),noFund?'':f.pct[RANGE].toFixed(2),f.unreal.toFixed(2),f.unreal_pct.toFixed(2),f.realized.toFixed(2)];})
```

(locate the exact text with `grep -n "noFund=noAnchor" index.html` — the surrounding line may wrap differently; the two `f.chg[RANGE]`/`f.pct[RANGE]` reads are the ones to drop the index from). Replace every `f.chg[RANGE]` with `f.chg` and `f.pct[RANGE]` with `f.pct` in that row mapper, and:

```js
 rows.push([t('totalWord'),'','','','','','','','','','','',T.value.toFixed(2),'100',noAnchor?'':T.chg[RANGE].toFixed(2),noAnchor?'':T.pct[RANGE].toFixed(2),T.unreal.toFixed(2),T.unreal_pct.toFixed(2),T.realized.toFixed(2)]);
```

Replace `T.chg[RANGE]` → `T.chg` and `T.pct[RANGE]` → `T.pct` in that line too.

- [ ] **Step 7: Delete the hero pills, `RANGE`, and `RANGES`**

In the hero markup, find:

```html
   <div class="range-pills" id="pills">
    <button data-r="d1">1D</button><button data-r="w1">1W</button><button data-r="d15" class="on">15D</button><button data-r="m1">1M</button></div>
```

Delete this `<div>` entirely (both lines).

In the script, find:

```js
const RANGES={d1:{d:1,l:'1 Day'},w1:{d:7,l:'1 Week'},d15:{d:15,l:'15 Days'},m1:{d:30,l:'1 Month'}};
```

Delete this line.

Find:

```js
let RANGE='d15',histMode='value',histSel=new Set(['__PORT__']),msFilter='',histSort='value',sortK='value',sortDir=-1;
```

Replace with:

```js
let histMode='value',histSel=new Set(['__PORT__']),msFilter='',histSort='value',sortK='value',sortDir=-1;
```

Find the pills click handler:

```js
document.querySelectorAll('#pills button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#pills button').forEach(x=>x.classList.remove('on'));b.classList.add('on');RANGE=b.dataset.r;renderTL();renderMovers();renderTable();});
```

Delete this line entirely.

- [ ] **Step 8: Add `1D` to the timeframe control and route its clicks through `renderAll`**

Find the chart timeframe row:

```html
    <div class="ms-modes" id="tfBtns"><button data-tf="1W">1W</button><button data-tf="1M">1M</button><button data-tf="3M">3M</button><button data-tf="6M">6M</button><button data-tf="1Y">1Y</button><button data-tf="YTD">YTD</button><button data-tf="MAX" class="on">MAX</button></div>
```

Replace with:

```html
    <div class="ms-modes" id="tfBtns"><button data-tf="1D">1D</button><button data-tf="1W">1W</button><button data-tf="1M">1M</button><button data-tf="3M">3M</button><button data-tf="6M">6M</button><button data-tf="1Y">1Y</button><button data-tf="YTD">YTD</button><button data-tf="MAX" class="on">MAX</button></div>
```

Find:

```js
document.querySelectorAll('#tfBtns button').forEach(b=>{
 if(b.dataset.tf===histTF)b.classList.add('on');else b.classList.remove('on');
 b.onclick=()=>{document.querySelectorAll('#tfBtns button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  histTF=b.dataset.tf;histFrom='';histTo='';localStorage.setItem('kkp_histtf',histTF);renderHist();renderRisk();};});
document.getElementById('tfApply').onclick=()=>{
 const f=document.getElementById('tfFrom').value,to=document.getElementById('tfTo').value;
 if(!f&&!to)return;
 histTF='CUSTOM';histFrom=f;histTo=to;
 document.querySelectorAll('#tfBtns button').forEach(x=>x.classList.remove('on'));
 renderHist();renderRisk();};
```

Replace with:

```js
document.querySelectorAll('#tfBtns button').forEach(b=>{
 if(b.dataset.tf===histTF)b.classList.add('on');else b.classList.remove('on');
 b.onclick=()=>{document.querySelectorAll('#tfBtns button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  histTF=b.dataset.tf;histFrom='';histTo='';
  localStorage.setItem('kkp_histtf',histTF);localStorage.removeItem('kkp_histfrom');localStorage.removeItem('kkp_histto');
  renderAll();};});
document.getElementById('tfApply').onclick=()=>{
 const f=document.getElementById('tfFrom').value,to=document.getElementById('tfTo').value;
 if(!f&&!to)return;
 histTF='CUSTOM';histFrom=f;histTo=to;
 localStorage.setItem('kkp_histtf','CUSTOM');localStorage.setItem('kkp_histfrom',histFrom);localStorage.setItem('kkp_histto',histTo);
 document.querySelectorAll('#tfBtns button').forEach(x=>x.classList.remove('on'));
 renderAll();};
```

This is §2's Persistence requirement: `tfApply` now writes all three keys, and switching to a fixed period clears any stale custom bounds. Calling `renderAll()` instead of `renderHist();renderRisk();` is what makes this the single control — hero, table and movers now recompute on every timeframe change, not just the chart and risk section.

- [ ] **Step 9: Load a stored `CUSTOM` defensively**

Find:

```js
let histTF=localStorage.getItem('kkp_histtf')||'MAX',histFrom='',histTo='';
```

Replace with:

```js
let histTF=localStorage.getItem('kkp_histtf')||'MAX',histFrom=localStorage.getItem('kkp_histfrom')||'',histTo=localStorage.getItem('kkp_histto')||'';
if(histTF==='CUSTOM'&&(!histFrom||!histTo||!/^\d{4}-\d{2}-\d{2}$/.test(histFrom)||!/^\d{4}-\d{2}-\d{2}$/.test(histTo))){histTF='MAX';histFrom='';histTo='';localStorage.setItem('kkp_histtf','MAX');localStorage.removeItem('kkp_histfrom');localStorage.removeItem('kkp_histto');}
```

A stored `CUSTOM` whose bounds are missing or malformed falls back to `MAX`, per §2.

- [ ] **Step 10: Update the range-label i18n keys**

Find, in `I18N.en`:

```js
 r_d1:'1 Day',r_w1:'1 Week',r_d15:'15 Days',r_m1:'1 Month',tlLabel:'Portfolio value change over the past {p}',showing:'Showing <b>{a}</b> of {b} funds',
```

Replace with:

```js
 r_1D:'1 Day',r_1W:'1 Week',r_1M:'1 Month',r_3M:'3 Months',r_6M:'6 Months',r_1Y:'1 Year',r_YTD:'Year to date',r_MAX:'All history',r_CUSTOM:'Custom range',tlLabel:'Portfolio value change over the past {p}',showing:'Showing <b>{a}</b> of {b} funds',
```

Find, in `I18N.th` (its own `r_d1:...` line):

```js
 r_d1:'1 วัน',r_w1:'1 สัปดาห์',r_d15:'15 วัน',r_m1:'1 เดือน',tlLabel:'มูลค่าพอร์ตเปลี่ยนแปลงในช่วง {p}
```

Replace the `r_*` portion with:

```js
 r_1D:'1 วัน',r_1W:'1 สัปดาห์',r_1M:'1 เดือน',r_3M:'3 เดือน',r_6M:'6 เดือน',r_1Y:'1 ปี',r_YTD:'ตั้งแต่ต้นปี',r_MAX:'ทั้งหมด',r_CUSTOM:'ช่วงที่กำหนดเอง',
```

keeping the rest of that line (`tlLabel:...` onward) exactly as it already reads — only the `r_*` keys are being replaced, in place.

- [ ] **Step 11: Update `check.mjs`'s hardcoded range-label list**

Find, in `scripts/check.mjs`:

```js
  ['r_d1','r_w1','r_d15','r_m1'].forEach(k => { if (!(k in I18N.en)) missing.en.push(k); if (!(k in I18N.th)) missing.th.push(k); });
```

Replace with:

```js
  ['r_1D','r_1W','r_1M','r_3M','r_6M','r_1Y','r_YTD','r_MAX','r_CUSTOM'].forEach(k => { if (!(k in I18N.en)) missing.en.push(k); if (!(k in I18N.th)) missing.th.push(k); });
```

- [ ] **Step 12: Refresh the CSP hash and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines including `perf engine: 20 fixtures pass`, exit 0.

- [ ] **Step 13: Verify in the browser**

Load the portfolio (see Global Constraints), stamp `asof` on every fund, reload.

1. The hero no longer shows the `1D/1W/15D/1M` pill row.
2. Click `1D` in the chart's timeframe row (now the only timeframe control): the hero Δ, the table's Change column, the movers lists, the chart, and the risk section all update together. Click `MAX`: same.
3. Set a custom range via the date inputs and Apply: hero/table/movers/chart/risk all reflect it. Reload the page: the custom range and its dates survive.
4. Switch language: `1D` through `MAX`'s text next to Gainers/Losers/the table header (`rangeLabel`) reads correctly in both languages.
5. Console is clean — no `ReferenceError: RANGE is not defined`.

- [ ] **Step 14: Commit**

```bash
git add index.html scripts/check.mjs
git commit -m "Unify the global timeframe into a single scalar control"
```

---

## Task 2: Command bar

Replaces `<header class="top">` and the `.filterbar`/`.confidence` block with the command bar the spec defines: brand, AMC/Tax filter popovers, the timeframe control (moved here from the Historical Comparison card), TH/EN, an overflow panel holding one-shot actions, and `Update NAV` as the one button that never moves. Built for desktop widths first; Task 5 adds the narrower collapse behaviour on top of what this task creates. The six existing `<section>` blocks stay flat below, untabbed — Task 4 wraps them.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `filterAMC`, `filterTax` (existing `Set`s), `buildFilters()` (existing, rewritten to target new markup), `histTF`/`periodStart` (Task 1).
- Produces:
  - A reusable non-modal popover pattern: `openPopover(triggerEl, panelEl)` / `closePopover(panelEl)`, used by the AMC popover, Tax popover, and the overflow panel.
  - `#amcPopover`, `#taxPopover`, `#overflowPanel` — `role="dialog"`, non-modal, `aria-haspopup="dialog"` triggers.
  - The action buttons (`Sign in`, `Buy / Sell`, `Switch`, `CSV export`, `Print`, both imports, `Copy AI import prompt`, `Download nav_history.json`, `Import NAV database`, TH/EN) relocate into `#overflowPanel`. `Update NAV` does not.

- [ ] **Step 1: Add the popover CSS**

Add, near the existing `.fchip`/`.chip2` rules (after the `.chip2{...}` line):

```css
.cmdbar{display:flex;align-items:center;gap:10px;padding:10px 22px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.cmdbar-group{position:relative;display:flex;align-items:center;gap:8px}
.popover-trigger{display:inline-flex;align-items:center;gap:6px}
.popover{position:absolute;top:calc(100% + 6px);left:0;z-index:60;min-width:220px;background:var(--panel);border:1px solid var(--line2);border-radius:var(--radius-md,12px);box-shadow:var(--shadow);padding:12px;display:none}
.popover.open{display:block}
.popover h4{margin:0 0 8px;font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.5px}
.popover-row{display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:6px}
.popover-row:hover{background:var(--panel2)}
.popover-row input[type=checkbox],.popover-row input[type=radio]{accent-color:var(--accent)}
.popover-actions{display:flex;flex-direction:column;gap:4px;min-width:240px}
.popover-actions .btn{justify-content:flex-start}
.tf-segmented{display:inline-flex;background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:3px;gap:2px}
.tf-segmented button{background:none;border:none;color:var(--muted);font:inherit;font-weight:600;font-size:12.5px;padding:6px 12px;border-radius:8px;cursor:pointer}
.tf-segmented button.on{background:linear-gradient(135deg,#4d8dff,#3b6fd4);color:#fff}
```

- [ ] **Step 2: Replace the header markup**

Find:

```html
<header class="top"><div class="top-inner">
 <div class="brand"><div class="logo">PORT</div><div><h1>Portfolio Monitor</h1><div class="sub" data-i18n="brandSub">Multi-AMC · NAV-based valuation</div></div></div>
 <button class="btn ghost mobile-only menu-btn" id="mobileMenuBtn" type="button" aria-expanded="false" aria-controls="headerActions" data-i18n-aria="menuBtn">☰</button>
 <div class="upd" id="headerActions"><div class="asof"><div><span data-i18n="asOf">As of</span> <b id="asof"></b></div><div id="srcline" style="font-size:10.5px;color:var(--muted2)"></div></div>
  <button class="btn ghost" id="langBtn" style="font-size:13px;padding:9px 13px;min-width:52px;justify-content:center">ไทย</button>
  <button class="btn ghost" id="authBtn" style="font-size:13px;padding:9px 13px">☁ Sign in</button>
  <button class="btn ghost" id="txnBtn" style="font-size:13px;padding:9px 13px" data-i18n="txnBtn">⇄ Buy / Sell</button>
  <button class="btn ghost" id="swBtn" style="font-size:13px;padding:9px 13px" data-i18n="swBtn">⇌ Switch</button>
  <button class="btn" id="updBtn"><span id="updIco">↻</span><span id="updTxt" data-i18n="updNav">Update NAV</span></button></div>
</div></header>
```

Replace with:

```html
<header class="cmdbar" id="cmdbar">
 <div class="brand"><div class="logo">PORT</div><div><h1>Portfolio Monitor</h1><div class="sub" data-i18n="brandSub">Multi-AMC · NAV-based valuation</div></div></div>

 <div class="cmdbar-group">
  <button type="button" class="btn ghost popover-trigger" id="amcTrigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="amcPopover"><span data-i18n="lblAMC">AMC</span><span id="amcTriggerLabel"></span></button>
  <div class="popover" id="amcPopover" role="dialog" aria-label="AMC" data-i18n-aria-label="lblAMC"></div>
 </div>
 <div class="cmdbar-group">
  <button type="button" class="btn ghost popover-trigger" id="taxTrigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="taxPopover"><span data-i18n="lblTax">Tax</span><span id="taxTriggerLabel"></span></button>
  <div class="popover" id="taxPopover" role="dialog" aria-label="Tax" data-i18n-aria-label="lblTax"></div>
 </div>

 <div class="tf-segmented" id="cmdTf"></div>

 <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
  <button class="btn" id="updBtn"><span id="updIco">↻</span><span id="updTxt" data-i18n="updNav">Update NAV</span></button>
  <div class="cmdbar-group">
   <button type="button" class="btn ghost popover-trigger" id="overflowTrigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="overflowPanel" aria-label="More" data-i18n-aria-label="menuBtn">⋯</button>
   <div class="popover popover-actions" id="overflowPanel" role="dialog" aria-label="More actions" data-i18n-aria-label="menuBtn" style="right:0;left:auto"></div>
  </div>
 </div>
</header>
```

`amcTriggerLabel`/`taxTriggerLabel` and the popovers' contents are filled by `buildFilters()` in Step 4. `cmdTf` is filled by Step 5. `overflowPanel`'s contents are filled by Step 6.

- [ ] **Step 3: Write the shared popover controller**

Add, near `showDialog`/`hideDialog`:

```js
let OPEN_POPOVER=null;
function openPopover(trigger,panel){
 if(OPEN_POPOVER&&OPEN_POPOVER.panel!==panel)closePopover(OPEN_POPOVER.panel);
 panel.classList.add('open');trigger.setAttribute('aria-expanded','true');
 OPEN_POPOVER={trigger,panel};
 const focusable=panel.querySelector('button,input,[tabindex]');
 if(focusable)focusable.focus();
}
function closePopover(panel,restoreFocus){
 if(!panel||!panel.classList.contains('open'))return;
 panel.classList.remove('open');
 const trigger=document.querySelector(`[aria-controls="${panel.id}"]`);
 if(trigger)trigger.setAttribute('aria-expanded','false');
 if(restoreFocus&&trigger)trigger.focus();
 if(OPEN_POPOVER&&OPEN_POPOVER.panel===panel)OPEN_POPOVER=null;
}
document.addEventListener('click',e=>{
 if(!OPEN_POPOVER)return;
 if(OPEN_POPOVER.panel.contains(e.target)||OPEN_POPOVER.trigger.contains(e.target))return;
 closePopover(OPEN_POPOVER.panel);
},true);
document.addEventListener('focusin',e=>{
 if(!OPEN_POPOVER)return;
 if(OPEN_POPOVER.panel.contains(e.target)||OPEN_POPOVER.trigger.contains(e.target))return;
 closePopover(OPEN_POPOVER.panel);
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&OPEN_POPOVER){closePopover(OPEN_POPOVER.panel,true);}
},true);
document.querySelectorAll('.popover-trigger').forEach(btn=>{
 btn.onclick=()=>{const panel=document.getElementById(btn.getAttribute('aria-controls'));
  if(panel.classList.contains('open'))closePopover(panel,true);else openPopover(btn,panel);};
});
```

This is non-modal by construction: it never intercepts `Tab`, so focus leaves the panel through the browser's normal order; the `focusin` listener closes the panel once focus has actually left it (not on every keystroke), and `Escape` is the only path that also restores focus to the trigger — matching §1's "focus-out does not \[restore focus\], since focus has already gone where the user sent it."

The existing global keydown handler traps `Tab` only inside `.modal-bg.show` (Buy/Sell, Switch, Sign in, fund detail) — untouched, so those stay modal.

- [ ] **Step 4: Rewrite `buildFilters` to render into the popovers**

Find:

```js
function buildFilters(){
 const amcs=[...new Set(ALL.map(f=>f.amc))];
 const taxes=[...new Set(ALL.map(f=>f.tax))];
 document.getElementById('amcFilter').innerHTML=amcs.map(a=>`<button type="button" class="fchip amc ${filterAMC.has(a)?'on':''}" data-a="${escAttr(a)}" style="${filterAMC.has(a)?`background:${AMC_COL[a]||'#c7a760'};color:#10130f`:''}">${escHTML(a)}</button>`).join('');
 document.getElementById('taxFilter').innerHTML=taxes.map(x=>`<button type="button" class="fchip tax ${filterTax.has(x)?'on':''}" data-t="${escAttr(x)}" style="${filterTax.has(x)?`background:${TAX_COL[x]||'#c7a760'};color:#10130f`:''}">${escHTML(x)}</button>`).join('');
 document.querySelectorAll('.fchip.amc').forEach(c=>c.onclick=()=>{const a=c.dataset.a;filterAMC.has(a)?filterAMC.delete(a):filterAMC.add(a);renderAll();});
 document.querySelectorAll('.fchip.tax').forEach(c=>c.onclick=()=>{const t=c.dataset.t;filterTax.has(t)?filterTax.delete(t):filterTax.add(t);renderAll();});
 document.getElementById('fstatus').innerHTML=t('showing').replace('{a}',F.length).replace('{b}',ALL.length);
}
```

Replace with:

```js
function buildFilterPopover(panelId,triggerLabelId,items,activeSet,colorMap,allLabelKey){
 const panel=document.getElementById(panelId);
 panel.innerHTML=`<h4 data-i18n="${allLabelKey}"></h4>`+items.map(x=>`<label class="popover-row"><input type="checkbox" data-v="${escAttr(x)}" ${activeSet.has(x)?'checked':''}><span>${escHTML(x)}</span></label>`).join('');
 panel.querySelector('h4').textContent=t(allLabelKey);
 panel.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.onchange=()=>{const v=cb.dataset.v;activeSet.has(v)?activeSet.delete(v):activeSet.add(v);renderAll();});
 const label=document.getElementById(triggerLabelId);
 if(activeSet.size===0)label.textContent='';
 else if(activeSet.size===1)label.textContent=': '+[...activeSet][0];
 else label.textContent=': '+[...activeSet][0]+' +'+(activeSet.size-1);
}
function buildFilters(){
 const amcs=[...new Set(ALL.map(f=>f.amc))];
 const taxes=[...new Set(ALL.map(f=>f.tax))];
 buildFilterPopover('amcPopover','amcTriggerLabel',amcs,filterAMC,AMC_COL,'lblAMC');
 buildFilterPopover('taxPopover','taxTriggerLabel',taxes,filterTax,TAX_COL,'lblTax');
}
```

The old `#fstatus` ("Showing N of M funds") line and its `showing` i18n key move to the scope chip in Task 3; `buildFilters` no longer writes it. `AMC_COL`/`TAX_COL` are passed through but unused inside `buildFilterPopover` for now — Phase 3 (visual language) is what applies per-item colour; leave the parameter so that task's diff is additive, not a signature change.

- [ ] **Step 5: Move the timeframe control into the command bar**

The chart card still owns `#tfBtns` and `#tfApply`/`#tfFrom`/`#tfTo` (the custom-range inputs stay in the Historical Comparison card — only the fixed-period segmented control relocates). Find the markup added in Task 1 Step 8:

```html
    <div class="ms-modes" id="tfBtns"><button data-tf="1D">1D</button><button data-tf="1W">1W</button><button data-tf="1M">1M</button><button data-tf="3M">3M</button><button data-tf="6M">6M</button><button data-tf="1Y">1Y</button><button data-tf="YTD">YTD</button><button data-tf="MAX" class="on">MAX</button></div>
```

Delete this line from the chart card's `.tf-row` (leave `.tf-custom` and `#benchSel` in place there).

In the command bar markup from Step 2, the `<div class="tf-segmented" id="cmdTf"></div>` placeholder receives the same buttons. Add a render function next to `buildFilters`:

```js
function renderTfControl(){
 const tf=document.getElementById('cmdTf');
 const opts=['1D','1W','1M','3M','6M','1Y','YTD','MAX'];
 tf.innerHTML=opts.map(o=>`<button type="button" data-tf="${o}" class="${histTF===o?'on':''}">${o}</button>`).join('');
 tf.querySelectorAll('button').forEach(b=>b.onclick=()=>{
  histTF=b.dataset.tf;histFrom='';histTo='';
  localStorage.setItem('kkp_histtf',histTF);localStorage.removeItem('kkp_histfrom');localStorage.removeItem('kkp_histto');
  renderAll();
 });
}
```

`renderAll()` (called after every timeframe change) must call this so the command bar's buttons re-render with the correct `.on` state — including after a custom range is applied, where none of the eight should show `.on`. Find, in `renderAll()`:

```js
function renderAll(){
 buildHoldings();computeAll();applyFilter();
 safe(buildFilters);safe(renderHeader);safe(renderConfidence);safe(renderEmpty);safe(renderTL);safe(renderMovers);safe(renderPL);safe(renderTable);safe(renderMSList);
 safe(renderDonuts);safe(renderHist);safe(renderRisk);safe(renderBenchSel);safe(renderUnlock);safe(renderConc);
}
```

Replace with:

```js
function renderAll(){
 buildHoldings();computeAll();applyFilter();
 safe(buildFilters);safe(renderTfControl);safe(renderHeader);safe(renderConfidence);safe(renderEmpty);safe(renderTL);safe(renderMovers);safe(renderPL);safe(renderTable);safe(renderMSList);
 safe(renderDonuts);safe(renderHist);safe(renderRisk);safe(renderBenchSel);safe(renderUnlock);safe(renderConc);
}
```

The custom-range Apply button (`#tfApply`, still in the chart card) must also refresh the command bar's buttons on use — its handler already calls `renderAll()` after Task 1 Step 8, which now includes `renderTfControl`, so no further change is needed there.

- [ ] **Step 6: Move one-shot actions into the overflow panel**

Find the footer block:

```html
 <div class="foot">
  <span data-i18n="footNote">Market value = units × latest NAV (Finnomena). Cost basis &amp; realized P/L from your statements. NAV database accumulates locally on each update.</span><br>
  <button class="btn ghost" id="expBtn" data-i18n="expBtn">⬇ Download nav_history.json</button>
  <button class="btn ghost" id="impBtn" data-i18n="impBtn">⬆ Import NAV database</button><input type="file" id="impFile" accept="application/json">
  <button class="btn ghost" id="impHoldBtn" data-i18n="impHoldBtn">⬆ Import portfolio (holdings.json)</button><input type="file" id="impHoldFile" accept="application/json">
  <button class="btn ghost" id="promptBtn" data-i18n="promptBtn">📋 Copy AI import prompt</button>
  <div style="margin-top:9px" data-i18n="disclaimer">For portfolio tracking only — not investment advice.</div>
```

Its closing `</div></div>` two lines below stays; only the button row moves. Replace the block above with a plain informational footer (no buttons):

```html
 <div class="foot">
  <span data-i18n="footNote">Market value = units × latest NAV (Finnomena). Cost basis &amp; realized P/L from your statements. NAV database accumulates locally on each update.</span>
  <div style="margin-top:9px" data-i18n="disclaimer">For portfolio tracking only — not investment advice.</div>
```

Populate the overflow panel (Step 2's `#overflowPanel`) once, at load, alongside the other one-time DOM wiring (find the block of `document.getElementById('...').onclick=...` lines near the bottom of the script and add this near them):

```js
document.getElementById('overflowPanel').innerHTML=`
 <button type="button" class="btn ghost" id="ovLang" style="justify-content:space-between"><span data-i18n="langBtnLbl">Language</span><span id="ovLangVal">ไทย</span></button>
 <button type="button" class="btn ghost" id="ovAuth"></button>
 <button type="button" class="btn ghost" id="ovTxn" data-i18n="txnBtn">⇄ Buy / Sell</button>
 <button type="button" class="btn ghost" id="ovSw" data-i18n="swBtn">⇌ Switch</button>
 <hr style="border-color:var(--line);margin:6px 0">
 <button type="button" class="btn ghost" id="ovCsv" data-i18n="csvBtn">⬇ Export CSV</button>
 <button type="button" class="btn ghost" id="ovPrint" data-i18n="printBtn">🖨 Print</button>
 <hr style="border-color:var(--line);margin:6px 0">
 <button type="button" class="btn ghost" id="ovExp" data-i18n="expBtn">⬇ Download nav_history.json</button>
 <button type="button" class="btn ghost" id="ovImp" data-i18n="impBtn">⬆ Import NAV database</button>
 <button type="button" class="btn ghost" id="ovImpHold" data-i18n="impHoldBtn">⬆ Import portfolio (holdings.json)</button>
 <button type="button" class="btn ghost" id="promptBtn" data-i18n="promptBtn">📋 Copy AI import prompt</button>`;
applyLang();
document.getElementById('ovLang').onclick=()=>{LANG=LANG==='en'?'th':'en';localStorage.setItem('kkp_lang',LANG);applyLang();renderAll();};
document.getElementById('ovAuth').onclick=openAuth;
document.getElementById('ovTxn').onclick=()=>openTxn('');
document.getElementById('ovSw').onclick=openSw;
document.getElementById('ovCsv').onclick=exportCSV;
document.getElementById('ovPrint').onclick=()=>window.print();
document.getElementById('ovExp').onclick=exportDB;
document.getElementById('ovImp').onclick=()=>document.getElementById('impFile').click();
document.getElementById('ovImpHold').onclick=()=>document.getElementById('impHoldFile').click();
```

`promptBtn` keeps its existing `id`, so the file's own existing handler —

```js
document.getElementById('promptBtn').onclick=async()=>{
```

(elsewhere in the script, unchanged by this task) keeps working with no further edit. Delete only its old *markup* location from the footer in the step above; do not touch its handler.

Two of the moved buttons had bespoke text logic that must survive:

- `authBtn`'s label used to switch between "☁ Sign in" and "☁ {email}" — find `updateAuthUI`:

  ```js
  function updateAuthUI(){const b=document.getElementById('authBtn');if(b)b.textContent=USER?('\u{1F464} '+USER.email.split('@')[0]):t('signIn');}
  ```

  Replace `'authBtn'` with `'ovAuth'`.

- `langBtn`'s own click handler toggled `LANG` directly; that logic is now `ovLang`'s handler above. Find the original:

  ```js
  document.getElementById('langBtn').onclick=()=>{LANG=LANG==='en'?'th':'en';localStorage.setItem('kkp_lang',LANG);applyLang();renderAll();};
  ```

  Delete this line — `ovLang`'s handler (added above) replaces it. Also add, in `applyLang()` (find its function body), a line that keeps `#ovLangVal` showing the *other* language as an offer to switch, matching the original button's convention of showing "ไทย" while in English and vice versa:

  ```js
  const ovLangVal=document.getElementById('ovLangVal');if(ovLangVal)ovLangVal.textContent=LANG==='en'?'ไทย':'English';
  ```

  Add this as the last line inside `applyLang()`.

- [ ] **Step 7: Delete the old filter-bar and confidence-bar wrapper markup that no longer applies**

The `#amcFilter`/`#taxFilter`/`#fstatus` spans and their `.filterbar` wrapper are superseded by the popovers. Find:

```html
 <!-- FILTER BAR -->
 <div id="fbSentinel" aria-hidden="true"></div>
 <div class="sticky-controls">
 <div class="filterbar">
  <div class="fgroup"><span class="lbl" data-i18n="lblAMC">AMC</span><span id="amcFilter"></span></div>
  <div class="fgroup"><span class="lbl" data-i18n="lblTax">Tax</span><span id="taxFilter"></span></div>
  <div class="fstatus" id="fstatus"></div>
 </div>

 <div class="confidence" id="confidenceBar" aria-live="polite">
  <div class="conf-item"><span class="conf-dot" id="coverageDot"></span><span data-i18n="confCoverage">Valuation coverage</span><b id="confCoverage">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="rangeDot"></span><span data-i18n="confRange">NAV date range</span><b id="confRange">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="staleDot"></span><span data-i18n="confStale">Stale funds</span><b id="confStale">—</b></div>
 </div>
 </div>
```

Replace with just the confidence bar, unwrapped (Task 3 relocates it into the portfolio header; for this task, leave it as a plain block directly under the command bar so nothing references a missing element):

```html
 <div class="confidence" id="confidenceBar" aria-live="polite">
  <div class="conf-item"><span class="conf-dot" id="coverageDot"></span><span data-i18n="confCoverage">Valuation coverage</span><b id="confCoverage">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="rangeDot"></span><span data-i18n="confRange">NAV date range</span><b id="confRange">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="staleDot"></span><span data-i18n="confStale">Stale funds</span><b id="confStale">—</b></div>
 </div>
```

`#fbSentinel` is deleted along with it — it existed only to give the old `topOff()` sticky heuristic a measurement point, which this phase removes in Task 4.

- [ ] **Step 8: Add `langBtnLbl` i18n key**

Add to `I18N.en`, beside `menuBtn`:

```js
 langBtnLbl:'Language',
```

Add to `I18N.th`:

```js
 langBtnLbl:'ภาษา',
```

- [ ] **Step 9: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines, exit 0. If i18n fails, a key referenced by the new markup (`data-i18n-aria-label="lblAMC"` etc. — confirm the existing `applyLang()` handles `data-i18n-aria-label`, or use whatever attribute-translation mechanism `data-i18n-aria` already uses elsewhere in the file; check with `grep -n "data-i18n-aria" index.html` and match its exact attribute name rather than inventing `data-i18n-aria-label`) is missing from one language.

- [ ] **Step 10: Verify in the browser**

At a desktop width (≥1240px, resize the window if needed):

1. Command bar shows: brand, `AMC` button, `Tax` button, the eight-button timeframe control, `Update NAV`, and a `⋯` overflow trigger. No left sidebar.
2. Click `AMC`: a popover opens listing every AMC as a checkbox, current filter state checked. Toggle one: the page's totals/table update (confirms `renderAll()` still runs) and the trigger label shows e.g. `: KKP`. Click elsewhere: it closes. Reopen and press `Escape`: it closes and focus returns to the `AMC` button.
3. Same for `Tax`.
4. Click `⋯`: the overflow panel opens with all the relocated buttons. Sign in, Buy/Sell, Switch, CSV export, Print, both imports, the AI prompt copy, and the NAV database download/import all still work exactly as before. Language switch still works and its neighbouring label shows the other language's name.
5. `Update NAV` is not inside the overflow panel — it is always visible.
6. Tab from the AMC button: focus moves into the popover's first checkbox, then continues through remaining checkboxes and out to the Tax button — it does not cycle back to the top of the AMC popover.
7. Console is clean.

- [ ] **Step 11: Commit**

```bash
git add index.html
git commit -m "Build the command bar: filter popovers, unified timeframe, overflow panel"
```

---

## Task 3: Portfolio header

Replaces `.hero` with the portfolio header the spec defines: total, Δ for the selected period with its resolved comparison date, a sparkline, the three secondary stats, and — new — a scope chip when a filter is active, plus the relocated confidence/freshness bar.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `T.value`, `T.chg`, `T.pct`, `T.chgFrom` (Task 1), `filterAMC`, `filterTax`, `F.length`, `ALL.length`.
- Produces: `renderScope()`, `renderSparkline()`, both called from `renderAll()`.

- [ ] **Step 1: Add the scope-chip and sparkline CSS**

Add near `.hero-sub`:

```css
.scope-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:3px 10px;margin-left:10px}
.chg-from{font-size:11px;color:var(--muted2);margin-left:8px;font-weight:500}
.spark{display:block;margin-top:10px}
```

- [ ] **Step 2: Restructure the hero markup**

Find:

```html
 <div class="hero"><div class="hero-grid">
  <div class="hero-main">
   <div class="eyebrow" data-i18n="eyebrow">Total Market Value</div>
   <div class="totval"><span class="cur">฿</span><span id="h-value" class="mono"></span></div>
   <div class="hero-sub"><div class="it"><span data-i18n="costBasis">Cost Basis</span><b class="mono" id="h-cost"></b></div>
    <div class="it"><span data-i18n="unrealPL">Unrealized P/L</span><b class="mono pos" id="h-unreal"></b></div>
    <div class="it"><span data-i18n="fundsLbl">Funds</span><b id="h-count"></b></div></div>
   <div class="tl-headline"><span class="big mono" id="tl-baht"></span><span class="pct mono" id="tl-pct"></span></div>
   <div class="tl-label" id="tl-label"></div>
  </div>
  <div class="hero-side">
   <div class="mini"><div class="lab" data-i18n="heroUnrealLab">Unrealized P/L (on current holdings)</div><div class="val mono pos" id="m-unreal"></div>
    <div class="meta"><span data-i18n="vsCost">vs cost</span> <span class="chip2" id="m-unreal-pct" style="background:rgba(31,210,134,.14);color:var(--pos)"></span></div></div>
   <div class="mini"><div class="lab" data-i18n="heroRealLab">Realized P/L (cumulative)</div><div class="val mono" id="m-real"></div><div class="meta" data-i18n="heroRealMeta">from past redemptions</div></div>
  </div>
 </div></div>
```

Replace with:

```html
 <div class="hero" id="pfHeader"><div class="hero-grid">
  <div class="hero-main">
   <div style="display:flex;align-items:baseline;flex-wrap:wrap"><div class="eyebrow" id="eyebrowLbl" data-i18n="eyebrow">Total Market Value</div><span class="scope-chip" id="scopeChip" hidden></span></div>
   <div class="totval"><span class="cur">฿</span><span id="h-value" class="mono"></span></div>
   <div class="hero-sub"><div class="it"><span data-i18n="costBasis">Cost Basis</span><b class="mono" id="h-cost"></b></div>
    <div class="it"><span data-i18n="unrealPL">Unrealized P/L</span><b class="mono pos" id="h-unreal"></b></div>
    <div class="it"><span data-i18n="fundsLbl">Funds</span><b id="h-count"></b></div></div>
   <div class="tl-headline"><span class="big mono" id="tl-baht"></span><span class="pct mono" id="tl-pct"></span><span class="chg-from" id="tl-from"></span></div>
   <div class="tl-label" id="tl-label"></div>
   <svg class="spark" id="spark" width="100%" height="36" viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true"></svg>
  </div>
  <div class="hero-side">
   <div class="mini"><div class="lab" data-i18n="heroUnrealLab">Unrealized P/L (on current holdings)</div><div class="val mono pos" id="m-unreal"></div>
    <div class="meta"><span data-i18n="vsCost">vs cost</span> <span class="chip2" id="m-unreal-pct" style="background:rgba(31,210,134,.14);color:var(--pos)"></span></div></div>
   <div class="mini"><div class="lab" data-i18n="heroRealLab">Realized P/L (cumulative)</div><div class="val mono" id="m-real"></div><div class="meta" data-i18n="heroRealMeta">from past redemptions</div></div>
  </div>
 </div>
 <div class="confidence" id="confidenceBar" aria-live="polite">
  <div class="conf-item"><span class="conf-dot" id="coverageDot"></span><span data-i18n="confCoverage">Valuation coverage</span><b id="confCoverage">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="rangeDot"></span><span data-i18n="confRange">NAV date range</span><b id="confRange">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="staleDot"></span><span data-i18n="confStale">Stale funds</span><b id="confStale">—</b></div>
 </div>
 </div>
```

The confidence bar moves here (into `#pfHeader`) from where Task 2 Step 7 left it as a standalone block directly under the command bar. Delete that standalone copy — find it right after the command bar's closing `</header>` tag:

```html
 <div class="confidence" id="confidenceBar" aria-live="polite">
  <div class="conf-item"><span class="conf-dot" id="coverageDot"></span><span data-i18n="confCoverage">Valuation coverage</span><b id="confCoverage">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="rangeDot"></span><span data-i18n="confRange">NAV date range</span><b id="confRange">—</b></div>
  <div class="conf-item"><span class="conf-dot" id="staleDot"></span><span data-i18n="confStale">Stale funds</span><b id="confStale">—</b></div>
 </div>
```

and delete it (this exact markup now exists twice in the file after the paste above — remove the one that sits between the command bar and the empty-state block, keeping only the copy now inside `#pfHeader`).

- [ ] **Step 3: Render the scope chip and the eyebrow swap**

Add, near `renderTL`:

```js
function renderScope(){
 const chip=document.getElementById('scopeChip'),lbl=document.getElementById('eyebrowLbl');
 const active=filterAMC.size>0||filterTax.size>0;
 if(!active){chip.hidden=true;lbl.textContent=t('eyebrow');return;}
 chip.hidden=false;lbl.textContent=t('eyebrowFiltered');
 const parts=[...filterAMC,...filterTax];
 chip.textContent=parts.join(' · ')+` — ${F.length}/${ALL.length}`;
}
```

Add `renderScope` to `renderAll()`'s list, next to `renderTL`:

```js
 safe(buildFilters);safe(renderTfControl);safe(renderHeader);safe(renderConfidence);safe(renderEmpty);safe(renderTL);safe(renderScope);safe(renderMovers);safe(renderPL);safe(renderTable);safe(renderMSList);
```

Add the `eyebrowFiltered` i18n key. In `I18N.en`, beside `eyebrow`:

```js
 eyebrowFiltered:'Filtered value',
```

In `I18N.th`:

```js
 eyebrowFiltered:'มูลค่าตามตัวกรอง',
```

- [ ] **Step 4: Render the resolved comparison date**

Add, at the end of `renderTL` (after the line that sets `tl-label`'s text, inside the non-`noPeriod` branch — the function already returns early in the `noPeriod` branch, so this only needs to run in the normal path):

```js
 document.getElementById('tl-from').textContent=T.chgFrom?t('vsDate').replace('{d}',fmtD(T.chgFrom)):'';
```

Also clear it in the `noPeriod` early-return branch, right before that branch's `return;`:

```js
  document.getElementById('tl-from').textContent='';
```

Add the `vsDate` i18n key. In `I18N.en`:

```js
 vsDate:'vs {d}',
```

In `I18N.th`:

```js
 vsDate:'เทียบ {d}',
```

- [ ] **Step 5: Render the sparkline**

Add, near `renderTL`:

```js
function renderSparkline(){
 const svg=document.getElementById('spark');
 const ps=portfolioSeries();const dates=ps.map(r=>r.date);const w=tfWindow(dates);const wset=new Set(w);
 const pts=ps.filter(r=>wset.has(r.date)).map(r=>r.value);
 if(pts.length<2){svg.innerHTML='';return;}
 const min=Math.min(...pts),max=Math.max(...pts),span=(max-min)||1;
 const W=300,H=36;
 const xy=pts.map((v,i)=>[i/(pts.length-1)*W,H-((v-min)/span)*H]);
 const d='M'+xy.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' L');
 const up=pts[pts.length-1]>=pts[0];
 svg.innerHTML=`<path d="${d}" fill="none" stroke="${up?'var(--pos)':'var(--neg)'}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}
```

Add `renderSparkline` to `renderAll()`, next to `renderTL`.

- [ ] **Step 6: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines, exit 0.

- [ ] **Step 7: Verify in the browser**

1. With no filter active: eyebrow reads "Total Market Value" / "มูลค่ารวม", no scope chip.
2. Turn on an AMC filter: eyebrow switches to "Filtered value" / "มูลค่าตามตัวกรอง", a chip appears reading e.g. `KKP — 19/62`, and the total/Δ/sparkline all reflect the filtered set. Clear the filter: both revert.
3. The Δ shows a small `vs 29 ส.ค.`-style label next to the percentage. Change the timeframe: it updates to the new resolved date, which may differ from a naive "N days ago" if a holiday or stale weekend intervened.
4. A sparkline renders under the Δ, colored green for a positive move and red for a negative one over the current window. Switch timeframe to `1D`: it redraws with fewer points.
5. With no anchor set (clear `localStorage.kkp_holdings` and re-import without stamping `asof`), the sparkline is empty (no stray path) and the comparison-date label is blank, consistent with `noPeriod()`.
6. Confidence bar (coverage / NAV date range / stale funds) now renders inside the portfolio header, directly under the hero grid, and still functions — click "Valuation coverage" and the missing-funds toast still appears.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add the scope chip, resolved comparison date, and sparkline to the portfolio header"
```

---

## Task 4: Tab shell

Wraps the six existing `<section>` blocks into the five tab panels the spec defines (splitting the Tax Unlock / Look-Through pair across two different tabs), with full tablist/tabpanel ARIA, keyboard navigation, and `kkp_tab` persistence. Desktop geometry becomes the `100dvh` grid; mobile becomes a single sticky wrapper holding a compact status row and the tab strip.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: nothing new from earlier tasks besides the shell markup they produced.
- Produces: `activateTab(id)`, `kkp_tab` in `localStorage`.

- [ ] **Step 1: Identify the six sections and their tab destinations**

Confirm with `grep -n "<!-- .* -->" index.html` (or by reading `index.html` from the closing `</div>` of `#pfHeader` to the closing `</div>` of `.wrap`) that the six top-level `<section>` blocks appear in this order, and note the mapping:

| # | Current content | Destination tab |
|---|---|---|
| 1 | Historical Comparison (`<!-- HISTORY MULTI-SELECT -->`) | ผลตอบแทน |
| 2 | Allocation, 3 donuts (`<!-- ALLOCATION -->`) | สัดส่วน |
| 3 | Movers + Realized/Unrealized (`<!-- MOVERS + PL -->`) | ผลตอบแทน |
| 4 | Risk & Performance (`<!-- RISK & PERFORMANCE -->`) | ความเสี่ยง |
| 5 | Tax Unlock + Look-Through, `grid2` (`<!-- TAX UNLOCK + LOOK-THROUGH -->`) | **split**: the Tax Unlock card → ภาษี, the Look-Through card → สัดส่วน |
| 6 | Holdings table (`<!-- TABLE -->`) | ถือครอง |

Section 5's `<div class="grid2">` currently holds two `<div class="card">` children side by side. This task separates them into two different tab panels, so the `grid2` wrapper is deleted and each card becomes the sole content of its destination panel (or shares it with other cards — สัดส่วน ends up with three donut cards plus the Look-Through card).

- [ ] **Step 2: Add the tab bar CSS**

```css
.shell{display:flex;flex-direction:column;min-height:100vh}
.tabbar-wrap{background:var(--bg);border-bottom:1px solid var(--line)}
.tablist{display:flex;gap:4px;overflow-x:auto;max-width:1340px;margin:0 auto;padding:0 22px}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);font:inherit;font-weight:600;font-size:13.5px;padding:12px 14px;cursor:pointer;white-space:nowrap}
.tab[aria-selected=true]{color:var(--txt);border-bottom-color:var(--accent)}
.tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.status-row{display:none;align-items:center;gap:10px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);max-width:1340px;margin:0 auto;padding:8px 22px}
.tabbody{max-width:1340px;margin:0 auto;padding:0 22px 56px}
.tabpanel{padding-top:4px}
@media(min-width:1024px){
 .shell{height:100dvh;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);min-height:0}
 .tabbody{overflow-y:auto;min-height:0}
}
@media(max-width:1023px){
 .tabbar-wrap{position:sticky;top:0;z-index:40}
 .status-row{display:flex}
}
```

`.tabbody` carries the same `max-width`/`margin`/`padding` values `.wrap` uses at its base (undisturbed until Task 6 Step 1 only removes `.wrap`'s *sidebar override*, not its base rule) — this keeps tab content at the page's existing content width without depending on the `.wrap` class itself, which would also inherit that sidebar override's `display:grid` until Task 6 deletes it.

- [ ] **Step 3: Wrap the body in the shell and add the tab bar**

Find the opening of the scrollable content, right after the portfolio header's closing tags added in Task 3 (i.e. immediately before the `<!-- HISTORY MULTI-SELECT -->` comment) and wrap everything from `<header class="cmdbar"...>` through the closing `</div>` of `.wrap` in a `<div class="shell">`. Concretely:

Find:

```html
<header class="cmdbar" id="cmdbar">
```

Replace with:

```html
<div class="shell">
<header class="cmdbar" id="cmdbar">
```

Find the empty-state block (it sits between the portfolio header and the first section):

```html
 <div class="empty-state" id="emptyState" hidden>
  <h2 data-i18n="emptyTitle">Build your portfolio view</h2>
  <p data-i18n="emptyBody">Sign in to load your cloud portfolio, or import a holdings file to start tracking value, performance and risk.</p>
  <div class="empty-actions"><button class="btn" id="emptySignIn" type="button" data-i18n="emptySignIn">Sign in</button><button class="btn ghost" id="emptyImport" type="button" data-i18n="emptyImport">Import portfolio</button></div>
 </div>
```

`.shell` is a 4-row grid (command bar / portfolio header / tab bar / tab body), so its **direct children** must be exactly those four elements — `.wrap` cannot stay open around all of them, or the tab bar and tab body end up nested one level too deep and never become their own grid rows. Close `.wrap` right after the empty-state block (which is the last thing `.wrap` should still contain besides the portfolio header), then add the tab bar and the tab body as `.wrap`'s siblings, each reusing `.wrap`'s own centering by carrying its class.

Immediately after the empty-state block, insert:

```html
 </div>
 <div class="tabbar-wrap" id="tabbarWrap">
  <div class="status-row" id="statusRow">
   <button type="button" class="btn ghost" id="statusTf" style="padding:4px 10px;font-size:12px"></button>
   <span id="statusFresh"></span>
   <span id="statusScope"></span>
  </div>
  <div class="tablist" role="tablist" id="tablist" aria-label="Portfolio sections">
   <button class="tab" role="tab" id="tab-holdings" aria-controls="panel-holdings" aria-selected="true" tabindex="0" data-i18n="tabHoldings">ถือครอง</button>
   <button class="tab" role="tab" id="tab-returns" aria-controls="panel-returns" aria-selected="false" tabindex="-1" data-i18n="tabReturns">ผลตอบแทน</button>
   <button class="tab" role="tab" id="tab-allocation" aria-controls="panel-allocation" aria-selected="false" tabindex="-1" data-i18n="tabAllocation">สัดส่วน</button>
   <button class="tab" role="tab" id="tab-risk" aria-controls="panel-risk" aria-selected="false" tabindex="-1" data-i18n="tabRisk">ความเสี่ยง</button>
   <button class="tab" role="tab" id="tab-tax" aria-controls="panel-tax" aria-selected="false" tabindex="-1" data-i18n="tabTax">ภาษี</button>
  </div>
 </div>
 <main class="tabbody" id="tabbody">
```

The first line above (` </div>`) is `.wrap`'s closing tag, moved here from the end of the file. At the end of the file, two closing `</div>` tags currently follow the `.foot` block's disclaimer line — the first closes `.foot`, the second closes `.wrap`. That second one is no longer `.wrap`'s closer (this edit moved `.wrap`'s close up to here instead) — leave it in place at the end of the file exactly as it is; it is repurposed in this step's final edit to close `.shell`, so nothing there needs to be added or deleted, only reinterpreted. `.tablist`/`.status-row`/`.tabbody` get their own width-constraint rule in Step 2's CSS (matching `.wrap`'s `max-width:1340px;margin:0 auto` values directly) rather than borrowing the `.wrap` class itself — reusing that class here would also pull in the old sidebar override still present until Task 6 deletes it, which sets `display:grid` and would fight the `display:flex` these elements need in the meantime. `.tabbar-wrap` itself (the sticky background) stays full-bleed; only its two children are width-constrained.

Add the i18n keys. In `I18N.en`:

```js
 tabHoldings:'Holdings',tabReturns:'Returns',tabAllocation:'Allocation',tabRisk:'Risk',tabTax:'Tax',
```

In `I18N.th`:

```js
 tabHoldings:'ถือครอง',tabReturns:'ผลตอบแทน',tabAllocation:'สัดส่วน',tabRisk:'ความเสี่ยง',tabTax:'ภาษี',
```

- [ ] **Step 4: Turn the six sections into five panels**

Find section 1 (Historical Comparison):

```html
 <!-- HISTORY MULTI-SELECT -->
 <section>
```

Replace with:

```html
 <div role="tabpanel" class="tabpanel" id="panel-returns" aria-labelledby="tab-returns">
 <!-- HISTORY MULTI-SELECT -->
 <section>
```

Find section 2's opening (Allocation):

```html
 <!-- ALLOCATION (3 donuts) -->
 <section>
```

Since section 1 (now the start of `panel-returns`) must close before section 2 starts a *different* panel, insert the closing `</div>` for `panel-returns` right before this, then open `panel-allocation`:

```html
 </div>
 <div role="tabpanel" class="tabpanel" id="panel-allocation" aria-labelledby="tab-allocation" hidden>
 <!-- ALLOCATION (3 donuts) -->
 <section>
```

Find section 3's opening (Movers + PL) — this belongs back in `panel-returns`, so close `panel-allocation` and *reopen* `panel-returns` (a tabpanel's content does not need to be one contiguous DOM block from the source's perspective, but for clarity keep each panel's `<div>` contiguous by moving section 3 to sit directly after section 1 in the source, and moving section 2 after it). Rather than physically reordering the file (error-prone with a plain-text edit), keep panels non-contiguous but valid: two separate `<div role="tabpanel" id="panel-returns">` elements are invalid HTML (duplicate ID) — so section 3 must physically move next to section 1.

Cut section 3 (Movers + PL) — from its `<!-- MOVERS + PL -->` comment through its section's closing `</section>` — and paste it immediately before the `</div>` that now closes `panel-returns` (i.e., directly after section 1's `</section>`, before the line `</div>` you added two steps above for `panel-allocation`'s opening). After this move, section 1 and section 3 are adjacent and both inside one `panel-returns` div; section 2 (Allocation) follows in its own `panel-allocation` div, opened as shown above.

Find section 4's opening (Risk & Performance), which now directly follows section 2:

```html
 <!-- RISK & PERFORMANCE -->
 <section>
```

Close `panel-allocation` and open `panel-risk`:

```html
 </div>
 <div role="tabpanel" class="tabpanel" id="panel-risk" aria-labelledby="tab-risk" hidden>
 <!-- RISK & PERFORMANCE -->
 <section>
```

Find section 5 (Tax Unlock + Look-Through):

```html
 <!-- TAX UNLOCK + LOOK-THROUGH -->
 <section><div class="grid2">
  <div class="card"><h3 data-i18n="secUnlock">Tax-Fund Unlock Schedule</h3><div class="csub" data-i18n="unlockHint">SSF 10y · ThaiESG/X 5y · RMF age 55 &amp; 5y from first buy</div>
   <div class="ms-modes" id="unlockModes" style="margin-bottom:10px"><button type="button" data-um="lot" class="on" data-i18n="byLot">By lot</button><button type="button" data-um="fund" data-i18n="byFund">By fund</button><button type="button" data-um="year" data-i18n="byYear">By year</button></div>
   <div class="risk-wrap"><table class="risk-tbl" style="min-width:520px"><thead id="unlockHead"></thead><tbody id="unlockBody"></tbody></table></div>
   <div style="margin-top:10px"><button class="btn ghost" id="birthBtn" type="button" data-i18n="setBirth">🎂 Set birth date (for RMF)</button></div></div>
  <div class="card"><h3 data-i18n="secConc">Look-Through Holdings</h3><div class="csub" data-i18n="concHint">What your funds actually hold, combined</div>
   <div class="risk-wrap"><table class="risk-tbl" style="min-width:420px"><thead><tr><th data-i18n="chName">Security</th><th data-i18n="chExp">Exposure</th><th data-i18n="chPct">% of port</th><th data-i18n="chVia">Funds</th></tr></thead><tbody id="concBody"></tbody></table></div>
   <div class="pl-foot" data-i18n="concNote">Estimated from each fund's top-5 holdings — actual exposure can be higher.</div></div>
 </div></section>
```

This section is split. Replace it with:

```html
 </div>
 <div role="tabpanel" class="tabpanel" id="panel-tax" aria-labelledby="tab-tax" hidden>
 <!-- TAX UNLOCK -->
 <section>
  <div class="card"><h3 data-i18n="secUnlock">Tax-Fund Unlock Schedule</h3><div class="csub" data-i18n="unlockHint">SSF 10y · ThaiESG/X 5y · RMF age 55 &amp; 5y from first buy</div>
   <div class="ms-modes" id="unlockModes" style="margin-bottom:10px"><button type="button" data-um="lot" class="on" data-i18n="byLot">By lot</button><button type="button" data-um="fund" data-i18n="byFund">By fund</button><button type="button" data-um="year" data-i18n="byYear">By year</button></div>
   <div class="risk-wrap"><table class="risk-tbl" style="min-width:520px"><thead id="unlockHead"></thead><tbody id="unlockBody"></tbody></table></div>
   <div style="margin-top:10px"><button class="btn ghost" id="birthBtn" type="button" data-i18n="setBirth">🎂 Set birth date (for RMF)</button></div></div>
 </section>
 </div>
 <div role="tabpanel" class="tabpanel" id="panel-holdings" aria-labelledby="tab-holdings">
```

The Look-Through card moves into `panel-allocation` instead of staying here. Go back to where you opened `panel-allocation` two steps above (right after the `<!-- ALLOCATION (3 donuts) -->` comment's `<section>` line) and, at that section's closing `</section>` tag (find the Allocation section's end — it closes with `</div></section>` right after the third donut card), insert the Look-Through card before that `</section>` closes:

```html
  <div class="card"><h3 data-i18n="secConc">Look-Through Holdings</h3><div class="csub" data-i18n="concHint">What your funds actually hold, combined</div>
   <div class="risk-wrap"><table class="risk-tbl" style="min-width:420px"><thead><tr><th data-i18n="chName">Security</th><th data-i18n="chExp">Exposure</th><th data-i18n="chPct">% of port</th><th data-i18n="chVia">Funds</th></tr></thead><tbody id="concBody"></tbody></table></div>
   <div class="pl-foot" data-i18n="concNote">Estimated from each fund's top-5 holdings — actual exposure can be higher.</div></div>
```

placed as a fourth card alongside the three donut cards (outside their `.grid3` wrapper, as a sibling `<div class="card">` after `</div>` closes `.grid3`, so it spans full width under the three donuts rather than squeezing into the grid).

Finally, find section 6 (Holdings table)'s opening:

```html
 <!-- TABLE -->
 <section>
```

The `panel-holdings` div was already opened in the edit above (right after `panel-tax` closed); delete this now-redundant standalone comment-plus-`<section>` opening tag pair and keep just:

```html
 <!-- TABLE -->
 <section>
```

as the direct child (no change needed here — `panel-holdings`'s div now wraps it from the outside; this section's own markup is unchanged). Right after this section's closing `</section>`, close the final panel and `main`:

```html
 </section>
 </div>
 </main>
```

`.wrap` already closed earlier in this task (Step 3, right after the empty-state block), so nothing here reopens or re-closes it. What follows `</main>` in the file is the `.foot` block from Task 2 Step 6 — it is `main`'s sibling, a direct child of `.shell` alongside `header.cmdbar`, `.wrap`, `.tabbar-wrap`, and `main`.

At the very end of the file, the two closing `</div>` tags that already follow `.foot`'s disclaimer line need no edit at all: the first still closes `.foot`, and the second — which used to close `.wrap` before this task moved that closing tag up to Step 3 — now closes `.shell` instead, simply by virtue of `.wrap` no longer being open at that point in the document. Confirm this by counting: after Step 3's edit, `.wrap` opens once (its original opening tag) and closes once (the new location after empty-state); `.shell` opens once (Step 3's first edit) and must close exactly once, which this trailing tag now does without any text needing to change.

This step is the most error-prone in the plan because it is a sequence of cuts and pastes across a large file rather than isolated replacements. After completing it, verify structure with a balanced-tag sanity check before moving on:

Run: `node -e "const h=require('fs').readFileSync('index.html','utf8'); const open=(h.match(/<section>/g)||[]).length; const close=(h.match(/<\/section>/g)||[]).length; const panelOpen=(h.match(/role=\"tabpanel\"/g)||[]).length; console.log('section open/close:',open,close,'| tabpanel divs:',panelOpen)"`
Expected: `section open/close: 6 6 | tabpanel divs: 5` (five panels, six `<section>` elements since `panel-returns` holds two and `panel-allocation`/`panel-tax`/`panel-risk`/`panel-holdings` hold one each — recount against the mapping table in Step 1 if this doesn't match, since a miscount here means a tag was dropped or duplicated).

Then confirm `.shell`'s direct children in the actual DOM, which a text-level tag count cannot catch (a `</div>` can be balanced overall while still closing the wrong element, nesting things one level too deep). Load the page in the browser and run in the console:

```js
[...document.querySelector('.shell').children].map(el=>el.tagName+(el.id?'#'+el.id:'')+(el.className?'.'+el.className.split(' ')[0]:''))
```

Expected: exactly five entries, in this order — `HEADER#cmdbar`, `DIV.wrap`, `DIV.tabbar-wrap#tabbarWrap`, `MAIN.tabbody#tabbody`, `DIV.foot`. If `.wrap` shows up containing `tabbar-wrap` or `tabbody` as descendants instead of them appearing as separate top-level entries in this list, the `100dvh` grid in Step 2 will size only two rows (header and `.wrap`) instead of four, and the portfolio header and tab bar will scroll together with the tab body on desktop instead of staying fixed — go back and re-check where `.wrap`'s closing tag landed.

- [ ] **Step 5: Write the tab controller**

Add, near the popover controller from Task 2:

```js
const TAB_IDS=['holdings','returns','allocation','risk','tax'];
function activateTab(id,focus){
 TAB_IDS.forEach(x=>{
  const tab=document.getElementById('tab-'+x),panel=document.getElementById('panel-'+x);
  const on=x===id;
  tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
  panel.hidden=!on;
 });
 localStorage.setItem('kkp_tab',id);
 const statusTf=document.getElementById('statusTf');if(statusTf)statusTf.textContent=histTF==='CUSTOM'?t('r_CUSTOM'):histTF;
 if(focus)document.getElementById('tab-'+id).focus();
}
document.querySelectorAll('#tablist .tab').forEach((tab,i)=>{
 tab.onclick=()=>activateTab(TAB_IDS[i]);
});
document.getElementById('tablist').addEventListener('keydown',e=>{
 const i=TAB_IDS.indexOf(document.activeElement.id.replace('tab-',''));
 if(i<0)return;
 let next=null;
 if(e.key==='ArrowRight')next=TAB_IDS[(i+1)%TAB_IDS.length];
 else if(e.key==='ArrowLeft')next=TAB_IDS[(i-1+TAB_IDS.length)%TAB_IDS.length];
 else if(e.key==='Home')next=TAB_IDS[0];
 else if(e.key==='End')next=TAB_IDS[TAB_IDS.length-1];
 else if(e.key==='Enter'||e.key===' '){e.preventDefault();activateTab(TAB_IDS[i]);return;}
 if(next){e.preventDefault();document.getElementById('tab-'+next).tabIndex=0;document.getElementById('tab-'+next).focus();
  document.getElementById('tab-'+TAB_IDS[i]).tabIndex=-1;}
});
const _storedTab=localStorage.getItem('kkp_tab');
activateTab(TAB_IDS.includes(_storedTab)?_storedTab:'holdings');
```

Arrow keys move focus without activating (matching §1's "activation is manual"); `Enter`/`Space` activate the focused tab. `activateTab` itself is what a click or explicit activation calls, and it's also what sets the initial state from `kkp_tab` on load.

Add the status row's remaining two fields — freshness and scope — by extending `renderConfidence` and `renderScope` (from Task 3) to also write into the mobile-only status row. In `renderConfidence`, add at its end:

```js
 const sf=document.getElementById('statusFresh');if(sf)sf.textContent=T.stale?`${T.stale} stale`:'';
```

In `renderScope`, add at its end:

```js
 const ss=document.getElementById('statusScope');if(ss)ss.textContent=active?chip.textContent:'';
```

`#statusTf` also needs refreshing whenever the timeframe changes, not only on tab activation — add a call to update it inside `renderTfControl` (Task 2 Step 5), at its end:

```js
 const statusTf=document.getElementById('statusTf');if(statusTf)statusTf.textContent=histTF==='CUSTOM'?t('r_CUSTOM'):histTF;
```

`#statusTf` has no click handler yet — there is nothing for it to open until Task 5 builds the period popover it will trigger. Leave it inert (it already shows the correct label; it just isn't yet clickable) rather than wiring it to a control that doesn't exist. Task 5 Step 5 adds its `onclick`.

- [ ] **Step 6: Fix `renderEmpty`'s selector list for the new shell**

Find:

```css
body.is-empty .hero,body.is-empty section,body.is-empty .foot,body.is-empty .confidence{display:none}
```

Replace with:

```css
body.is-empty .hero,body.is-empty .tabbar-wrap,body.is-empty .tabbody,body.is-empty .foot{display:none}
```

(`.confidence` now lives inside `.hero`, so hiding `.hero` already hides it — the separate `.confidence` selector is redundant but harmless to drop since it's covered.)

- [ ] **Step 7: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines, exit 0.

- [ ] **Step 8: Verify in the browser**

1. Reload with a loaded portfolio: the page opens on the **ถือครอง** (Holdings) tab, table visible immediately, no scrolling needed to see it.
2. Click **ผลตอบแทน**: the historical chart, fund multi-select, gainers/losers, and realized/unrealized cards all appear together.
3. Click **สัดส่วน**: the three donuts plus the Look-Through card appear.
4. Click **ความเสี่ยง**: the risk KPIs and per-fund table appear.
5. Click **ภาษี**: the tax-unlock schedule appears, alone.
6. Reload the page: it reopens on the last tab you had selected (not always Holdings).
7. Keyboard: focus the tablist, press the right arrow four times — focus visits each tab in order and wraps from ภาษี back to ถือครอง on a fifth press, without changing which panel is shown until you press Enter or Space. Press Home/End: focus jumps to the first/last tab.
8. Resize below 1024px: the tab bar (with the status row above it) becomes the only sticky element — scroll down and confirm the command bar and portfolio header scroll away while the tab bar stays pinned at the top.
9. Console is clean; no duplicate-ID warnings, no orphaned `</section>` mismatches.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Wrap the six sections into five tab panels with full keyboard support"
```

---

## Task 5: Responsive command bar collapse

Implements the width-based collapse table from §1: the AMC/Tax popovers become a single trigger at 1024–1239px, and move into the overflow panel below 1024px; the timeframe segmented control becomes a trigger-driven popover below 1240px and stays on the command bar (never in overflow) at every width; TH/EN also moves into overflow below 1024px, alongside the filters.

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `openPopover`/`closePopover` (Task 2), `renderTfControl` (Task 2).
- Produces: a period popover (`#periodPopover`) used at narrow desktop and on mobile via `#statusTf`.

- [ ] **Step 1: Add the period-popover markup and its trigger**

Find the `<div class="tf-segmented" id="cmdTf"></div>` line from Task 2 Step 2. Leave it in place for wide desktop, and add its narrow-width sibling immediately after it:

```html
 <div class="cmdbar-group narrow-tf" id="narrowTfGroup" style="display:none">
  <button type="button" class="btn ghost popover-trigger" id="periodTrigger" aria-haspopup="dialog" aria-expanded="false" aria-controls="periodPopover"><span id="periodTriggerLabel"></span></button>
  <div class="popover" id="periodPopover" role="dialog" aria-label="Timeframe" data-i18n-aria-label="lblPeriod"></div>
 </div>
```

Add the `lblPeriod` i18n key. `I18N.en`: `lblPeriod:'Timeframe',`. `I18N.th`: `lblPeriod:'ช่วงเวลา',`.

- [ ] **Step 2: Add the collapse CSS**

```css
@media(max-width:1239px){
 .tf-segmented{display:none}
 .narrow-tf{display:flex!important}
}
@media(min-width:1240px){
 .narrow-tf{display:none!important}
}
@media(max-width:1023px){
 #amcTrigger,#taxTrigger,#ovLang{display:none}
}
```

`#amcTrigger`/`#taxTrigger` hide via CSS below 1024px; their controls become reachable only through the overflow panel at that width (Step 4 adds them there). `#ovLang` already lives in the overflow panel from Task 2 — hiding it below 1024px would be wrong since it needs to be reachable; remove that selector from the rule above (it was listed in error — the correct behaviour is TH/EN **stays** in the overflow panel at every width, since Task 2 already put it there, not on the command bar directly, so nothing about it changes at this breakpoint). Use:

```css
@media(max-width:1023px){
 #amcTrigger,#taxTrigger{display:none}
}
```

- [ ] **Step 3: Render the period popover and keep both timeframe controls in sync**

Add, replacing `renderTfControl` from Task 2 Step 5:

```js
function renderTfControl(){
 const tf=document.getElementById('cmdTf');
 const opts=['1D','1W','1M','3M','6M','1Y','YTD','MAX'];
 tf.innerHTML=opts.map(o=>`<button type="button" data-tf="${o}" class="${histTF===o?'on':''}">${o}</button>`).join('');
 tf.querySelectorAll('button').forEach(b=>b.onclick=()=>setTimeframe(b.dataset.tf));

 const label=histTF==='CUSTOM'?t('r_CUSTOM'):histTF;
 document.getElementById('periodTriggerLabel').textContent=label;
 const statusTf=document.getElementById('statusTf');if(statusTf)statusTf.textContent=label;

 const pop=document.getElementById('periodPopover');
 pop.innerHTML=`<h4 data-i18n="lblPeriod"></h4>`+opts.map(o=>`<label class="popover-row"><input type="radio" name="periodPop" value="${o}" ${histTF===o?'checked':''}><span>${o}</span></label>`).join('');
 pop.querySelector('h4').textContent=t('lblPeriod');
 pop.querySelectorAll('input[type=radio]').forEach(r=>r.onchange=()=>{setTimeframe(r.value);closePopover(pop,true);});
}
function setTimeframe(tf){
 histTF=tf;histFrom='';histTo='';
 localStorage.setItem('kkp_histtf',histTF);localStorage.removeItem('kkp_histfrom');localStorage.removeItem('kkp_histto');
 renderAll();
}
```

`setTimeframe` centralises what was, until now, duplicated inline in three click handlers (`#tfBtns`, `#cmdTf`, and now the period popover). Find the two other places this logic is inlined and simplify them to call it:

In Task 1 Step 8's `#tfBtns` handler, find:

```js
 b.onclick=()=>{document.querySelectorAll('#tfBtns button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  histTF=b.dataset.tf;histFrom='';histTo='';
  localStorage.setItem('kkp_histtf',histTF);localStorage.removeItem('kkp_histfrom');localStorage.removeItem('kkp_histto');
  renderAll();};});
```

Replace with:

```js
 b.onclick=()=>setTimeframe(b.dataset.tf);});
```

(the `.on` class toggling for `#tfBtns` is redundant with this change since nothing re-renders `#tfBtns` itself elsewhere — but since `#tfBtns` still exists in the Historical Comparison card per Task 2 Step 5's note that only the *command bar's* copy was added, not a replacement of the original, confirm whether `#tfBtns` still exists in the DOM at this point. It does **not** — Task 2 Step 5 explicitly deleted the `<div class="ms-modes" id="tfBtns">...` line from the chart card. This handler registration (`document.querySelectorAll('#tfBtns button').forEach(...)`) now targets zero elements and is dead code. Delete the entire `document.querySelectorAll('#tfBtns button').forEach(...)` block — both the loop that sets initial `.on` state and the one that attaches `onclick` — since `renderTfControl` (called from `renderAll()`) is what builds and wires the command bar's segmented control on every render, replacing this one-time wiring entirely.

- [ ] **Step 4: Move AMC/Tax filters into the overflow panel below 1024px**

The popovers built in Task 2 already exist at fixed DOM locations (`#amcPopover`, `#taxPopover`) anchored to `#amcTrigger`/`#taxTrigger`, which Step 2 above hides below 1024px along with their popovers (a hidden trigger's popover has no way to open). Add copies of the same controls inside the overflow panel for that width range, rendered by the same `buildFilterPopover` helper from Task 2 Step 4.

Find the overflow panel's static markup (Task 2 Step 6):

```html
 <button type="button" class="btn ghost" id="ovLang" style="justify-content:space-between"><span data-i18n="langBtnLbl">Language</span><span id="ovLangVal">ไทย</span></button>
```

Insert two collapsible sections above it:

```html
 <div id="ovFilters" style="display:none">
  <h4 data-i18n="lblAMC" style="margin:4px 0 6px;font-size:12px;color:var(--muted2);text-transform:uppercase"></h4>
  <div id="ovAmcList"></div>
  <h4 data-i18n="lblTax" style="margin:10px 0 6px;font-size:12px;color:var(--muted2);text-transform:uppercase"></h4>
  <div id="ovTaxList"></div>
  <hr style="border-color:var(--line);margin:6px 0">
 </div>
 <button type="button" class="btn ghost" id="ovLang" style="justify-content:space-between"><span data-i18n="langBtnLbl">Language</span><span id="ovLangVal">ไทย</span></button>
```

Add the CSS to show `#ovFilters` only when relevant:

```css
@media(max-width:1023px){#ovFilters{display:block!important}}
```

In `buildFilters` (Task 2 Step 4), render into both the command-bar popovers and the overflow copies:

```js
function buildFilters(){
 const amcs=[...new Set(ALL.map(f=>f.amc))];
 const taxes=[...new Set(ALL.map(f=>f.tax))];
 buildFilterPopover('amcPopover','amcTriggerLabel',amcs,filterAMC,AMC_COL,'lblAMC');
 buildFilterPopover('taxPopover','taxTriggerLabel',taxes,filterTax,TAX_COL,'lblTax');
 buildFilterList('ovAmcList',amcs,filterAMC);
 buildFilterList('ovTaxList',taxes,filterTax);
}
function buildFilterList(elId,items,activeSet){
 const el=document.getElementById(elId);
 el.innerHTML=items.map(x=>`<label class="popover-row"><input type="checkbox" data-v="${escAttr(x)}" ${activeSet.has(x)?'checked':''}><span>${escHTML(x)}</span></label>`).join('');
 el.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.onchange=()=>{const v=cb.dataset.v;activeSet.has(v)?activeSet.delete(v):activeSet.add(v);renderAll();});
}
```

The overflow panel is itself a non-modal popover from Task 2's shared controller, so toggling a checkbox inside it and triggering `renderAll()` is safe — `renderAll()` doesn't touch `.open` classes, so the panel stays open while the user checks several boxes, consistent with §1's "Filters apply on change; the popover stays open."

- [ ] **Step 5: Wire the status row's timeframe button to the period popover**

Task 4 Step 5 left `#statusTf` inert (no `onclick`), since the period popover it opens didn't exist yet. Add its handler now, in the same place the other popover triggers are wired (Task 2 Step 3's block):

```js
document.getElementById('statusTf').onclick=()=>{const p=document.getElementById('periodPopover');
 if(p.classList.contains('open'))closePopover(p,true);else openPopover(document.getElementById('statusTf'),p);};
```

- [ ] **Step 6: Refresh CSP and run the full check**

Run: `node scripts/update-csp.mjs && node scripts/check.mjs`
Expected: five `✓` lines, exit 0.

- [ ] **Step 7: Verify in the browser at three widths**

At **≥1240px**: the eight-button segmented timeframe control is visible on the command bar; the single period trigger/popover is hidden; `AMC`/`Tax` triggers are visible on the command bar.

At **1024–1239px** (resize the window): the segmented control disappears, replaced by a single trigger showing the active period (e.g. `MAX`); clicking it opens a popover with eight radio options; selecting one updates the whole page and closes the popover. `AMC`/`Tax` triggers remain on the command bar.

At **<1024px**: `AMC`/`Tax` triggers disappear from the command bar; opening the overflow panel (`⋯`) now shows AMC and Tax checkbox lists above the language button; toggling a checkbox there updates the page and the panel stays open. The sticky status row's period button shows the active period and opens the same period popover as the command bar's own trigger at 1024–1239px.

At every width: the timeframe control (segmented, trigger, or status-row button) is always reachable without opening the overflow panel — confirm this by resizing through all three ranges and checking a timeframe control is visible on the command bar or status row at each, never solely inside `⋯`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add the responsive collapse for filters and the timeframe control"
```

---

## Task 6: Cleanup and acceptance

Removes the dead sidebar/topOff/mobile-menu code the new shell supersedes, fixes the print stylesheet for the new element names, and runs the full §7.2 acceptance pass.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Delete the dead desktop-sidebar CSS**

Find the base (non-media-query) rail rule:

```css
header.top{position:fixed;inset:0 auto 0 0;width:214px;background:#0a0e0d;border:0;border-right:1px solid var(--line);backdrop-filter:none;overflow:hidden}
```

Delete it and its paired `.top-inner{height:100vh;...}` rule immediately below it (the one setting `max-width:none;margin:0;padding:24px 18px;display:flex;flex-direction:column...`).

Find the `.wrap` sidebar-margin rule:

```css
.wrap{max-width:none;margin:0 0 0 214px;padding:0 28px 56px;display:grid;grid-template-columns:minmax(0,1fr)}
.wrap>.sticky-controls{order:1}.wrap>.empty-state{order:3}.wrap>.hero{order:4}
.wrap>section:nth-of-type(1){order:5}.wrap>section:nth-of-type(6){order:6}.wrap>section:nth-of-type(4){order:7}
.wrap>section:nth-of-type(2){order:8}.wrap>section:nth-of-type(3){order:9}.wrap>section:nth-of-type(5){order:10}.wrap>.foot{order:11}
```

Delete all four lines — the section reordering they implemented is now what the tab panels do structurally.

Find the `.filterbar`/`.sticky-controls` rule block that followed (from `.filterbar{position:relative;top:auto;...}` through `.sticky-controls.stuck{...}`):

```css
.filterbar{position:relative;top:auto;margin:18px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius-md);background:rgba(17,22,20
```

(read the full block with `grep -n "^\.filterbar{position:relative" index.html` and delete through the matching `.sticky-controls.stuck{...}` line) — delete it entirely; `.filterbar`/`.sticky-controls` have no markup left to style after Task 2.

Find the `@media(max-width:900px)` block that reshapes `header.top` for the old top-bar mobile mode:

```css
@media(max-width:900px){
 header.top{position:sticky;inset:auto;top:0;width:auto;height:auto;border-right:0;border-bottom:1px solid var(--line);background:rgba(10,14,13,.96)}
 .top-inner{height:auto;overflow:visible;display:grid;grid-template-columns:minmax(0,1fr) auto;padding:10px 14px;gap:8px}
 .brand{align-items:center;padding-bottom:0;border-bottom:0}.brand .sub{max-width:none}
 .mobile-only{display:inline-flex}.menu-btn{width:40px;height:40px;padding:0;justify-content:center}
 .upd{display:none!important;grid-column:1/-1;width:100%;margin-top:0;padding-top:10px;border-top:1px solid var(--line);flex-direction:row;flex-wrap:wrap}
 .upd.open{display:flex!important}.upd .asof{width:100%;padding:0 0 8px;margin:0;text-align:left;border:0}.upd .btn{width:auto;flex:1 1 calc(50% - 4px);justify-content:center}
 .wrap{margin-left:0;padding:0 16px 44px}.filterbar{position:relative;top:auto;margin:12px 0 0;padding:11px 12px}
 .hero-grid{grid-template-columns:1fr}.hero-side{grid-template-columns:1fr 1fr;grid-template-rows:none}
 .grid2{grid-template-columns:1fr}.grid3{grid-template-columns:1fr}.grid3>.card:last-child{grid-column:auto}
}
```

Replace with just the layout rules that still apply (hero/grid reflow), dropping every `header.top`/`.top-inner`/`.mobile-only`/`.menu-btn`/`.upd`/`.filterbar` line since none of those elements exist anymore:

```css
@media(max-width:900px){
 .wrap{padding:0 16px 44px}
 .hero-grid{grid-template-columns:1fr}.hero-side{grid-template-columns:1fr 1fr;grid-template-rows:none}
 .grid2{grid-template-columns:1fr}.grid3{grid-template-columns:1fr}.grid3>.card:last-child{grid-column:auto}
}
```

- [ ] **Step 2: Delete the dead mobile-menu JS and markup**

Find, in the command bar markup — this button no longer exists after Task 2's rewrite, so confirm with `grep -n "mobileMenuBtn" index.html` that only the JS handler remains (the markup was already replaced in Task 2 Step 2). Find:

```js
document.getElementById('mobileMenuBtn').onclick=()=>{const a=document.getElementById('headerActions'),b=document.getElementById('mobileMenuBtn'),open=a.classList.toggle('open');b.setAttribute('aria-expanded',String(open));};
```

Delete this line — both `mobileMenuBtn` and `headerActions` no longer exist in the DOM.

- [ ] **Step 3: Delete the old sticky-controls `topOff` script**

Find:

```js
/* keep filter bar pinned right below the header */
(function(){const hdr=document.querySelector('header.top'),fb=document.querySelector('.sticky-controls');
 if(!hdr||!fb)return;
 // Top-bar layout: stick just below the header. Sidebar/tall layouts: stick to viewport top.
 const topOff=()=>{const r=hdr.getBoundingClientRect();return (r.width>window.innerWidth*0.6&&r.height<160)?Math.max(0,Math.round(r.height)-1):0;};
 const adj=()=>{fb.style.top=topOff()+'px';};
 adj();window.addEventListener('resize',adj);
 let tick=false;
 const onScroll=()=>{if(tick)return;tick=true;requestAnimationFrame(()=>{tick=false;adj();
  fb.classList.toggle('stuck',fb.getBoundingClientRect().top<=topOff()+1&&window.scrollY>4);});};
 window.addEventListener('scroll',onScroll,{passive:true});onScroll();})();
```

Delete this entire IIFE — `header.top` and `.sticky-controls` no longer exist; the new shell's stickiness is pure CSS (`.tabbar-wrap{position:sticky}` below 1024px, the `100dvh` grid above it), needing no JS offset calculation at all.

- [ ] **Step 4: Fix the print stylesheet**

Find:

```css
@media print{header.top,.filterbar,.ms-top,.ms-list,.tf-row,.foot,#pills,.btn,.range-pills{display:none!important}
```

Replace with:

```css
@media print{.cmdbar,.tabbar-wrap,.ms-top,.ms-list,.tf-row,.foot,.btn,.tf-segmented,.scope-chip{display:none!important}
 .tabpanel{display:block!important}.shell{display:block!important;height:auto!important}.tabbody{overflow:visible!important}
```

The added `.tabpanel{display:block!important}` and `.shell`/`.tabbody` overrides ensure every tab's content prints (not just the currently active one) rather than the browser respecting the `hidden` attribute Task 4 relies on for screen display — printing the whole portfolio, not just whichever tab happened to be open, matches the pre-existing print behaviour of showing every section.

- [ ] **Step 5: Full acceptance pass**

Run: `node scripts/check.mjs`
Expected: five `✓` lines, exit 0.

Browser, real portfolio loaded, `asof` stamped, at each of **320, 390, 768, 1024, 1400px** (use the browser's responsive-mode width entry, not window resizing, for the two smallest):

1. No horizontal overflow or clipped content at any width, in both TH and EN (Thai labels are the wrapping risk the spec calls out — check the command bar's brand text and the tab labels specifically).
2. Keyboard-only pass: Tab into the command bar, reach the AMC popover, Tab through its checkboxes, Tab out to the Tax trigger (never trapped). Reach the tablist, use arrows/Home/End, activate with Enter. Reach a holdings row's disclosure — **not built until Phase 2** — skip that specific check and note it as out of scope. Reach the overflow trigger, open it, Tab through its buttons, close with Escape, confirm focus returns to the trigger. Confirm the existing modal dialogs (Buy/Sell, Switch, Sign in) still trap focus as before.
3. 200% browser zoom at 1400px width: command bar and tab bar remain usable, nothing overlaps.
4. Language switch at every width: command bar, tab labels, popovers, and status row all read correctly in Thai, including Buddhist-year dates where the resolved comparison date crosses a year boundary (set the anchor to a date more than a year back and confirm `tl-from` shows a year).
5. Regression: with `histTF=MAX` and the portfolio's real `asof`, the hero total and the risk tab's TWR/volatility/XIRR match the values recorded in `docs/superpowers/plans/2026-09-03-phase0-performance-engine.md`'s "Phase 0 results" section (adjusted only for the additional days elapsed since that recording) — confirming this phase's data-model changes (scalar `chg`/`pct`, the `MAX` baseline moving from `ld` to `_as`) did not change what Phase 0 fixed.
6. Print preview (desktop, `Ctrl/Cmd+P`) shows every section, not just the active tab.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Remove the dead sidebar/topOff code and fix print for the tab shell"
```

---

## Not in this plan

Phase 2 (sortable sticky-header holdings table, sparkline-per-row, disclosure-button row expansion replacing the fund detail modal) and Phase 3 (Ink & Brass v2 visual language, categorical chart palettes, density pass) get their own plans once this one is reviewed. The holdings table this phase's tab shell wraps is functionally unchanged from before — same columns, same click-to-open-modal row behaviour — because that table is Phase 2's job.

This plan also does not touch `AMC_COL`/`TAX_COL`'s use for colouring individual filter chips inside the new popovers (each renders as a plain checkbox row); applying per-item colour there is cosmetic and belongs with Phase 3's palette work, not this phase's structural one.
