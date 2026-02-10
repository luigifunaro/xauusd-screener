const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function buildChartUrl(symbol, interval) {
  const params = new URLSearchParams({
    frameElementId: 'tradingview_capture',
    symbol: `OANDA:${symbol}`,
    interval,
    theme: 'light',
    style: '1',
    locale: 'it',
    enable_publishing: '0',
    allow_symbol_change: '0',
    hide_side_toolbar: '0',
    hide_top_toolbar: '0',
    withdateranges: '1',
    hide_volume: '0',
    timezone: 'Etc/UTC',
    utm_source: 'localhost',
    utm_medium: 'widget_new',
    utm_campaign: 'chart',
    utm_term: `OANDA:${symbol}`,
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

async function captureWithRetry(page, filePath, retries) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.screenshot({ path: filePath });
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.error(`  Retry ${attempt + 1}/${retries} for ${path.basename(filePath)}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Inject studies (SMA/EMA) into the chart using the internal TradingView API.
 * Uses chartWidget.model().createStudyInserter() which works on widgetembed pages.
 */
async function injectStudies(page, studies) {
  return page.evaluate(async (studiesCfg) => {
    const cw = window.chartWidget;
    if (!cw) return { ok: false, error: 'no chartWidget' };

    const results = [];
    for (const study of studiesCfg) {
      try {
        const inserter = cw.model().createStudyInserter(
          { type: 'java', studyId: study.id },
          [],
          {}
        );
        inserter.setPropertiesState({
          styles: {
            [study.plotName]: study.styles,
          },
        });
        await inserter.insert(() =>
          Promise.resolve({ inputs: study.inputs, parentSources: [] })
        );
        results.push({ id: study.id, ok: true });
      } catch (e) {
        results.push({ id: study.id, ok: false, error: String(e) });
      }
    }
    return { ok: true, results };
  }, studies);
}

async function capture(options = {}) {
  const {
    timeframes: tfFilter,
    viewport,
    returnBuffers = false,
  } = options;

  const screenshotsDir = path.resolve(__dirname, '..', config.screenshotsDir);
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const ts = timestamp();
  const results = [];
  let browser;

  // Filter timeframes if specified
  const selectedTimeframes = tfFilter
    ? config.timeframes.filter((tf) =>
        tfFilter.some((f) => f.toUpperCase() === tf.filename.toUpperCase() || f === tf.value)
      )
    : config.timeframes;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    });

    const context = await browser.newContext({
      viewport: viewport || config.viewport,
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
    });

    for (const tf of selectedTimeframes) {
      const page = await context.newPage();
      page.on('dialog', (d) => d.dismiss());

      const url = buildChartUrl(config.symbol, tf.value);
      console.error(`Loading ${tf.label} chart...`);

      await page.goto(url, { waitUntil: 'load' });

      try {
        await page.waitForSelector('canvas', { timeout: 15000 });
      } catch {
        console.error(`  Warning: canvas not found for ${tf.label}, capturing anyway`);
      }

      // Wait for chart to be fully ready before injecting studies
      await page.waitForTimeout(config.waitTime);

      // Dismiss any popups
      await page.evaluate(() => {
        document.querySelectorAll('[class*="close"], [class*="dismiss"]').forEach((el) => {
          try { el.click(); } catch (e) {}
        });
      });

      // Inject SMA and EMA studies with custom inputs and styles
      const studyResult = await injectStudies(page, config.studies);
      if (studyResult.ok && studyResult.results) {
        for (const r of studyResult.results) {
          if (r.ok) {
            console.error(`  Added: ${r.id}`);
          } else {
            console.error(`  Warning: ${r.id} failed - ${r.error}`);
          }
        }
      } else {
        console.error(`  Warning: study injection failed - ${studyResult.error || 'unknown'}`);
      }

      // Wait for studies to render
      await page.waitForTimeout(config.studyWaitTime);

      // Dismiss any error popups before screenshot
      await page.evaluate(() => {
        document.querySelectorAll('button').forEach((btn) => {
          if (btn.textContent.includes('Ho capito') || btn.textContent.includes('OK')) {
            btn.click();
          }
        });
      });
      await page.waitForTimeout(300);

      if (returnBuffers) {
        const buffer = await page.screenshot();
        results.push({ timeframe: tf.filename, label: tf.label, buffer });
        console.error(`  Captured: ${tf.label}`);
      } else {
        const filename = `${config.symbol}_${tf.filename}_${ts}.png`;
        const filePath = path.join(screenshotsDir, filename);
        await captureWithRetry(page, filePath, config.maxRetries);
        results.push(filePath);
        console.error(`  Saved: ${filename}`);
      }

      await page.close();
    }
  } finally {
    if (browser) await browser.close();
  }

  return results;
}

module.exports = capture;
