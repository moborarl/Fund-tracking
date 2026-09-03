# Dashboard redesign — design spec

**Date:** 2026-09-03
**Target:** `index.html` (single file, currently 3,076 lines / 192 KB)
**Live:** https://fundtracking.yourpower.today/

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

The owner's stated usage is 80% "quick check whether the portfolio is up or down"
plus "browse the holdings table". Those two tasks sit at opposite ends of the page:
the hero is at the top, the holdings table starts ~7,200 px down. Every other section
is permanently expanded between them, with no tabs, no collapsing, and no section
navigation.

Four further defects found while measuring:

1. **Two competing time controls.** The hero pills (`1D / 1W / 15D / 1M`) and the
   chart timeframe (`1W / 1M / 3M / 6M / 1Y / YTD / MAX / custom`) are independent
   and produce different periods for numbers shown on the same screen.
2. **Risk figures are impossible.** TWR `+12,073.62%`, XIRR `+6,345.59%`,
   annualized volatility `595.5%`, best day `+608.41%`. Root cause below.
3. **Date labels drop the year.** The risk window renders "8 Jul → 2 Sept" for a
   window that actually spans 8 July 2019 → 2 September 2026.
4. **The 214 px left rail carries only action buttons** — no section navigation —
   while the holdings table is horizontally cramped.

### Root cause of the risk figures

`portfolioSeries()` (`index.html:2398`) builds its date axis from the union of every
held fund's NAV history, then computes each day's return as:

```js
const r = (value - flow) / prev - 1;
```

`flow` counts only ledger transactions (buy / sell / switch / dividend). `navAt()`
(`index.html:2807`) returns `null` for any date before a fund's first stored NAV, so a
fund contributes ฿0 to `value` until its history begins and its **entire market value
then appears in a single day with `flow = 0`**. The chain treats that capital entering
price coverage as investment return, compounding `twr` to five figures and producing
single-day returns like `+608.41%`, which in turn inflate volatility and XIRR.

`renderRisk()` (`index.html:2520`) derives its XIRR cash flows from the same `flow`
field, so it inherits the defect.

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
| Broken risk math | Fix the formula properly in this round |

Risk & Performance and Tax Unlock / Look-Through are **demoted to the last two tabs,
not removed.**

---

## 1 · Page structure

The 214 px left rail is removed; its actions move into the command bar. The page
becomes three fixed layers plus a tab body.

| Layer | Height | Contents |
|---|---|---|
| Command bar (sticky) | 56 px | Brand · AMC filter · Tax filter · **global timeframe** · TH/EN · actions menu |
| Portfolio header (sticky) | 116 px | Total market value · Δ for the selected timeframe · sparkline · cost basis / unrealized / realized · data-coverage chip |
| Tab bar (sticky) | 40 px | **ถือครอง** · ผลตอบแทน · สัดส่วน · ความเสี่ยง · ภาษี |
| Tab body | remaining viewport | Scrolls internally |

Tab order follows stated usage. `ถือครอง` (Holdings) is the default tab.

**Actions menu** collapses `Sign in`, `Buy / Sell`, `Switch`, CSV export, print, and
both import buttons behind a single overflow button. `Update NAV` stays outside the
menu as the command bar's one primary button, because it is the only action carrying a
freshness signal.

**Tab state** persists in `localStorage` under `kkp_tab`, defaulting to `holdings`.

### Tab contents

- **ถือครอง** — holdings table only, full height.
- **ผลตอบแทน** — historical comparison chart (fund multi-select, Value / % change / NAV
  modes, benchmark overlay), then Top gainers · Top losers · Realized vs unrealized.
- **สัดส่วน** — the three donuts (asset class, AMC, tax benefit) plus Look-Through
  Holdings.
- **ความเสี่ยง** — risk KPIs and the per-fund risk table.
- **ภาษี** — tax-fund unlock schedule (by lot / by fund / by year).

### Mobile (< 780 px)

Command bar collapses to brand + overflow. Portfolio header keeps the total, Δ, and
sparkline; the three secondary KPIs wrap to a second line. The tab bar becomes a
horizontally scrollable strip. The holdings table keeps its existing card
recomposition under 680 px, with the inline expansion rendering inside the card.

---

## 2 · Single global timeframe

One control on the command bar: `1D · 1W · 1M · 3M · 6M · 1Y · YTD · MAX · กำหนดเอง`.

It drives every period-dependent number on the page:

- the Δ and sparkline in the portfolio header,
- the `CHANGE` column in the holdings table and its header label,
- the historical comparison chart,
- top gainers / top losers,
- every figure in the risk tab.

The hero pills (`d1 / w1 / d15 / m1`) and their handler are deleted. The existing
`kkp_histtf` key continues to store the selection, so a returning user keeps their
timeframe. `1D` is added to the existing set; `15D` is dropped.

---

## 3 · Holdings table

The eight existing columns stay: Fund · NAV · Units · Market value · Weight ·
Change (selected timeframe) · Unrealized · Realized.

Changes:

- **Sparkline** in the Change column, drawn from the same window as the global
  timeframe.
- **Sortable headers** — click to sort, second click reverses, an arrow marks the
  active column and direction. Sort state persists in `localStorage` under `kkp_sort`.
- **Sticky table header** and a **sticky totals footer** that stays visible while the
  body scrolls.
- **Inline row expansion replaces the fund detail modal.** Clicking a row (or pressing
  Enter / Space on it) expands a panel directly beneath it containing: NAV with its
  price date, average cost, actual collected fees (management fee and TER), the fund's
  top-5 holdings, and Buy / Sell / Switch buttons scoped to that fund. Only one row is
  expanded at a time. The existing modal markup and its handler are removed once the
  panel reaches parity.
- **Row height 54–56 px → 44 px** (header row stays 36 px), showing roughly 14 funds
  per screen instead of 8.
- Funds without a NAV get an explicit `ไม่มีราคา` / `No price` badge rather than
  dimmed text; stale funds keep their existing staleness badge.

Keyboard operability, focus handling, and escaped external strings must survive the
change — the expanded panel is a `role="region"` labelled by its row, and the row
carries `aria-expanded`.

---

## 4 · Visual language: Ink & brass v2

### Tokens

```
--bg        #0B0D0E    page
--surface   #14171A    cards, table body
--surface-2 #1B1F23    raised: sticky headers, expanded row, menus
--border    #23262A    1px hairline
--text      #E8E6E1    primary
--muted     #8A8F94    labels
--muted2    #6E7378    hints, price dates
--brass     #C9A45C    accent
--pos       #3FB68B    gain
--neg       #E0645C    loss
```

### Rules

- Every number renders in the mono face with `font-variant-numeric: tabular-nums` so
  digits align down a column.
- Type scale: 30 / 20 / 15 / 13 / 11 px. Weights 400 and 500 only.
- Borders are 1px hairline. Radius 8px on cards, 6px on controls.
- **Brass appears in exactly three places**: the primary button, the selected tab, and
  the focus ring. It is never decorative.
- Card padding 16px, grid gap 12px (down from 20–24px) — roughly 25% denser.
- Gain / loss colour is always paired with a sign character, never colour alone.

The theme stays dark-only, per the project's standing requirement.

---

## 5 · Risk math fixes

### 5.1 Coverage entry and exit are external flows

In `portfolioSeries()`, track which codes were priced on the previous date. For each
date, before computing the return:

- for every code priced today but not on the previous date, add `units × nav` to
  `flow` (capital entering);
- for every code priced on the previous date but not today, subtract its previous
  value from `flow` (capital leaving).

`r = (value - flow) / prev - 1` then measures only price movement. XIRR inherits the
correction because `renderRisk()` reads the same `flow` field.

### 5.2 Date labels carry the year when the window spans one

`fmtD()` gains a year when the window's first and last dates fall in different
calendar years. Thai locale keeps Buddhist years, matching the rest of the Thai UI.

### 5.3 Guards

- Drop any daily return that is not finite from the return series.
- When priced funds represent less than 60% of portfolio market value on the window's
  first date, render the existing `noData` message instead of the KPI values.

### 5.4 Verification

With the real 62-fund portfolio and timeframe `MAX`, TWR, annualized volatility, max
drawdown, XIRR, and best/worst day must all land in a defensible range, and no single
day may show a return above ±25%. Spot-check one single-fund window against that
fund's own NAV series, where TWR must equal the fund's simple NAV return.

---

## 6 · Out of scope

Unchanged: the single-file `index.html` delivery, Supabase schema and reads, the
Cloudflare Worker sync, the `holdings.json` import schema and its merge/delete
semantics, append-only ledger corrections, and the auth flow.

Every user-visible string must exist in both `en` and `th` i18n tables — CI fails the
build on a missing key.

After any edit to `index.html`, run `node scripts/update-csp.mjs` then
`node scripts/check.mjs` before committing. The page pins a sha256 hash of its inline
script; a stale hash disables all JavaScript on the live site.

---

## 7 · Delivery phases

Each phase leaves the dashboard working and reviewable on its own.

1. **Structure** — command bar, portfolio header, tab shell, remove the left rail,
   single global timeframe.
2. **Table** — sortable sticky headers, sticky totals, sparkline column, inline row
   expansion, remove the fund detail modal.
3. **Visual language** — the Ink & brass v2 token set and density pass.
4. **Risk math** — the three fixes and their verification.
