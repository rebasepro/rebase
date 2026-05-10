/**
 * fix_segments.cjs
 *
 * Re-records segments 02, 05, and 06 which had issues in the first run.
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const { execSync } = require("child_process");

const SEGMENTS_DIR = "segments";
const FPS = 20;
const SCREENSHOT_INTERVAL = 50;

async function login(page) {
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));
  const needsLogin = await page.evaluate(() =>
    document.body.innerHTML.includes("Sign in with email") || document.body.innerHTML.includes("Sign in")
  );
  if (!needsLogin) return;

  try { await page.waitForSelector('[role="checkbox"]'); await page.click('[role="checkbox"]'); } catch {}
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Sign in with email"));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  try { await page.waitForSelector('button[type="submit"]', { timeout: 5000 }); await page.click('button[type="submit"]'); } catch {}
  await new Promise(r => setTimeout(r, 4000));
  await page.waitForFunction(() => !document.body.innerHTML.includes("Sign in with email"), { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
}

async function recordSegment(page, name, viewport, actions) {
  console.log(`\n━━━ Recording segment: ${name} (${viewport.width}x${viewport.height}) ━━━`);
  await page.setViewport(viewport);
  await new Promise(r => setTimeout(r, 500));

  const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  let recording = true;

  const timer = setInterval(async () => {
    if (!recording) return;
    try {
      await page.screenshot({ path: `${framesDir}/f-${String(frameCount).padStart(5, "0")}.png` });
      frameCount++;
    } catch {}
  }, SCREENSHOT_INTERVAL);

  await new Promise(r => setTimeout(r, 600));
  await actions(page);
  await new Promise(r => setTimeout(r, 800));

  recording = false;
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 200));

  console.log(`  → Captured ${frameCount} frames`);

  const outPath = `${SEGMENTS_DIR}/${name}.mp4`;
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  try {
    execSync(`ffmpeg -y -framerate ${FPS} -i ${framesDir}/f-%05d.png -c:v libx264 -pix_fmt yuv420p -preset fast "${outPath}" 2>/dev/null`);
    console.log(`  → Video: ${outPath}`);
  } catch (err) {
    console.error(`  ✗ ffmpeg failed for ${name}:`, err.message);
  }
}

(async () => {
  console.log("Fixing broken segments...\n");

  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=2560,1600"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1920, height: 1080 });

  await login(page);

  // ═══ FIX SEGMENT 02: Blog Posts Card Grid ═══
  // Problem: data hadn't loaded. Fix: navigate FIRST, wait for cards to appear, THEN record.
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 4000));
  // Wait until at least some card content is visible
  await page.waitForFunction(() => {
    return document.querySelectorAll("img").length > 3;
  }, { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  await recordSegment(page, "02_posts_card_grid", { width: 1200, height: 900 }, async (p) => {
    // Smooth scroll down to reveal more cards
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => {
        const main = document.querySelector("main") || document.documentElement;
        main.scrollBy({ top: 60, behavior: "smooth" });
      });
      await new Promise(r => setTimeout(r, 120));
    }
    await new Promise(r => setTimeout(r, 600));
    // Hover over cards
    for (let x = 250; x <= 900; x += 220) {
      await p.mouse.move(x, 350);
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 400));
    // Smooth scroll back up
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => {
        const main = document.querySelector("main") || document.documentElement;
        main.scrollBy({ top: -60, behavior: "smooth" });
      });
      await new Promise(r => setTimeout(r, 120));
    }
  });

  // ═══ FIX SEGMENT 05: Entity Editor ═══
  // Problem: the viewport was set small before navigating, so the sidebar collapsed
  // and the click didn't hit a card. Fix: navigate and open entity BEFORE shrinking viewport.
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 4000));
  await page.waitForFunction(() => document.querySelectorAll("img").length > 3, { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  // Click the FIRST card's image or title to open the entity
  await page.evaluate(() => {
    // Find the first card with an actual title text
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"]');
    // Try clicking a card element directly
    if (cards.length > 0) {
      cards[0].click();
      return;
    }
    // Fallback: find any clickable row
    const links = document.querySelectorAll("a[href*='/c/posts/']");
    if (links.length > 0) links[0].click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // Now check if we're on an entity page (URL should have /c/posts/NUMBER)
  const url = page.url();
  console.log(`  Entity URL: ${url}`);
  
  // If we're not on an entity page, try clicking on row 150 (first item)
  if (!url.match(/\/c\/posts\/\d+/)) {
    console.log("  Click didn't land on entity, trying direct navigation...");
    await page.goto("http://localhost:5173/c/posts/150", { waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 4000));
  }

  // Now shrink the viewport to get a tight editor crop
  await recordSegment(page, "05_entity_editor", { width: 900, height: 1000 }, async (p) => {
    // Scroll down in the form to show more fields
    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => {
        const main = document.querySelector("main") || document.documentElement;
        main.scrollBy({ top: 80, behavior: "smooth" });
      });
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 800));
    // Scroll back up
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => {
        const main = document.querySelector("main") || document.documentElement;
        main.scrollBy({ top: -80, behavior: "smooth" });
      });
      await new Promise(r => setTimeout(r, 200));
    }
  });

  // ═══ FIX SEGMENT 06: Products Grid ═══
  // Problem: click hit a toolbar import button. Fix: navigate, wait for data, hover only (no clicks).
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/products", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 5000));
  // Wait for product names to render
  await page.waitForFunction(() => {
    return document.body.innerText.includes("Protein Bar") || document.body.innerText.includes("Garden Tool");
  }, { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  await recordSegment(page, "06_products_grid", { width: 1100, height: 700 }, async (p) => {
    // Just hover over product cards — no clicking to avoid modal accidents
    for (let y = 200; y <= 500; y += 100) {
      for (let x = 250; x <= 900; x += 200) {
        await p.mouse.move(x, y);
        await new Promise(r => setTimeout(r, 250));
      }
    }
    await new Promise(r => setTimeout(r, 400));
    // Smooth scroll down a bit
    for (let i = 0; i < 5; i++) {
      await p.evaluate(() => {
        const main = document.querySelector("main") || document.documentElement;
        main.scrollBy({ top: 50, behavior: "smooth" });
      });
      await new Promise(r => setTimeout(r, 150));
    }
    await new Promise(r => setTimeout(r, 500));
  });

  await browser.close();

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  FIXED SEGMENTS COMPLETE");
  console.log("═══════════════════════════════════════════════════\n");
  ["02_posts_card_grid", "05_entity_editor", "06_products_grid"].forEach(name => {
    const f = `${SEGMENTS_DIR}/${name}.mp4`;
    if (fs.existsSync(f)) {
      const stats = fs.statSync(f);
      console.log(`  📹 ${name}.mp4 (${(stats.size / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`  ✗ ${name}.mp4 missing`);
    }
  });
  console.log();
})();
