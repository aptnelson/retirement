# Personal Retirement Calculator — Web App

## Project Goal

Convert Patrick's Excel spreadsheet (`Personal Retirement Calculator.xlsm`) into a responsive, interactive single-page web app. Users adjust parameters and see all three charts update in real time. Fidelity to the spreadsheet's math and behavior is the top priority.

## Tech Stack

- **Vanilla JavaScript** (no framework)
- **[Chart.js](https://www.chartjs.org/)** (v4) for all three charts — handles stacked bar, area, and line charts well
- **Web Worker** for the Monte Carlo simulation — keeps the UI responsive during 1,000 trial runs
- Single `index.html` + `style.css` + `calc.js` (core math) + `worker.js` (Monte Carlo) + `charts.js` (chart rendering/updating)

No build tools needed. All dependencies via CDN.

---

## Source Spreadsheet Structure

### Three Sheets

1. **`inputs`** — user parameters + 3 charts
2. **`calcs`** — year-by-year projection engine (rows 18–99, one row per age)
3. **`random`** — Monte Carlo results store (1,000 trial columns + percentile bands in columns C–G)

---

## Input Parameters

All pulled from the `inputs` sheet. These become the UI controls.

| Parameter | Default | Type | Notes |
|-----------|---------|------|-------|
| Random Trials | 1000 | number (1–1000) | How many Monte Carlo runs |
| Date of Birth | 1980-01-01 | date | Used to compute current age |
| Annual Pay | $100,000 | currency | Current salary |
| Current Balance | $200,000 | currency | Current portfolio balance |
| Risk Tolerance | Low-Medium | dropdown | Options: High, Med-High, Medium, Low-Medium, Low |
| Salary Growth | 3% | percent | Annual raise rate |
| Savings Rate | 10% | percent | % of salary saved each year |
| Retire At Age | 60 | number | Target retirement age |
| Retirement Drawdown | 10% | percent | Annual withdrawal rate; default fallback is 4% |
| Replacement Ratio | (blank) | percent | % of final salary needed; default = `MIN(80%, 1 - savings_rate)` |
| Expected Return Override | 5% | percent | Overrides blended portfolio return when set |
| Next Year Scenario | Horrible! | dropdown | Options: Great!, Good, Average, Flat, Bad, Horrible!, Who Knows? |
| First Year of Retirement | Horrible! | dropdown | Same options as above |
| Graph Max Age | 75 | number | Upper bound for all charts |
| Display Toggle | Balance | toggle | "Balance" vs "Investment Earnings" for sensitivity chart |

**Derived:**
- Current Age = `DATEDIF(DOB, TODAY(), "m") / 12` (fractional years)
- Graph Min Age = `ROUND(current_age, 0)`
- Replacement Ratio default = `MIN(0.80, 1 - savings_rate)`
- Drawdown default = `0.04`

---

## Market Parameters (Hard-Coded from Spreadsheet)

These come from real ETF data embedded in `calcs`. Do not expose as user inputs unless explicitly asked.

```js
const MARKET = {
  stock: { expectedReturn: 0.062, stdDev: 0.1774 },  // IVV (S&P 500)
  bond:  { expectedReturn: 0.0426, stdDev: 0.0337 },  // AGG (US Agg)
  correlation: -0.25,                                   // stock-bond correlation
};
```

**Confidence weight:** 80/20 (stock/bond) for blended expected return:
```
E[portfolio] = 0.8 * stock.expectedReturn + 0.2 * bond.expectedReturn
```

**Scenario multipliers** (applied to the expected return component for special years):
```js
const SCENARIOS = {
  "Great!":    2.0,
  "Good":      1.5,
  "Average":   1.0,
  "Flat":      0.0,
  "Bad":      -1.0,
  "Horrible!": -2.0,
  "Who Knows?": null,  // use NORM.INV(RAND()) → just a fully random draw (no bias)
};
```

**Risk Tolerance → Asset Allocation Glide Path:**

Formula: `stock_pct = CLAMP(base - age, max_pct, min_pct) / 100`

| Risk | Base | Max% | Min% |
|------|------|------|------|
| High | 140 | 90 | 60 |
| Med-High | 130 | 85 | 50 |
| Medium | 120 | 80 | 40 |
| Low-Medium | 110 | 75 | 30 |
| Low | 100 | 70 | 2 |

```js
function stockPct(riskTolerance, age) {
  const { base, max, min } = RISK_TABLE[riskTolerance];
  return Math.max(Math.min(base - age, max), min) / 100;
}
```

---

## Core Math (replicate exactly from `calcs` sheet)

### Year-by-Year Projection

Run from `current_age` (rounded to integer) through age 99 (or 120). Each year produces one data point.

```js
function projectYear(prev, params, year) {
  const { age, balance } = prev;
  const nextAge = age + 1;
  const isRetired = age >= params.retireAt;

  // Salary (grows at salaryGrowth rate; 0 in retirement)
  const salary = isRetired ? 0 : params.pay * Math.pow(1 + params.salaryGrowth, age - params.startAge);

  // Asset allocation
  const sp = stockPct(params.riskTolerance, age);
  const bp = 1 - sp;

  // Returns for this year (passed in from caller — deterministic or random)
  const stockReturn = ...; // see below
  const bondReturn  = ...;
  const blended = stockReturn * sp + bondReturn * bp;

  // Savings and withdrawals
  const annualSavings = isRetired ? 0 : salary * params.savingsRate;
  const monthlySavings = annualSavings / 12;

  // FV adjustment: converts monthly contributions to annual equivalent
  // Excel: =FV((1+r)^(1/12)-1, 12, -monthly, , 1) - annual
  const monthlyRate = Math.pow(1 + blended, 1 / 12) - 1;
  const fvAdj = fv(monthlyRate, 12, -monthlySavings, 0, 1) - annualSavings;

  // Withdrawal (retirement phase)
  const maxWithdrawal = balance > 0
    ? Math.min(params.drawdown * balance, params.salaryAtRetirement * params.replacementRatio)
    : 0;
  const withdrawal = isRetired && balance > 0 ? -maxWithdrawal : 0;

  // EOY balance
  const growth = Math.max(balance, 0) * blended;
  const eoyBalance = balance + growth + annualSavings + fvAdj + withdrawal;

  return { age: nextAge, balance: Math.max(eoyBalance, 0), growth, annualSavings, fvAdj, withdrawal };
}
```

**FV helper (replicates Excel's FV function):**
```js
// type=1 means payments at beginning of period (annuity due)
function fv(rate, nper, pmt, pv = 0, type = 0) {
  if (rate === 0) return -(pv + pmt * nper);
  const factor = Math.pow(1 + rate, nper);
  return -(pv * factor + pmt * (1 + rate * type) * (factor - 1) / rate);
}
```

### Blended Return Generation

**Deterministic (base / sensitivity scenarios):**
```js
// base: uses hard-coded expected returns
// +1%: stock E[x]+0.01, bond E[x]+0.01*(-0.25)  [bond adjusts by correlation]
// -1%: same but -0.01
function deterministicReturn(age, riskTol, offset = 0) {
  const sp = stockPct(riskTol, age);
  const bp = 1 - sp;
  return (MARKET.stock.expectedReturn + offset) * sp
       + (MARKET.bond.expectedReturn + offset * MARKET.correlation) * bp;
}
```

**Random (Monte Carlo):**
```js
function normalRandom(mean, std) {
  // Box-Muller transform
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomReturn(asset, age, params, isFirstYear, isFirstRetirementYear) {
  const { expectedReturn, stdDev } = MARKET[asset];
  const isSpecialYear = (isFirstYear && age === params.startAge)
                     || (isFirstRetirementYear && age === params.retireAt);

  if (!isSpecialYear) return normalRandom(expectedReturn, stdDev);

  const scenario = isFirstRetirementYear ? params.firstRetirementScenario : params.nextYearScenario;
  const mult = SCENARIOS[scenario];
  if (mult === null) return normalRandom(0, 1);  // "Who Knows?" — pure random
  return expectedReturn * mult;  // scale expected return by scenario multiplier
}
```

> **Note:** The `params.expectedReturnOverride` (inputs!C21), when set, replaces the hard-coded expected returns in the deterministic scenarios but NOT necessarily the random draws (verify against spreadsheet behavior).

### Monte Carlo Simulation

The VBA macro runs N trials, each time forcing a full recalculation. In JS, this becomes:

```js
// In worker.js
function runMonteCarlo(params, trials) {
  const ages = buildAgeArray(params);  // integer ages from startAge to 99
  const results = ages.map(() => []);  // results[ageIndex] = array of N balances

  for (let t = 0; t < trials; t++) {
    let balance = params.currentBalance;
    let salaryAtRetirement = null;

    ages.forEach((age, i) => {
      if (age === params.retireAt) salaryAtRetirement = computeSalary(params, age);
      const sr = randomReturn('stock', age, params, t === 0 ? false : true, ...);
      const br = randomReturn('bond',  age, params, ...);
      // ... run projectYear with sr/br ...
      results[i].push(balance);
    });
  }

  // Compute percentile bands
  return ages.map((age, i) => {
    const sorted = results[i].slice().sort((a, b) => a - b);
    return {
      age,
      p5:  percentile(sorted, 0.05),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.50),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
    };
  });
}
```

**Percentile method:** Use `PERCENTILE.EXC` equivalent (exclusive interpolation):
```js
function percentile(sorted, p) {
  const n = sorted.length;
  const pos = p * (n + 1) - 1;  // PERCENTILE.EXC uses (n+1) not (n-1)
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo < 0) return sorted[0];
  if (hi >= n) return sorted[n - 1];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}
```

**Stacked bar data** (bands are differences so they stack to the 95th percentile):
```
band1 = p5            (hidden/transparent base layer)
band2 = p25 - p5      (5%–25%)
band3 = p50 - p25     (25%–50%)
band4 = p75 - p50     (50%–75%)
band5 = p95 - p75     (75%–95%)
```

### Decomposition (for Area Chart)

Track cumulative totals as projection runs:
- **Net Savings** = `MAX(initialBalance + cumulativeSavings + cumulativeWithdrawals, 0)`
- **Net Earnings** = `cumulativeGrowth + cumulativeFvAdj`
- **Balance** = `Net Savings + Net Earnings` (reconciliation check)

### Sensitivity Scenarios (for Line Chart)

Run three parallel deterministic projections using `deterministicReturn(age, riskTol, 0)`, `+0.01`, `-0.01`. No random draws — fully deterministic.

When the display toggle is "Balance": show EOY balance.
When "Investment Earnings": show only `cumulativeGrowth + cumulativeFvAdj` (the earnings component only).

---

## Three Charts

All charts filter to the age range `[graphMinAge, graphMaxAge]`.

### Chart 1 — Monte Carlo Fan Chart (Stacked Bar)

- **Type:** Stacked bar (vertical)
- **X-axis:** Age
- **Y-axis:** Portfolio balance ($)
- **Series (5 stacked layers):**
  - Layer 1 (hidden/transparent): up to 5th percentile
  - Layer 2 (light): 5th–25th percentile
  - Layer 3 (medium): 25th–50th percentile
  - Layer 4 (medium-dark): 50th–75th percentile
  - Layer 5 (dark): 75th–95th percentile
- **Triggered by:** "Run Trials" button; not auto-updated on parameter change (mirrors Excel behavior where you must manually run the macro)

### Chart 2 — Balance Decomposition (Area Chart)

- **Type:** Stacked area
- **X-axis:** Age
- **Y-axis:** Portfolio balance ($)
- **Series:**
  - "Balance" (total EOY balance)
  - "Net Savings" (cumulative contributions minus withdrawals)
  - "Net Earnings" (cumulative investment growth)
- **Updates:** Real-time on parameter change (uses base deterministic returns)

### Chart 3 — Sensitivity Analysis (Line Chart)

- **Type:** Line
- **X-axis:** Age
- **Y-axis:** Balance or Investment Earnings (per display toggle)
- **Series:**
  - "Base" (expected returns)
  - "+1%" (expected returns + 1%)
  - "−1%" (expected returns − 1%)
- **Updates:** Real-time on parameter change

---

## UI / UX Requirements

- **Layout:** Two-column on desktop (inputs left, charts right), single-column on mobile
- **Real-time updates:** Charts 2 and 3 recalculate immediately on any input change (debounce ~150ms)
- **Monte Carlo:** Triggered by a "Run Trials" button with a progress indicator (Web Worker posts progress back to main thread)
- **Number formatting:** Currency values in `$###,###` format; percentages as `##.#%`
- **Insolvency warning:** If the projection hits $0 before age 99, show a visible warning with the insolvency age
- **Responsive:** Works on mobile — charts resize, inputs stack vertically

---

## File Structure

```
index.html      — layout, controls, chart canvases
style.css       — responsive styling
calc.js         — all math (projectYear, deterministicRun, percentile, etc.)
worker.js       — Monte Carlo loop (runs in Web Worker)
charts.js       — Chart.js initialization and update functions
main.js         — wires inputs → calc → charts, handles Worker messaging
```

---

## Implementation Notes & Gotchas

1. **FV function:** Excel's `FV(rate, nper, pmt, pv, type)` with `type=1` (annuity due — payments at start of period). Replicate exactly using the formula above.

2. **Age arithmetic:** The projection starts at `ROUND(current_age, 0)` (integer), not at `current_age` exactly. First row uses `params.currentBalance` as opening balance.

3. **Salary at retirement:** Record the salary value at exactly `retireAt` age for use in the replacement ratio withdrawal cap. It doesn't update after retirement.

4. **Withdrawal floor:** Never withdraw more than the balance; never allow balance to go below 0.

5. **Scenario years:** Year 1 scenario (`nextYearScenario`) applies to the first simulated year (age = startAge in the first trial). First retirement year scenario applies to age = `retireAt`. For the deterministic scenarios (Charts 2 & 3), these special year scenarios are NOT applied — only the Monte Carlo uses them.

6. **`Who Knows?` scenario:** Draws from `NORM.INV(RAND(), 0, 1)` — a standard normal with mean 0. This means the expected return contribution is zero (pure noise), unlike other scenarios that scale the expected return.

7. **Progress reporting from Worker:** Post `{ type: 'progress', pct: i/trials * 100 }` every 50 trials so the UI can show a progress bar.

8. **Chart.js stacked bar:** Set `stack: 'stack0'` on all Monte Carlo series. The base layer (0 to p5) should have `backgroundColor: 'transparent'` and `borderWidth: 0` to create the "floating" band effect.

9. **`PERCENTILE.EXC` vs `PERCENTILE.INC`:** Excel uses `PERCENTILE.EXC` in the random sheet. Use the `(n+1)` formula above, not the standard `(n-1)` formula.

10. **Graph axis bounds:** Dynamically set Chart.js `min`/`max` on the x-axis to `graphMinAge`/`graphMaxAge` whenever those inputs change.
