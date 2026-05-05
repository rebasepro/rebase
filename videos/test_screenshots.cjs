const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    defaultViewport: { width: 1920,
height: 1080 }
  });
  const page = await browser.newPage();

  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await page.screenshot({ path: "screen1.png" });

  // Click first card or row
  // Rebase admin uses cards or rows. Let's try to find an anchor tag inside main content
  const links = await page.$$('a[href*="/c/posts/"]');
  if (links.length > 0) {
    await links[0].click();
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: "screen2.png" });
  }

  await browser.close();
})();
