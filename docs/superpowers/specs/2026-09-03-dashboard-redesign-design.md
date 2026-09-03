# Dashboard redesign — design spec

**Date:** 2026-09-03 (revised after review)
**Target:** `index.html` (single file, currently 3,076 lines / 192 KB)
**Live:** https://fundtracking.yourpower.today/

## Governing principle

A compact portfolio workspace that keeps valuation, period, freshness, and data scope
continuously visible, and that clearly separates actual investor performance from
reconstructed or estimated history.

---

## Problem

Measured against the real portfolio (66 funds imported, 62 priced, ฿2,070,757.78) at a
1400 px viewport:

| Section | Height |
|---|---|
| Hero | 346 px |
| Historical Comparison | 746 px |
| Allocation | 529 px |
| Gainers / Losers / P&L | 389 px |
| Risk & Performance | 2,379 px |
| Tax Unlock + Look-Through | 2,841 px |
| Holdings table | 3,446 px |

Total ≈ 10,700 px — about 12 viewport heights.

Stated usage is 80% "quick check whether the portfolio is up or down" plus "browse the
holdings table". Those two tasks sit at opposite ends of the page: the hero is at the
top, the holdings table starts ~7,200 px down, with every other section permanently
expanded between them and no tabs, collapsing, or section navigation.

Further defects found while measuring:

1. **Two competing time controls.** The hero pills (`1D / 1W / 15D / 1M`,
   `RANGES` at `index.html:2113`) and the chart timeframe (`1W … MAX`, `tfWindow` at
   `index.html:2426`) are independent and produce different periods for numbers on the
   same screen.
2. **Risk figures are impossible.** TWR `+12,073.62%`, XIRR `+6,345.59%`, annualized
   volatility `595.5%`, best day `+608.41%`.
3. **Date labels drop the year.** `fmtD()` (`index.html:2514`) renders
   "8 Jul → 2 Sept" for a window spanning 8 July 2019 → 2 September 2026.
4. **The 214 px left rail carries only action buttons**, no section navigation, while
   the holdings table is horizontally cramped.
5. **Custom date ranges do not persist.** `tfApply` (`index.html:2897`) sets
   `histTF='CUSTOM'` and the two bounds but writes nothing to `localStorage`.
6. **Filters silently change the headline.** `applyFilter()` (`index.html:2248`) sums
   `T.value` over the filtered set `F`, and `portfolioSeries()` applies
   `seriesIncluded()`, so "Total Market Value" is a filtered subtotal that is never
   labelled as one.

### Why the performance numbers are wrong

`portfolioSeries()` (`index.html:2396`) has two independent defects.

**Defect A — units are projected backward from a snapshot.**

```js
const units = {};
codes.forEach(c => units[c] = +(HOLDINGS_BASE[c] && HOLDINGS_BASE[c].units) || 0);
```

`HOLDINGS_BASE` is the imported statement balance, stamped with `asof` at import time.
Post-`asof` ledger entries are applied forward and pre-`asof` ones are suppressed by
`txAbsorbed()` (`index.html:2084`), so the engine is correct **from `asof` onward**.
Before `asof` it holds the snapshot's units constant across the entire stored NAV
history — seven years, in the measured portfolio. `MAX` is therefore a backtest of the
snapshot's holdings, not the investor's historical portfolio, and it is presented as
though it were the latter.

The repo's own `holdings.json` carries **no `asof` on any of its 66 funds** and no
`lots`, so for hand-edited or legacy data there is currently no anchor at all.

**Defect B — capital entering price coverage is counted as return.**

```js
const r = (value - flow) / prev - 1;
```

`flow` counts only ledger transactions. `navAt()` (`index.html:2807`) returns `null`
before a fund's first stored NAV, so a fund contributes ฿0 until its history begins and
its entire market value then lands in one day with `flow = 0`. That produces single-day
returns like `+608.41%`, which compound `twr` into five figures and inflate volatility
and XIRR. `renderRisk()` (`index.html:2520`) derives its XIRR cash flows from the same
`flow` field and inherits the defect.

Note `navAt()` carries the last known price forward indefinitely, so coverage can be
entered but never left. Any "coverage exit" handling would be dead code.

---

## Decisions taken

| Question | Answer |
|---|---|
| Primary tasks (80%) | Quick up/down check + browsing the holdings table |
| Primary device | Desktop; mobile occasionally |
| Depth of redesign | Restructure IA **and** replace the visual language |
| Layout | Option A (tabbed workspace) + inline row expansion borrowed from option B |
| Visual direction | "Ink & brass v2" — evolve the existing dark brass palette |
| Sections actually used | Historical comparison + benchmark; allocation donuts |
| Broken performance math | Fix the engine properly, before anything depends on it |

Risk & Performance and Tax Unlock / Look-Through are **demoted to the last two tabs,
not removed.**

---

## 1 · Page structure

The 214 px left rail is removed; its actions move into the command bar.

| Layer | Height | Contents |
|---|---|---|
| Command bar | intrinsic, ~56 px | Brand · AMC filter · Tax filter · **global timeframe** · TH/EN · overflow panel · Update NAV |
| Portfolio header | intrinsic, min 96 px | Total market value · Δ for the selected period · sparkline · cost basis / unrealized / realized · scope and freshness chips |
| Tab bar | intrinsic, ~40 px | **ถือครอง** · ผลตอบแทน · สัดส่วน · ความเสี่ยง · ภาษี |
| Tab body | remaining viewport (desktop) | See geometry rules below |

`ถือครอง` (Holdings) is the default tab. Tab state persists under `kkp_tab`.

**Geometry — no JavaScript measurement.** On desktop (≥ 1024 px) the shell is

```css
height: 100dvh;
display: grid;
grid-template-rows: auto auto auto minmax(0, 1fr);
```

The three layers size to their content and the fourth row takes the remainder. None of
them is `position: sticky`, no offset is computed, and Thai labels that wrap simply
grow their row and shrink the panel. This removes both the `ResizeObserver` bookkeeping
proposed in the previous draft and the current `topOff()` heuristic
(`index.html:2963`), which tests `r.height < 160` and breaks exactly when those labels
wrap. The portfolio header keeps a `min-height` and no fixed height.

Below 1024 px the shell reverts to normal document flow and document scrolling, and
**exactly one element is sticky at `top: 0`: a wrapper holding the tab strip plus a
compact status row.** The full command bar and the portfolio header scroll away above
it. One sticky element at zero needs no offset arithmetic, so the mobile path is also
pure CSS.

The compact status row carries what the governing principle requires to stay visible:
the active-period trigger (`1M`, `กำหนดเอง`), the freshness chip, and the scope chip
when a filter is active. Tapping the period trigger opens the same period popover used
on desktop. Without this row the mobile path would contradict the governing principle,
since the timeframe otherwise lives on the command bar and would scroll out of view.

**Overflow panel** collapses `Sign in`, `Buy / Sell`, `Switch`, CSV export, print, both
import buttons, and the TH/EN switch. Below 1024 px it also absorbs the AMC and Tax
filters. `Update NAV` never enters it — it stays a visible button, shrinking to an icon
button with a persistent `aria-label` on mobile, because it is the only action carrying
a freshness signal.

Because the panel mixes one-shot actions with filter checkboxes, it is **not** an ARIA
menu. It is a `button` with `aria-expanded` / `aria-haspopup="dialog"` over a
`role="dialog"` labelled by its heading, containing ordinary buttons and checkboxes.
`role="menu"` would require every child to be a `menuitem` variant —
`menuitemcheckbox` for the filters — and would impose roving-tabindex arrow navigation
that suits neither checkboxes nor a mixed panel. Escape closes it and returns focus to
the trigger; a click or focus outside closes it; Tab cycles within it while open.

The AMC and Tax filter popovers at wider breakpoints use the same `role="dialog"`
pattern, so there is one disclosure behaviour across the whole command bar.

**Command bar control forms.** The controls do not fit inline. The real filter sets are
8 AMCs and 5 tax types (6 once an LTF holding appears — `computeAll()` derives `LTF`
at `index.html:2233`), plus 9 timeframes: 22 chips before brand, language, menu, and
Update NAV. They collapse as follows.

| Width | AMC / Tax | Timeframe |
|---|---|---|
| ≥ 1240 px | `AMC: ทั้งหมด` / `ภาษี: ทั้งหมด` buttons opening multi-select popovers | Full segmented control, 9 options |
| 1024–1239 px | Same two buttons | Single trigger showing the active value, opening the period menu |
| < 1024 px | Both move into the overflow panel | Single trigger, mirrored in the sticky status row |

The trigger label always shows the active selection (`1M`, `กำหนดเอง`, `AMC: KKP +2`),
so the current scope and period are readable without opening anything. Each popover is
a `button` with `aria-expanded` / `aria-haspopup` over a `role="dialog"` containing
checkboxes for filters or radios for the period, with Escape, click-outside, and
focus-return matching the overflow panel. Filters apply on change; the popover stays open
so several can be toggled in one visit.

The timeframe control never leaves the command bar at any width, because every number
on screen depends on it.

**Tab bar** is a `role="tablist"` of `role="tab"` buttons with `aria-selected` and
`aria-controls`; each panel is a `role="tabpanel"` labelled by its tab. Left/Right move
between tabs, Home/End jump to the ends, only the active tab is in the tab order
(`tabindex="-1"` on the rest), and activation is manual — arrows move focus, Enter or
Space selects — so arrowing past a heavy panel does not force a render.

### Tab contents

- **ถือครอง** — the holdings table only, full height.
- **ผลตอบแทน** — historical comparison chart (fund multi-select, Value / % change / NAV
  modes, benchmark overlay), then Top gainers · Top losers · Realized vs unrealized.
- **สัดส่วน** — the three donuts (asset class, AMC, tax benefit) plus Look-Through
  Holdings.
- **ความเสี่ยง** — risk KPIs and the per-fund risk table.
- **ภาษี** — tax-fund unlock schedule (by lot / by fund / by year).

### Mobile (< 780 px)

The command bar keeps brand, the timeframe trigger, the `Update NAV` icon button, and
the overflow trigger. Filters and the TH/EN switch live inside the overflow panel, per
the collapse table above. The portfolio header keeps the total, Δ, and sparkline, with
the three secondary KPIs wrapping to a second line; both scroll away.

The sticky wrapper below them holds the compact status row (period trigger, freshness
chip, scope chip) above a horizontally scrollable tab strip with the active tab
scrolled into view. The holdings table keeps its existing card recomposition under
680 px, with the disclosure panel rendering inside the card.

---

## 2 · Single global timeframe

One control on the command bar:
`1D · 1W · 1M · 3M · 6M · 1Y · YTD · MAX · กำหนดเอง`.

It drives the Δ and sparkline in the portfolio header, the `CHANGE` column and its
header label in the holdings table, the historical comparison chart, top gainers and
losers, and every figure in the risk tab. The hero pills (`RANGES`, `d1/w1/d15/m1`) and
their handler are deleted; `15D` is dropped and `1D` joins the shared set.

### Valuation anchor

There is exactly one valuation date for the whole page: **`asOf` = the latest date on
which any included fund has a NAV.** Every "current" number — total market value,
weights, unrealized P/L — is computed at `asOf` with each fund's own last known NAV
carried forward, which is what `navAt()` already does.

A period of length *n* compares `asOf` against the **last available portfolio
valuation on or before `asOf − n calendar days`** — the existing `refLE` +
`daysBefore` behaviour at `index.html:2227`. This makes weekends, Thai public
holidays, differing AMC calendars, and stale funds all resolve the same way: the last
real valuation before the boundary, never an interpolated or skipped one. `1D` is
therefore "versus the previous available valuation", not "versus yesterday".

`YTD` anchors to 1 January of `asOf`'s year. `MAX` runs from the reliable-history start
defined in §5, not from the first stored NAV.

The header shows the resolved comparison date next to the Δ (e.g. `เทียบ 29 ส.ค.`), so
a period that resolved across a holiday is visible rather than implied.

Funds whose own last NAV is older than `asOf` keep their existing staleness badge, and
the header's freshness chip reports how many funds are stale.

### Filter scope

AMC and Tax filters change the headline, because `applyFilter()` and
`seriesIncluded()` both already respect them. That stays — a filtered total is the
useful number — but it must be labelled. Whenever either filter is non-empty the
portfolio header shows a scope chip reading e.g. `KKP · SSF — 12 จาก 62 กอง` next to
the eyebrow, and the eyebrow itself reads `มูลค่าตามตัวกรอง` instead of
`มูลค่ารวม`. Clearing the filters restores both.

### Persistence

`kkp_histtf` continues to store the selection and gains `CUSTOM` as a valid value;
`kkp_histfrom` and `kkp_histto` store the custom bounds. `tfApply` writes all three.
On load, a stored `CUSTOM` whose bounds are missing or invalid falls back to `MAX`.

---

## 3 · Holdings table

The eight existing columns stay: Fund · NAV · Units · Market value · Weight ·
Change (selected period) · Unrealized · Realized.

- **Sparkline** in the Change column, over the same window as the global timeframe.
- **Sortable headers.** Each sortable `<th>` contains a real `<button>`; the `<th>`
  carries `aria-sort` (`ascending` / `descending` / `none`) and an arrow marks the
  active column. Sort state persists under `kkp_sort`.
- **Sticky table header** and a **sticky totals footer**.
- **Inline disclosure replaces the fund detail modal.** The row stays a plain `<tr>`;
  the Fund cell holds a real `<button>` with `aria-expanded` and `aria-controls`.
  Activating it inserts a sibling `<tr><td colspan="8">` containing a
  `role="region"` labelled by the fund's name heading, with: NAV and its price date,
  average cost, actual collected fees (management fee and TER), the fund's top-5
  holdings, and Buy / Sell / Switch buttons scoped to that fund. One row open at a
  time. The modal markup and handler are removed once the panel reaches parity.
- **Row height 54–56 px → 44 px** (header row stays 36 px), showing roughly 14 funds
  per screen instead of 8.
- Funds without a NAV get an explicit `ไม่มีราคา` / `No price` badge rather than
  dimmed text.

Escaping of external and imported strings must survive the change — the disclosure
panel renders fund names, AMC names, and top-holding names from Finnomena data.

---

## 4 · Visual language: Ink & brass v2

### Core tokens

```
--bg        #0B0D0E    page
--surface   #14171A    cards, table body
--surface-2 #1B1F23    raised: sticky headers, expanded row, menus
--border    #23262A    1px hairline
--text      #E8E6E1    primary
--muted     #A2A8AE    labels                 6.91:1 on --surface-2
--muted2    #8A9096    hints, price dates     5.14:1 on --surface-2
--brass     #C9A45C    accent
--pos       #3FB68B    gain
--neg       #E0645C    loss
```

The previous draft's `--muted2: #6E7378` measured 4.07:1 on `--bg`, 3.76:1 on
`--surface` and ~3.46:1 on `--surface-2` — below the 4.5:1 required for 11 px text.
Both muted values above are chosen with margin over the *lightest* surface they can sit
on, so they pass everywhere.

### Categorical tokens

`AMC_COL` (`index.html:2117`) already defines eight AMC colours. It is promoted to CSS
custom properties and joined by two more scales, all defined against `--surface`:

- `--cat-amc-*` — the existing eight, contrast-checked and adjusted where needed.
- `--cat-asset-*` — asset classes, for the asset-allocation donut.
- `--cat-tax-*` — SSF / ThaiESG / ThaiESGX / RMF / LTF / General.
- `--series-1…8` — the multi-fund comparison chart, plus `--series-bench` for the
  benchmark.

Colour is never the only distinction: donut segments carry direct labels with values,
chart series carry end-of-line labels, and the benchmark keeps its dashed stroke.

**The comparison chart is capped at 8 fund series**, plus the portfolio line and the
benchmark — 10 lines at most. Eight colours with dash cycling and end labels do not
stay readable beyond that, and the current multi-select makes overrun trivial: the
`+ all` button per AMC (`index.html:2383`) can add 20 funds in one click from a
62-fund portfolio. At the cap, unselected chips are disabled with
`aria-disabled="true"` and a translated explanation (`เลือกได้สูงสุด 8 กอง ·
เอาออกก่อนเพื่อเพิ่มกองอื่น`), and `+ all` on an AMC that would overrun selects up to
the cap by value and reports how many it added. "Portfolio only" and "Clear" always
work regardless of the cap.

### Type and density

- Numbers use the **main sans family with `font-variant-numeric: tabular-nums`** — the
  existing `.mono` class (`index.html:20`) already does exactly this, and it is kept.
  No monospace family is introduced.
- Type scale 30 / 20 / 15 / 13 / 11 px. Weights 400 and 500 only.
- Borders 1px hairline. Radius 8px on cards, 6px on controls.
- Card padding 16px, grid gap 12px (down from 20–24px) — roughly 25% denser.
- **Brass carries three semantic roles**: the primary action, the selected tab, and the
  focus ring. It is never decorative. Repeat use within a role is expected.
- Gain and loss are always paired with a sign character, never colour alone.

The theme stays dark-only, per the project's standing requirement.

---

## 5 · Performance engine

### 5.1 Reliable-history anchor

Define, for each **currently included** fund — one passing `seriesIncluded()`, so the
anchor moves with the AMC and Tax filters exactly as `asOf` and the totals do — with a
`HOLDINGS_BASE` entry and units > 0:

```
anchor(code) = HOLDINGS_BASE[code].asof            (when present)
```

```
portfolioAnchor = max over those codes of anchor(code)
```

Funds whose units come entirely from ledger transactions (`_added`, no snapshot entry)
do not constrain the anchor — they hold zero units before their first buy, which is
already correct.

- **TWR, XIRR, volatility, drawdown, best/worst day, the header Δ, and the table's
  Change column use only dates ≥ `portfolioAnchor`.** `MAX` starts there.
- The comparison chart may still draw the pre-anchor span, rendered dimmed and dashed
  with a legend entry reading `ก่อน <วันที่> · จำลองจากยอดปัจจุบัน` /
  `before <date> · modelled from current balance`. It is never fed into any statistic.
- A period whose requested start precedes `portfolioAnchor` is clamped to the anchor,
  and the header's resolved comparison date shows the clamped date.

**Missing `asof`.** If any included snapshot fund with units > 0 lacks `asof` there is
no honest anchor, and **every period-derived result becomes unavailable** — not merely
the risk tab. That set is: the header Δ, its percentage and sparkline, the holdings
table's Change column and row sparklines, top gainers and losers, and the whole risk
tab. Each renders the existing `noData` message rather than a number, and the Change
column's header drops its period label.

Point-in-time results stay available throughout, because they need no period: total
market value, cost basis, unrealized and realized P/L, weights, all three allocation
donuts, look-through holdings, and the tax unlock schedule.

The comparison chart also stays, drawn entirely in the dimmed dashed "modelled history"
treatment described above, since it is explicitly labelled as reconstructed rather than
presented as measured performance.

The portfolio header surfaces a single action, "ตั้งวันเริ่มพอร์ต",
which prompts for a date and writes it as `asof` on every snapshot fund missing one.
The prompt reuses the existing pattern from `setBirth()` (`index.html:2554`). This case
is reachable today: the repo's `holdings.json` has no `asof` on any of its 66 funds,
while `importHoldings()` (`index.html:2954`) stamps one on every UI import.

### 5.2 Coverage entry is an external flow

Within the reliable window, a fund's NAV history can still begin after
`portfolioAnchor`.

The date axis is the union of NAV dates, so consecutive dates can be days apart, and
the transaction loop at `index.html:2403` drains **every** entry dated `<= D` — not
just those dated `D`. Any rule keyed on "transactions dated exactly `D`" therefore
misses a purchase dated `D − 1` that settles into the same batch, and mishandles a sale
in the opposite direction.

Capture each fund's units **before** the batch runs, and use those:

```
openingUnits = { ...units }                        // before the while loop for D

// drain the batch: each buy, sell, dividend and switch contributes to flow exactly once

if navAt(C, D) != null && navAt(C, P) == null:
    flow += openingUnits[C] * navAt(C, D)
```

`openingUnits[C]` is the capital that was already held but unpriced, which is precisely
what enters coverage. Units acquired in the batch entered `flow` through the ledger
branch and must not be added again; units sold in the batch left through it as well.
The small residual — the difference between a transaction's price and that day's NAV —
is genuine return and is correctly retained.

No coverage-exit branch is written. `navAt()` carries the last price forward
indefinitely, so a priced fund never becomes unpriced; units reaching zero are already
handled by the sell branch.

### 5.3 Transaction dates join the valuation axis

The axis is currently the union of NAV dates only (`index.html:2398`). A transaction
dated between two NAV observations is drained into the later date's batch, so
`(value - flow) / prev - 1` books that flow at the end of a period it did not span. A
large contribution mid-period therefore distorts the sub-period return.

**The axis becomes the union of NAV dates and transaction dates**, restricted to
`>= portfolioAnchor`. On a date that carries no new NAV:

- each priced fund is valued at `navAt(code, date)`, which carries its last price
  forward, so funds with no new observation contribute a 0% sub-period return — which
  is the correct reading under carry-forward;
- a fund being bought that has no NAV coverage yet is valued at the transaction's own
  price for that date, which is the only price that exists for it.

The flow is then subtracted on the date it actually occurred, and TWR becomes a true
time-weighted chain rather than an end-of-period approximation. The axis grows by the
number of distinct transaction dates, which is small next to years of daily NAVs.

`histHint` keeps its existing "ledger-adjusted" wording (`index.html:2132`); with this
change the wording is literally true rather than approximate.

### 5.4 Date labels carry the year when the window spans one

`fmtD()` includes the year when the window's first and last dates fall in different
calendar years. Thai locale keeps Buddhist years, matching the rest of the Thai UI.

### 5.5 Guards

- Drop any daily return that is not finite from the return series.
- Window coverage below 60% renders the existing `noData` message instead of the KPI
  values. "Market value on the window's first date" is not computable — a fund with no
  historical price has no value then — so coverage is measured in `asOf` money:

  ```
  coverage = Σ asOf value of included funds priced on or before the window start
           ÷ Σ asOf value of all included funds that are priced at all
  ```

  This answers the question that matters: how much of today's selected portfolio the
  historical window actually represents. Funds never priced at all are excluded from
  both sides and keep their separate report in the coverage chip, which already lists
  them (`confCoverage`, `62/66` in the measured portfolio).

### 5.6 Naming

`rkXirr` already reads "Estimated XIRR" / "XIRR โดยประมาณ" (`index.html:2139`) and
stays. "Estimated" remains accurate for its own reason: the app has no record of the
investor's true external cash flows, only a statement snapshot plus a ledger.

**The `xirrEst` footnote is wrong and must be rewritten.** It currently reads "Baseline
cost is treated as an opening cash flow" / "ใช้ต้นทุนพอร์ตตั้งต้นเป็นกระแสเงินสดวันแรก",
but `renderRisk()` (`index.html:2520`) builds

```js
{ date: x.date, amount: i === 0 ? -x.value : -x.flow }
```

and `x.value` is **market value**, not cost (`rows.push({date, value, twr, flow})` at
`index.html:2410`). Opening market value is the right choice for a windowed return — it
is what the investor had at risk when the window opened — so the calculation stays and
the wording changes, in both languages:

> Opening market value on `<date>` is treated as the initial cash flow; subsequent
> ledger and synthetic coverage flows are included.

> ใช้มูลค่าตลาดต้นงวด ณ `<วันที่>` เป็นกระแสเงินสดแรก รวมรายการซื้อขายและ
> เงินที่เพิ่งเข้ามาในความคุ้มครองราคาที่ตามมา

`<date>` is the window's first date after anchor clamping, so the reader can see which
cash flows were actually available.

---

## 6 · Out of scope

Unchanged: the single-file `index.html` delivery, Supabase schema and reads, the
Cloudflare Worker sync, the `holdings.json` import schema and its merge/delete
semantics, append-only ledger corrections, and the auth flow.

Every user-visible string must exist in both `en` and `th` i18n tables — CI fails the
build on a missing key.

After any edit to `index.html`, run `node scripts/update-csp.mjs` then
`node scripts/check.mjs` before committing. The page pins a sha256 hash of its inline
script; a stale hash disables all JavaScript on the live site. **The working tree is
currently stale** — `check.mjs` exits 1 on the uncommitted `.sticky-controls` change.

---

## 7 · Verification

### 7.1 Engine fixtures

The performance engine is bracketed with sentinel comments inside the inline script so
`scripts/check-perf.mjs` can slice it out and evaluate it in a `node:vm` sandbox with
injected `NAVDB`, `HOLDINGS_BASE`, and `TXNS`. Each fixture is a JSON file under
`test/fixtures/` with expected outputs to a fixed tolerance. `check-perf.mjs` runs from
`scripts/check.mjs` so CI covers it.

Required fixtures:

| # | Scenario | Assertion |
|---|---|---|
| 1 | Static single-fund holding, no transactions | TWR equals the fund's simple NAV return exactly |
| 2 | Dividend-paying fund | TWR deliberately differs from NAV return; the gap equals the dividend's contribution |
| 3 | Coverage entry with a same-day purchase | No double count — TWR unchanged by the entry |
| 3b | Coverage entry with a purchase dated between the previous NAV date and `D` | Same result as 3; the `boughtToday` formulation would have double counted |
| 3c | Coverage entry with a same-day sale | Sale flows out once; TWR unchanged by the entry |
| 4 | Coverage entry with no transaction that day | Entry contributes zero return |
| 5 | Snapshot boundary: transactions before and after `asof` | Pre-`asof` entries absorbed; series starts at `asof` |
| 6 | Snapshot funds with no `asof` | Engine reports "no anchor"; every period-derived result is unavailable while point-in-time values still compute |
| 7 | Buy, sell, dividend, and switch in one window | Units, cost, realized P/L, and TWR all reconcile |
| 8 | Stale fund (last NAV before `asOf`) | Carried forward; flagged stale; no synthetic return |
| 9 | Fund with no NAV at all | Excluded from valuation; counted in the coverage chip |
| 10 | AMC filter applied, where the filtered-out fund holds the latest `asof` | Series, totals **and `portfolioAnchor`** all move to the filtered set |
| 10b | Window start before some funds' first NAV | Coverage ratio matches the `asOf`-money definition; below 60% the KPIs suppress |
| 10c | Large contribution dated between two NAV observations | The contribution date appears on the valuation axis and TWR is unchanged by it; the pre-fix end-of-period booking would have shifted it |
| 10d | Window with an opening balance, one mid-window buy and one sell | XIRR cash-flow series equals exactly `[-openingMarketValue, -buy, +sell, +closingMarketValue]` on the expected dates |
| 11 | Custom window whose start precedes the anchor | Clamped to the anchor; reported clamped date |
| 12 | Custom window of a single day | Returns zero-length result, not `NaN` |

No assertion caps a daily return at a fixed percentage — a legitimate move can exceed
any such bound. Correctness is asserted against the fixtures' expected values instead.

### 7.2 Browser checks

Run against the real 62-fund portfolio at 320, 390, 768, 1024, and 1400 px:

- No horizontal overflow; sticky offsets correct at every width in both TH and EN
  (Thai labels are the wrapping risk).
- The command bar's collapse table holds at every width: filter and timeframe triggers
  show their active selection, and the timeframe never disappears.
- Keyboard-only pass: tab bar arrow navigation, sort buttons, row disclosure, filter
  and timeframe popovers, overflow panel — each with open/close/Escape/focus-return —
  and dialogs still focus-trapped.
- Comparison chart at the 8-series cap: chips disable with a translated reason, `+ all`
  on a large AMC reports what it added, "Clear" still works.
- 200% browser zoom at 1400 px: layers still usable, nothing clipped.
- Contrast spot-check of `--muted`, `--muted2`, and every categorical token against the
  surface it renders on.

### 7.3 Existing checks

`scripts/check.mjs` covers JS parsing, i18n key resolution across both languages, the
CSP hash, and worker syntax. It gains the `check-perf.mjs` call. Everything in §7.2
stays manual.

---

## 8 · Delivery phases

Reordered so nothing surfaces a known-bad number.

0. **Performance engine** — the anchor model, coverage-entry flow, transaction dates on
   the valuation axis, year-aware date labels, guards, the rewritten `xirrEst` footnote
   in both languages, fixtures, and `check-perf.mjs`. The only visible change is that
   footnote; the existing hero and risk section pick up correct numbers immediately.
1. **Structure** — command bar, portfolio header with scope and freshness chips, tab
   shell with full keyboard support, remove the left rail, single global timeframe with
   its persistence and resolved-comparison-date label.
2. **Table** — sortable headers with `aria-sort`, sticky header and totals, sparkline
   column, disclosure-button row expansion, remove the fund detail modal.
3. **Visual language** — the Ink & brass v2 token set, categorical scales, and the
   density pass.

Each phase leaves the dashboard working, passes `check.mjs`, and is reviewable alone.
