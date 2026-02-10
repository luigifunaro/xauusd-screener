# XAUUSD Multi-Timeframe Screener

Captures TradingView chart screenshots for XAUUSD across multiple timeframes (15M, 1H, 4H, Daily, Weekly).

## Installation

```bash
npm install
```

Playwright's Chromium browser installs automatically via the `postinstall` script.

## Usage

Capture screenshots:

```bash
npm start
```

View live charts in the browser:

```bash
npm run dashboard
```

## Configuration

- **Timeframes and settings**: edit `src/config.js`
- **Chart layout**: edit `src/dashboard/index.html`

## Output

Screenshots are saved in the `screenshots/` folder with the naming pattern `XAUUSD_[timeframe]_[date]_[time].png`.
