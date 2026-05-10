/**
 * record_bento_segments.cjs
 *
 * Captures multiple short video segments of the Rebase admin dashboard in dark mode.
 * Each segment has a DIFFERENT viewport/crop and shows a SPECIFIC interaction.
 * These are meant to be composed into a bento-box promotional animation.
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const { execSync } = require("child_process");

const SEGMENTS_DIR = "segments";
const FPS = 20; // screenshot every 50ms → 20fps for smooth video
const SCREENSHOT_INTERVAL = 50;

// ── LOGIN HELPER ───────────────────────────────────────────────────
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

// ── RECORDING HELPER ───────────────────────────────────────────────
async function recordSegment(page, name, viewport, actions) {
  console.log(`\n━━━ Recording segment: ${name} (${viewport.width}x${viewport.height}) ━━━`);

  // Set the viewport for this segment's specific crop
  await page.setViewport(viewport);
  await new Promise(r => setTimeout(r, 500));

  const framesDir = `${SEGMENTS_DIR}/${name}/frames`;
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

  // Wait a beat before starting the interaction so there's a "static" lead-in
  await new Promise(r => setTimeout(r, 600));

  // Execute the actions
  await actions(page);

  // Wait a beat after actions for a "static" tail
  await new Promise(r => setTimeout(r, 800));

  recording = false;
  clearInterval(timer);
  await new Promise(r => setTimeout(r, 200));

  console.log(`  → Captured ${frameCount} frames`);

  // Convert to mp4
  const outPath = `${SEGMENTS_DIR}/${name}.mp4`;
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  try {
    execSync(`ffmpeg -y -framerate ${FPS} -i ${framesDir}/f-%05d.png -c:v libx264 -pix_fmt yuv420p -preset fast "${outPath}" 2>/dev/null`);
    console.log(`  → Video: ${outPath}`);
  } catch (err) {
    console.error(`  ✗ ffmpeg failed for ${name}:`, err.message);
  }
}

// ── MAIN ───────────────────────────────────────────────────────────
(async () => {
  console.log("Starting bento segment recording...\n");

  if (fs.existsSync(SEGMENTS_DIR)) fs.rmSync(SEGMENTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new", args: ["--window-size=2560,1600"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.setViewport({ width: 1920, height: 1080 });

  await login(page);

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 1: Dashboard Scorecards
  // Wide landscape crop showing the insight scorecards at the top.
  // Interaction: hover over the cards to show the subtle highlights.
  // ════════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "01_dashboard_scorecards", { width: 1400, height: 500 }, async (p) => {
    // Hover over each scorecard in sequence
    await p.mouse.move(400, 180);
    await new Promise(r => setTimeout(r, 600));
    await p.mouse.move(650, 180);
    await new Promise(r => setTimeout(r, 600));
    await p.mouse.move(900, 180);
    await new Promise(r => setTimeout(r, 600));
    await p.mouse.move(1150, 180);
    await new Promise(r => setTimeout(r, 600));
    // Click into Orders collection
    await p.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a, [role='link'], .cursor-pointer"));
      const orders = links.find(l => l.textContent.includes("Orders"));
      if (orders) orders.click();
    });
    await new Promise(r => setTimeout(r, 1500));
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 2: Blog Posts Card Grid
  // Square-ish crop showing the gorgeous card grid with images.
  // Interaction: scroll down slowly to reveal more cards.
  // ════════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "02_posts_card_grid", { width: 1200, height: 900 }, async (p) => {
    // Smooth scroll down
    for (let i = 0; i < 15; i++) {
      await p.evaluate(() => window.scrollBy(0, 30));
      await new Promise(r => setTimeout(r, 80));
    }
    await new Promise(r => setTimeout(r, 400));
    // Scroll back up
    for (let i = 0; i < 15; i++) {
      await p.evaluate(() => window.scrollBy(0, -30));
      await new Promise(r => setTimeout(r, 80));
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 3: Orders List — Status Badges
  // Tall narrow crop focused on the order rows + status badges.
  // Interaction: hover over rows, then click one to open detail.
  // ════════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/orders", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "03_orders_list", { width: 1000, height: 800 }, async (p) => {
    // Hover over successive order rows
    for (let y = 300; y <= 700; y += 60) {
      await p.mouse.move(500, y);
      await new Promise(r => setTimeout(r, 300));
    }
    // Click an order row to open it
    await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".cursor-pointer"));
      if (rows.length > 2) rows[2].click();
    });
    await new Promise(r => setTimeout(r, 2000));
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 4: Table View — Data-Rich Table
  // Full-width crop of the table view with all columns visible.
  // Interaction: hover header, then click a row to open side panel.
  // ════════════════════════════════════════════════════════════════════
  await page.goto("http://localhost:5173/c/posts?__view=table", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "04_table_view", { width: 1600, height: 700 }, async (p) => {
    // Hover across table headers
    await p.mouse.move(220, 107);
    await new Promise(r => setTimeout(r, 400));
    await p.mouse.move(380, 107);
    await new Promise(r => setTimeout(r, 400));
    await p.mouse.move(540, 107);
    await new Promise(r => setTimeout(r, 400));
    await p.mouse.move(870, 107);
    await new Promise(r => setTimeout(r, 400));
    // Click row 3
    await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr"));
      if (rows.length > 3) rows[3].click();
    });
    await new Promise(r => setTimeout(r, 2000));
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 5: Entity Editor — Editing a Field
  // Right-side crop showing the entity form with fields.
  // Interaction: click into a text field, type, then blur.
  // ════════════════════════════════════════════════════════════════════
  // Navigate to posts, open one via its direct URL pattern
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));
  // Click first card to open entity
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".cursor-pointer"));
    if (cards.length > 0) cards[0].click();
  });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "05_entity_editor", { width: 800, height: 1000 }, async (p) => {
    // Find a text input and type into it
    const inputs = await p.$$('input[type="text"], textarea');
    if (inputs.length > 0) {
      const target = inputs[0];
      await target.click();
      await new Promise(r => setTimeout(r, 300));
      // Select all existing text then type new text
      await p.keyboard.down("Meta");
      await p.keyboard.press("a");
      await p.keyboard.up("Meta");
      await new Promise(r => setTimeout(r, 200));
      await p.keyboard.type("Deploying Hono to Cloudflare Workers and Deno Deploy", { delay: 40 });
      await new Promise(r => setTimeout(r, 500));
      // Click elsewhere to blur
      await p.mouse.click(400, 800);
      await new Promise(r => setTimeout(r, 800));
    }
    // Scroll down in the editor to show more fields
    await p.evaluate(() => {
      const panel = document.querySelector('[class*="overflow-auto"], [class*="scroll"]');
      if (panel) panel.scrollBy(0, 200);
    });
    await new Promise(r => setTimeout(r, 1000));
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 6: Products Catalog Grid
  // Medium square crop of the products grid with category badges.
  // Interaction: hover over products, click one.
  // ════════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/products", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "06_products_grid", { width: 1100, height: 700 }, async (p) => {
    // Hover over product cards
    for (let x = 300; x <= 900; x += 200) {
      await p.mouse.move(x, 300);
      await new Promise(r => setTimeout(r, 400));
    }
    // Click a product card
    await p.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".cursor-pointer"));
      if (cards.length > 3) cards[3].click();
    });
    await new Promise(r => setTimeout(r, 2000));
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 7: Sidebar Navigation
  // Narrow tall crop of just the sidebar + part of content.
  // Interaction: click through different collections in the sidebar.
  // ════════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "07_sidebar_nav", { width: 500, height: 800 }, async (p) => {
    // Click through sidebar items (icons are at x≈28)
    const sidebarItems = [
      { y: 108, name: "authors" },
      { y: 140, name: "posts" },
      { y: 170, name: "profiles" },
      { y: 225, name: "customers" },
      { y: 255, name: "orders" },
      { y: 285, name: "products" },
      { y: 340, name: "tickets" },
    ];
    for (const item of sidebarItems) {
      await p.mouse.click(28, item.y);
      await new Promise(r => setTimeout(r, 800));
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // SEGMENT 8: Search & Filter
  // Upper-right crop showing search bar + filter controls.
  // Interaction: click search, type a query, see results filter.
  // ════════════════════════════════════════════════════════════════════
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:5173/c/posts", { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 3000));

  await recordSegment(page, "08_search_filter", { width: 1200, height: 700 }, async (p) => {
    // Click search input
    const searchInput = await p.$('input[placeholder="Search"]');
    if (searchInput) {
      await searchInput.click();
      await new Promise(r => setTimeout(r, 300));
      await p.keyboard.type("TypeScript", { delay: 80 });
      await new Promise(r => setTimeout(r, 1500));
      // Clear search
      await p.keyboard.down("Meta");
      await p.keyboard.press("a");
      await p.keyboard.up("Meta");
      await p.keyboard.press("Backspace");
      await new Promise(r => setTimeout(r, 1000));
    }
  });

  await browser.close();

  // ── SUMMARY ──────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════");
  console.log("  BENTO SEGMENTS COMPLETE");
  console.log("═══════════════════════════════════════════════════\n");
  const files = fs.readdirSync(SEGMENTS_DIR).filter(f => f.endsWith(".mp4"));
  files.forEach(f => {
    const stats = fs.statSync(`${SEGMENTS_DIR}/${f}`);
    console.log(`  📹 ${f} (${(stats.size / 1024).toFixed(0)} KB)`);
  });
  console.log(`\nAll segments in: ${SEGMENTS_DIR}/\n`);
})();
