// main.js — Wires DOM inputs to the calculation engine and charts

(function () {

  // ---------- DOM refs ----------
  var $ = function (id) { return document.getElementById(id); };

  var elDob              = $('dob');
  var elPay              = $('pay');
  var elBalance          = $('balance');
  var elRisk             = $('risk');
  var elSalaryGrowth     = $('salaryGrowth');
  var elSavingsRate      = $('savingsRate');
  var elRetireAt         = $('retireAt');
  var elDrawdown         = $('drawdown');
  var elReplacement      = $('replacement');
  var elExpectedReturn   = $('expectedReturn');
  var elNextYear         = $('nextYear');
  var elRetirementYear   = $('retirementYear');
  var elGraphMax         = $('graphMax');
  var elDisplayMode      = $('displayMode');
  var elTrials           = $('trials');
  var elRunBtn           = $('runTrials');
  var elProgress         = $('progressBar');
  var elProgressWrap     = $('progressWrap');
  var elCurrentAge       = $('currentAge');
  var elRetireBalance    = $('retireBalance');
  var elInsolvencyWarn   = $('insolvencyWarn');
  var elInsolvencyAge    = $('insolvencyAge');
  var elMonthlyIncome    = $('monthlyIncome');

  // ---------- Read inputs into params object ----------
  function readParams() {
    var drawdownVal = elDrawdown.value.trim();
    var replacementVal = elReplacement.value.trim();
    var expectedVal = elExpectedReturn.value.trim();

    return buildParams({
      dob: elDob.value,
      pay: parseFloat(elPay.value) || 0,
      currentBalance: parseFloat(elBalance.value) || 0,
      riskTolerance: elRisk.value,
      salaryGrowth: (parseFloat(elSalaryGrowth.value) || 0) / 100,
      savingsRate: (parseFloat(elSavingsRate.value) || 0) / 100,
      retireAt: parseInt(elRetireAt.value, 10) || 65,
      drawdown: drawdownVal !== '' ? parseFloat(drawdownVal) / 100 : null,
      replacementRatio: replacementVal !== '' ? parseFloat(replacementVal) / 100 : null,
      expectedReturnOverride: expectedVal !== '' ? parseFloat(expectedVal) / 100 : null,
      nextYearScenario: elNextYear.value,
      retirementScenario: elRetirementYear.value,
      graphMaxAge: parseInt(elGraphMax.value, 10) || 75,
      displayMode: elDisplayMode.value,
      trials: parseInt(elTrials.value, 10) || 1000,
    });
  }

  // ---------- Format helpers ----------
  function fmtUSD(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // ---------- Update charts & stats ----------
  function refresh() {
    var params = readParams();

    // Update current-age display
    elCurrentAge.textContent = params.currentAge.toFixed(1);

    // Update placeholder on replacement ratio
    var defaultRR = Math.min(80, Math.round((1 - params.savingsRate) * 100));
    elReplacement.placeholder = defaultRR;

    // Update placeholder on expected return showing computed blend
    if (params.expectedReturnOverride === null) {
      var blend = deterministicReturn(params, params.startAge, 0) * 100;
      elExpectedReturn.placeholder = blend.toFixed(1);
    }

    // Deterministic projections (Chart 3: sensitivity)
    var det = computeAllDeterministic(params);
    // Stochastic projection (Chart 2: decomposition) — uses pre-generated random returns
    var stochastic = runStochasticProjection(params);

    var minAge = params.startAge;
    var maxAge = params.graphMaxAge;

    // Summary stats (from deterministic base)
    var retireIdx = -1;
    for (var i = 0; i < det.base.length; i++) {
      if (det.base[i].age === params.retireAt + 1) { retireIdx = i; break; }
    }
    if (retireIdx >= 0) {
      elRetireBalance.textContent = fmtUSD(det.base[retireIdx].balance);
      var drawdownRate = (params.drawdown !== null) ? params.drawdown : 0.04;
      var monthlyIncome = (det.base[retireIdx].balance * drawdownRate) / 12;
      elMonthlyIncome.textContent = fmtUSD(monthlyIncome);
    } else {
      elRetireBalance.textContent = '—';
      elMonthlyIncome.textContent = '—';
    }

    var insolvAge = findInsolvencyAge(det.base);
    if (insolvAge !== null && insolvAge <= 99) {
      elInsolvencyWarn.classList.remove('hidden');
      elInsolvencyAge.textContent = insolvAge;
    } else {
      elInsolvencyWarn.classList.add('hidden');
    }

    // Chart 2: stochastic decomposition (jagged, matches Excel)
    Charts.updateDecompChart(stochastic, minAge, maxAge);
    // Chart 3: deterministic sensitivity (smooth)
    Charts.updateSensitivityChart(det, minAge, maxAge, params.displayMode);
  }

  // ---------- Debounce ----------
  var debounceTimer = null;
  function debouncedRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 120);
  }

  // ---------- Bind all inputs ----------
  var inputs = document.querySelectorAll('.controls input, .controls select');
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener('input', debouncedRefresh);
    inputs[i].addEventListener('change', debouncedRefresh);
  }

  // ---------- Monte Carlo (Web Worker) ----------
  var worker = null;
  var lastMCBands = null;

  function runMonteCarlo() {
    // Regenerate the single stochastic realization used by Chart 2
    regenerateRandomReturns();
    refresh();

    var params = readParams();
    elRunBtn.disabled = true;
    elRunBtn.textContent = 'Running\u2026';
    elProgressWrap.classList.remove('hidden');
    elProgress.style.width = '0%';

    if (worker) worker.terminate();
    worker = new Worker('worker.js');

    worker.onmessage = function (e) {
      if (e.data.type === 'progress') {
        elProgress.style.width = e.data.pct.toFixed(0) + '%';
      } else if (e.data.type === 'done') {
        lastMCBands = e.data.bands;
        var minAge = params.startAge;
        var maxAge = params.graphMaxAge;
        Charts.updateMonteCarloChart(lastMCBands, minAge, maxAge);
        elRunBtn.disabled = false;
        elRunBtn.textContent = 'Run Trials';
        setTimeout(function () { elProgressWrap.classList.add('hidden'); }, 600);
      }
    };

    worker.onerror = function (err) {
      console.error('Worker error:', err);
      elRunBtn.disabled = false;
      elRunBtn.textContent = 'Run Trials';
      elProgressWrap.classList.add('hidden');
    };

    worker.postMessage({ params: params, trials: params.trials });
  }

  elRunBtn.addEventListener('click', runMonteCarlo);

  // When graphMaxAge or displayMode changes, also re-filter MC chart if data exists
  elGraphMax.addEventListener('change', function () {
    if (lastMCBands) {
      var params = readParams();
      Charts.updateMonteCarloChart(lastMCBands, params.startAge, params.graphMaxAge);
    }
  });

  // ---------- Initialize ----------
  regenerateRandomReturns(); // generate initial stochastic returns for Chart 2

  Charts.initMonteCarloChart($('mcCanvas').getContext('2d'));
  Charts.initDecompChart($('decompCanvas').getContext('2d'));
  Charts.initSensitivityChart($('sensCanvas').getContext('2d'));

  // Initial render
  refresh();

})();
