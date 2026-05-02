const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1920,1080']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173/c/posts', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'debug1.png' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'debug2.png' });
  
  if (page.url().includes('login') || page.url().includes('auth')) {
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const createOne = elements.find(el => el.textContent.trim() === 'Create one' || el.textContent.trim() === 'Sign up');
      if (createOne) createOne.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    const inputs = await page.$$('input');
    if (inputs.length >= 3) {
      await inputs[0].type(`VideoUser${Date.now()}`);
      await inputs[1].type(`video${Date.now()}@test.com`);
      await inputs[2].type('Video123!');
    }
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const createAcc = buttons.find(b => b.textContent.includes('Create Account') || b.textContent.includes('Sign Up') || b.textContent.includes('Register') || b.textContent.includes('Create account'));
      if (createAcc) createAcc.click();
    });
    await page.waitForFunction('window.location.pathname.includes("/c/")', { timeout: 10000 }).catch(() => {});
  }
  
  await page.goto('http://localhost:5173/c/posts?__view=table', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'debug3.png' });
  
  await browser.close();
})();
