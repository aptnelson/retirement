// worker.js — Monte Carlo simulation (runs in a Web Worker)
importScripts('calc.js');

self.onmessage = function (e) {
  var params = e.data.params;
  var trials = e.data.trials;
  var startAge = params.startAge;
  var maxAge = 99;
  var numYears = maxAge - startAge + 1;   // years to simulate
  var numPoints = numYears + 1;            // data points (includes starting balance)

  // Pre-compute retirement parameters once
  var salaryAtRetirement = params.pay
    * Math.pow(1 + params.salaryGrowth, Math.max(params.retireAt - startAge, 0));
  var replacementRatio = (params.replacementRatio !== null)
    ? params.replacementRatio
    : Math.min(0.80, 1 - params.savingsRate);
  var drawdownRate = (params.drawdown !== null) ? params.drawdown : 0.04;

  // results[ageIndex] = Float64Array of length `trials`
  var results = [];
  for (var i = 0; i < numPoints; i++) {
    results.push(new Float64Array(trials));
  }

  // ---------- Run trials ----------
  for (var t = 0; t < trials; t++) {
    var balance = params.currentBalance;
    results[0][t] = balance;

    for (var y = 0; y < numYears; y++) {
      var age = startAge + y;
      var isRetired = (age > params.retireAt);
      var salary = isRetired
        ? 0
        : params.pay * Math.pow(1 + params.salaryGrowth, age - startAge);
      var annualSavings = isRetired ? 0 : salary * params.savingsRate;
      var monthlySavings = annualSavings / 12;

      var blended = randomBlendedReturn(age, params);
      if (blended <= -1) blended = -0.999;

      var growth = Math.max(balance, 0) * blended;

      var fvAdj = 0;
      if (annualSavings > 0) {
        var monthlyRate = Math.pow(1 + blended, 1 / 12) - 1;
        fvAdj = excelFV(monthlyRate, 12, -monthlySavings, 0, 1) - annualSavings;
      }

      var withdrawal = 0;
      if (isRetired && balance > 0) {
        withdrawal = -Math.min(
          drawdownRate * balance,
          salaryAtRetirement * replacementRatio
        );
      }

      balance = balance + growth + annualSavings + fvAdj + withdrawal;
      if (balance < 0) balance = 0;

      results[y + 1][t] = balance;
    }

    // Progress every 50 trials
    if ((t + 1) % 50 === 0 || t === trials - 1) {
      self.postMessage({ type: 'progress', pct: ((t + 1) / trials) * 100 });
    }
  }

  // ---------- Compute percentile bands ----------
  var ages = [];
  var bands = [];

  for (var idx = 0; idx < numPoints; idx++) {
    ages.push(startAge + idx);

    var sorted = Array.from(results[idx]).sort(function (a, b) { return a - b; });

    var p5  = percentileExc(sorted, 0.05);
    var p25 = percentileExc(sorted, 0.25);
    var p50 = percentileExc(sorted, 0.50);
    var p75 = percentileExc(sorted, 0.75);
    var p95 = percentileExc(sorted, 0.95);

    bands.push({
      age:   startAge + idx,
      p5:    p5,
      p25:   p25,
      p50:   p50,
      p75:   p75,
      p95:   p95,
      band0: p5,
      band1: p25 - p5,
      band2: p50 - p25,
      band3: p75 - p50,
      band4: p95 - p75,
    });
  }

  self.postMessage({ type: 'done', ages: ages, bands: bands });
};
