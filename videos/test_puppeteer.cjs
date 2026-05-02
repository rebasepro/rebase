const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173/c/posts', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  let needsLogin = await page.evaluate(() => document.body.innerHTML.includes('Sign in'));
  console.log('needsLogin:', needsLogin, await page.url());
  
  if (needsLogin) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Sign in with email'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    const inputs = await page.$$('input');
    console.log('Inputs found:', inputs.length);
    if (inputs.length >= 2) {
      await inputs[0].type('admin@rebase.com');
      await inputs[1].type('password123');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.trim() === 'Sign in' && !b.disabled);
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log('After login wait, URL:', await page.url());
  await page.screenshot({ path: 'test_screen.png' });
  await browser.close();
})();
