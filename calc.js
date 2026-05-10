// calc.js — Core calculation engine for Personal Retirement Calculator
// All math replicates the Excel spreadsheet formulas exactly.

var MARKET = {
  stock: { expectedReturn: 0.062, stdDev: 0.1774 },   // IVV (S&P 500)
  bond:  { expectedReturn: 0.0426, stdDev: 0.0337 },   // AGG (US Agg Bond)
  correlation: -0.25,
};

var RISK_TABLE = {
  'High':       { base: 140, max: 90, min: 60 },
  'Med-High':   { base: 130, max: 85, min: 50 },
  'Medium':     { base: 120, max: 80, min: 40 },
  'Low-Medium': { base: 110, max: 75, min: 30 },
  'Low':        { base: 100, max: 70, min: 2 },
};

var SCENARIOS = {
  'Great!':      2.0,
  'Good':        1.5,
  'Average':     1.0,
  'Flat':        0.0,
  'Bad':        -1.0,
  'Horrible!':  -2.0,
  'Who Knows?':  null,
};

// ---------------------------------------------------------------------------
// Excel FV function replica
// type=1 → annuity due (payments at beginning of period)
// ---------------------------------------------------------------------------
function excelFV(rate, nper, pmt, pv, type) {
  pv = pv || 0;
  type = type || 0;
  if (rate === 0) return -(pv + pmt * nper);
  var factor = Math.pow(1 + rate, nper);
  return -(pv * factor + pmt * (1 + rate * type) * (factor - 1) / rate);
}

// ---------------------------------------------------------------------------
// Stock allocation fraction (0–1) from risk tolerance + age glide path
// Formula: clamp(base - age, min, max) / 100
// ---------------------------------------------------------------------------
function stockPct(riskTolerance, age) {
  var r = RISK_TABLE[riskTolerance];
  return Math.max(Math.min(r.base - age, r.max), r.min) / 100;
}

// ---------------------------------------------------------------------------
// Box-Muller normal random variate
// ---------------------------------------------------------------------------
function normalRandom(mean, stdDev) {
  var u = 1 - Math.random();   // (0, 1]
  var v = Math.random();        // [0, 1)
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// PERCENTILE.EXC — matches Excel's exclusive-interpolation percentile
// ---------------------------------------------------------------------------
function percentileExc(sorted, p) {
  var n = sorted.length;
  var pos = p * (n + 1) - 1;
  var lo = Math.floor(pos);
  var hi = Math.ceil(pos);
  if (lo < 0) return sorted[0];
  if (hi >= n) return sorted[n - 1];
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

// ---------------------------------------------------------------------------
// Deterministic blended return for a given age & offset (+1% / -1%)
// The override replaces the STOCK expected return (not the full blend).
// Bond expected return always stays at its market value.
// The +/-1% offset applies to stocks directly and to bonds scaled by correlation.
// ---------------------------------------------------------------------------
function deterministicReturn(params, age, offset) {
  var stockER = (params.expectedReturnOverride !== null)
    ? params.expectedReturnOverride
    : MARKET.stock.expectedReturn;
  var sp = stockPct(params.riskTolerance, age);
  var bp = 1 - sp;
  return (stockER + offset) * sp
       + (MARKET.bond.expectedReturn + offset * MARKET.correlation) * bp;
}

// ---------------------------------------------------------------------------
// Random return for a single asset in a single year (Monte Carlo)
// Scenario overrides apply to year 1 and the first retirement year.
// ---------------------------------------------------------------------------
function randomReturn(asset, age, params) {
  var info = MARKET[asset];
  var scenario = null;

  // First retirement year scenario (takes precedence if both coincide)
  if (age === params.retireAt && params.retireAt >= params.startAge) {
    scenario = params.retirementScenario;
  } else if (age === params.startAge) {
    scenario = params.nextYearScenario;
  }

  if (scenario === null || scenario === undefined) {
    return normalRandom(info.expectedReturn, info.stdDev);
  }

  var mult = SCENARIOS[scenario];
  if (mult === null) {
    // "Who Knows?" — treat as a regular random draw
    return normalRandom(info.expectedReturn, info.stdDev);
  }
  return info.expectedReturn * mult;
}

// ---------------------------------------------------------------------------
// Blended random return using asset allocation weights
// ---------------------------------------------------------------------------
function randomBlendedReturn(age, params) {
  var sp = stockPct(params.riskTolerance, age);
  var bp = 1 - sp;
  return randomReturn('stock', age, params) * sp
       + randomReturn('bond',  age, params) * bp;
}

// ---------------------------------------------------------------------------
// Run a full projection from startAge through age 99.
//
// returnFn(age) → blended return for that year.
//
// Returns an array of objects:
//   { age, balance, netSavings, netEarnings }
// where data[0] is the initial state (BOY at startAge = currentBalance)
// and each subsequent entry is the balance at the START of that age
// (i.e. the EOY of the previous year).
// ---------------------------------------------------------------------------
function runProjection(params, returnFn) {
  var startAge = params.startAge;
  var maxProjectionAge = 99;

  var salaryAtRetirement = params.pay
    * Math.pow(1 + params.salaryGrowth, Math.max(params.retireAt - startAge, 0));
  var replacementRatio = (params.replacementRatio !== null)
    ? params.replacementRatio
    : Math.min(0.80, 1 - params.savingsRate);
  var drawdownRate = (params.drawdown !== null) ? params.drawdown : 0.04;

  var data = [];
  var balance = params.currentBalance;
  var cumAdditionalSavings = 0;
  var cumWithdrawals = 0;
  var cumEarnings = 0;

  // Initial data point: BOY at startAge
  data.push({
    age: startAge,
    balance: balance,
    netSavings: params.currentBalance,
    netEarnings: 0,
  });

  for (var age = startAge; age <= maxProjectionAge; age++) {
    var isRetired = (age > params.retireAt);
    var salary = isRetired
      ? 0
      : params.pay * Math.pow(1 + params.salaryGrowth, age - startAge);
    var annualSavings = isRetired ? 0 : salary * params.savingsRate;
    var monthlySavings = annualSavings / 12;

    // Blended return for this year (deterministic or random, per caller)
    var blended = returnFn(age);
    if (blended <= -1) blended = -0.999; // guard against impossible losses

    // Growth on opening balance
    var growth = Math.max(balance, 0) * blended;

    // FV adjustment: extra growth from monthly (vs. lump-sum) contributions
    var fvAdj = 0;
    if (annualSavings > 0) {
      var monthlyRate = Math.pow(1 + blended, 1 / 12) - 1;
      fvAdj = excelFV(monthlyRate, 12, -monthlySavings, 0, 1) - annualSavings;
    }

    // Withdrawal in retirement
    var withdrawal = 0;
    if (isRetired && balance > 0) {
      withdrawal = -Math.min(
        drawdownRate * balance,
        salaryAtRetirement * replacementRatio
      );
    }

    balance = balance + growth + annualSavings + fvAdj + withdrawal;
    if (balance < 0) balance = 0;

    cumAdditionalSavings += annualSavings;
    cumWithdrawals += withdrawal;
    cumEarnings += (growth + fvAdj);

    // Decomposition: Net Savings + Net Earnings = Balance
    var rawNetSavings = params.currentBalance + cumAdditionalSavings + cumWithdrawals;
    var netSavings = Math.max(rawNetSavings, 0);
    var netEarnings = balance - netSavings;

    data.push({
      age: age + 1,
      balance: balance,
      netSavings: netSavings,
      netEarnings: Math.max(netEarnings, 0),
    });
  }

  return data;
}

// ---------------------------------------------------------------------------
// Pre-generated random returns for the single stochastic realization (Chart 2).
// Generated once on load, regenerated when "Run Trials" is clicked.
// Uses the ORIGINAL market distributions (NOT the expected return override).
// ---------------------------------------------------------------------------
var pregenStock = [];
var pregenBond = [];

function regenerateRandomReturns() {
  for (var age = 0; age <= 120; age++) {
    pregenStock[age] = normalRandom(MARKET.stock.expectedReturn, MARKET.stock.stdDev);
    pregenBond[age] = normalRandom(MARKET.bond.expectedReturn, MARKET.bond.stdDev);
  }
}

// Run a single stochastic projection using the pre-generated random returns.
// Scenario overrides are applied at the appropriate ages.
function runStochasticProjection(params) {
  return runProjection(params, function (age) {
    var sp = stockPct(params.riskTolerance, age);
    var bp = 1 - sp;

    var sr = pregenStock[age];
    var br = pregenBond[age];

    // Apply scenario overrides for special years
    var scenario = null;
    if (age === params.retireAt && params.retireAt >= params.startAge) {
      scenario = params.retirementScenario;
    } else if (age === params.startAge) {
      scenario = params.nextYearScenario;
    }

    if (scenario) {
      var mult = SCENARIOS[scenario];
      if (mult !== null) {
        sr = MARKET.stock.expectedReturn * mult;
        br = MARKET.bond.expectedReturn * mult;
      }
      // "Who Knows?" (null) keeps the pre-generated random draw
    }

    return sr * sp + br * bp;
  });
}

// ---------------------------------------------------------------------------
// Convenience: deterministic projection with a return offset
// ---------------------------------------------------------------------------
function runDeterministicProjection(params, offset) {
  return runProjection(params, function (age) {
    return deterministicReturn(params, age, offset);
  });
}

// ---------------------------------------------------------------------------
// Compute all deterministic data needed by Charts 2 & 3
// ---------------------------------------------------------------------------
function computeAllDeterministic(params) {
  return {
    base:   runDeterministicProjection(params, 0),
    plus1:  runDeterministicProjection(params, 0.01),
    minus1: runDeterministicProjection(params, -0.01),
  };
}

// ---------------------------------------------------------------------------
// Find the first age where the portfolio balance drops to zero
// ---------------------------------------------------------------------------
function findInsolvencyAge(projection) {
  for (var i = 1; i < projection.length; i++) {
    if (projection[i].balance <= 0 && projection[i - 1].balance > 0) {
      return projection[i].age;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build a params object (shared shape used by all functions)
// ---------------------------------------------------------------------------
function buildParams(opts) {
  var today = new Date();
  var dob = new Date(opts.dob);
  var diffMs = today - dob;
  var currentAge = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  var startAge = Math.round(currentAge);

  return {
    currentAge: currentAge,
    startAge: startAge,
    pay: opts.pay,
    currentBalance: opts.currentBalance,
    riskTolerance: opts.riskTolerance,
    salaryGrowth: opts.salaryGrowth,
    savingsRate: opts.savingsRate,
    retireAt: opts.retireAt,
    drawdown: opts.drawdown,               // null → default 4%
    replacementRatio: opts.replacementRatio, // null → default min(80%, 1-savingsRate)
    expectedReturnOverride: opts.expectedReturnOverride, // null → use allocation blend
    nextYearScenario: opts.nextYearScenario,
    retirementScenario: opts.retirementScenario,
    graphMaxAge: opts.graphMaxAge,
    displayMode: opts.displayMode,          // "Balance" | "Investment Earnings"
    trials: opts.trials,
  };
}
