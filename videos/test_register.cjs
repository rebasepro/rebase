const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:5173/c/posts', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  let needsLogin = await page.evaluate(() => document.body.innerHTML.includes('Sign in'));
  if (needsLogin) {
    console.log('Needs login, trying to register');
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const createOne = elements.find(el => el.textContent.trim() === 'Create one' || el.textContent.includes('Sign up'));
      if (createOne) createOne.click();
    });
    
    await new Promise(r => setTimeout(r, 1000));
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      const testEmail = `admin${Date.now()}@rebase.com`;
      console.log('Using email:', testEmail);
      await inputs[0].type(testEmail);
      await inputs[1].type('password123');
      
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Create') || b.textContent.includes('Register') || b.textContent.includes('Sign up'));
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log('After register, URL:', await page.url());
  await page.screenshot({ path: 'test_screen2.png' });
  await browser.close();
})();
