module.exports = {
  symbol: 'XAUUSD',
  timeframes: [
    { value: '5', label: '5 Min', filename: '5M' },
    { value: '15', label: '15 Min', filename: '15M' },
    { value: '30', label: '30 Min', filename: '30M' },
    { value: '60', label: '1H', filename: '1H' },
    { value: '240', label: '4H', filename: '4H' },
  ],
  studies: [
    {
      id: 'MASimple@tv-basicstudies',
      plotName: 'MovAvgSimple',
      inputs: { length: 265 },
      styles: { color: '#00bcd4', linewidth: 3 },
    },
    {
      id: 'MAExp@tv-basicstudies',
      plotName: 'MovAvgExp',
      inputs: { length: 75 },
      styles: { color: '#2962ff', linewidth: 3 },
    },
  ],
  screenshotsDir: 'screenshots',
  viewport: { width: 1920, height: 1200 },
  waitTime: 3000,
  studyWaitTime: 2000,
  maxRetries: 2,
};
