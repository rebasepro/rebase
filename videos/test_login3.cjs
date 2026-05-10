const puppeteer = require("puppeteer");
(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=1920,1080"] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', request => console.log('REQ FAIL:', request.url(), request.failure().errorText));

  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    await page.waitForSelector('[role="checkbox"]');
    await page.click('[role="checkbox"]');
  } catch (e) {}
  await new Promise(r => setTimeout(r, 500));

  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find(b => b.textContent.includes("Sign in with email"));
      if (btn) btn.click();
    });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 1000));

  try {
    await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
    await page.click('button[type="submit"]');
  } catch (e) {}
  
  await new Promise(r => setTimeout(r, 5000));
  
  await browser.close();
})();
