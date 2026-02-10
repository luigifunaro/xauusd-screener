const fs = require('fs');
const path = require('path');
const capture = require('./src/capture');

const screenshotsDir = path.resolve(__dirname, 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

const now = new Date().toLocaleString();
console.log('========================================');
console.log('  XAUUSD Multi-Timeframe Screener');
console.log(`  ${now}`);
console.log('========================================\n');

const start = Date.now();

capture()
  .then((files) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nScreenshots captured (${files.length}):`);
    files.forEach((f) => console.log(`  ${path.relative(__dirname, f)}`));
    console.log(`\nDone in ${elapsed}s`);
  })
  .catch((err) => {
    console.error('\nError during capture:', err.message || err);
    process.exit(1);
  });
