import { chromium } from '@playwright/test';

(async () => {
  console.log("Launching browser...");
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 }
  });
  
  const fileUrl = `file://${process.cwd()}/og-template.html`;
  console.log("Navigating to " + fileUrl);
  
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  
  // Wait a moment for web fonts to load
  await page.waitForTimeout(2000);
  
  console.log("Taking screenshots...");
  await page.screenshot({ path: './website/public/img/teaser.png' });
  await page.screenshot({ path: './website/public/img/twitter_teaser.png' });
  
  await browser.close();
  console.log("Done!");
})();
