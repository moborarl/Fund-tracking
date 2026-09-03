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
| Command bar (sticky) | intrinsic, ~56 px | Brand · AMC filter · Tax filter · **global timeframe** · TH/EN · actions menu · Update NAV |
| Portfolio header (sticky) | intrinsic, min 96 px | Total market value · Δ for the selected period · sparkline · cost basis / unrealized / realized · scope and freshness chips |
| Tab bar (sticky) | intrinsic, ~40 px | **ถือครอง** · ผลตอบแทน · สัดส่วน · ความเสี่ยง · ภาษี |
| Tab body | remaining viewport (desktop) | See scrolling rules below |

`ถือครอง` (Holdings) is the default tab. Tab state persists under `kkp_tab`.

**Sticky geometry.** The three layers are not fixed pixel heights. Each measures itself
with a `ResizeObserver` and publishes `--h-cmd`, `--h-hdr`, `--h-tabs` as CSS custom
properties on `:root`; every sticky `top` and the tab body's height derive from those.
This replaces the current `topOff()` heuristic (`index.html:2963`), which tests
`r.height < 160` and breaks when Thai labels wrap. The portfolio header has a
`min-height` but no fixed height, so wrapping grows it instead of clipping.

**Scrolling.** On desktop (≥ 1024 px) the tab body scrolls internally so the three
layers stay put. Below 1024 px the page reverts to normal document scrolling — the
command bar and tab bar stay sticky, the portfolio header does not — to avoid
nested-scroll friction on touch.

**Actions menu** collapses `Sign in`, `Buy / Sell`, `Switch`, CSV export, print, and
both import buttons. `Update NAV` stays outside it as the one primary button, because
it is the only action carrying a freshness signal. The menu is a `button` with
`aria-expanded` and `aria-haspopup="menu"` controlling a `role="menu"`; Escape closes
it and returns focus to the trigger, a click or focus outside closes it, and Up/Down
move between items.

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

Command bar keeps brand, the timeframe control, and the overflow button — the
timeframe stays visible because every number on the screen depends on it. Filters move
into the overflow menu. The portfolio header keeps the total, Δ, and sparkline, with
the three secondary KPIs wrapping to a second line. The tab bar becomes a horizontally
scrollable strip with the active tab scrolled into view. The holdings table keeps its
existing card recomposition under 680 px, with the disclosure panel rendering inside
the card.

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
Series beyond eight cycle the ramp but vary dash pattern, so two same-coloured lines
never share a style.

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

Define, for each fund with a `HOLDINGS_BASE` entry and units > 0:

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

**Missing `asof`.** If any snapshot fund with units > 0 lacks `asof` there is no honest
anchor. The risk tab and the header Δ then show the existing `noData` message with an
explanatory line, and the portfolio header surfaces a single action, "ตั้งวันเริ่มพอร์ต",
which prompts for a date and writes it as `asof` on every snapshot fund missing one.
The prompt reuses the existing pattern from `setBirth()` (`index.html:2554`). This case
is reachable today: the repo's `holdings.json` has no `asof` on any of its 66 funds,
while `importHoldings()` (`index.html:2954`) stamps one on every UI import.

### 5.2 Coverage entry is an external flow

Within the reliable window, a fund's NAV history can still begin after
`portfolioAnchor`. For each date `D` with previous date `P`, for each included code
`C`:

```
if navAt(C, D) != null && navAt(C, P) == null:
    boughtToday = Σ units of buy transactions for C dated exactly D
    flow += (units[C] - boughtToday) * navAt(C, D)
```

Subtracting `boughtToday` prevents double counting: those units' cash already entered
`flow` through the ledger branch, and `units[C]` already includes them.

No coverage-exit branch is written. `navAt()` carries the last price forward
indefinitely, so a priced fund never becomes unpriced; units reaching zero are already
handled by the sell branch.

### 5.3 Date labels carry the year when the window spans one

`fmtD()` includes the year when the window's first and last dates fall in different
calendar years. Thai locale keeps Buddhist years, matching the rest of the Thai UI.

### 5.4 Guards

- Drop any daily return that is not finite from the return series.
- When priced funds represent less than 60% of portfolio market value on the window's
  first date, render the existing `noData` message instead of the KPI values.

### 5.5 Naming

`rkXirr` already reads "Estimated XIRR" / "XIRR โดยประมาณ" (`index.html:2139`) and its
`xirrEst` footnote already states that the baseline cost is treated as an opening cash
flow. Both are correct and stay. The footnote gains the anchor date so the reader knows
which cash flows were actually available.

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
| 4 | Coverage entry with no transaction that day | Entry contributes zero return |
| 5 | Snapshot boundary: transactions before and after `asof` | Pre-`asof` entries absorbed; series starts at `asof` |
| 6 | Snapshot funds with no `asof` | Engine reports "no anchor" rather than a number |
| 7 | Buy, sell, dividend, and switch in one window | Units, cost, realized P/L, and TWR all reconcile |
| 8 | Stale fund (last NAV before `asOf`) | Carried forward; flagged stale; no synthetic return |
| 9 | Fund with no NAV at all | Excluded from valuation; counted in the coverage chip |
| 10 | AMC filter applied | Series and totals cover only the filtered set |
| 11 | Custom window whose start precedes the anchor | Clamped to the anchor; reported clamped date |
| 12 | Custom window of a single day | Returns zero-length result, not `NaN` |

No assertion caps a daily return at a fixed percentage — a legitimate move can exceed
any such bound. Correctness is asserted against the fixtures' expected values instead.

### 7.2 Browser checks

Run against the real 62-fund portfolio at 320, 390, 768, 1024, and 1400 px:

- No horizontal overflow; sticky offsets correct at every width in both TH and EN
  (Thai labels are the wrapping risk).
- Keyboard-only pass: tab bar arrow navigation, sort buttons, row disclosure, actions
  menu open/close/Escape/focus-return, dialogs still focus-trapped.
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

0. **Performance engine** — the anchor model, coverage-entry flow, year-aware date
   labels, guards, fixtures, and `check-perf.mjs`. No visual change; the existing hero
   and risk section pick up correct numbers immediately.
1. **Structure** — command bar, portfolio header with scope and freshness chips, tab
   shell with full keyboard support, remove the left rail, single global timeframe with
   its persistence and resolved-comparison-date label.
2. **Table** — sortable headers with `aria-sort`, sticky header and totals, sparkline
   column, disclosure-button row expansion, remove the fund detail modal.
3. **Visual language** — the Ink & brass v2 token set, categorical scales, and the
   density pass.

Each phase leaves the dashboard working, passes `check.mjs`, and is reviewable alone.
