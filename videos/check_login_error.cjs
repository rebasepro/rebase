const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=1920,1080"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  let needsLogin = await page.evaluate(() => document.body.innerHTML.includes("Sign in with email") || document.body.innerHTML.includes("Sign in"));
  if (needsLogin) {
    await page.evaluate(() => { const cb = document.querySelector('input[type="checkbox"]'); if (cb) cb.click(); });
    await new Promise(r => setTimeout(r, 500));
    
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find(b => b.textContent.includes("Sign in with email"));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const btn = btns.find(b => b.textContent === "Sign in");
      if (btn) btn.click();
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log("PAGE TEXT AFTER LOGIN:");
    console.log(pageText);
  }
  await browser.close();
})();
