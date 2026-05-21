import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  console.log("Launching browser...");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const consoleLogs = [];
  const networkErrors = [];
  const images = [];

  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  page.on('requestfailed', request => {
    networkErrors.push({ url: request.url(), errorText: request.failure().errorText });
  });

  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 400) {
      networkErrors.push({ url, status });
    }
    // Track images
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i) || response.headers()['content-type']?.startsWith('image/')) {
      images.push({ url, status });
    }
  });

  const targetUrl = 'http://localhost:4321/product';
  console.log(`Setting cookie consent and navigating to ${targetUrl}...`);
  await context.addCookies([{
    name: 'cookie-consent',
    value: 'accepted',
    url: 'http://localhost:4321'
  }]);
  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  // Wait a bit for animations
  await page.waitForTimeout(3000);

  // Scroll down slowly to trigger all scroll animations
  console.log("Scrolling slowly to trigger animations...");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  });

  // Wait for any remaining animations to finish
  await page.waitForTimeout(2000);

  const artifactDir = '/Users/francesco/.gemini/antigravity/brain/200eda54-606d-4cca-aafb-a343a3107fbf';
  const fullScreenshot = path.join(artifactDir, 'product_fullpage.png');
  console.log(`Taking full-page screenshot: ${fullScreenshot}`);
  await page.screenshot({ path: fullScreenshot, fullPage: true });

  // Gather some metrics and content details
  const pageDetails = await page.evaluate(() => {
    return {
      title: document.title,
      h1: document.querySelector('h1')?.innerText || 'None',
      headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        tag: h.tagName,
        text: h.innerText
      })),
      links: Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href
      })),
      images: Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        alt: img.alt
      })),
    };
  });

  const report = {
    consoleLogs,
    networkErrors,
    images,
    pageDetails
  };

  const reportPath = path.join(artifactDir, 'product_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to ${reportPath}`);

  await browser.close();
  console.log("Browser closed. Finished!");
})();
