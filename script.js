/* ================================================================
   RetireWise — script.js
   Mirrors the logic from the Excel file (inputs → calcs → random sheets)
   ================================================================ */

// ── Allocation table (from calcs sheet) ──────────────────────────
const ALLOCATION_TABLE = {
  'High':      { formula: (age) => Math.min(0.90, Math.max(0.60, (140 - age) / 100)) },
  'Med-High':  { formula: (age) => Math.min(0.85, Math.max(0.50, (130 - age) / 100)) },
  'Medium':    { formula: (age) => Math.min(0.80, Math.max(0.40, (120 - age) / 100)) },
  'Low-Medium':{ formula: (age) => Math.min(0.75, Math.max(0.30, (110 - age) / 100)) },
  'Low':       { formula: (age) => Math.min(0.70, Math.max(0.20, (100 - age) / 100)) },
};

// ETF volatilities (from calcs sheet — IVV/AGG annualised σ)
const IVV_VOL = 0.177;  // approx std dev
const AGG_VOL = 0.034;

// Social security rough estimate
function estimateSS(salary, retireAge, ssAge) {
  const aime = Math.min(salary, 168600) / 12;
  const bp1 = 1174, bp2 = 7078;
  let pia = 0;
  if (aime <= bp1)       pia = aime * 0.90;
  else if (aime <= bp2)  pia = bp1 * 0.90 + (aime - bp1) * 0.32;
  else                   pia = bp1 * 0.90 + (bp2 - bp1) * 0.32 + (aime - bp2) * 0.15;

  const nra = 67;
  let adj = 1;
  if (ssAge < nra)       adj = 1 - 0.00556 * (nra - ssAge) * 12;
  else if (ssAge > nra)  adj = 1 + 0.008  * (ssAge - nra) * 12;

  return Math.max(0, pia * adj * 12);
}

// ── Monte Carlo helpers ───────────────────────────────────────────
function boxMuller() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Main calculation ─────────────────────────────────────────────
function getInputs() {
  const dob = new Date(document.getElementById('dob').value);
  const today = new Date();
  const age = (today - dob) / (365.25 * 24 * 3600 * 1000);
  return {
    age,
    salary:       +document.getElementById('salary').value,
    balance:      +document.getElementById('balance').value,
    salaryGrowth: +document.getElementById('salary-growth').value / 100,
    savingsRate:  +document.getElementById('savings-rate').value  / 100,
    retireAge:    +document.getElementById('retire-age').value,
    ssAge:        +document.getElementById('ss-age').value,
    drawdown:     +document.getElementById('drawdown').value / 100,
    replacement:  +document.getElementById('replacement').value  / 100,
    risk:          document.getElementById('risk').value,
    expectedReturn: +document.getElementById('expected-return').value / 100,
  };
}

function runProjection(inp, returnOverride) {
  const { age, salary, balance, salaryGrowth, savingsRate,
          retireAge, ssAge, drawdown, replacement, risk, expectedReturn } = inp;

  const r = returnOverride !== undefined ? returnOverride : expectedReturn;

  const rows = [];
  let curBalance = balance;
  let curSalary  = salary;
  let totalContrib = balance;   // seed = initial balance
  let totalEarnings = 0;

  const maxAge = 120;

  for (let a = Math.floor(age); a <= maxAge; a++) {
    const isRetired = a >= retireAge;
    const allocFn = ALLOCATION_TABLE[risk]?.formula || ALLOCATION_TABLE['Medium'].formula;
    const stockPct = allocFn(a);
    const bondPct  = 1 - stockPct;
    const blendReturn = stockPct * (r + 0.01) + bondPct * (r - 0.01);

    let withdrawal = 0;
    let savings    = 0;

    if (!isRetired) {
      savings = curSalary * savingsRate;
      curSalary *= (1 + salaryGrowth);
    } else {
      // drawdown-based withdrawal
      withdrawal = curBalance * drawdown;
    }

    const invGrowth = curBalance * blendReturn;
    totalEarnings += Math.max(0, invGrowth);

    const prev = curBalance;
    curBalance = curBalance + invGrowth + savings - withdrawal;
    if (curBalance <= 0) {
      rows.push({ age: a, balance: 0, contrib: totalContrib, earnings: totalEarnings, isRetired, insolvent: true });
      break;
    }

    if (!isRetired) totalContrib += savings;

    rows.push({ age: a, balance: curBalance, contrib: totalContrib, earnings: totalEarnings, isRetired });
  }
  return rows;
}

function runOptPess(inp) {
  const { age, salary, balance, salaryGrowth, savingsRate,
          retireAge, ssAge, drawdown, risk, expectedReturn } = inp;

  const base  = runProjection(inp, expectedReturn);
  const opt   = runProjection(inp, expectedReturn + 0.02);
  const pess  = runProjection(inp, expectedReturn - 0.02);
  return { base, opt, pess };
}

// ── Chart instances ──────────────────────────────────────────────
let growthChartInst, contribChartInst, rangeChartInst, donutInst;

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: {
        font: { family: "'DM Mono', monospace", size: 11 },
        color: '#5a5a6e',
        usePointStyle: true,
        pointStyleWidth: 10,
      }
    },
    tooltip: {
      backgroundColor: '#0e0e12',
      titleFont: { family: "'DM Mono', monospace", size: 11 },
      bodyFont:  { family: "'DM Mono', monospace", size: 11 },
      padding: 12,
      callbacks: {
        label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
      }
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: { font: { family: "'DM Mono', monospace", size: 10 }, color: '#5a5a6e', maxTicksLimit: 12 }
    },
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { family: "'DM Mono', monospace", size: 10 }, color: '#5a5a6e',
        callback: v => fmtShort(v)
      }
    }
  }
};

function fmt(n)      { return '$' + Math.round(n).toLocaleString(); }
function fmtShort(n) {
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
}

function makeRetireLine(rows, retireAge) {
  const idx = rows.findIndex(r => r.age >= retireAge);
  if (idx < 0) return null;
  return {
    type: 'line',
    xMin: idx, xMax: idx,
    borderColor: 'rgba(201,168,76,0.5)',
    borderWidth: 2,
    borderDash: [6, 3],
    label: {
      content: `Retire ${retireAge}`,
      enabled: true,
      position: 'start',
      color: '#c9a84c',
      font: { family: "'DM Mono', monospace", size: 10 },
      backgroundColor: 'transparent',
      yAdjust: -12,
    }
  };
}

function buildGrowthChart(rows, retireAge) {
  const labels = rows.map(r => r.age.toString());
  const data   = rows.map(r => r.balance);

  const ctx = document.getElementById('growthChart').getContext('2d');
  if (growthChartInst) growthChartInst.destroy();

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, 380);
  grad.addColorStop(0, 'rgba(26,58,107,0.18)');
  grad.addColorStop(1, 'rgba(26,58,107,0)');

  growthChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Account Balance',
        data,
        borderColor: '#1a3a6b',
        backgroundColor: grad,
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#1a3a6b',
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: {
          annotations: {
            retireLine: makeRetireLine(rows, retireAge)
          }
        }
      }
    }
  });
}

function buildContribChart(rows) {
  const labels  = rows.map(r => r.age.toString());
  const contrib = rows.map(r => r.contrib);
  const growth  = rows.map(r => Math.max(0, r.balance - r.contrib));

  const ctx = document.getElementById('contribChart').getContext('2d');
  if (contribChartInst) contribChartInst.destroy();

  contribChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Contributions',
          data: contrib,
          backgroundColor: 'rgba(201,168,76,0.75)',
          borderRadius: 2,
          stack: 'a',
        },
        {
          label: 'Investment Growth',
          data: growth,
          backgroundColor: 'rgba(26,58,107,0.75)',
          borderRadius: 2,
          stack: 'a',
        }
      ]
    },
    options: { ...CHART_DEFAULTS }
  });
}

function buildRangeChart(base, opt, pess, retireAge) {
  const labels = base.map(r => r.age.toString());

  const ctx = document.getElementById('rangeChart').getContext('2d');
  if (rangeChartInst) rangeChartInst.destroy();

  // Align opt/pess to base length
  const len = base.length;
  const optData  = opt.slice(0, len).map((r, i) => r?.balance ?? 0);
  const pessData = pess.slice(0, len).map((r, i) => r?.balance ?? 0);
  const baseData = base.map(r => r.balance);

  rangeChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Optimistic (+2%)',
          data: optData,
          borderColor: '#2d7a3a',
          backgroundColor: 'rgba(45,122,58,0.06)',
          borderWidth: 2,
          fill: false,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: 'Expected',
          data: baseData,
          borderColor: '#1a3a6b',
          backgroundColor: 'rgba(26,58,107,0.08)',
          borderWidth: 2.5,
          fill: false,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: 'Conservative (−2%)',
          data: pessData,
          borderColor: '#c9a84c',
          backgroundColor: 'rgba(201,168,76,0.06)',
          borderWidth: 2,
          fill: false,
          tension: 0.35,
          pointRadius: 0,
        }
      ]
    },
    options: { ...CHART_DEFAULTS }
  });
}

function buildDonut(stockPct, bondPct) {
  const ctx = document.getElementById('donutChart').getContext('2d');
  if (donutInst) donutInst.destroy();

  donutInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Stocks (IVV)', 'Bonds (AGG)'],
      datasets: [{
        data: [Math.round(stockPct * 100), Math.round(bondPct * 100)],
        backgroundColor: ['#1a3a6b', '#c9a84c'],
        borderWidth: 0,
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e0e12',
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}%` }
        }
      }
    }
  });
}

// ── Main calculate() ─────────────────────────────────────────────
function calculate() {
  const inp = getInputs();
  const { base, opt, pess } = runOptPess(inp);

  // Current allocation
  const allocFn  = ALLOCATION_TABLE[inp.risk]?.formula || ALLOCATION_TABLE['Medium'].formula;
  const stockPct = allocFn(inp.age);
  const bondPct  = 1 - stockPct;

  const blendReturn = stockPct * (inp.expectedReturn + 0.01) + bondPct * (inp.expectedReturn - 0.01);
  const optReturn   = blendReturn + 0.02;
  const pessReturn  = blendReturn - 0.02;

  // Retirement row
  const retireRow = base.find(r => r.age >= inp.retireAge) || base[base.length - 1];
  const retireBal = retireRow.balance;
  const monthlyW  = retireBal * inp.drawdown / 12;
  const yearsToRetire = Math.max(0, inp.retireAge - inp.age);

  // Social security
  const ssAnnual  = estimateSS(inp.salary, inp.retireAge, inp.ssAge);
  const ssMonthly = ssAnnual / 12;

  const retireSalary = inp.salary * Math.pow(1 + inp.salaryGrowth, yearsToRetire);
  const incomeNeeded = retireSalary * inp.replacement;

  // Hero stats
  document.getElementById('hero-balance').textContent  = fmtShort(retireBal);
  document.getElementById('hero-monthly').textContent  = fmtShort(monthlyW);
  document.getElementById('hero-years').textContent    = Math.round(yearsToRetire) + ' yrs';

  // Allocation panel
  const sp = Math.round(stockPct * 100);
  const bp = Math.round(bondPct * 100);
  document.getElementById('stocks-pct').textContent        = sp + '%';
  document.getElementById('bonds-pct').textContent         = bp + '%';
  document.getElementById('stocks-pct-center').textContent = sp + '%';
  document.getElementById('blended-return').textContent    = (blendReturn * 100).toFixed(2) + '%';
  document.getElementById('opt-return').textContent        = (optReturn   * 100).toFixed(2) + '%';
  document.getElementById('pess-return').textContent       = (pessReturn  * 100).toFixed(2) + '%';
  document.getElementById('alloc-rationale').innerHTML =
    `Based on your age (${Math.floor(inp.age)}) and <strong>${inp.risk}</strong> risk tolerance, your equity allocation is ${sp}% stocks / ${bp}% bonds. This rebalances automatically as you approach retirement at age ${inp.retireAge}.`;

  // Summary cards
  document.getElementById('sum-retire-bal').textContent = fmt(retireBal);
  document.getElementById('sum-monthly').textContent    = fmt(monthlyW) + '/mo';
  document.getElementById('sum-contrib').textContent    = fmt(retireRow.contrib);
  document.getElementById('sum-growth').textContent     = fmt(Math.max(0, retireBal - retireRow.contrib));
  document.getElementById('sum-ss').textContent         = fmt(ssMonthly) + '/mo';
  document.getElementById('sum-income').textContent     = fmt(incomeNeeded / 12) + '/mo needed';

  // Retirement marker
  document.getElementById('rm-age').textContent = inp.retireAge;

  // Charts
  buildDonut(stockPct, bondPct);
  buildGrowthChart(base, inp.retireAge);
  buildContribChart(base);
  buildRangeChart(base, opt, pess, inp.retireAge);

  // Scroll to projections if first calc
  if (!window._calcDone) {
    setTimeout(() => document.getElementById('allocation').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    window._calcDone = true;
  }
}

// ── Tab switching ────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.chart-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Auto-calculate on load ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  calculate();
});

// ── Re-calculate on Enter in any input ──────────────────────────
document.querySelectorAll('input, select').forEach(el => {
  el.addEventListener('change', calculate);
});
