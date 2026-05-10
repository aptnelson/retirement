// charts.js — Chart.js initialization and update helpers
// Requires Chart.js v4 loaded globally.

var Charts = (function () {

  // ---------- Formatting helpers ----------
  function fmtCurrency(val) {
    if (val >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M';
    if (val >= 1e3) return '$' + (val / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(val);
  }

  var currencyTick = function (value) { return fmtCurrency(value); };

  function tooltipLabel(ctx) {
    return ctx.dataset.label + ': ' + fmtCurrency(ctx.parsed.y);
  }

  // ---------- Shared defaults ----------
  Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#64748b';
  Chart.defaults.plugins.tooltip.callbacks = Chart.defaults.plugins.tooltip.callbacks || {};

  // ---------- Color palette ----------
  var blue = '#2563eb';
  function blueA(a) { return 'rgba(37,99,235,' + a + ')'; }
  var green  = '#10b981';
  var purple = '#8b5cf6';
  var red    = '#ef4444';
  var greenA = 'rgba(16,185,129,0.35)';
  var purpleA = 'rgba(139,92,246,0.35)';

  // ======================================================================
  // Chart 1 — Monte Carlo Fan Chart (stacked bar)
  // ======================================================================
  var mcChart = null;

  function initMonteCarloChart(ctx) {
    mcChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          { label: '_base',      data: [], backgroundColor: 'transparent', borderWidth: 0, stack: 'mc', skipNull: true },
          { label: '5th – 25th', data: [], backgroundColor: blueA(0.18), borderWidth: 0, stack: 'mc', borderRadius: 0 },
          { label: '25th – 50th',data: [], backgroundColor: blueA(0.32), borderWidth: 0, stack: 'mc', borderRadius: 0 },
          { label: '50th – 75th',data: [], backgroundColor: blueA(0.50), borderWidth: 0, stack: 'mc', borderRadius: 0 },
          { label: '75th – 95th',data: [], backgroundColor: blueA(0.72), borderWidth: 0, stack: 'mc', borderRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: { stacked: true, grid: { display: false }, title: { display: true, text: 'Age' } },
          y: { stacked: true, ticks: { callback: currencyTick }, title: { display: true, text: 'Portfolio Balance' } },
        },
        plugins: {
          legend: {
            labels: { filter: function (item) { return item.text !== '_base'; } },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                if (ctx.dataset.label === '_base') return null;
                return tooltipLabel(ctx);
              },
            },
          },
        },
      },
    });
  }

  function updateMonteCarloChart(bands, minAge, maxAge) {
    if (!mcChart) return;
    var filtered = bands.filter(function (b) { return b.age >= minAge && b.age <= maxAge; });

    mcChart.data.labels = filtered.map(function (b) { return b.age; });
    mcChart.data.datasets[0].data = filtered.map(function (b) { return b.band0; });
    mcChart.data.datasets[1].data = filtered.map(function (b) { return b.band1; });
    mcChart.data.datasets[2].data = filtered.map(function (b) { return b.band2; });
    mcChart.data.datasets[3].data = filtered.map(function (b) { return b.band3; });
    mcChart.data.datasets[4].data = filtered.map(function (b) { return b.band4; });
    mcChart.update();
  }

  // ======================================================================
  // Chart 2 — Balance Decomposition (overlapping areas, matches Excel)
  // Three independent series: Balance (green fill), Net Savings (orange
  // line), Net Earnings (blue fill). NOT stacked — they overlap.
  // ======================================================================
  var decompChart = null;

  function initDecompChart(ctx) {
    decompChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Balance',
            data: [],
            fill: true,
            backgroundColor: 'rgba(16,185,129,0.25)',
            borderColor: green,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            order: 3,
          },
          {
            label: 'Net Savings',
            data: [],
            fill: false,
            borderColor: '#f97316',
            borderWidth: 2.5,
            pointRadius: 0,
            tension: 0,
            order: 1,
          },
          {
            label: 'Net Earnings',
            data: [],
            fill: true,
            backgroundColor: 'rgba(37,99,235,0.25)',
            borderColor: blue,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            order: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Age' } },
          y: {
            ticks: { callback: currencyTick },
            title: { display: true, text: 'Portfolio Balance' },
          },
        },
        plugins: {
          tooltip: { callbacks: { label: tooltipLabel } },
        },
      },
    });
  }

  function updateDecompChart(projection, minAge, maxAge) {
    if (!decompChart) return;
    var filtered = projection.filter(function (d) { return d.age >= minAge && d.age <= maxAge; });

    decompChart.data.labels = filtered.map(function (d) { return d.age; });
    decompChart.data.datasets[0].data = filtered.map(function (d) { return d.balance; });
    decompChart.data.datasets[1].data = filtered.map(function (d) { return d.netSavings; });
    decompChart.data.datasets[2].data = filtered.map(function (d) { return d.netEarnings; });
    decompChart.update();
  }

  // ======================================================================
  // Chart 3 — Sensitivity Analysis (line chart)
  // ======================================================================
  var sensitivityChart = null;

  function initSensitivityChart(ctx) {
    sensitivityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Base',  data: [], borderColor: blue,  backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.25 },
          { label: '+1%',   data: [], borderColor: green, backgroundColor: 'transparent', borderWidth: 2,   pointRadius: 0, tension: 0.25, borderDash: [6, 3] },
          { label: '\u22121%', data: [], borderColor: red,   backgroundColor: 'transparent', borderWidth: 2,   pointRadius: 0, tension: 0.25, borderDash: [6, 3] },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: { grid: { display: false }, title: { display: true, text: 'Age' } },
          y: { ticks: { callback: currencyTick }, title: { display: true, text: '' } },
        },
        plugins: {
          tooltip: { callbacks: { label: tooltipLabel } },
        },
      },
    });
  }

  function updateSensitivityChart(det, minAge, maxAge, displayMode) {
    if (!sensitivityChart) return;
    var field = (displayMode === 'Investment Earnings') ? 'netEarnings' : 'balance';

    var fBase   = det.base.filter(function (d)   { return d.age >= minAge && d.age <= maxAge; });
    var fPlus1  = det.plus1.filter(function (d)  { return d.age >= minAge && d.age <= maxAge; });
    var fMinus1 = det.minus1.filter(function (d) { return d.age >= minAge && d.age <= maxAge; });

    sensitivityChart.data.labels = fBase.map(function (d) { return d.age; });
    sensitivityChart.data.datasets[0].data = fBase.map(function (d)   { return d[field]; });
    sensitivityChart.data.datasets[1].data = fPlus1.map(function (d)  { return d[field]; });
    sensitivityChart.data.datasets[2].data = fMinus1.map(function (d) { return d[field]; });
    sensitivityChart.options.scales.y.title.text =
      (displayMode === 'Investment Earnings') ? 'Investment Earnings' : 'Portfolio Balance';
    sensitivityChart.update();
  }

  // ---------- Public API ----------
  return {
    initMonteCarloChart: initMonteCarloChart,
    updateMonteCarloChart: updateMonteCarloChart,
    initDecompChart: initDecompChart,
    updateDecompChart: updateDecompChart,
    initSensitivityChart: initSensitivityChart,
    updateSensitivityChart: updateSensitivityChart,
  };

})();
