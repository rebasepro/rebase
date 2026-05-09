const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  await page.evaluate(() => { const cb = document.querySelector('[role="checkbox"]'); if (cb) cb.click(); });
  await new Promise(r => setTimeout(r, 500));
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const btn = btns.find(b => b.textContent.includes("Sign in with email"));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Use Puppeteer to type and press Enter
  await page.focus('input[type="password"]');
  await page.keyboard.press('Enter');
  
  await new Promise(r => setTimeout(r, 3000));
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log("TEXT:\n", text);
  await browser.close();
})();
