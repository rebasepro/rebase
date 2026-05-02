const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/c/posts', {waitUntil: 'networkidle0'});
  console.log(await page.content());
  await browser.close();
})();
