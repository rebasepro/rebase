/**
 * fix_v2.cjs — Fix broken/weak segments from the V2 recording batch.
 *
 * Targets: 07_search_live (broken clear), 09_bulk_select (0 frames), 10_rapid_nav (0 frames)
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const { execSync } = require("child_process");

const SEGMENTS_DIR = "segments_v2";
const FPS = 24;
const SCREENSHOT_INTERVAL = 42;

async function login(page) {
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));
  const needsLogin = await page.evaluate(() =>
    document.body.innerHTML.includes("Sign in with email")
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

async function smoothScroll(page, dir = "down", steps = 6, dist = 80) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d, px) => {
      const el = document.querySelector("main") || document.documentElement;
      el.scrollBy({ top: d === "down" ? px : -px, behavior: "smooth" });
    }, dir, dist);
    await new Promise(r => setTimeout(r, 100));
  }
}

async function recordSegment(page, name, viewport, actions) {
  console.log(`\n━━━ Fixing: ${name} (${viewport.width}×${viewport.height}) ━━━`);
  await page.setViewport(viewport);
  await new Promise(r => setTimeout(r, 500));

  const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  let recording = true;

  // Take one screenshot immediately to prime things
  await page.screenshot({ path: `${framesDir}/f-00000.png` });
  frameCount = 1;

  const timer = setInterval(async () => {
    if (!recording) return;
    try {
      await page.screenshot({ path: `${framesDir}/f-${String(frameCount).padStart(5, "0")}.png` });
      frameCount++;
    } catch {}
  }, SCREENSHOT_INTERVAL);

  await new Promise(r => setTimeout(r, 500));
  await actions(page);
  await new Promise(r => setTimeout(r, 600));

  recording = false;
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 200));

  console.log(`  → ${frameCount} frames`);

  const outPath = `${SEGMENTS_DIR}/${name}.mp4`;
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  try {
    execSync(`ffmpeg -y -framerate ${FPS} -i ${framesDir}/f-%05d.png -c:v libx264 -pix_fmt yuv420p -preset fast "${outPath}" 2>/dev/null`);
    console.log(`  → ${outPath}`);
  } catch (err) {
    console.error(`  ✗ ffmpeg: ${err.message}`);
  }
}

(async () => {
  console.log("Fixing V2 segments...\n");

  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=2560,1600"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1920, height: 1080 });
  await login(page);

  // ═══════════════════════════════════════════════════════════════════
  // FIX 07: Search — type one term, wait, clear properly, type another
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "07_search_live", { width: 1300, height: 800 }, async (p) => {
    const searchInput = await p.$('input[placeholder="Search"]');
    if (searchInput) {
      await searchInput.click();
      await new Promise(r => setTimeout(r, 400));

      // Type "React" slowly
      await p.keyboard.type("React", { delay: 130 });
      await new Promise(r => setTimeout(r, 1500));

      // Clear properly — use triple-click then delete
      await searchInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 1200));

      // Type "Node" slowly
      await p.keyboard.type("Node", { delay: 130 });
      await new Promise(r => setTimeout(r, 1500));

      // Clear again
      await searchInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 800));
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // FIX 09: Bulk select — use direct checkbox clicking with proper waits
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForFunction(() => document.body.innerText.includes("Deploying Hono"), { timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  await recordSegment(page, "09_bulk_select", { width: 1200, height: 800 }, async (p) => {
    // Find checkboxes by selector
    const checkboxes = await p.$$('[role="checkbox"]');
    console.log(`  Found ${checkboxes.length} checkboxes`);

    // Click first 4 checkboxes one by one
    const count = Math.min(4, checkboxes.length);
    for (let i = 0; i < count; i++) {
      await checkboxes[i].click();
      await new Promise(r => setTimeout(r, 500));
    }
    // Wait to show selected state
    await new Promise(r => setTimeout(r, 1000));

    // Unselect them
    for (let i = count - 1; i >= 0; i--) {
      await checkboxes[i].click();
      await new Promise(r => setTimeout(r, 400));
    }
    await new Promise(r => setTimeout(r, 600));
  });

  // ═══════════════════════════════════════════════════════════════════
  // FIX 10: Rapid nav — use direct URL navigation instead of sidebar clicks
  // ═══════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "10_rapid_nav", { width: 1600, height: 950 }, async (p) => {
    const routes = [
      { url: "http://localhost:5173/c/orders", wait: "ORD-2025" },
      { url: "http://localhost:5173/c/products", wait: "Products" },
      { url: "http://localhost:5173/c/tickets", wait: "Tickets" },
      { url: "http://localhost:5173/c/customers", wait: "Customers" },
      { url: "http://localhost:5173/c/posts", wait: "Blog posts" },
    ];
    for (const route of routes) {
      await p.goto(route.url, { waitUntil: "networkidle0" });
      await p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 8000 }, route.wait).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
    }
  });

  await browser.close();

  console.log("\n\n═══════════════════════════════════════════════════");
  console.log("  V2 FIXES COMPLETE");
  console.log("═══════════════════════════════════════════════════\n");
  for (const name of ["07_search_live", "09_bulk_select", "10_rapid_nav"]) {
    const path = `${SEGMENTS_DIR}/${name}.mp4`;
    if (fs.existsSync(path)) {
      const st = fs.statSync(path);
      console.log(`  📹 ${name}.mp4  (${(st.size / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`  ✗ ${name}.mp4 — MISSING`);
    }
  }
  console.log();
})();
