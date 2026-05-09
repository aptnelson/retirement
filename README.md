# RetireWise — Personal Retirement Calculator

A clean, interactive retirement planning website that translates the Excel-based retirement calculator into a modern web application.

## Features

- **Personalized Inputs** — Age, salary, current balance, savings rate, retirement age, Social Security timing, drawdown rate, and more
- **Smart Asset Allocation** — Automatically suggests stock/bond allocation based on age and risk tolerance (replicates the Excel logic)
- **3 Interactive Charts**
  - **Account Growth** — Balance from today through retirement and beyond
  - **Contributions vs Growth** — Shows the power of compounding over time
  - **Outcome Range** — Optimistic, expected, and conservative projections
- **Social Security Estimate** — Rough SS benefit based on salary history
- **Summary Cards** — Key metrics at a glance

## Files

```
├── index.html    — Main page structure
├── style.css     — Styling (editorial / refined aesthetic)
├── script.js     — Calculator logic + Chart.js charts
└── README.md     — This file
```

## How to Run

Simply open `index.html` in a browser — no build step required. The site uses [Chart.js](https://chartjs.org) via CDN.

## GitHub Pages

To publish on GitHub Pages:
1. Push these files to a GitHub repository
2. Go to Settings → Pages
3. Set source to `main` branch, root directory
4. Your site will be live at `https://yourusername.github.io/repo-name`

## Inputs Mirror (from Excel)

| Input | Excel Cell | Notes |
|-------|-----------|-------|
| Date of Birth | DOB | Calculates current age |
| Salary | Pay | Current annual income |
| Current Balance | Current Balance | Starting account value |
| Salary Growth | Salary Growth | Annual % increase |
| Savings Rate | Savings Rate | % of salary saved |
| Retire at Age | Retire at Age | Target retirement age |
| Social Security Age | Start SS at Age | When to claim benefits |
| Drawdown Rate | Retirement Drawdown | Annual % withdrawal |
| Replacement Ratio | Replacement Ratio | % of income needed in retirement |
| Risk Tolerance | Risk Tolerance | Drives stock/bond allocation |

## Disclaimer

For illustrative purposes only. Not financial advice.
